// The SVG emitter — `SvgRenderer`.
//
// This turns a `RenderScene` (from `@inflexa-ai/tsprov-render-core`) into a standalone
// SVG string carrying the W3C PROV visual language. Unlike the DOT and Mermaid
// siblings — which hand a layout engine a description and let it place the boxes — SVG
// has no downstream layout step, so this renderer OWNS layout: it hands the scene to
// dagre (`@dagrejs/dagre`, the sanctioned heavy dependency for this package) with each
// node sized from an estimator (`measure.ts`), lays it out synchronously and
// deterministically, then reads dagre's coordinates back and serializes glyphs and
// edges to a pure string. No DOM, no WASM, no browser.
//
// Layout is dagre's LAYERED layout, NOT Graphviz `dot`'s coordinates: this renderer
// deliberately does not reproduce `prov.dot`'s pixel geometry (that is the stretch
// graphviz stage). The visual CONTRACT here is `PROV_THEME` — the shapes, fills,
// strokes, edge tints and labels — not any particular (x, y). See DEVIATIONS.md.
//
// Like the siblings the projection is read ONCE (`toRenderScene`) and never re-read;
// the string is a pure function of the scene plus dagre's deterministic layout, so two
// renders of the same document are byte-identical. D18's blank-node information-content
// rule is reused verbatim: a relation splits through a small join circle only when it
// carries n-ary legs or an attribute annotation, and that first segment is drawn
// marker-less (the arrowhead lives on the second segment), exactly as the DOT renderer
// routes it.

import { Graph, layout, type GraphLabel, type NodeLabel, type EdgeLabel } from "@dagrejs/dagre";
import {
  PROV_THEME,
  type ProvTheme,
  type NodeStyle,
  type Direction,
  type NodeKind,
  type Renderer,
  type RendererOptions,
  type RenderScene,
  type RenderNode,
  type RenderEdge,
  type RenderAttr,
  type RenderBundle,
  toRenderScene,
} from "@inflexa-ai/tsprov-render-core";
import type { ProvDocument } from "@inflexa-ai/tsprov";

import {
  FONT_FAMILY,
  NODE_FONT_SIZE,
  LABEL_FONT_SIZE,
  NODE_PAD_X,
  HOUSE_ROOF,
  FOLDER_TAB,
  NOTE_FOLD,
  nodeBox,
  textWidth,
  lineHeightPx,
} from "./measure.js";

/**
 * Options for {@link SvgRenderer.render}: the {@link RendererOptions} common to every
 * renderer (the {@link SceneOptions} projection toggles plus a `theme` partial),
 * extended with a `direction` mapped to dagre's `rankdir`.
 */
export type SvgRenderOptions = RendererOptions & {
  /**
   * Layout direction, mapped to dagre's `rankdir`. Defaults to the theme's direction
   * (`"BT"`, the PROV convention). A runtime value outside the four valid directions
   * (only reachable from untyped JS callers) falls back to `"BT"`, mirroring the sibling
   * renderers' guard.
   */
  readonly direction?: Direction;
};

/** The four valid directions; a runtime guard for untyped JS callers. */
const VALID_DIRECTIONS: ReadonlySet<string> = new Set(["BT", "TB", "LR", "RL"]);

// dagre layout tuning. Fixed (not themed) because they are pure presentation knobs with
// no PROV meaning; chosen for legible spacing at the corpus's scale. Deterministic —
// dagre adds no randomness — so the goldens stay platform-stable.
const NODE_SEP = 30;
const RANK_SEP = 44;
const EDGE_SEP = 12;
const MARGIN = 12;

// Padding (px) between a bundle's member bounding box and the rounded rect drawn behind
// them, and the corner radius of that rect.
const BUNDLE_PAD = 14;
const BUNDLE_RADIUS = 8;

/**
 * Escapes a string for interpolation into SVG/XML text content OR a double-quoted
 * attribute value — the single escape helper this emitter routes EVERY interpolation
 * through (node labels, edge labels, annotation rows, `<title>` tooltips, `href`s). It
 * replaces the five XML metacharacters: `&` first (so the entities it introduces are
 * not themselves re-escaped), then `<`/`>` (which would otherwise forge tags in text),
 * then `"`/`'` (which would otherwise close a quoted attribute early). Escaping all five
 * in both positions is a deliberate superset — safe everywhere — so there is exactly one
 * helper to audit rather than a text variant and an attribute variant.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Graphviz X11 color names that are NOT valid CSS/SVG colors, mapped to the hex the X11
// palette assigns them — the same projection the Mermaid emitter owns, for the same
// reason: `PROV_THEME` stays Graphviz-faithful as the single source of visual truth, so
// the projection to a browser-legal color lives at the emission boundary. An SVG
// renderer (a browser, `resvg`, Inkscape) drops an unknown color word, which would leave
// a themed stroke at its default and defeat the visual language; projecting the name to
// its hex keeps the intended color visible. X11 `red4` (the `prov:Usage` stroke) is the
// darkest of the `red1..red4` ramp = `#8B0000`; it is currently the only Graphviz-only
// name any theme color uses. Every other theme color (`darkgreen`, `red`, `gray`,
// `grey`, `dimgray`, `aliceblue`, hex literals) is already valid CSS and passes through.
const GRAPHVIZ_ONLY_CSS: ReadonlyMap<string, string> = new Map([["red4", "#8B0000"]]);

/**
 * Projects a `PROV_THEME` color token to a browser-legal CSS/SVG color: a Graphviz-only
 * X11 name (see {@link GRAPHVIZ_ONLY_CSS}) becomes its hex; any already-legal token
 * passes through unchanged. Total: an unmapped token is returned as-is. Exported so the
 * conformance eval can hold the emitter to the SAME projection when it checks emitted
 * fills/strokes/tints against the theme.
 */
export function toCssColor(color: string): string {
  return GRAPHVIZ_ONLY_CSS.get(color) ?? color;
}

/**
 * Formats a coordinate/length for SVG output with fixed 2-decimal rounding. dagre emits
 * floats; rounding here (deterministically — `Math.round` is IEEE-754-stable) keeps the
 * exact same string on every platform so float noise can never leak into a golden. `-0`
 * is normalized to `"0"` so a rounded-away negative zero cannot produce a `"-0"` token.
 */
function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/**
 * Merges a partial theme over {@link PROV_THEME}, shallow per section then per entry —
 * identical strategy to the sibling renderers' `mergeTheme` (kept in lockstep so a theme
 * override behaves the same across renderers). `Partial<ProvTheme>` cannot express a
 * partial `NodeStyle`, so a JS override entry may still be partial — the per-entry spread
 * handles that safely. Deliberately not a deep-merge: no dependency, and one level of
 * nesting is all the theme has.
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

/** Per-entry shallow merge of a keyed style record; keys absent from `override` keep the base. */
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

/** The concrete glyph shapes an element/inferred node is drawn with. */
type Glyph = "ellipse" | "rect" | "house" | "folder";

/**
 * The SVG glyph for a node kind — the real PROV reference silhouettes (SVG restores the
 * `house`/`folder` shapes Mermaid could not): entity → ellipse, activity → rect, agent →
 * house, bundle → folder, unknown → ellipse (the generic oval). Exhaustive over
 * {@link NodeKind}.
 */
function glyphForKind(kind: NodeKind): Glyph {
  switch (kind) {
    case "entity":
      return "ellipse";
    case "activity":
      return "rect";
    case "agent":
      return "house";
    case "bundle":
      return "folder";
    case "unknown":
      return "ellipse";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * The {@link NodeStyle} for a scene node: the gray generic style for an inferred
 * endpoint, else the colored declared-element style. Exhaustive over {@link NodeKind};
 * declared `unknown` is unreachable (elements always carry a colored kind) and falls
 * back to the generic style, mirroring the sibling renderers' `nodeStyle`.
 */
function nodeStyle(node: RenderNode, theme: ProvTheme): NodeStyle {
  const kind = node.kind;
  if (node.inferred) return theme.generic[kind];
  switch (kind) {
    case "entity":
    case "activity":
    case "agent":
    case "bundle":
      return theme.nodes[kind];
    case "unknown":
      return theme.generic.unknown;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** The label lines of an element node: two lines under `useLabels` when label ≠ identifier. */
function nodeLabelLines(node: RenderNode, useLabels: boolean): string[] {
  if (useLabels && node.label !== node.qualifiedName) {
    return [node.label, node.qualifiedName];
  }
  return [node.label];
}

/** The `<title>` tooltip lines: the qualified name, then one `name = value` row per attribute. */
function nodeTitleLines(node: RenderNode): string[] {
  return [node.qualifiedName, ...node.attributes.map((attr) => `${attr.name} = ${attr.value}`)];
}

// ── Draw instructions ────────────────────────────────────────────────────────────
//
// The build pass records what to draw (independent of position) and registers each box
// with dagre; the emit pass reads dagre's laid-out coordinates back by id. Keeping the
// draw list separate from the dagre graph means the string is assembled in a fixed,
// scene-derived order (not dagre's internal node/edge iteration order), which is what
// makes the output deterministic and diff-stable.

/** An element or inferred-endpoint node to draw. */
type ElementDraw = {
  readonly id: string;
  readonly kind: NodeKind;
  readonly inferred: boolean;
  readonly glyph: Glyph;
  readonly fill: string;
  readonly stroke: string | undefined;
  readonly labelLines: readonly string[];
  readonly titleLines: readonly string[];
  readonly uri: string | undefined;
  readonly bundleId: string | undefined;
};

/** A small join circle materializing an n-ary / annotated relation (D18). */
type BlankDraw = { readonly id: string };

/** A folded-corner note box holding an element's or relation's attribute rows. */
type NoteDraw = { readonly id: string; readonly rows: readonly string[] };

/**
 * One drawn edge segment. A binary relation is one segment (arrowed, labeled); a split
 * relation is a marker-less labeled first segment + an arrowed unlabeled second segment
 * + gray arrowed legs; an annotation is a dashed, marker-less link. `name` disambiguates
 * parallel dagre edges (the graph is a multigraph).
 */
type SegmentDraw = {
  readonly v: string;
  readonly w: string;
  readonly name: string;
  readonly stroke: string;
  readonly arrow: boolean;
  readonly dashed: boolean;
  readonly label: string | undefined;
  readonly labelFill: string;
};

/** The full set of draw instructions plus the dagre graph and the marker color set. */
type Build = {
  readonly graph: Graph<GraphLabel, NodeLabel, EdgeLabel>;
  readonly elements: readonly ElementDraw[];
  readonly blanks: readonly BlankDraw[];
  readonly notes: readonly NoteDraw[];
  readonly segments: readonly SegmentDraw[];
  readonly bundles: readonly RenderBundle[];
  readonly markerColors: ReadonlySet<string>;
};

/**
 * `SvgRenderer` projects a PROV document to a standalone SVG string in the W3C PROV
 * visual language (`Renderer<string>`, `format: "svg"`). Synchronous and deterministic:
 * dagre lays out without randomness and the emitter rounds every number the same way, so
 * two renders of the same document with the same options are byte-identical. The result
 * opens directly in a browser tab, an `<img src="data:image/svg+xml,…">`, or a README —
 * with no external tool.
 */
export class SvgRenderer implements Renderer<string, SvgRenderOptions> {
  /** The stable format identifier for this renderer. */
  readonly format = "svg";

  /**
   * Renders `doc` to a standalone SVG string.
   *
   * @param doc     The document to render.
   * @param options Projection toggles ({@link SceneOptions}), a `theme` override, and the
   *                layout `direction`.
   * @returns The SVG source.
   */
  render(doc: ProvDocument, options?: SvgRenderOptions): string {
    const theme = mergeTheme(options?.theme);
    const direction = resolveDirection(options?.direction, theme.direction);
    const scene = toRenderScene(doc, options);
    const build = buildGraph(scene, theme, direction, options?.useLabels ?? false);
    layout(build.graph);
    return emit(build, theme);
  }
}

/** Resolves the effective direction: an explicit valid direction, else the theme's, else `"BT"`. */
function resolveDirection(requested: Direction | undefined, themeDefault: Direction): Direction {
  if (requested === undefined) return themeDefault;
  // `requested` is typed `Direction`, so this guard only bites an untyped JS caller
  // passing garbage — mirroring the sibling renderers' runtime reset to the default.
  return VALID_DIRECTIONS.has(requested) ? requested : "BT";
}

/**
 * Builds the dagre graph and the draw lists from the scene. Nodes are registered in
 * scene order; then each relation is routed through the D18 blank-node rule and its
 * legs/annotation materialized. Element and relation annotations become {@link NoteDraw}
 * boxes with a dashed link. The dagre `rankdir` carries the direction; `marginx`/
 * `marginy` inset the whole layout so the `viewBox` needs no manual offset.
 */
function buildGraph(
  scene: RenderScene,
  theme: ProvTheme,
  direction: Direction,
  useLabels: boolean,
): Build {
  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: true, directed: true });
  graph.setGraph({
    rankdir: direction,
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    edgesep: EDGE_SEP,
    marginx: MARGIN,
    marginy: MARGIN,
  });
  // Parallel edges each carry their own label object; a missing default would let dagre
  // share one label across them.
  graph.setDefaultEdgeLabel(() => ({}));

  const elements: ElementDraw[] = [];
  const blanks: BlankDraw[] = [];
  const notes: NoteDraw[] = [];
  const segments: SegmentDraw[] = [];
  const markerColors = new Set<string>();
  // Renderer-local id counters for the nodes the scene does not own (join circles and
  // note boxes) and unique dagre edge names for the multigraph.
  const counters = { blank: 0, note: 0, edge: 0 };

  function addSegment(seg: Omit<SegmentDraw, "name">): void {
    counters.edge += 1;
    const name = `s${counters.edge}`;
    segments.push({ ...seg, name });
    if (seg.arrow) markerColors.add(seg.stroke);
    const hasLabel = seg.label !== undefined;
    // A labeled edge reserves space for its label so dagre returns a placed (x, y);
    // labelpos "c" centers the label on the edge.
    graph.setEdge(
      seg.v,
      seg.w,
      hasLabel
        ? { width: textWidth(seg.label ?? "", LABEL_FONT_SIZE), height: LABEL_FONT_SIZE, labelpos: "c" }
        : {},
      name,
    );
  }

  function addNote(attributes: readonly RenderAttr[], targetId: string): void {
    if (attributes.length === 0) return;
    counters.note += 1;
    const id = `ann${counters.note}`;
    const rows = attributes.map((attr) => `${attr.name} = ${attr.value}`);
    notes.push({ id, rows });
    graph.setNode(id, nodeBox("note", rows, LABEL_FONT_SIZE));
    // The dashed annotation link is arrowhead-less (the dashed form IS the styling) and
    // takes the note theme's link color.
    addSegment({
      v: id,
      w: targetId,
      stroke: toCssColor(theme.annotationLink.color),
      arrow: false,
      dashed: true,
      label: undefined,
      labelFill: "black",
    });
  }

  for (const node of scene.nodes) {
    const glyph = glyphForKind(node.kind);
    const style = nodeStyle(node, theme);
    const labelLines = nodeLabelLines(node, useLabels);
    elements.push({
      id: node.id,
      kind: node.kind,
      inferred: node.inferred,
      glyph,
      fill: toCssColor(style.fillcolor),
      stroke: style.color === undefined ? undefined : toCssColor(style.color),
      labelLines,
      titleLines: nodeTitleLines(node),
      uri: node.uri,
      bundleId: node.bundleId,
    });
    graph.setNode(node.id, nodeBox(glyph, labelLines, NODE_FONT_SIZE));
  }

  for (const edge of scene.edges) {
    addEdge(edge);
  }

  function addEdge(edge: RenderEdge): void {
    const style = theme.relations[edge.relation];
    const lineColor = toCssColor(style.color ?? "black");
    const labelFill = toCssColor(style.fontcolor ?? style.color ?? "black");
    const needsBlankNode = edge.naryLegs.length > 0 || edge.attributes.length > 0;

    if (!needsBlankNode) {
      addSegment({
        v: edge.source,
        w: edge.target,
        stroke: lineColor,
        arrow: true,
        dashed: false,
        label: edge.label,
        labelFill,
      });
      return;
    }

    counters.blank += 1;
    const bnode = `b${counters.blank}`;
    blanks.push({ id: bnode });
    graph.setNode(bnode, nodeBox("blank", [], 0));
    // First segment: source → join circle, marker-LESS (the arrowhead is on the second
    // segment), keeping the relation label + tint. Mirrors DOT's `arrowhead=none`.
    addSegment({
      v: edge.source,
      w: bnode,
      stroke: lineColor,
      arrow: false,
      dashed: false,
      label: edge.label,
      labelFill,
    });
    // Second segment: join circle → target, arrowed, label dropped.
    addSegment({
      v: bnode,
      w: edge.target,
      stroke: lineColor,
      arrow: true,
      dashed: false,
      label: undefined,
      labelFill,
    });
    // Extra n-ary legs: gray arrowed edges labeled with the leg's role. Always gray,
    // regardless of the relation's own tint (matching the DOT/Mermaid legs).
    for (const leg of edge.naryLegs) {
      addSegment({
        v: bnode,
        w: leg.target,
        stroke: "gray",
        arrow: true,
        dashed: false,
        label: leg.role,
        labelFill: "dimgray",
      });
    }
    addNote(edge.attributes, bnode);
  }

  // Element annotations attach AFTER all element nodes exist, so a note's dashed link
  // resolves to a real node. Emission order does not depend on this (draw lists are
  // assembled here in one pass) — only dagre registration does.
  for (const node of scene.nodes) {
    addNote(node.attributes, node.id);
  }

  return { graph, elements, blanks, notes, segments, bundles: scene.bundles, markerColors };
}

/** A laid-out box: dagre's center coordinates and the size the estimator gave the node. */
type LaidBox = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** Reads a node's laid-out box, defaulting missing coordinates to 0 (every added node is placed). */
function laidBox(graph: Graph<GraphLabel, NodeLabel, EdgeLabel>, id: string): LaidBox {
  const nl = graph.node(id);
  return { x: nl.x ?? 0, y: nl.y ?? 0, width: nl.width ?? 0, height: nl.height ?? 0 };
}

/**
 * Serializes the laid-out build to the SVG string. Paint order encodes depth: bundle
 * rects first (behind their members), then edges, then join circles, notes, and finally
 * element glyphs on top. `viewBox` is dagre's margined graph size; there are NO
 * `width`/`height` attributes (the SVG scales to its container) and no background rect
 * (transparent).
 */
function emit(build: Build, theme: ProvTheme): string {
  const { graph } = build;
  const gl = graph.graph();
  // A nodeless scene (e.g. the D15 all-skipped case) leaves dagre's graph size at
  // -Infinity; clamp to a finite, non-negative viewBox so the SVG stays well-formed and
  // the "finite viewBox" contract holds even when there is nothing to draw.
  const width = finiteSize(gl.width);
  const height = finiteSize(gl.height);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}" ` +
      `class="prov-graph" font-family="${escapeXml(FONT_FAMILY)}">`,
  );
  parts.push(emitDefs(build.markerColors));

  for (const bundle of build.bundles) {
    const rect = emitBundle(build, bundle);
    if (rect !== null) parts.push(rect);
  }
  for (const seg of build.segments) {
    parts.push(emitSegment(graph, seg));
  }
  for (const blank of build.blanks) {
    parts.push(emitBlank(graph, blank, theme));
  }
  for (const note of build.notes) {
    parts.push(emitNote(graph, note, theme));
  }
  for (const el of build.elements) {
    parts.push(emitElement(graph, el));
  }

  parts.push("</svg>");
  return `${parts.join("\n")}\n`;
}

/** Clamps a dagre graph dimension to a finite, non-negative number (nodeless graphs report -Infinity). */
function finiteSize(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** A stable, id-safe marker id for a stroke color (`#8B0000` → `arrow-8B0000`, `gray` → `arrow-gray`). */
function markerId(color: string): string {
  return `arrow-${color.replace(/[^A-Za-z0-9]/g, "")}`;
}

/**
 * The `<defs>` block: one `<marker>` arrowhead per distinct stroke color, deduped. The
 * marker is filled with its color so an arrowhead matches its edge; `userSpaceOnUse`
 * units keep every arrowhead the same size regardless of stroke width. Colors are sorted
 * so the defs order is deterministic independent of edge-processing order.
 */
function emitDefs(markerColors: ReadonlySet<string>): string {
  const markers = [...markerColors].sort().map((color) => {
    return (
      `<marker id="${markerId(color)}" viewBox="0 0 10 10" refX="9" refY="5" ` +
      `markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">` +
      `<path d="M0,0 L10,5 L0,10 z" fill="${color}"/>` +
      `</marker>`
    );
  });
  return `<defs>${markers.join("")}</defs>`;
}

/**
 * A bundle's rounded rect + title, computed post-hoc from its member nodes' laid-out
 * boxes (dagre has no native clusters — the members were laid out flat). Returns `null`
 * for a bundle with no members (nothing to enclose). The rect is filled with the theme's
 * bundle fill and drawn BEFORE its members (paint order = visually behind).
 *
 * TODO(extend): dagre's `compound` mode with `setParent` would let dagre reserve real
 * cluster space so members never interleave with non-members; this post-hoc bounding box
 * is the accepted stage-4 approximation (see DEVIATIONS.md) and can be upgraded there.
 */
function emitBundle(build: Build, bundle: RenderBundle): string | null {
  const members = build.elements.filter((el) => el.bundleId === bundle.id);
  if (members.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const member of members) {
    const box = laidBox(build.graph, member.id);
    minX = Math.min(minX, box.x - box.width / 2);
    minY = Math.min(minY, box.y - box.height / 2);
    maxX = Math.max(maxX, box.x + box.width / 2);
    maxY = Math.max(maxY, box.y + box.height / 2);
  }
  const x = minX - BUNDLE_PAD;
  const y = minY - BUNDLE_PAD;
  const w = maxX - minX + 2 * BUNDLE_PAD;
  const h = maxY - minY + 2 * BUNDLE_PAD;
  const fill = toCssColor(PROV_THEME.nodes.bundle.fillcolor);
  const label =
    bundle.label === ""
      ? ""
      : `<text x="${fmt(x + 6)}" y="${fmt(y + LABEL_FONT_SIZE + 2)}" ` +
        `font-size="${fmt(LABEL_FONT_SIZE)}" fill="#333333">${escapeXml(bundle.label)}</text>`;
  return (
    `<g class="prov-bundle">` +
    `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" ` +
    `rx="${fmt(BUNDLE_RADIUS)}" ry="${fmt(BUNDLE_RADIUS)}" fill="${fill}" ` +
    `stroke="#9aa7b4"/>` +
    label +
    `</g>`
  );
}

/** One edge segment: a polyline `<path>` (rounded joins via `stroke-linejoin`) + optional label. */
function emitSegment(graph: Graph<GraphLabel, NodeLabel, EdgeLabel>, seg: SegmentDraw): string {
  const el = graph.edge(seg.v, seg.w, seg.name);
  const points = el.points ?? [];
  const d =
    points.length === 0
      ? ""
      : points.map((p, i) => `${i === 0 ? "M" : "L"} ${fmt(p.x)} ${fmt(p.y)}`).join(" ");
  const dashAttr = seg.dashed ? ` stroke-dasharray="4 3"` : "";
  const markerAttr = seg.arrow ? ` marker-end="url(#${markerId(seg.stroke)})"` : "";
  const path =
    `<path d="${d}" fill="none" stroke="${seg.stroke}" stroke-width="1.5" ` +
    `stroke-linejoin="round" stroke-linecap="round"${dashAttr}${markerAttr}/>`;
  let label = "";
  if (seg.label !== undefined && el.x !== undefined && el.y !== undefined) {
    label =
      `<text x="${fmt(el.x)}" y="${fmt(el.y)}" text-anchor="middle" ` +
      `dominant-baseline="central" font-size="${fmt(LABEL_FONT_SIZE)}" ` +
      `fill="${seg.labelFill}">${escapeXml(seg.label)}</text>`;
  }
  return `<g class="prov-edge">${path}${label}</g>`;
}

/** The small gray join circle for a split relation (D18's blank node). */
function emitBlank(graph: Graph<GraphLabel, NodeLabel, EdgeLabel>, blank: BlankDraw, theme: ProvTheme): string {
  const box = laidBox(graph, blank.id);
  const stroke = theme.annotationLink.color;
  return (
    `<g class="prov-blank">` +
    `<circle cx="${fmt(box.x)}" cy="${fmt(box.y)}" r="${fmt(box.width / 2)}" ` +
    `fill="gray" stroke="${stroke}"/>` +
    `</g>`
  );
}

/** A folded-corner note box holding left-aligned `name = value` rows. */
function emitNote(graph: Graph<GraphLabel, NodeLabel, EdgeLabel>, note: NoteDraw, theme: ProvTheme): string {
  const box = laidBox(graph, note.id);
  const left = box.x - box.width / 2;
  const right = box.x + box.width / 2;
  const top = box.y - box.height / 2;
  const bottom = box.y + box.height / 2;
  // Outline with the top-right corner folded in by NOTE_FOLD; a second subpath draws the
  // fold's two inner edges so the corner reads as turned down.
  const outline =
    `M ${fmt(left)} ${fmt(top)} L ${fmt(right - NOTE_FOLD)} ${fmt(top)} ` +
    `L ${fmt(right)} ${fmt(top + NOTE_FOLD)} L ${fmt(right)} ${fmt(bottom)} ` +
    `L ${fmt(left)} ${fmt(bottom)} Z`;
  const fold =
    `M ${fmt(right - NOTE_FOLD)} ${fmt(top)} L ${fmt(right - NOTE_FOLD)} ${fmt(top + NOTE_FOLD)} ` +
    `L ${fmt(right)} ${fmt(top + NOTE_FOLD)}`;
  const path =
    `<path d="${outline} ${fold}" fill="#ffffff" stroke="${theme.annotation.color}"/>`;
  const rows = leftAlignedText(
    note.rows,
    left + NODE_PAD_X,
    box.y,
    LABEL_FONT_SIZE,
    theme.annotation.fontcolor,
  );
  return `<g class="prov-annotation">${path}${rows}</g>`;
}

/**
 * An element/inferred node: `<title>` tooltip, its themed glyph, and its centered label,
 * wrapped in an `<a href>` when the node has a URI. Uses SVG2 bare `href` (no `xlink:` —
 * modern renderers only), documented as an accepted requirement.
 */
function emitElement(graph: Graph<GraphLabel, NodeLabel, EdgeLabel>, el: ElementDraw): string {
  const box = laidBox(graph, el.id);
  const title = `<title>${escapeXml(el.titleLines.join("\n"))}</title>`;
  const shape = emitGlyph(el, box);
  // House/folder text sits in the body BELOW the roof/tab, not at the node center.
  const textCy =
    el.glyph === "house"
      ? (box.y - box.height / 2 + HOUSE_ROOF + (box.y + box.height / 2)) / 2
      : el.glyph === "folder"
        ? (box.y - box.height / 2 + FOLDER_TAB + (box.y + box.height / 2)) / 2
        : box.y;
  const label = centeredText(el.labelLines, box.x, textCy, NODE_FONT_SIZE, "black");
  const inferredClass = el.inferred ? " prov-inferred" : "";
  const group = `<g class="prov-node prov-${el.kind}${inferredClass}">${title}${shape}${label}</g>`;
  return el.uri === undefined ? group : `<a href="${escapeXml(el.uri)}">${group}</a>`;
}

/** The themed glyph element (ellipse/rect/house polygon/folder path) for an element node. */
function emitGlyph(el: ElementDraw, box: LaidBox): string {
  const fill = `fill="${el.fill}"`;
  const stroke = el.stroke === undefined ? "" : ` stroke="${el.stroke}"`;
  const left = box.x - box.width / 2;
  const right = box.x + box.width / 2;
  const top = box.y - box.height / 2;
  const bottom = box.y + box.height / 2;
  switch (el.glyph) {
    case "ellipse":
      return `<ellipse cx="${fmt(box.x)}" cy="${fmt(box.y)}" rx="${fmt(box.width / 2)}" ry="${fmt(box.height / 2)}" ${fill}${stroke}/>`;
    case "rect":
      return `<rect x="${fmt(left)}" y="${fmt(top)}" width="${fmt(box.width)}" height="${fmt(box.height)}" ${fill}${stroke}/>`;
    case "house": {
      const shoulder = top + HOUSE_ROOF;
      const points = [
        `${fmt(left)},${fmt(bottom)}`,
        `${fmt(right)},${fmt(bottom)}`,
        `${fmt(right)},${fmt(shoulder)}`,
        `${fmt(box.x)},${fmt(top)}`,
        `${fmt(left)},${fmt(shoulder)}`,
      ].join(" ");
      return `<polygon points="${points}" ${fill}${stroke}/>`;
    }
    case "folder": {
      const tab = top + FOLDER_TAB;
      const tabRight = left + box.width * 0.4;
      const d =
        `M ${fmt(left)} ${fmt(top)} L ${fmt(tabRight)} ${fmt(top)} ` +
        `L ${fmt(tabRight + 6)} ${fmt(tab)} L ${fmt(right)} ${fmt(tab)} ` +
        `L ${fmt(right)} ${fmt(bottom)} L ${fmt(left)} ${fmt(bottom)} Z`;
      return `<path d="${d}" ${fill}${stroke}/>`;
    }
    default: {
      const exhaustive: never = el.glyph;
      return exhaustive;
    }
  }
}

/** A centered (`text-anchor="middle"`) multi-line `<text>`, vertically centered on `cy`. */
function centeredText(
  lines: readonly string[],
  cx: number,
  cy: number,
  fontSize: number,
  fill: string,
): string {
  return textElement(lines, cx, cy, fontSize, fill, "middle");
}

/** A left-aligned (`text-anchor="start"`) multi-line `<text>`, vertically centered on `cy`. */
function leftAlignedText(
  lines: readonly string[],
  startX: number,
  cy: number,
  fontSize: number,
  fill: string,
): string {
  return textElement(lines, startX, cy, fontSize, fill, "start");
}

/**
 * A multi-line `<text>` block whose vertical center sits on `cy`. Each line is a
 * `<tspan>` re-anchored to `x`; the first line's `dy` lifts the block so the stack is
 * centered, and `dominant-baseline="central"` centers each line on its own baseline.
 */
function textElement(
  lines: readonly string[],
  x: number,
  cy: number,
  fontSize: number,
  fill: string,
  anchor: "middle" | "start",
): string {
  const lh = lineHeightPx(fontSize);
  const startDy = (-(lines.length - 1) / 2) * lh;
  const tspans = lines
    .map((line, i) => `<tspan x="${fmt(x)}" dy="${fmt(i === 0 ? startDy : lh)}">${escapeXml(line)}</tspan>`)
    .join("");
  return (
    `<text x="${fmt(x)}" y="${fmt(cy)}" text-anchor="${anchor}" dominant-baseline="central" ` +
    `font-size="${fmt(fontSize)}" fill="${fill}">${tspans}</text>`
  );
}
