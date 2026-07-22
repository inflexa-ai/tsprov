# @inflexa-ai/tsprov-render-interactive

An **interactive HTML** renderer for
[`@inflexa-ai/tsprov`](https://www.npmjs.com/package/@inflexa-ai/tsprov) provenance
documents. `renderInteractiveHtml(doc)` returns **ONE self-contained HTML file** — inline
CSS and vanilla JS, the dagre-positioned scene baked in as JSON, **no external resource
loads** — that opens from `file://` with nothing installed and turns a static provenance
picture into an **animated, explorable graph**: pan/zoom, progressive disclosure of large
graphs, an attribute-inspection panel, search/filter, visible bundle grouping, and
light/dark awareness — all in the W3C PROV visual language.

It is the "email someone a provenance graph they can actually explore" renderer: write the
string to a `.html`, attach it to an email, drop it on a static host — it just works,
offline, in any evergreen browser.

## Usage

```ts
import { ProvDocument } from "@inflexa-ai/tsprov";
import { renderInteractiveHtml } from "@inflexa-ai/tsprov-render-interactive";

const doc = ProvDocument.deserialize(json, "json");
const html = renderInteractiveHtml(doc, { title: "My provenance" });
//    ^ a complete, self-contained HTML document

await Bun.write("provenance.html", html);
// open it in any browser — no server, no network, no build step
```

There is also an `InteractiveRenderer` implementing the shared `Renderer<string>` contract
(`format: "html"`), for code that dispatches over renderers uniformly:

```ts
import { InteractiveRenderer } from "@inflexa-ai/tsprov-render-interactive";
const html = new InteractiveRenderer().render(doc);
```

`renderInteractiveHtml(doc, options?)` is **synchronous and deterministic**: the scene, the
dagre layout, and the template are all deterministic and the payload geometry is rounded to
2 decimals, so the same document + options produce a **byte-identical** file every time.

## Options

`InteractiveRenderOptions` extends the shared `RendererOptions` (the scene projection
toggles + a `theme` override) with a layout `direction`, a disclosure `focus`, and a `title`:

| Option | Default | Effect |
| --- | --- | --- |
| `title` | `"Provenance graph"` | Document title, shown in the browser tab and the header. |
| `direction` | `"BT"` | Layout direction (dagre `rankdir`): `"BT"` \| `"TB"` \| `"LR"` \| `"RL"`. |
| `focus` | highest-degree node | For a graph with more than 50 nodes, the qualified name (e.g. `"ex:e1"`) the initial view opens on. |
| `useLabels` | `false` | Node text is `prov:label` (two-line label when it differs from the identifier). |
| `showNary` | `true` | Extra n-ary endpoints drawn as legs off a shared join circle. |
| `includeElementAttributes` | `true` | Element attributes become folded-corner notes. |
| `includeRelationAttributes` | `true` | Relation attributes become notes. |
| `theme` | `PROV_THEME` | A `Partial<ProvTheme>` merged over the reference theme (shallow per section and per entry). |

## What you get in the browser

- **Pan & zoom** — drag to pan, scroll to zoom (cursor-anchored). Programmatic view changes
  (fit, focus, expand) ease the `viewBox` with `requestAnimationFrame` (the `viewBox` is not
  CSS-transitionable, so it is animated by hand).
- **Progressive disclosure** — a graph with **≤ 50 nodes** shows in full; a larger one opens
  on a **focus node + its 2-hop neighborhood**, so a hundreds-of-record document is legible
  on load. Every visible node with hidden neighbors carries a **count badge**; clicking it
  (or the panel's *Expand neighbors*) reveals its neighbors with a CSS transition, and the
  view re-fits. **Show all** / **Reset** and a per-node **Collapse** round it out.
- **Attribute panel** — click (or Enter on) a node to inspect its qualified name, a
  themed kind chip, a link to its URI, its attribute table, its degree, and expand/collapse
  actions.
- **Search & filter** — substring search over qualified names and labels plus per-kind
  checkboxes: matches are highlighted, the rest dimmed, and Enter jumps to the first match.
- **The visual language** — entity **ellipses**, activity **rects**, agent **house**
  polygons, bundle **folders**, folded-corner note annotations, join circles for n-ary
  relations, tinted labelled edges with arrowheads, and aliceblue bundle rectangles — the
  reference colors, baked from the theme and **fixed** across light/dark. Only the page
  **chrome** (background, panel, controls) follows `prefers-color-scheme`; the PROV colors
  are the language and do not change.

## Self-contained, by construction

The output references **nothing external**: no CDN, no fonts, no images, no `fetch`/XHR. The
whole viewer — style, client, and the positioned scene — is inlined into the single file.
(Anchor `href`s to entity URIs are optional navigation *data*; the file is fully functional
offline without them.) An eval renders all 401 corpus documents and asserts self-containment,
determinism, and that the embedded payload round-trips — including through hostile literals:
a `</script>` inside an attribute value cannot break out of the payload, because every `<` in
the embedded JSON is escaped to `<` (and restored losslessly by `JSON.parse`).

## Output size

The file bundles the whole viewer, so every emitted page carries a fixed template cost of
roughly **~50 KB minified (~15 KB gzipped)** of style + client, plus the scene payload which
scales with the document. Typical sizes:

| Document | Nodes / edges | Emitted HTML | gzipped |
| --- | --- | --- | --- |
| primer triangle | 3 / 3 | ~90 KB | ~20 KB |
| **prov-inflexa.2** (real-world) | **151 / 487** | **~505 KB** | **~70 KB** |

That is the tradeoff for a zero-dependency, offline, single-file artifact — trivially small
to email or host, and it opens instantly.

## Layout is baked, once, by the SVG seam (D20)

Layout is **not** computed in the browser — there is no client-side force simulation. The
scene is laid out at **generate time** by reusing the SVG renderer's dagre layout
(`@inflexa-ai/tsprov-render-svg`'s exported `layoutScene` seam), so the workspace has exactly
**one** layout implementation and the interactive picture matches the static SVG. As with the
SVG renderer, coordinates are dagre's layered layout, **not** Graphviz `dot`'s (see
`DEVIATIONS.md`, **D20**). Positions are fixed, so revealing a hidden node is a class flip —
nothing re-flows, and spatial memory is preserved.

## Dependencies and install cost

```sh
bun add @inflexa-ai/tsprov @inflexa-ai/tsprov-render-core @inflexa-ai/tsprov-render-svg @inflexa-ai/tsprov-render-interactive
```

Its two runtime dependencies are the value-semantic sibling
[`@inflexa-ai/tsprov-render-core`](https://www.npmjs.com/package/@inflexa-ai/tsprov-render-core)
and [`@inflexa-ai/tsprov-render-svg`](https://www.npmjs.com/package/@inflexa-ai/tsprov-render-svg)
(the layout seam); `@dagrejs/dagre` comes in **transitively through render-svg**, its single
owner, not directly. `tsprov` is a **peer** (installed once, shared by every renderer). The
embedded browser client is **dependency-free vanilla JS** — no framework, no CDN, nothing.

The package ships a dual **ESM + CJS** build with `.d.ts` declarations, consumable under both
`moduleResolution: bundler` and `nodenext`/`node16`.

## Authoring the client

The browser client is authored as real files — `template/{shell.html,style.css,app.js}` —
and compiled by `scripts/generate-template.mjs` (`bun run gen`) into the committed
`src/template.generated.ts`. A drift test regenerates in memory and fails on any mismatch, so
the sources and the shipped module can never silently diverge. Edit the template files, run
`bun run gen`, and re-run the tests.

## License

Apache-2.0. Part of the [tsprov](https://github.com/inflexa-ai/tsprov) project.
