// The Mermaid emitter — `MermaidRenderer`.
//
// This turns a `RenderScene` (from `@inflexa-ai/tsprov-render-core`) into a Mermaid
// `flowchart` string carrying the W3C PROV visual language. Like the DOT sibling it
// is a pure, deterministic string builder: `render(doc, options)` projects the
// document through `toRenderScene` once and then reads ONLY the scene — never the
// document again — so the output is a function of scene data alone (document order
// in, byte-identical string out).
//
// Mermaid has no Python reference (`prov` ships only a DOT emitter). The visual
// language therefore comes from the same `PROV_THEME` the DOT renderer transcribes,
// mapped onto Mermaid's flowchart primitives — with two honest approximations logged
// as one DEVIATIONS row: Mermaid has no `house`/`folder`/`note`/`point` shapes, so
// agent → hexagon, bundle → subroutine, annotation → rect, and the n-ary/annotation
// blank node → a tiny circle. Everything else (which nodes exist, which edges are
// drawn, when a relation splits through a blank node) is decided by the scene,
// identically to DOT — including D18's information-content rule for blank nodes.

import {
  PROV_THEME,
  type ProvTheme,
  type NodeStyle,
  type EdgeStyle,
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
  safeLinkUri,
  toCssColor,
} from "@inflexa-ai/tsprov-render-core";
import type { ProvDocument } from "@inflexa-ai/tsprov";

/**
 * Options for {@link MermaidRenderer.render}: the {@link RendererOptions} common to
 * every renderer (the {@link SceneOptions} projection toggles plus a `theme`
 * partial), extended with a Mermaid-specific flowchart `direction`.
 */
export type MermaidRenderOptions = RendererOptions & {
  /**
   * Flowchart layout direction emitted after the `flowchart` keyword. Defaults to
   * the theme's direction (`"BT"`, the PROV convention). A runtime value outside the
   * four valid directions (only reachable from untyped JS callers) falls back to
   * `"BT"`, mirroring the DOT renderer's guard.
   */
  readonly direction?: Direction;
};

/** The four valid flowchart directions; a runtime guard for untyped JS callers. */
const VALID_DIRECTIONS: ReadonlySet<string> = new Set(["BT", "TB", "LR", "RL"]);

/**
 * Escapes a string for a Mermaid double-quoted label. Node text is ARBITRARY: a QName,
 * but under `useLabels` also a `prov:label` literal that can be any corpus string. Every
 * label is wrapped in `"…"` and Mermaid renders it as HTML, so both breaking out of the
 * quoted span AND forging markup have to be neutralized — otherwise a label like
 * `<img src=x onerror=…>` would reach the page verbatim. Each such character is therefore
 * entity-escaped, exactly as the sibling {@link escapeRow} does: `&`→`&amp;` (first, so the
 * entities the later steps introduce are not re-escaped), `<`→`&lt;`, `>`→`&gt;`, and
 * `"`→`#quot;` (Mermaid uses `#`-prefixed entity codes, not `&`-prefixed ones, for a quote
 * inside a label). The two-line `useLabels` label's structural `<br/>` is inserted by the
 * caller ({@link nodeLabel}) AFTER escaping each line, so that intentional line break
 * survives while any `<br/>` inside the text itself lands inert as `&lt;br/&gt;`.
 */
function escapeLabel(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "#quot;");
}

/**
 * Escapes an annotation-row cell (an attribute name or value). Annotation rects join
 * their `name = value` rows with a structural `<br/>`, so a row's own content must
 * not be able to forge that structure or break out of the surrounding quoted label
 * — and unlike node labels these cells carry ARBITRARY corpus literals (unicode,
 * quotes, angle brackets, and even control characters: 19 corpus fixtures embed
 * `\n`/`\r`/`\t` in string values). So each cell is fully entity-escaped: `&`→`&amp;`
 * (first, so later replacements are not double-escaped), `<`→`&lt;`, `>`→`&gt;`,
 * `"`→`#quot;`; and any run of line breaks / tabs collapses to a single literal
 * space so a multi-line value cannot split the single-line Mermaid statement that
 * the line-grammar check requires. A literal `<br/>` in a value survives as
 * `&lt;br/&gt;` — visibly inert, never a spurious row break.
 */
function escapeRow(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "#quot;")
    .replace(/[\r\n\t]+/g, " ");
}

/**
 * Escapes a URI for a `click … href "…"` statement. A URI cannot contain an
 * unescaped `"` (it would close the href string); real corpus URIs never do, but the
 * replacement keeps the emitter total for pathological input.
 */
function escapeHref(value: string): string {
  return value.replace(/"/g, "#quot;");
}

/**
 * Merges a partial theme over {@link PROV_THEME}, shallow per section then per entry
 * — identical strategy to the DOT renderer's `mergeTheme` (kept in lockstep so a
 * theme override behaves the same across renderers). Per-entry merge lets an override
 * touch a single field while untouched fields keep the reference value.
 * `Partial<ProvTheme>` cannot express a partial `NodeStyle`, so a JS override entry
 * may still be partial — the per-entry spread handles that safely. Deliberately not a
 * deep-merge: no dependency, and one level of nesting is all the theme has.
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
  // `override` is typed `Record<K, S>`, so its own keys are exactly `K`; `Object.keys`
  // only widens to `string[]` because TS cannot prove a plain record carries no extra
  // keys. The cast restores the key type the parameter already guarantees.
  for (const key of Object.keys(override) as K[]) {
    merged[key] = { ...base[key], ...override[key] };
  }
  return merged;
}

/**
 * The Mermaid classDef name for a node. Declared elements carry the colored class
 * named for their kind (`entity`/`activity`/`agent`/`bundle`); inferred endpoints
 * carry the gray `…Inferred` class from the theme's generic map. Both are distinct
 * classes for the same kind because one URI can appear declared in one place and
 * inferred in another with different styling. Exhaustive over `NodeKind`; declared
 * `unknown` is unreachable (elements always carry a colored kind) and falls back to
 * the generic unknown class, mirroring the DOT renderer's `nodeStyle`.
 */
function nodeClassName(node: RenderNode): string {
  const kind = node.kind;
  if (node.inferred) {
    switch (kind) {
      case "entity":
        return "entityInferred";
      case "activity":
        return "activityInferred";
      case "agent":
        return "agentInferred";
      case "bundle":
        return "bundleInferred";
      case "unknown":
        return "unknownInferred";
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
  }
  switch (kind) {
    case "entity":
      return "entity";
    case "activity":
      return "activity";
    case "agent":
      return "agent";
    case "bundle":
      return "bundle";
    case "unknown":
      return "unknownInferred";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * Wraps already-quoted label `text` in the shape syntax for `kind`. Mermaid has no
 * `house`/`folder` shapes, so the honest best fits (logged in DEVIATIONS.md) are:
 * entity → stadium `([…])` (oval), activity → rect `[…]`, agent → hexagon `{{…}}`
 * (house), bundle → subroutine `[[…]]` (folder — an inferred `mentionOf` endpoint;
 * declared bundles are subgraphs, not nodes), unknown → stadium (the generic theme's
 * oval). Exhaustive over `NodeKind`.
 */
function shapeNode(id: string, kind: NodeKind, text: string): string {
  switch (kind) {
    case "entity":
      return `${id}([${text}])`;
    case "activity":
      return `${id}[${text}]`;
    case "agent":
      return `${id}{{${text}}}`;
    case "bundle":
      return `${id}[[${text}]]`;
    case "unknown":
      return `${id}([${text}])`;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * The node's quoted label text. Without `useLabels`, or when the label equals the
 * identifier, the identifier alone. With `useLabels` and a distinct label, the
 * two-line form `label<br/>identifier` (the DOT renderer's two-line label, expressed
 * with Mermaid's `<br/>` line break inside a quoted label).
 */
function nodeLabel(node: RenderNode, useLabels: boolean): string {
  if (useLabels && node.label !== node.qualifiedName) {
    return `"${escapeLabel(node.label)}<br/>${escapeLabel(node.qualifiedName)}"`;
  }
  return `"${escapeLabel(node.label)}"`;
}

/**
 * A Mermaid `linkStyle` declaration body for an edge tint, or `null` when the theme
 * leaves the relation untinted. `stroke:` is the line color (`EdgeStyle.color`),
 * `color:` the label color (`EdgeStyle.fontcolor`) — the Mermaid analogues of DOT's
 * `color`/`fontcolor`. A relation with neither (e.g. `wasInformedBy`) yields `null`
 * so no `linkStyle` line is emitted for it, matching the design's "only tinted edges
 * get a linkStyle line". Each color is run through {@link toCssColor} so a
 * Graphviz-only theme name reaches the browser as a CSS color rather than an inert
 * token the CSS parser would drop.
 */
function tintDecl(color: string | undefined, fontcolor: string | undefined): string | null {
  const parts: string[] = [];
  if (color !== undefined) parts.push(`stroke:${toCssColor(color)}`);
  if (fontcolor !== undefined) parts.push(`color:${toCssColor(fontcolor)}`);
  return parts.length === 0 ? null : parts.join(",");
}

/** The tint for a relation edge (both segments of a split keep the relation's tint). */
function relationTint(style: EdgeStyle): string | null {
  return tintDecl(style.color, style.fontcolor);
}

// The gray leg tint — a relation's extra n-ary legs are always drawn gray, matching
// the DOT renderer's `color=gray, fontcolor=dimgray` legs (both valid CSS names).
const LEG_TINT = "stroke:gray,color:dimgray";

/**
 * The classDef emission order: colored declared classes first, then the gray
 * inferred classes from the theme's generic map, then the annotation and blank-node
 * classes. Only classes a scene actually references are emitted (in this order), so a
 * small graph stays small while every `:::class` a node carries is guaranteed to have
 * a definition (Mermaid errors on an undefined class).
 */
const NODE_CLASS_ORDER: ReadonlyArray<{
  readonly name: string;
  readonly kind: NodeKind;
  readonly inferred: boolean;
}> = [
  { name: "entity", kind: "entity", inferred: false },
  { name: "activity", kind: "activity", inferred: false },
  { name: "agent", kind: "agent", inferred: false },
  { name: "bundle", kind: "bundle", inferred: false },
  { name: "entityInferred", kind: "entity", inferred: true },
  { name: "activityInferred", kind: "activity", inferred: true },
  { name: "agentInferred", kind: "agent", inferred: true },
  { name: "bundleInferred", kind: "bundle", inferred: true },
  { name: "unknownInferred", kind: "unknown", inferred: true },
];

/** The `NodeStyle` behind one entry of {@link NODE_CLASS_ORDER}: colored (`nodes`) or gray (`generic`). */
function classDefStyle(
  entry: { readonly kind: NodeKind; readonly inferred: boolean },
  theme: ProvTheme,
): NodeStyle {
  if (entry.inferred) return theme.generic[entry.kind];
  switch (entry.kind) {
    case "entity":
    case "activity":
    case "agent":
    case "bundle":
      return theme.nodes[entry.kind];
    case "unknown":
      // No declared-unknown entry exists in NODE_CLASS_ORDER; kept for exhaustiveness.
      return theme.generic.unknown;
    default: {
      const exhaustive: never = entry.kind;
      return exhaustive;
    }
  }
}

/** Renders a node `classDef` line: `fill` from the theme, `stroke` only where the theme sets a border color. */
function nodeClassDefLine(name: string, style: NodeStyle): string {
  const decl = style.color === undefined
    ? `fill:${style.fillcolor}`
    : `fill:${style.fillcolor},stroke:${style.color}`;
  return `classDef ${name} ${decl}`;
}

/**
 * Mutable emission state threaded through the walk. `bnode`/`annotation` counters
 * mint renderer-local ids the scene does not own (the scene owns only `n*`/`e*`/`c*`
 * ids); `linkCount` is the running index of link statements in EMISSION ORDER — the
 * space Mermaid's `linkStyle <index>` addresses, so every link statement (edges, both
 * split segments, legs, AND dotted annotation links) must advance it. `linkStyles`
 * records the tint for the subset of links that carry one, keyed by that index.
 */
type EmitState = {
  readonly lines: string[];
  readonly clicks: string[];
  readonly usedClasses: Set<string>;
  readonly linkStyles: { index: number; decl: string }[];
  linkCount: number;
  bnode: number;
  annotation: number;
};

/** Appends a link statement, advances the link index, and records its tint when it has one. */
function pushLink(state: EmitState, statement: string, tint: string | null): void {
  state.lines.push(statement);
  if (tint !== null) state.linkStyles.push({ index: state.linkCount, decl: tint });
  state.linkCount += 1;
}

/**
 * `MermaidRenderer` projects a PROV document to a Mermaid `flowchart` string in the
 * W3C PROV visual language (`Renderer<string>`, `format: "mermaid"`). Stateless and
 * deterministic: two renders of the same document with the same options are
 * byte-identical. The result renders natively in GitHub, GitLab, and any Mermaid-aware
 * Markdown pipeline with no tooling.
 */
export class MermaidRenderer implements Renderer<string, MermaidRenderOptions> {
  /** The stable format identifier for this renderer. */
  readonly format = "mermaid";

  /**
   * Renders `doc` to a Mermaid flowchart string.
   *
   * @param doc     The document to render.
   * @param options Projection toggles ({@link SceneOptions}), a `theme` override,
   *                and the flowchart `direction`.
   * @returns The Mermaid source.
   */
  render(doc: ProvDocument, options?: MermaidRenderOptions): string {
    const theme = mergeTheme(options?.theme);
    const direction = resolveDirection(options?.direction, theme.direction);
    const scene = toRenderScene(doc, options);
    return emit(scene, theme, direction, options?.useLabels ?? false);
  }
}

/** Resolves the effective direction: an explicit valid direction, else the theme's, else `"BT"`. */
function resolveDirection(requested: Direction | undefined, themeDefault: Direction): Direction {
  if (requested === undefined) return themeDefault;
  // `requested` is typed `Direction`, so this guard only bites an untyped JS caller
  // passing garbage — mirroring the DOT renderer's runtime reset to the default.
  return VALID_DIRECTIONS.has(requested) ? requested : "BT";
}

/**
 * The pure scene→Mermaid projection. Emission order mirrors the DOT renderer: the
 * flowchart header, then top-level nodes (with their annotation rects), then each
 * bundle as a `subgraph`, then relations (materializing blank/annotation nodes as
 * needed). Trailer sections follow the body in a fixed order — `click` links, then
 * `classDef`s, then `linkStyle`s — so the whole string is a deterministic function of
 * the scene.
 */
function emit(
  scene: RenderScene,
  theme: ProvTheme,
  direction: Direction,
  useLabels: boolean,
): string {
  const state: EmitState = {
    lines: [],
    clicks: [],
    usedClasses: new Set<string>(),
    linkStyles: [],
    linkCount: 0,
    bnode: 0,
    annotation: 0,
  };

  state.lines.push(`flowchart ${direction}`);

  // Nodes first, grouped by container: top-level, then each bundle as a subgraph.
  // Relations follow at the top level — valid Mermaid (edges reference subgraph member
  // ids by name) and structurally equivalent to placing them inside the subgraph.
  for (const node of scene.nodes) {
    if (node.bundleId === undefined) emitNode(state, node, theme, useLabels);
  }
  for (const bundle of scene.bundles) {
    emitSubgraph(state, bundle, scene, theme, useLabels);
  }
  for (const edge of scene.edges) {
    emitEdge(state, edge, theme);
  }

  // Trailer: clicks, then the referenced classDefs in canonical order, then linkStyles
  // in link-index order.
  state.lines.push(...state.clicks);
  for (const entry of NODE_CLASS_ORDER) {
    if (state.usedClasses.has(entry.name)) {
      state.lines.push(nodeClassDefLine(entry.name, classDefStyle(entry, theme)));
    }
  }
  if (state.usedClasses.has("annotation")) {
    // The annotation rect transcribes the note theme's border (`color`) and text
    // (`fontcolor`); it has no themed fill (a `note` box is unfilled in DOT).
    state.lines.push(
      `classDef annotation stroke:${theme.annotation.color},color:${theme.annotation.fontcolor}`,
    );
  }
  if (state.usedClasses.has("bnode")) {
    // The blank node approximates DOT's fixed `shape=point, color=gray` dot; like DOT
    // it is not themed. Near-invisible: a small gray-filled circle.
    state.lines.push("classDef bnode fill:gray,stroke:gray");
  }
  for (const { index, decl } of state.linkStyles) {
    state.lines.push(`linkStyle ${index} ${decl}`);
  }

  return `${state.lines.join("\n")}\n`;
}

/** Emits one element node statement, then its annotation rect + dotted link when it carries attributes. */
function emitNode(state: EmitState, node: RenderNode, theme: ProvTheme, useLabels: boolean): void {
  const className = nodeClassName(node);
  state.usedClasses.add(className);
  state.lines.push(`${shapeNode(node.id, node.kind, nodeLabel(node, useLabels))}:::${className}`);
  // Every node with a URI gets a click-through link — parity with DOT's unconditional
  // `URL`. Renderers that forbid links (GitHub strips them) degrade gracefully. Only an
  // allowlisted scheme is linked: a `javascript:`/`data:` href would execute when a
  // Mermaid-rendered page is opened, so a hostile-scheme node simply gets no click line.
  if (node.uri !== undefined) {
    const href = safeLinkUri(node.uri);
    if (href !== undefined) {
      state.clicks.push(`click ${node.id} href "${escapeHref(href)}" _blank`);
    }
  }
  emitAnnotation(state, node.attributes, node.id);
}

/** Emits a bundle as a `subgraph`: its titled header, then its member element nodes, then `end`. */
function emitSubgraph(
  state: EmitState,
  bundle: RenderBundle,
  scene: RenderScene,
  theme: ProvTheme,
  useLabels: boolean,
): void {
  state.lines.push(`subgraph ${bundle.id}["${escapeLabel(bundle.label)}"]`);
  for (const node of scene.nodes) {
    if (node.bundleId === bundle.id) emitNode(state, node, theme, useLabels);
  }
  state.lines.push("end");
}

/**
 * Emits one relation. A relation with n-ary legs OR non-formal attributes is split
 * through a blank circle node (D18's information-content rule, identical to the DOT
 * renderer's `needsBlankNode`): the first segment is an arrowless open link `---`
 * keeping the label, the second is a plain `-->` with no label, extra legs are gray
 * `-->` links labeled with the leg's role, and any attribute annotation attaches to
 * the blank node. A plain binary relation — no legs, no attributes — is a single
 * direct labeled edge and NO blank node (so a `>2`-slot relation whose tail slots are
 * all unset stays a clean binary edge, exactly as D18 specifies).
 */
function emitEdge(state: EmitState, edge: RenderEdge, theme: ProvTheme): void {
  const style = theme.relations[edge.relation];
  const needsBlankNode = edge.naryLegs.length > 0 || edge.attributes.length > 0;

  if (!needsBlankNode) {
    pushLink(state, `${edge.source} -->|${edge.label}| ${edge.target}`, relationTint(style));
    return;
  }

  state.bnode += 1;
  const bnode = `b${state.bnode}`;
  state.usedClasses.add("bnode");
  state.lines.push(`${bnode}((" ")):::bnode`);
  // First segment: source → blank node, arrowless (`---`, mirroring DOT's
  // `arrowhead=none`) and keeping the relation label + tint.
  pushLink(state, `${edge.source} ---|${edge.label}| ${bnode}`, relationTint(style));
  // Second segment: blank node → target, label dropped, tint kept.
  pushLink(state, `${bnode} --> ${edge.target}`, relationTint(style));
  // Extra n-ary legs: gray edges labeled with the leg's role (the formal attribute's
  // local part). Always gray, regardless of the relation's own tint.
  for (const leg of edge.naryLegs) {
    pushLink(state, `${bnode} -->|${leg.role}| ${leg.target}`, LEG_TINT);
  }
  emitAnnotation(state, edge.attributes, bnode);
}

/**
 * Emits an annotation rect holding `attributes` as `<br/>`-joined `name = value` rows
 * and a dotted, arrowless link (`-.-`) from the rect to `targetId`. The dotted link
 * consumes a link index but carries no `linkStyle` — the dotted form IS the annotation
 * styling, and the gray note-box color lives on the rect's `annotation` classDef.
 */
function emitAnnotation(
  state: EmitState,
  attributes: readonly RenderAttr[],
  targetId: string,
): void {
  if (attributes.length === 0) return;
  state.annotation += 1;
  const annId = `ann${state.annotation}`;
  state.usedClasses.add("annotation");
  const rows = attributes
    .map((attr) => `${escapeRow(attr.name)} = ${escapeRow(attr.value)}`)
    .join("<br/>");
  state.lines.push(`${annId}["${rows}"]:::annotation`);
  pushLink(state, `${annId} -.- ${targetId}`, null);
}
