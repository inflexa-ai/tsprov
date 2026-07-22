// The `Renderer` contract every renderer package implements.
//
// This is the one sanctioned `interface` in the package (per CLAUDE.md's
// type-vs-interface rule: an `interface` names a contract a class `implements`);
// every other exported shape is a `type`.

import type { ProvDocument } from "@inflexa-ai/tsprov";

import type { SceneOptions } from "./scene.js";
import type { ProvTheme } from "./theme.js";

/**
 * The options common to every renderer: the {@link SceneOptions} that shape the
 * scene projection, plus a `theme` override a renderer deep-merges over
 * {@link PROV_THEME}. Concrete renderers extend this with their own presentation
 * options (e.g. a DOT renderer's `rankdir`).
 */
export type RendererOptions = SceneOptions & {
  /** A partial theme deep-merged over the default {@link PROV_THEME}. */
  readonly theme?: Partial<ProvTheme>;
};

/**
 * A renderer turns a PROV document into some output format `Out` (a DOT string,
 * Mermaid text, an SVG, an interactive component…). Every renderer package in the
 * ladder implements this single contract over {@link toRenderScene}.
 *
 * @typeParam Out     The rendered output type.
 * @typeParam Options The renderer's option type; extends {@link RendererOptions}.
 */
export interface Renderer<
  Out,
  Options extends RendererOptions = RendererOptions,
> {
  /** A stable format identifier for this renderer (e.g. `"dot"`, `"mermaid"`, `"svg"`). */
  readonly format: string;

  /**
   * Renders `doc` to `Out`. May be async (e.g. a renderer that shells out to a
   * layout engine), so callers should await the result.
   *
   * @param doc     The document to render.
   * @param options Optional projection + presentation overrides.
   */
  render(doc: ProvDocument, options?: Options): Out | Promise<Out>;
}
