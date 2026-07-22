// Public API for `@inflexa-ai/tsprov-render-interactive` — the interactive HTML renderer.
//
// This is the package's single public barrel (the entry point `package.json` resolves
// to), the one intentional exception to the "no barrels" rule: internal modules import
// each other directly. `@inflexa-ai/tsprov-render-core` and
// `@inflexa-ai/tsprov-render-svg` (the layout seam; dagre stays owned by svg) are this
// package's two runtime dependencies; `tsprov` is a peer.

export {
  renderInteractiveHtml,
  InteractiveRenderer,
  buildScenePayload,
  WHOLE_GRAPH_MAX,
  DISCLOSURE_HOPS,
} from "./interactive.js";
export type { InteractiveRenderOptions, ScenePayload } from "./interactive.js";
