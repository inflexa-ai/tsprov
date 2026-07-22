// Projection of PROV_THEME's Graphviz-faithful color tokens to browser-legal CSS/SVG colors.
//
// `PROV_THEME` (theme.ts) is the single source of visual truth: it transcribes `prov.dot`'s
// colors verbatim, X11 names and all. A handful of those X11 names are NOT valid CSS/SVG color
// keywords, and a browser (or resvg/Inkscape) silently DROPS an unknown color word — which
// would leave a themed stroke/fill at its default and quietly defeat the visual language. So
// the projection to a browser-legal token lives HERE, at the emission boundary every renderer
// that writes CSS/SVG colors shares (the Mermaid classDef/linkStyle surface, the SVG emitter,
// the interactive viewer's baked theme). Keeping it in render-core lets the theme stay
// Graphviz-faithful while the one projection is defined in exactly one place.

// The Graphviz X11 color names PROV_THEME uses that are NOT valid CSS/SVG colors, mapped to the
// hex the X11 palette assigns them. X11 `red4` (the `prov:Usage` stroke) is the darkest of the
// `red1..red4` ramp = `#8B0000`; it is currently the ONLY Graphviz-only name any theme color
// uses. Every other theme color (`darkgreen`, `red`, `gray`, `grey`, `dimgray`, `aliceblue`,
// and the hex literals) is already valid CSS and passes through untouched.
const GRAPHVIZ_ONLY_CSS: ReadonlyMap<string, string> = new Map([["red4", "#8B0000"]]);

/**
 * Projects a `PROV_THEME` color token to a browser-legal CSS/SVG color: a Graphviz-only X11
 * name (see {@link GRAPHVIZ_ONLY_CSS}) becomes its X11 hex; any already-legal token — a hex
 * like `#FED37F` or a CSS keyword like `red`/`gray` — passes through unchanged. Total: an
 * unmapped token is returned as-is. Every renderer that writes a theme color into CSS/SVG runs
 * it through here, so the projection is defined in exactly one place (and a conformance eval
 * can hold each emitter to the SAME projection when it checks emitted colors against the theme).
 */
export function toCssColor(color: string): string {
  return GRAPHVIZ_ONLY_CSS.get(color) ?? color;
}
