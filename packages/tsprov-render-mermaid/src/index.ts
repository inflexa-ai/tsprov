// Public API for `@inflexa-ai/tsprov-render-mermaid` — the Mermaid renderer.
//
// This is the package's single public barrel (the entry point `package.json`
// resolves to), the one intentional exception to the "no barrels" rule: internal
// modules import each other directly. `@inflexa-ai/tsprov-render-core` is this
// package's one runtime dependency; `tsprov` is a peer.

export { MermaidRenderer } from "./mermaid.js";
export type { MermaidRenderOptions } from "./mermaid.js";
