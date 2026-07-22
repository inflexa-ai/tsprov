// The DOT (Graphviz) emitter — `DotRenderer`.
//
// This turns a `RenderScene` (from `@inflexa-ai/tsprov-render-core`) into a DOT
// `digraph` string reproducing the structure of Python `prov`'s `prov_to_dot`
// (`reference/prov/src/prov/dot.py:179-409`). It is a pure, deterministic string
// builder: `render(doc, options)` projects the document through `toRenderScene`
// once and then reads ONLY the scene — never the document again — so the output is
// a function of scene data alone (document order in, byte-identical string out).
//
// What the scene deliberately leaves to a renderer, and this module materializes:
//   - blank ("point") nodes that split an n-ary / attribute-annotated relation
//     (dot.py:301-306, :357-390),
//   - `shape=note` annotation boxes carrying an HTML-TABLE label (dot.py:212-247).
// Everything visual (shapes, colors, relation labels) comes from `PROV_THEME`.

import {
  PROV_THEME,
  type ProvTheme,
  type NodeStyle,
  type EdgeStyle,
  type Direction,
  type DeclaredNodeKind,
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

/**
 * Options for {@link DotRenderer.render}: the {@link RendererOptions} common to
 * every renderer (the {@link SceneOptions} projection toggles plus a `theme`
 * partial), extended with a DOT-specific graph `direction`.
 */
export type DotRenderOptions = RendererOptions & {
  /**
   * Graph layout direction emitted as `rankdir` (`dot.py:196`). Defaults to the
   * theme's direction (`"BT"`). A runtime value outside the four valid directions
   * (only reachable from untyped JS callers) falls back to `"BT"`, matching
   * `dot.py:203-205`.
   */
  readonly direction?: Direction;
};

/** The four valid `rankdir` values; a runtime guard for untyped JS callers (`dot.py:203`). */
const VALID_DIRECTIONS: ReadonlySet<string> = new Set(["BT", "TB", "LR", "RL"]);

// A DOT identifier that needs no quoting: an alphanumeric/underscore name or a
// numeral (DOT language grammar). Anything else (`#FFFC87`, `ex:e`, a URI, a value
// with spaces) is emitted as a double-quoted string. The golden comparator unquotes
// before comparing, so this only has to be VALID DOT — it need not match pydot's own
// quoting choices byte-for-byte.
const DOT_BAREWORD = /^(?:[A-Za-z_][A-Za-z0-9_]*|-?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?))$/;

/**
 * Escapes a string for a DOT double-quoted literal: backslash and double-quote are
 * the only two characters that must be escaped inside `"…"` (DOT language spec).
 * `\` is escaped first so the `"`→`\"` replacement is not itself re-escaped.
 */
function escapeDotString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Renders an attribute value as a bareword when the grammar allows, else a quoted string. */
function dotValue(value: string): string {
  return DOT_BAREWORD.test(value) ? value : `"${escapeDotString(value)}"`;
}

/**
 * Escapes text destined for an HTML-like (`<…>`) DOT label, mirroring Python's
 * `html.escape(s, quote=True)` exactly — the function `dot.py` applies to every
 * annotation cell (`dot.py:230,234`). `&` is replaced first so later replacements
 * are not double-escaped; `"`→`&quot;` and `'`→`&#x27;` are included because the
 * reference's `html.escape` defaults to `quote=True` (verified against `prov.dot`
 * output — the design's "quotes stay literal" note is inaccurate for this path).
 */
function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Merges a partial theme over {@link PROV_THEME}, shallow per section, then shallow
 * per entry within the keyed sections (`nodes`/`generic`/`relations`). Per-entry
 * merge lets an override touch a single field (e.g. an entity's `fillcolor`) while
 * the untouched fields keep the reference value; `annotation`/`annotationLink` are
 * single objects merged shallowly. `Partial<ProvTheme>` cannot express a partial
 * `NodeStyle`, so at runtime an override entry may still be partial (from JS) — the
 * per-entry spread handles that safely. Deliberately not a deep-merge: no dependency,
 * and one level of nesting is all the theme has.
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

/**
 * The DOT style for a scene node: the gray generic style for an inferred endpoint
 * (`GENERIC_NODE_STYLE`, `dot.py:295`), else the colored declared-element style
 * (`DOT_PROV_STYLE`, `dot.py:278`). The `switch` is exhaustive over `NodeKind`; a
 * declared element is only ever entity/activity/agent, so `unknown`/`bundle` are
 * defensive (declared `unknown` is unreachable — elements always carry a colored
 * kind — and falls back to the generic style rather than inventing one).
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

/** Renders a `NodeStyle` as ordered DOT attribute assignments (border `color` omitted where the theme leaves it unset). */
function nodeStyleAttrs(style: NodeStyle): string[] {
  const attrs = [
    `shape=${dotValue(style.shape)}`,
    `style=${dotValue(style.style)}`,
    `fillcolor=${dotValue(style.fillcolor)}`,
  ];
  if (style.color !== undefined) attrs.push(`color=${dotValue(style.color)}`);
  return attrs;
}

/**
 * Renders an `EdgeStyle` as ordered DOT attribute assignments. `omitLabel` drops the
 * `label` for an n-ary relation's second segment (`dot.py:371` deletes it); `color`/
 * `fontcolor` are emitted only where the theme sets them (the reference tints only
 * some relations).
 */
function edgeStyleAttrs(style: EdgeStyle, omitLabel: boolean): string[] {
  const attrs: string[] = [];
  if (!omitLabel) attrs.push(`label=${dotValue(style.label)}`);
  attrs.push(`fontsize=${dotValue(style.fontsize)}`);
  if (style.color !== undefined) attrs.push(`color=${dotValue(style.color)}`);
  if (style.fontcolor !== undefined) attrs.push(`fontcolor=${dotValue(style.fontcolor)}`);
  return attrs;
}

/** The HTML-TABLE label for an attribute-annotation note (`ANNOTATION_START/ROW/END`, `dot.py:163-168`). */
function annotationLabel(attributes: readonly RenderAttr[]): string {
  const rows = attributes.map((attr) => {
    // The value cell gains an `href` only when the value is itself an identifier
    // (its `valueUri` is present) — `dot.py:232`. The name cell always links to the
    // attribute's own URI.
    const valueHref = attr.valueUri === undefined ? "" : ` href="${attr.valueUri}"`;
    return (
      "    <TR>\n" +
      `        <TD align="left" href="${attr.nameUri}">${htmlEscape(attr.name)}</TD>\n` +
      `        <TD align="left"${valueHref}>${htmlEscape(attr.value)}</TD>\n` +
      "    </TR>"
    );
  });
  return [
    '<<TABLE cellpadding="0" border="0">',
    ...rows,
    "    </TABLE>>",
  ].join("\n");
}

/**
 * `DotRenderer` projects a PROV document to a DOT `digraph` string reproducing
 * `prov_to_dot`'s output (`Renderer<string>`, `format: "dot"`). Stateless and
 * deterministic: two renders of the same document with the same options are
 * byte-identical. Pipe the result to Graphviz's `dot` to produce an image.
 */
export class DotRenderer implements Renderer<string, DotRenderOptions> {
  /** The stable format identifier for this renderer. */
  readonly format = "dot";

  /**
   * Renders `doc` to a DOT digraph string.
   *
   * @param doc     The document to render.
   * @param options Projection toggles ({@link SceneOptions}), a `theme` override,
   *                and the graph `direction`.
   * @returns The DOT source.
   */
  render(doc: ProvDocument, options?: DotRenderOptions): string {
    const theme = mergeTheme(options?.theme);
    const direction = resolveDirection(options?.direction, theme.direction);
    const scene = toRenderScene(doc, options);
    return emit(scene, theme, direction, options?.useLabels ?? false);
  }
}

/** Resolves the effective `rankdir`: an explicit valid direction, else the theme's, else `"BT"`. */
function resolveDirection(
  requested: Direction | undefined,
  themeDefault: Direction,
): Direction {
  if (requested === undefined) return themeDefault;
  // `requested` is typed `Direction`, so this guard only bites an untyped JS caller
  // passing garbage — matching `dot.py:203-205`'s runtime reset to the default.
  return VALID_DIRECTIONS.has(requested) ? requested : "BT";
}

/**
 * The pure scene→DOT projection. Blank-node (`b*`) and annotation (`ann*`) ids are
 * minted here with independent counters (the scene owns only element/edge/bundle
 * ids); their exact values are immaterial — the golden comparator matches by
 * structure, not id.
 */
function emit(
  scene: RenderScene,
  theme: ProvTheme,
  direction: Direction,
  useLabels: boolean,
): string {
  const lines: string[] = [];
  // A mutable counter box threaded through emission so blank/annotation ids stay
  // globally unique across top-level nodes, clusters, and relations.
  const counters = { bnode: 0, annotation: 0 };

  lines.push("digraph G {");
  lines.push(`rankdir=${dotValue(direction)};`);
  lines.push('charset="utf-8";');

  // Element nodes (and their annotation notes) first, grouped by container: the
  // top level, then each bundle as a `cluster` subgraph (dot.py:249-257). Relations
  // and their materialized blank/annotation nodes follow at the top level — valid
  // DOT (edges reference cluster node ids by name) and structurally equivalent to
  // dot.py's in-cluster placement, which the reconstruction-based comparator ignores.
  for (const node of scene.nodes) {
    if (node.bundleId === undefined) emitNode(lines, node, theme, useLabels, counters);
  }
  for (const bundle of scene.bundles) {
    emitCluster(lines, bundle, scene, theme, useLabels, counters);
  }
  for (const edge of scene.edges) {
    emitEdge(lines, edge, theme, counters);
  }

  lines.push("}");
  return `${lines.join("\n")}\n`;
}

/** Emits one element node statement, then its annotation note + dashed link when it carries attributes. */
function emitNode(
  lines: string[],
  node: RenderNode,
  theme: ProvTheme,
  useLabels: boolean,
  counters: { bnode: number; annotation: number },
): void {
  const attrs = [`label=${nodeLabel(node, useLabels)}`];
  if (node.uri !== undefined) attrs.push(`URL="${escapeDotString(node.uri)}"`);
  attrs.push(...nodeStyleAttrs(nodeStyle(node, theme)));
  lines.push(`${node.id} [${attrs.join(", ")}];`);
  emitAnnotation(lines, node.attributes, node.id, theme, counters);
}

/**
 * The node's `label` value. Without `useLabels`, or when the label equals the
 * identifier, a plain quoted string (`dot.py:263,275`). With `useLabels` and a
 * distinct label, the two-line HTML form — the label as the main text and the
 * identifier as a smaller subtitle (`dot.py:269-273`). The two-line form interpolates
 * raw (no entity-escaping), exactly as the reference does.
 */
function nodeLabel(node: RenderNode, useLabels: boolean): string {
  if (useLabels && node.label !== node.qualifiedName) {
    return (
      `<${node.label}<br />` +
      `<font color="#333333" point-size="10">` +
      `${node.qualifiedName}</font>>`
    );
  }
  return `"${escapeDotString(node.label)}"`;
}

/** Emits a bundle as a `cluster` subgraph: its `URL`/`label`, then its member element nodes. */
function emitCluster(
  lines: string[],
  bundle: RenderBundle,
  scene: RenderScene,
  theme: ProvTheme,
  useLabels: boolean,
  counters: { bnode: number; annotation: number },
): void {
  // pydot prefixes a `Cluster` graph name with `cluster_`; the scene's bundle id
  // (`c1`, `c2`, …) mirrors dot.py's cluster counter, so `cluster_<id>` reproduces
  // the reference's subgraph name (dot.py:251).
  lines.push(`subgraph cluster_${bundle.id} {`);
  if (bundle.uri !== undefined) lines.push(`URL="${escapeDotString(bundle.uri)}";`);
  lines.push(`label="${escapeDotString(bundle.label)}";`);
  for (const node of scene.nodes) {
    if (node.bundleId === bundle.id) emitNode(lines, node, theme, useLabels, counters);
  }
  lines.push("}");
}

/**
 * Emits one relation. A relation with n-ary legs OR non-formal attributes is split
 * through a blank `point` node (dot.py:357-390): the first segment keeps the label
 * and gets `arrowhead=none`, the second drops the label, extra legs are gray with the
 * leg attribute's local part as label, and any attribute annotation attaches to the
 * blank node. A plain binary relation is a single styled edge (dot.py:391-399).
 */
function emitEdge(
  lines: string[],
  edge: RenderEdge,
  theme: ProvTheme,
  counters: { bnode: number; annotation: number },
): void {
  const style = theme.relations[edge.relation];
  const needsBlankNode = edge.naryLegs.length > 0 || edge.attributes.length > 0;

  if (!needsBlankNode) {
    lines.push(`${edge.source} -> ${edge.target} [${edgeStyleAttrs(style, false).join(", ")}];`);
    return;
  }

  counters.bnode += 1;
  const bnode = `b${counters.bnode}`;
  // The blank node styling is fixed in the reference (not themed): dot.py:304.
  lines.push(`${bnode} [label="", shape=point, color=gray];`);
  // First segment: source → blank node, label + full style + arrowhead removed.
  lines.push(
    `${edge.source} -> ${bnode} [${["arrowhead=none", ...edgeStyleAttrs(style, false)].join(", ")}];`,
  );
  // Second segment: blank node → target, label dropped.
  lines.push(`${bnode} -> ${edge.target} [${edgeStyleAttrs(style, true).join(", ")}];`);
  // Extra n-ary legs: gray edges labeled with the leg's role (dot.py:377-388). The
  // relation's own `fontsize` is kept; `color`/`fontcolor` are overridden to gray.
  for (const leg of edge.naryLegs) {
    const legAttrs = [
      `fontsize=${dotValue(style.fontsize)}`,
      "color=gray",
      "fontcolor=dimgray",
      `label=${dotValue(leg.role)}`,
    ];
    lines.push(`${bnode} -> ${leg.target} [${legAttrs.join(", ")}];`);
  }
  emitAnnotation(lines, edge.attributes, bnode, theme, counters);
}

/** Emits an annotation note holding `attributes` and a dashed arrowhead-less link to `targetId` (dot.py:243-247). */
function emitAnnotation(
  lines: string[],
  attributes: readonly RenderAttr[],
  targetId: string,
  theme: ProvTheme,
  counters: { bnode: number; annotation: number },
): void {
  if (attributes.length === 0) return;
  counters.annotation += 1;
  const annId = `ann${counters.annotation}`;
  const style = theme.annotation;
  const noteAttrs = [
    `label=${annotationLabel(attributes)}`,
    `shape=${dotValue(style.shape)}`,
    `color=${dotValue(style.color)}`,
    `fontcolor=${dotValue(style.fontcolor)}`,
    `fontsize=${dotValue(style.fontsize)}`,
  ];
  lines.push(`${annId} [${noteAttrs.join(", ")}];`);
  const link = theme.annotationLink;
  const linkAttrs = [
    `arrowhead=${dotValue(link.arrowhead)}`,
    `style=${dotValue(link.style)}`,
    `color=${dotValue(link.color)}`,
  ];
  lines.push(`${annId} -> ${targetId} [${linkAttrs.join(", ")}];`);
}
