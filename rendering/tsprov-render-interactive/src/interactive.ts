// The interactive-HTML emitter — `renderInteractiveHtml` + `InteractiveRenderer`.
//
// This is the vision centerpiece: ONE self-contained HTML file a tool can emit and a
// human can open from `file://` with nothing installed. It projects the document to a
// scene ONCE (`toRenderScene`), bakes the layout ONCE (`layoutScene`, the render-svg
// seam — so dagre keeps exactly one owner and the geometry matches the static SVG),
// assembles a JSON payload (the positioned scene + a projected theme + meta with the
// precomputed disclosure set), escapes it so a hostile corpus literal cannot break out of
// its `<script>`, and inlines it into the authored template (shell/style/app, compiled to
// `template.generated.ts`). No network, no CDN, no build step for the consumer.
//
// Determinism: every input is deterministic (the scene, the dagre layout, the template
// constants) and the payload is `JSON.stringify` of an object built in fixed key order
// with geometry rounded to 2 decimals, so the same document + options yield byte-identical
// HTML. That is what lets the goldens hold.

import {
  toRenderScene,
  PROV_THEME,
  type ProvTheme,
  type NodeStyle,
  type NodeKind,
  type DeclaredNodeKind,
  type RelationKind,
  type Direction,
  type Renderer,
  type RendererOptions,
  type RenderScene,
  type RenderAttr,
} from "@inflexa-ai/tsprov-render-core";
import {
  layoutScene,
  toCssColor,
  type LayoutScene,
  type LayoutBox,
  type LayoutPoint,
} from "@inflexa-ai/tsprov-render-svg";
import type { ProvDocument } from "@inflexa-ai/tsprov";

import { SHELL_HTML, STYLE_CSS, APP_JS } from "./template.generated.js";

/**
 * The whole graph is shown initially when it has at most this many nodes; a larger graph
 * opens on a focus node plus its nearest neighbors (capped at {@link INITIAL_CAP}) so a
 * hundreds-of-record document (prov-inflexa.2: 151 nodes) is legible on load rather than a hairball.
 */
export const WHOLE_GRAPH_MAX = 50;

/**
 * The neighborhood reach for the initial visible set on a large graph: a nearest-hop-first
 * BFS explores at most this many hops out from the focus. It bounds the *shape* of the
 * opening cluster; {@link INITIAL_CAP} bounds its *size* and is what actually protects against
 * a super-hub, whose hop-1 alone overflows the cap before this reach ever matters.
 */
export const DISCLOSURE_HOPS = 2;

/**
 * The initial visible set on a large graph is capped at this many nodes (focus included),
 * admitted nearest-hop-first and, within a hop, in scene order. Without it the focus defaults
 * to the highest-degree node, and around a super-hub — prov-inflexa.2's 141-degree hub — the
 * neighborhood reveals almost the whole graph on load, an illegible band; the cap keeps the
 * opening view a readable ~{@link INITIAL_CAP}-node cluster the reader can then expand from.
 */
export const INITIAL_CAP = 40;

/**
 * One badge/expand action reveals at most this many further neighbors of the acted-on node
 * (its direct, still-hidden neighbors in scene order); the node's badge then recomputes to
 * the remaining hidden count. The client (`template/app.js`) enforces this at click time, so
 * the same value is declared there too — a drift test asserts the two agree. Keeps expanding a
 * super-hub incremental (20 at a time) instead of dumping 100+ nodes on a single click.
 */
export const EXPAND_CAP = 20;

/**
 * Options for {@link renderInteractiveHtml}: the {@link RendererOptions} common to every
 * renderer (scene projection toggles + a `theme` override), plus the layout `direction`,
 * an optional `focus` (the qualified name to open a large graph on), and a `title` shown
 * in the tab and header.
 */
export type InteractiveRenderOptions = RendererOptions & {
  /** Layout direction mapped to dagre's `rankdir` (default the theme's `"BT"`). */
  readonly direction?: Direction;
  /**
   * The qualified name (e.g. `"ex:e1"`) to center the initial visible set on when the graph
   * exceeds {@link WHOLE_GRAPH_MAX} nodes. Falls back to the highest-degree node when unset
   * or unmatched.
   */
  readonly focus?: string;
  /** Document title for the tab and header (default `"Provenance graph"`). */
  readonly title?: string;
};

// ── Payload shape (the contract with template/app.js) ───────────────────────────────

/** A projected node/edge style with browser-legal colors (Graphviz-only names resolved). */
type ProjectedNodeStyle = { readonly fill: string; readonly stroke?: string };

/** The theme projected to browser-legal colors — the client's source of note/blank/chip color. */
type ProjectedTheme = {
  readonly nodes: Readonly<Record<DeclaredNodeKind, ProjectedNodeStyle>>;
  readonly generic: Readonly<Record<NodeKind, ProjectedNodeStyle>>;
  readonly relations: Readonly<Record<RelationKind, { readonly color?: string; readonly fontcolor?: string }>>;
  readonly annotation: { readonly color: string; readonly fontcolor: string };
  readonly annotationLink: { readonly color: string };
  readonly decor: { readonly bundleFill: string; readonly bundleStroke: string; readonly bundleLabelFill: string };
};

/** A payload node: the positioned geometry plus the logical fields the panel/search need. */
type PayloadNode = {
  readonly id: string;
  readonly kind: NodeKind;
  readonly inferred: boolean;
  readonly glyph: string;
  readonly fill: string;
  readonly stroke?: string;
  readonly qualifiedName: string;
  readonly label: string;
  readonly labelLines: readonly string[];
  readonly uri?: string;
  readonly bundleId?: string;
  readonly attributes: readonly RenderAttr[];
  readonly box: LayoutBox;
};

/** A payload edge: the logical adjacency the disclosure engine walks (geometry is in segments). */
type PayloadEdge = {
  readonly id: string;
  readonly relation: RelationKind;
  readonly label: string;
  readonly source: string;
  readonly target: string;
  readonly naryLegs: readonly { readonly role: string; readonly target: string }[];
};

/** A payload segment: the drawable polyline + the node ids that gate its visibility. */
type PayloadSegment = {
  readonly stroke: string;
  readonly arrow: boolean;
  readonly dashed: boolean;
  readonly label?: string;
  readonly labelFill: string;
  readonly points: readonly LayoutPoint[];
  readonly labelPos?: LayoutPoint;
  readonly gates: readonly string[];
};

/** The precomputed initial-disclosure decision, embedded so the client needs no layout logic. */
type PayloadDisclosure = {
  readonly wholeGraph: boolean;
  readonly focusId: string | null;
  readonly initialVisibleIds: readonly string[];
  readonly hops: number;
  readonly wholeGraphMax: number;
};

/**
 * The complete embedded payload the client reads from `#prov-scene`. Plain, JSON-safe data
 * with 2-decimal geometry, built in fixed key order so `JSON.stringify` is byte-stable.
 */
export type ScenePayload = {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly PayloadNode[];
  readonly edges: readonly PayloadEdge[];
  readonly segments: readonly PayloadSegment[];
  readonly blanks: readonly { readonly box: LayoutBox; readonly gates: readonly string[] }[];
  readonly notes: readonly { readonly rows: readonly string[]; readonly box: LayoutBox; readonly gates: readonly string[] }[];
  readonly bundles: readonly { readonly id: string; readonly label: string; readonly uri?: string; readonly rect: LayoutBox | null }[];
  readonly markerColors: readonly string[];
  readonly theme: ProjectedTheme;
  readonly meta: {
    readonly title: string;
    readonly counts: { readonly nodes: number; readonly edges: number; readonly bundles: number; readonly skipped: number };
    readonly options: {
      readonly useLabels: boolean;
      readonly includeElementAttributes: boolean;
      readonly includeRelationAttributes: boolean;
      readonly showNary: boolean;
      readonly direction: Direction;
    };
    readonly disclosure: PayloadDisclosure;
  };
};

// ── Emitter ─────────────────────────────────────────────────────────────────────────

/**
 * Renders `doc` to ONE self-contained, interactive HTML document (the loop-mandated API):
 * inline CSS + vanilla JS, the dagre-positioned scene baked in as escaped JSON, no external
 * resource loads, fully functional from `file://`. Deterministic — same document + options
 * produce byte-identical HTML.
 *
 * @param doc     The document to render.
 * @param options Projection toggles, a `theme` override, layout `direction`, an optional
 *                disclosure `focus`, and a `title`.
 * @returns The HTML source (write it to a `.html`, email it, or serve it).
 */
export function renderInteractiveHtml(doc: ProvDocument, options?: InteractiveRenderOptions): string {
  const payload = buildScenePayload(doc, options);
  const payloadJson = JSON.stringify(payload);
  // Escape `<` as its JSON unicode escape so no corpus literal containing `</script>` (or
  // `<!--`) can terminate the JSON <script> block. `JSON.parse` restores it verbatim, so
  // the payload round-trips exactly; `JSON.stringify` already handles quotes/control chars.
  const escapedPayload = payloadJson.replace(/</g, "\\u003c");

  const title = options?.title ?? "Provenance graph";
  const values: Record<string, string> = {
    __PROV_TITLE__: escapeHtml(title),
    __PROV_STYLE__: STYLE_CSS,
    __PROV_PAYLOAD__: escapedPayload,
    __PROV_APP__: APP_JS,
  };
  // Single pass with a function replacer: each slot is filled with its value exactly once
  // and the injected values are NEVER re-scanned, so a value that happens to contain a
  // `__PROV_*__` literal (a hostile title, a payload attribute) cannot corrupt the output;
  // a function replacer also avoids `$`-pattern interpretation in the replacement.
  return SHELL_HTML.replace(/__PROV_(?:TITLE|STYLE|PAYLOAD|APP)__/g, (match) => {
    const value = values[match];
    // The regex only matches the four known tokens, so `value` is always defined; the guard
    // satisfies `noUncheckedIndexedAccess` without an assertion.
    return value ?? match;
  });
}

/**
 * `InteractiveRenderer` wraps {@link renderInteractiveHtml} in the shared {@link Renderer}
 * contract (`Renderer<string>`, `format: "html"`). Synchronous and deterministic.
 */
export class InteractiveRenderer implements Renderer<string, InteractiveRenderOptions> {
  /** The stable format identifier for this renderer. */
  readonly format = "html";

  /**
   * Renders `doc` to a self-contained interactive HTML string.
   *
   * @param doc     The document to render.
   * @param options Projection + presentation overrides.
   * @returns The HTML source.
   */
  render(doc: ProvDocument, options?: InteractiveRenderOptions): string {
    return renderInteractiveHtml(doc, options);
  }
}

/**
 * Builds the embedded {@link ScenePayload} for `doc` — the pure-data core of the emitter,
 * separated so tests can inspect the payload without parsing HTML. Projects the scene,
 * bakes the layout, projects the theme, zips the positioned nodes with their logical
 * fields, rounds geometry to 2 decimals, and precomputes the initial disclosure set.
 */
export function buildScenePayload(doc: ProvDocument, options?: InteractiveRenderOptions): ScenePayload {
  const scene = toRenderScene(doc, options);
  const positioned = layoutScene(scene, options);
  const theme = mergeTheme(options?.theme);

  const logicalById = new Map(scene.nodes.map((n) => [n.id, n]));

  const nodes: PayloadNode[] = positioned.nodes.map((pn): PayloadNode => {
    const logical = logicalById.get(pn.id);
    // Positioned and logical node lists are the same set in the same order (both come from
    // the one scene walk), so every positioned id has a logical twin.
    const qualifiedName = logical?.qualifiedName ?? pn.id;
    const label = logical?.label ?? qualifiedName;
    const attributes = logical?.attributes ?? [];
    const node: PayloadNode = {
      id: pn.id,
      kind: pn.kind,
      inferred: pn.inferred,
      glyph: pn.glyph,
      fill: pn.fill,
      qualifiedName,
      label,
      labelLines: pn.labelLines,
      attributes,
      box: roundBox(pn.box),
    };
    return {
      ...node,
      ...(pn.stroke !== undefined ? { stroke: pn.stroke } : {}),
      ...(pn.uri !== undefined ? { uri: pn.uri } : {}),
      ...(pn.bundleId !== undefined ? { bundleId: pn.bundleId } : {}),
    };
  });

  const edges: PayloadEdge[] = scene.edges.map((e) => ({
    id: e.id,
    relation: e.relation,
    label: e.label,
    source: e.source,
    target: e.target,
    naryLegs: e.naryLegs.map((leg) => ({ role: leg.role, target: leg.target })),
  }));

  const segments: PayloadSegment[] = positioned.segments.map((s): PayloadSegment => {
    const seg: PayloadSegment = {
      stroke: s.stroke,
      arrow: s.arrow,
      dashed: s.dashed,
      labelFill: s.labelFill,
      points: s.points.map(roundPoint),
      gates: s.gates,
    };
    return {
      ...seg,
      ...(s.label !== undefined ? { label: s.label } : {}),
      ...(s.labelPos !== undefined ? { labelPos: roundPoint(s.labelPos) } : {}),
    };
  });

  const blanks = positioned.blanks.map((b) => ({ box: roundBox(b.box), gates: b.gates }));
  const notes = positioned.notes.map((n) => ({ rows: n.rows, box: roundBox(n.box), gates: n.gates }));
  const bundles = positioned.bundles.map((b) => ({
    id: b.id,
    label: b.label,
    rect: b.rect === null ? null : roundBox(b.rect),
    ...(b.uri !== undefined ? { uri: b.uri } : {}),
  }));

  const disclosure = computeDisclosure(scene, options?.focus);

  return {
    width: round2(positioned.width),
    height: round2(positioned.height),
    nodes,
    edges,
    segments,
    blanks,
    notes,
    bundles,
    markerColors: positioned.markerColors,
    theme: projectTheme(theme),
    meta: {
      title: options?.title ?? "Provenance graph",
      counts: {
        nodes: scene.nodes.length,
        edges: scene.edges.length,
        bundles: scene.bundles.length,
        skipped: scene.skipped.length,
      },
      options: {
        useLabels: options?.useLabels ?? false,
        includeElementAttributes: options?.includeElementAttributes ?? true,
        includeRelationAttributes: options?.includeRelationAttributes ?? true,
        showNary: options?.showNary ?? true,
        direction: resolveDirection(options?.direction, theme.direction),
      },
      disclosure,
    },
  };
}

// ── Disclosure ────────────────────────────────────────────────────────────────────

/**
 * Precomputes the initial visible set: the whole graph when it has ≤ {@link WHOLE_GRAPH_MAX}
 * nodes, otherwise the focus node (option `focus`, else the highest-degree node) plus its
 * nearest neighbors — a BFS out to {@link DISCLOSURE_HOPS} hops that admits nodes
 * nearest-hop-first (within a hop, in scene order) until the visible set reaches
 * {@link INITIAL_CAP}. Adjacency is undirected over the logical edges (endpoints and n-ary
 * leg targets are mutually adjacent) — the same graph the client walks for badges and
 * expansion. Deterministic (ties break on scene/document order).
 */
function computeDisclosure(scene: RenderScene, focus: string | undefined): PayloadDisclosure {
  const ids = scene.nodes.map((n) => n.id);
  const adjacency = new Map<string, Set<string>>();
  const incident = new Map<string, Set<string>>();
  for (const id of ids) {
    adjacency.set(id, new Set());
    incident.set(id, new Set());
  }
  for (const edge of scene.edges) {
    const participants = [edge.source, edge.target, ...edge.naryLegs.map((l) => l.target)];
    for (let i = 0; i < participants.length; i++) {
      for (let j = i + 1; j < participants.length; j++) {
        const a = participants[i];
        const b = participants[j];
        if (a === undefined || b === undefined || a === b) continue;
        adjacency.get(a)?.add(b);
        adjacency.get(b)?.add(a);
        incident.get(a)?.add(edge.id);
        incident.get(b)?.add(edge.id);
      }
    }
  }

  const focusId = resolveFocusId(scene, focus, incident);

  if (ids.length <= WHOLE_GRAPH_MAX) {
    return { wholeGraph: true, focusId, initialVisibleIds: ids, hops: DISCLOSURE_HOPS, wholeGraphMax: WHOLE_GRAPH_MAX };
  }

  const visible = new Set<string>();
  if (focusId !== null) {
    // Nearest-hop-first BFS, capped at INITIAL_CAP. Each hop's new neighbors are gathered,
    // then admitted in scene (document) order; admission stops the instant the cap is reached.
    // So a super-hub focus whose hop-1 alone exceeds the cap yields a legible cluster (the
    // focus + its first INITIAL_CAP-1 neighbors) rather than the whole graph two hops out.
    visible.add(focusId);
    let frontier = [focusId];
    for (let hop = 0; hop < DISCLOSURE_HOPS && visible.size < INITIAL_CAP; hop++) {
      const candidates = new Set<string>();
      for (const id of frontier) {
        for (const nb of adjacency.get(id) ?? []) {
          if (!visible.has(nb)) candidates.add(nb);
        }
      }
      const nextFrontier: string[] = [];
      for (const id of ids) {
        if (visible.size >= INITIAL_CAP) break;
        if (candidates.has(id)) {
          visible.add(id);
          nextFrontier.push(id);
        }
      }
      frontier = nextFrontier;
    }
  }
  // Emit in scene/document order for a stable, readable initial set — matching the
  // whole-graph branch, which emits every id in scene order.
  const initialVisibleIds = ids.filter((id) => visible.has(id));
  return { wholeGraph: false, focusId, initialVisibleIds, hops: DISCLOSURE_HOPS, wholeGraphMax: WHOLE_GRAPH_MAX };
}

/** The focus node id: the `focus` qualified name if it matches a node, else the highest-degree node. */
function resolveFocusId(
  scene: RenderScene,
  focus: string | undefined,
  incident: Map<string, Set<string>>,
): string | null {
  if (focus !== undefined) {
    const match = scene.nodes.find((n) => n.qualifiedName === focus);
    if (match !== undefined) return match.id;
  }
  let best: string | null = null;
  let bestDegree = -1;
  // Document order + strict `>` means the FIRST node at the max degree wins (deterministic).
  for (const node of scene.nodes) {
    const degree = incident.get(node.id)?.size ?? 0;
    if (degree > bestDegree) {
      bestDegree = degree;
      best = node.id;
    }
  }
  return best;
}

// ── Theme projection ────────────────────────────────────────────────────────────────

/** Projects a merged {@link ProvTheme} to browser-legal colors for the client. */
function projectTheme(theme: ProvTheme): ProjectedTheme {
  return {
    nodes: {
      entity: projectStyle(theme.nodes.entity),
      activity: projectStyle(theme.nodes.activity),
      agent: projectStyle(theme.nodes.agent),
      bundle: projectStyle(theme.nodes.bundle),
    },
    generic: {
      entity: projectStyle(theme.generic.entity),
      activity: projectStyle(theme.generic.activity),
      agent: projectStyle(theme.generic.agent),
      bundle: projectStyle(theme.generic.bundle),
      unknown: projectStyle(theme.generic.unknown),
    },
    relations: projectRelations(theme),
    annotation: {
      color: toCssColor(theme.annotation.color),
      fontcolor: toCssColor(theme.annotation.fontcolor),
    },
    annotationLink: { color: toCssColor(theme.annotationLink.color) },
    // The bundle fill matches the SVG emitter, which reads the CONSTANT PROV_THEME (not the
    // override), so a themed rect stays aliceblue; stroke/label are its fixed decor colors.
    decor: {
      bundleFill: toCssColor(PROV_THEME.nodes.bundle.fillcolor),
      bundleStroke: "#9aa7b4",
      bundleLabelFill: "#333333",
    },
  };
}

function projectStyle(style: NodeStyle): ProjectedNodeStyle {
  return style.color === undefined
    ? { fill: toCssColor(style.fillcolor) }
    : { fill: toCssColor(style.fillcolor), stroke: toCssColor(style.color) };
}

function projectRelations(theme: ProvTheme): Record<RelationKind, { color?: string; fontcolor?: string }> {
  const out = {} as Record<RelationKind, { color?: string; fontcolor?: string }>;
  for (const key of Object.keys(theme.relations) as RelationKind[]) {
    const style = theme.relations[key];
    const entry: { color?: string; fontcolor?: string } = {};
    if (style.color !== undefined) entry.color = toCssColor(style.color);
    if (style.fontcolor !== undefined) entry.fontcolor = toCssColor(style.fontcolor);
    out[key] = entry;
  }
  return out;
}

// ── Theme merge + geometry rounding (shared strategy with render-svg) ────────────────

/**
 * Merges a partial theme over {@link PROV_THEME}, shallow per section then per entry —
 * the same strategy render-svg's emitter uses so a theme override behaves identically
 * whether it drives the static SVG or the interactive page's projected theme.
 */
function mergeTheme(override?: Partial<ProvTheme>): ProvTheme {
  if (override === undefined) return PROV_THEME;
  return {
    direction: override.direction ?? PROV_THEME.direction,
    nodes: mergeStyleRecord(PROV_THEME.nodes, override.nodes),
    generic: mergeStyleRecord(PROV_THEME.generic, override.generic),
    relations: mergeStyleRecord(PROV_THEME.relations, override.relations),
    annotation: { ...PROV_THEME.annotation, ...override.annotation },
    annotationLink: { ...PROV_THEME.annotationLink, ...override.annotationLink },
  };
}

function mergeStyleRecord<K extends string, S extends object>(
  base: Readonly<Record<K, S>>,
  override: Readonly<Record<K, S>> | undefined,
): Record<K, S> {
  const merged: Record<K, S> = { ...base };
  if (override === undefined) return merged;
  for (const key of Object.keys(override) as K[]) {
    merged[key] = { ...base[key], ...override[key] };
  }
  return merged;
}

/** The four valid directions; a runtime guard for untyped JS callers. */
const VALID_DIRECTIONS: ReadonlySet<string> = new Set(["BT", "TB", "LR", "RL"]);

/** Resolves the effective layout direction, mirroring render-svg's guard. */
function resolveDirection(requested: Direction | undefined, themeDefault: Direction): Direction {
  if (requested === undefined) return themeDefault;
  return VALID_DIRECTIONS.has(requested) ? requested : "BT";
}

/**
 * Rounds a coordinate to 2 decimals — the same precision the SVG emitter's `fmt` writes, so
 * the baked geometry matches the static picture and the payload bytes are platform-stable
 * (dagre's float noise below the 2nd decimal can never reach a golden). `JSON.stringify`
 * already normalizes `-0` to `0`, so no special-casing is needed here.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundBox(box: LayoutBox): LayoutBox {
  return { x: round2(box.x), y: round2(box.y), width: round2(box.width), height: round2(box.height) };
}

function roundPoint(point: LayoutPoint): LayoutPoint {
  return { x: round2(point.x), y: round2(point.y) };
}

/**
 * Escapes the five XML metacharacters for the HTML title contexts (the `<title>` tag and
 * the header `<h1>`). The title is the one caller-supplied string interpolated into markup
 * rather than embedded as JSON, so it is escaped here; everything else reaches the DOM as
 * `textContent` in the client.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
