// A hand-rolled, dependency-free reader for `SvgRenderer` output.
//
// The SVG eval may not add an XML-parser dependency (not on the approved list), so both
// the well-formedness check and the light structural extraction the conformance sweep
// needs are written by hand here. `SvgRenderer` emits one top-level `<g>`/`<a>` group per
// line (the parts are `\n`-joined), so extraction is line-oriented + regex; the
// well-formedness check is a full character walk (tag balance + attribute quoting), NOT a
// line trick, so it would catch a genuinely malformed byte stream.

/** A parsed element/inferred-node glyph: the shape element, its class hooks, and its paint. */
export type SvgGlyph = {
  readonly shape: "ellipse" | "rect" | "polygon" | "path";
  readonly kind: string;
  readonly inferred: boolean;
  readonly fill: string;
  /** The glyph's border color, or `null` when the glyph carries no `stroke` attribute. */
  readonly stroke: string | null;
};

/** A parsed edge segment: the path's stroke, whether it is arrowed/dashed, and its label. */
export type SvgEdge = {
  readonly stroke: string;
  readonly arrowed: boolean;
  readonly dashed: boolean;
  readonly label: string | null;
  readonly labelFill: string | null;
};

/** A parsed `<marker>` arrowhead: its id and the color its `<path>` is filled with. */
export type SvgMarker = { readonly id: string; readonly fill: string };

/** The light structural model the conformance sweep reads. */
export type SvgModel = {
  readonly viewBox: readonly number[];
  readonly glyphs: readonly SvgGlyph[];
  readonly edges: readonly SvgEdge[];
  readonly bundleFills: readonly string[];
  readonly markers: readonly SvgMarker[];
  readonly markerRefs: readonly string[];
  /** `true` when the string contains any external reference (image/script/xlink/font/remote url). */
  readonly hasExternalReference: boolean;
};

// Groups are matched across the WHOLE string, not per line: a node group's `<title>`
// carries `\n`-separated attribute rows, so a node group legitimately spans several
// lines. `[\s\S]*?` is non-greedy and a group never nests another `<g>`, so the first
// `</g>` closes it.
const NODE_GROUP_RE = /<g class="prov-node prov-(\w+)( prov-inferred)?">([\s\S]*?)<\/g>/g;
const EDGE_GROUP_RE = /<g class="prov-edge">([\s\S]*?)<\/g>/g;
const BUNDLE_GROUP_RE = /<g class="prov-bundle">([\s\S]*?)<\/g>/g;
const GLYPH_RE = /<(ellipse|rect|polygon|path)\b[^>]*?\bfill="([^"]*)"(?:[^>]*?\bstroke="([^"]*)")?[^>]*\/>/;
const EDGE_PATH_RE = /<path d="[^"]*" fill="none" stroke="([^"]*)"[^>]*?\/>/;
const EDGE_LABEL_RE = /<text[^>]*\bfill="([^"]*)">([^<]*)<\/text>/;
const BUNDLE_RECT_RE = /<rect\b[^>]*\bfill="([^"]*)"[^>]*\/>/;
const MARKER_RE = /<marker id="([^"]*)"[^>]*><path d="[^"]*" fill="([^"]*)"\/>/g;
const MARKER_REF_RE = /marker-end="url\(#([^)]*)\)"/g;
const EXTERNAL_RE = /<image\b|<script\b|xlink:href|@import|\ssrc=|<use\b|url\(\s*['"]?https?:/;

/**
 * Parses `SvgRenderer` output into an {@link SvgModel} by scanning its top-level groups.
 * The {@link checkWellFormed} pass is what actually guarantees the string is well-formed,
 * so this reader may stay lenient.
 */
export function parseSvg(svg: string): SvgModel {
  const viewBox = (svg.match(/viewBox="([^"]*)"/)?.[1] ?? "").split(" ").map(Number);

  const glyphs: SvgGlyph[] = [];
  for (const node of svg.matchAll(NODE_GROUP_RE)) {
    const kind = node[1];
    const inner = node[3];
    if (kind === undefined || inner === undefined) continue;
    const glyph = GLYPH_RE.exec(inner);
    if (glyph !== null && glyph[1] !== undefined && glyph[2] !== undefined) {
      glyphs.push({
        shape: glyph[1] as SvgGlyph["shape"],
        kind,
        inferred: node[2] !== undefined,
        fill: glyph[2],
        stroke: glyph[3] ?? null,
      });
    }
  }

  const edges: SvgEdge[] = [];
  for (const group of svg.matchAll(EDGE_GROUP_RE)) {
    const inner = group[1];
    if (inner === undefined) continue;
    const path = EDGE_PATH_RE.exec(inner);
    if (path === null || path[1] === undefined) continue;
    const label = EDGE_LABEL_RE.exec(inner);
    edges.push({
      stroke: path[1],
      arrowed: inner.includes("marker-end="),
      dashed: inner.includes("stroke-dasharray="),
      label: label?.[2] ?? null,
      labelFill: label?.[1] ?? null,
    });
  }

  const bundleFills: string[] = [];
  for (const group of svg.matchAll(BUNDLE_GROUP_RE)) {
    const inner = group[1];
    if (inner === undefined) continue;
    const rect = BUNDLE_RECT_RE.exec(inner);
    if (rect !== null && rect[1] !== undefined) bundleFills.push(rect[1]);
  }

  const markers: SvgMarker[] = [];
  for (const m of svg.matchAll(MARKER_RE)) {
    if (m[1] !== undefined && m[2] !== undefined) markers.push({ id: m[1], fill: m[2] });
  }
  const markerRefs: string[] = [];
  for (const m of svg.matchAll(MARKER_REF_RE)) {
    if (m[1] !== undefined) markerRefs.push(m[1]);
  }

  return {
    viewBox,
    glyphs,
    edges,
    bundleFills,
    markers,
    markerRefs,
    hasExternalReference: EXTERNAL_RE.test(svg),
  };
}

/**
 * Checks `svg` for XML well-formedness by a full character walk — tag balance plus
 * attribute quoting — with NO parser dependency. Returns the first error found, or `null`
 * when well-formed. Because `SvgRenderer` escapes every `<`/`>`/`&`/`"` it interpolates,
 * a `>` reliably ends a tag and a `"` reliably ends an attribute value, so this simple
 * walk is sufficient for the grammar the emitter actually produces.
 */
export function checkWellFormed(svg: string): string | null {
  const stack: string[] = [];
  let i = 0;
  while (i < svg.length) {
    const lt = svg.indexOf("<", i);
    if (lt === -1) return textError(svg.slice(i));
    const textErr = textError(svg.slice(i, lt));
    if (textErr !== null) return textErr;
    const gt = svg.indexOf(">", lt);
    if (gt === -1) return `unterminated tag at ${lt}`;
    const tag = svg.slice(lt + 1, gt);
    i = gt + 1;
    if (tag.startsWith("/")) {
      const name = tag.slice(1).trim();
      const top = stack.pop();
      if (top !== name) return `close </${name}> does not match open <${top ?? "none"}>`;
      continue;
    }
    const selfClose = tag.endsWith("/");
    const body = selfClose ? tag.slice(0, -1) : tag;
    const m = body.match(/^([\w:-]+)([\s\S]*)$/);
    if (m === null || m[1] === undefined) return `malformed tag <${tag}>`;
    const attrErr = attrError(m[2] ?? "");
    if (attrErr !== null) return `in <${m[1]}>: ${attrErr}`;
    if (!selfClose) stack.push(m[1]);
  }
  return stack.length === 0 ? null : `unclosed tags: ${stack.join(",")}`;
}

/** Rejects an `&` in text/attribute content that does not begin a valid XML entity. */
function textError(text: string): string | null {
  const m = /&(?!(amp|lt|gt|quot|#39|#x27|#\d+);)/.exec(text);
  return m === null ? null : `unescaped & at offset ${m.index}`;
}

/** Rejects an unquoted or unbalanced attribute (and a raw `<`/unescaped `&` inside a value). */
function attrError(attrs: string): string | null {
  let rest = attrs.trim();
  while (rest.length > 0) {
    const m = rest.match(/^([\w:-]+)\s*=\s*"([^"]*)"\s*/);
    if (m === null || m[2] === undefined) {
      return `unquoted/malformed attribute near ${JSON.stringify(rest.slice(0, 40))}`;
    }
    if (m[2].includes("<")) return "raw < in attribute value";
    const valueErr = textError(m[2]);
    if (valueErr !== null) return `in attribute value: ${valueErr}`;
    rest = rest.slice(m[0].length);
  }
  return null;
}
