// Public API for `@inflexa-ai/tsprov-render-dot` — the DOT (Graphviz) renderer.
//
// This is the package's single public barrel (the entry point `package.json`
// resolves to), the one intentional exception to the "no barrels" rule: internal
// modules import each other directly. `@inflexa-ai/tsprov-render-core` is this
// package's one runtime dependency; `tsprov` is a peer.

export { DotRenderer } from "./dot.js";
export type { DotRenderOptions } from "./dot.js";
