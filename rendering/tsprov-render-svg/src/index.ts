// Public API for `@inflexa-ai/tsprov-render-svg` — the SVG renderer.
//
// This is the package's single public barrel (the entry point `package.json`
// resolves to), the one intentional exception to the "no barrels" rule: internal
// modules import each other directly. `@inflexa-ai/tsprov-render-core` and
// `@dagrejs/dagre` are this package's two runtime dependencies; `tsprov` is a peer.

export { SvgRenderer, toCssColor } from "./svg.js";
export type { SvgRenderOptions } from "./svg.js";
