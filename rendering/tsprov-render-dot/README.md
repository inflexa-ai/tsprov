# @inflexa-ai/tsprov-render-dot

A DOT (Graphviz) renderer for [`@inflexa-ai/tsprov`](https://www.npmjs.com/package/@inflexa-ai/tsprov)
provenance documents. `DotRenderer` turns a `ProvDocument` into a DOT `digraph`
string that reproduces the structure of Python `prov`'s `prov.dot.prov_to_dot` —
styled nodes, labeled and colored edges, n-ary relations routed through blank nodes,
attribute annotation notes, and bundles as clusters. Pipe the string to `dot` and you
get the same picture the Python library draws.

It carries **zero third-party weight**: its only runtime dependency is the
value-semantic sibling [`@inflexa-ai/tsprov-render-core`](https://www.npmjs.com/package/@inflexa-ai/tsprov-render-core),
and `tsprov` is a **peer** (installed once, shared by every renderer).

## Usage

```ts
import { ProvDocument } from "@inflexa-ai/tsprov";
import { DotRenderer } from "@inflexa-ai/tsprov-render-dot";

const doc = ProvDocument.deserialize(json, "json");
const dot = new DotRenderer().render(doc);
//    ^ a DOT digraph string
```

Render to an image by piping the string to Graphviz:

```sh
bun run render.ts | dot -Tsvg -o provenance.svg
# or -Tpng, -Tpdf, …
```

`render(doc, options?)` is **deterministic**: the same document and options produce a
byte-identical string every time. It projects the document through the render-core
scene once and then reads only the scene — the output is a pure function of scene data.

## Options

`DotRenderOptions` extends the shared `RendererOptions` (the scene projection toggles
+ a `theme` override) with a DOT-specific `direction`:

```ts
new DotRenderer().render(doc, {
  direction: "LR",                    // rankdir: "BT" (default) | "TB" | "LR" | "RL"
  useLabels: true,                    // use prov:label as node text (two-line label)
  showNary: true,                     // route n-ary relations through a blank node
  includeElementAttributes: true,     // element attributes as note boxes
  includeRelationAttributes: true,    // relation attributes as note boxes
  theme: {                            // partial PROV_THEME override, merged per section
    nodes: { ...PROV_THEME.nodes, entity: { ...PROV_THEME.nodes.entity, fillcolor: "#e0f0ff" } },
  },
});
```

| Option | Default | Effect |
| --- | --- | --- |
| `direction` | `"BT"` | `rankdir`. An out-of-range value (only reachable from untyped JS) falls back to `"BT"`. |
| `useLabels` | `false` | Node text is `prov:label`; when it differs from the identifier, a two-line HTML label with the identifier as a subtitle. |
| `showNary` | `true` | Extra n-ary endpoints are drawn as gray legs off a shared blank node. |
| `includeElementAttributes` | `true` | An element's non-formal attributes become a `shape=note` HTML-TABLE box linked to it. |
| `includeRelationAttributes` | `true` | A relation's non-formal attributes become a note box linked to the relation's blank node. |
| `theme` | `PROV_THEME` | A `Partial<ProvTheme>` merged over the reference theme, shallow per section and per entry (so an override can touch a single field). |

## What it draws

- **Nodes** — one per scene node: an entity oval, activity box, agent house, or bundle
  folder in the reference colors, each carrying its identifier `URL`. Endpoints
  inferred from a relation (not declared) get the gray generic style.
- **Edges** — one labeled, colored edge per binary relation (the PROV-N name and the
  relation's tint from the theme).
- **N-ary relations** — split through a point-shaped blank node: the first segment
  keeps the label and gets `arrowhead=none`, the second drops the label, and any extra
  endpoints are gray legs labeled with the endpoint's role.
- **Annotations** — non-formal attributes become a gray `shape=note` box with an
  HTML-TABLE label (attribute name linked to its URI, Identifier values linked to
  theirs), joined by a dashed, arrowhead-less link.
- **Bundles** — each sub-bundle is a `subgraph cluster_…` labeled with the bundle
  identifier.

## Skipped relations are enumerable, not silently absent (D15)

A relation whose first two formal endpoints are not both resolvable (e.g.
`wasStartedBy` with no activity) cannot be drawn as an edge between two nodes. Python
`prov.dot` draws it to a **dangling blank node**; this renderer, following the scene,
**omits it** — but the omission is not silent. `toRenderScene(doc).skipped` enumerates
every such relation with its type, identifier, and reason, so a caller can inspect
exactly what was left out:

```ts
import { toRenderScene } from "@inflexa-ai/tsprov-render-core";
const { skipped } = toRenderScene(doc);
// [{ relation: "prov:Start", identifier: "ex:start1", reason: "…" }, …]
```

This is deviation **D15** (see the repository's `DEVIATIONS.md`): the DOT output draws
strictly fewer, never-dangling edges, and the skipped set is the principled record of
the difference.

## Install

```sh
bun add @inflexa-ai/tsprov @inflexa-ai/tsprov-render-core @inflexa-ai/tsprov-render-dot
# or: npm install @inflexa-ai/tsprov @inflexa-ai/tsprov-render-core @inflexa-ai/tsprov-render-dot
```

`tsprov` is a peer dependency (`>=0.5.1 <2`); render-core is a regular dependency.
The package ships a dual **ESM + CJS** build with `.d.ts` declarations, consumable
under both `moduleResolution: bundler` and `nodenext`/`node16`.

## License

Apache-2.0. Part of the [tsprov](https://github.com/inflexa-ai/tsprov) project.
