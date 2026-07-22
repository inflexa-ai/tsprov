# @inflexa-ai/tsprov-render-svg

An SVG renderer for [`@inflexa-ai/tsprov`](https://www.npmjs.com/package/@inflexa-ai/tsprov)
provenance documents. `SvgRenderer` lays a `ProvDocument` out with
[dagre](https://github.com/dagrejs/dagre) and emits a **standalone SVG string** in the
W3C PROV visual language — real reference glyphs (**ellipse** entities, **rect**
activities, **house-polygon** agents), folded-corner note annotations, small join circles
for n-ary relations, aliceblue bundle rectangles, themed fills/strokes and tinted labelled
edges with arrowheads, `<title>` tooltips, and `<a href>` node links. It is the
batteries-included, real-picture, works-on-a-server renderer: **no Graphviz, no browser,
no WASM** — pure string SVG you can drop straight into an `<img>`, a README, or a browser
tab.

## Usage

```ts
import { ProvDocument } from "@inflexa-ai/tsprov";
import { SvgRenderer } from "@inflexa-ai/tsprov-render-svg";

const doc = ProvDocument.deserialize(json, "json");
const svg = new SvgRenderer().render(doc);
//    ^ a standalone SVG string — write it to a `.svg`, or embed it directly
```

Embed it anywhere an image goes — the SVG has a `viewBox` and no intrinsic `width`/
`height`, so it scales to its container, and it references nothing external, so a
`data:` URI works with zero extra files:

```ts
const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
const html = `<img src="${dataUri}" alt="provenance graph" width="600">`;
```

Or write it to disk and open it in any browser:

```ts
await Bun.write("provenance.svg", svg);
```

`render(doc, options?)` is **synchronous and deterministic**: dagre lays out without
randomness and every number is rounded the same way, so the same document and options
produce a byte-identical string every time. It projects the document through the
render-core scene once and then reads only the scene plus dagre's layout — the output is a
pure function of that data.

## Options

`SvgRenderOptions` extends the shared `RendererOptions` (the scene projection toggles + a
`theme` override) with a layout `direction` (mapped to dagre's `rankdir`):

```ts
new SvgRenderer().render(doc, {
  direction: "BT",                    // layout direction: "BT" (default) | "TB" | "LR" | "RL"
  useLabels: true,                    // use prov:label as node text (two-line label)
  showNary: true,                     // route n-ary relations through a join circle
  includeElementAttributes: true,     // element attributes as folded-corner notes
  includeRelationAttributes: true,    // relation attributes as folded-corner notes
  theme: {                            // partial PROV_THEME override, merged per section
    nodes: { ...PROV_THEME.nodes, entity: { ...PROV_THEME.nodes.entity, fillcolor: "#e0f0ff" } },
  },
});
```

| Option | Default | Effect |
| --- | --- | --- |
| `direction` | `"BT"` | Layout direction (dagre `rankdir`). An out-of-range value (only reachable from untyped JS) falls back to `"BT"`. |
| `useLabels` | `false` | Node text is `prov:label`; when it differs from the identifier, a two-line label with the identifier as a second line. |
| `showNary` | `true` | Extra n-ary endpoints are drawn as gray legs off a shared join circle. |
| `includeElementAttributes` | `true` | An element's non-formal attributes become a folded-corner note linked to it. |
| `includeRelationAttributes` | `true` | A relation's non-formal attributes become a note linked to the relation's join circle. |
| `theme` | `PROV_THEME` | A `Partial<ProvTheme>` merged over the reference theme, shallow per section and per entry (so an override can touch a single field). |

## What it draws

- **Nodes** — one themed glyph per scene node: an entity **ellipse**, activity **rect**,
  agent **house polygon**, or bundle-endpoint **folder**, in the reference colors.
  Endpoints inferred from a relation (not declared) get the gray generic style. Each node
  group carries a `<title>` tooltip (qualified name + attribute rows) and, when the node
  has a URI, is wrapped in an `<a href>`.
- **Edges** — a `<path>` polyline following dagre's routed points with a deduped
  per-color arrowhead `<marker>`, tinted with the relation's theme color, and a `<text>`
  label at dagre's label position.
- **N-ary relations** — split through a small join circle: the first segment is
  **marker-less** and keeps the label, the second carries the arrowhead, and extra
  endpoints are gray legs labelled with the endpoint's role.
- **Annotations** — non-formal attributes become a **folded-corner note** with
  `name = value` rows, joined by a dashed, arrowhead-less link.
- **Bundles** — each sub-bundle is an **aliceblue rounded rectangle** drawn behind its
  members, labelled top-left.
- **Canvas** — a `viewBox` sized to the layout, no `width`/`height` (scales to its
  container), and a transparent background. Every interpolated string is XML-escaped, so
  the output is well-formed and self-contained.

## Layout is dagre's, not Graphviz's (D20)

This renderer does **not** reproduce Graphviz `dot`'s pixel geometry — it lays out with
dagre's layered algorithm, so coordinates differ from what `prov.dot` would draw (pixel
parity is the stretch graphviz stage's job). What IS faithful is the visual language:
shapes, fills, strokes, relation labels and tints all come from `PROV_THEME`. Node box
sizes are estimated from text metrics (there is no DOM to measure against), deliberately
over-approximating so estimation error shows up as padding, not clipped text. Bundles have
no native dagre cluster, so their rectangle is computed post-hoc from member positions; in
a pathological graph a member can spatially interleave with a non-member. See
`DEVIATIONS.md` (**D20**).

## Skipped relations are enumerable, not silently absent (D15)

A relation whose first two formal endpoints are not both resolvable (e.g. `wasStartedBy`
with no activity) cannot be drawn as an edge. Following the scene, this renderer omits it —
but the omission is not silent: `toRenderScene(doc).skipped` enumerates every such relation
with its type, identifier, and reason:

```ts
import { toRenderScene } from "@inflexa-ai/tsprov-render-core";
const { skipped } = toRenderScene(doc);
// [{ relation: "prov:Start", identifier: "ex:start1", reason: "…" }, …]
```

This is deviation **D15** (see the repository's `DEVIATIONS.md`).

## Dependencies and install cost

```sh
bun add @inflexa-ai/tsprov @inflexa-ai/tsprov-render-svg
# or: npm install @inflexa-ai/tsprov @inflexa-ai/tsprov-render-svg
```

Unlike the DOT and Mermaid renderers — which carry **zero third-party weight** because a
downstream tool does the layout — this package pays for doing layout itself. Its two
runtime dependencies (both pulled in automatically, not installed by you) are the value-semantic sibling
[`@inflexa-ai/tsprov-render-core`](https://www.npmjs.com/package/@inflexa-ai/tsprov-render-core)
and **[`@dagrejs/dagre`](https://www.npmjs.com/package/@dagrejs/dagre)** (`^3`); `tsprov`
is a **peer** (installed once, shared by every renderer).

dagre is the honest, sanctioned heavy dependency here. Measured at implementation time
(`@dagrejs/dagre@3.0.0`, which bundles `@dagrejs/graphlib`):

| Metric | dagre (+ graphlib) |
| --- | --- |
| Registry tarball, **unpacked on disk** | **~1.19 MB** (`dist.unpackedSize` 1,186,652 B) |
| Bundled into an app, **minified** | **~40.7 KB** |
| Bundled into an app, **minified + gzipped** | **~14.1 KB** |

That is the "pay only for what you render" tradeoff: you get a real picture with no
external tool, in exchange for dagre's weight. This renderer's **own** code adds ~3.5 KB
gzipped on top (the size budget in `rendering/evals/budgets.json` measures our code with
deps external; dagre's cost is documented here, not budgeted, so the ratchet is not gamed).

The package ships a dual **ESM + CJS** build with `.d.ts` declarations, consumable under
both `moduleResolution: bundler` and `nodenext`/`node16`. dagre is a dual (ESM+CJS)
package with named exports, so it interops cleanly from both our builds.

## License

Apache-2.0. Part of the [tsprov](https://github.com/inflexa-ai/tsprov) project.
