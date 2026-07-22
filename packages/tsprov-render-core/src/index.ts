// Public API for `@inflexa-ai/tsprov-render-core` — the renderer-agnostic scene
// projection and the W3C PROV visual theme.
//
// This is the package's single public barrel (the entry point `package.json`
// resolves to), the one intentional exception to the "no barrels" rule: internal
// modules import each other directly. tsprov itself is a peer dependency — this
// package adds zero runtime dependencies.

export { toRenderScene } from "./scene.js";
export type {
  RenderScene,
  RenderNode,
  RenderEdge,
  RenderAttr,
  RenderBundle,
  NaryLeg,
  SkippedRelation,
  SceneOptions,
} from "./scene.js";

export { PROV_THEME } from "./theme.js";
export type {
  ProvTheme,
  NodeStyle,
  EdgeStyle,
  AnnotationStyle,
  AnnotationLinkStyle,
  NodeKind,
  DeclaredNodeKind,
  RelationKind,
  Direction,
} from "./theme.js";

export type { Renderer, RendererOptions } from "./renderer.js";

export { safeLinkUri } from "./uri.js";
