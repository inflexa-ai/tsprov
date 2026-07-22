# @inflexa-ai/tsprov-render-core

The renderer-agnostic foundation for visualizing [`@inflexa-ai/tsprov`](https://www.npmjs.com/package/@inflexa-ai/tsprov)
provenance documents.

Every renderer in the tsprov ladder — DOT, Mermaid, SVG, interactive — needs the
same two things before it can exist: a **semantic scene** projected from a PROV
document, and the **W3C PROV visual theme** as data. This package provides both,
plus the `Renderer` contract they all implement. It carries **zero runtime
dependencies** and takes `tsprov` as a **peer**, so adding a renderer to your app
never installs a second copy of the core.

## What it is

- **`toRenderScene(doc, options?)`** — projects a `ProvDocument` into a JSON-safe
  `RenderScene { nodes, edges, bundles, skipped }`. It walks the PROV *document
  model* with the exact semantics of Python `prov`'s `prov_to_dot` (bundles as
  clusters, n-ary relation legs, inferred endpoints, `unified()`-with-fallback), so
  a renderer can reproduce `prov.dot`-equivalent output without re-reading the
  document — and other renderers can present the same data their own way.
- **`PROV_THEME`** — the W3C PROV visual convention (shapes, fill/border colors,
  relation labels, annotation styling, default `BT` direction) as an overridable
  `ProvTheme` data object.
- **`Renderer<Out, Options>`** — the single interface every renderer package
  implements.

The scene is **plain, deterministic data**: no class instances, no `Map`/`Set`.
Node/edge/bundle ids are stable (`n1`, `e1`, `c1`, … in document order), and two
projections of the same document are byte-identical when `JSON.stringify`d.

## The scene model

```ts
import { ProvDocument } from "@inflexa-ai/tsprov";
import { toRenderScene, PROV_THEME } from "@inflexa-ai/tsprov-render-core";

const doc = ProvDocument.deserialize(json, "json");
const scene = toRenderScene(doc);
//    ^ { nodes, edges, bundles, skipped }
```

- **`RenderNode`** `{ id, kind, qualifiedName, label, uri?, attributes, bundleId?, inferred }`
  — a declared element (`kind`: `entity` | `activity` | `agent`) or an endpoint
  **inferred** from a relation (`inferred: true`, `kind` from the formal
  attribute's PROV-DM domain, or `unknown`). `bundleId` marks membership in a
  sub-bundle.
- **`RenderEdge`** `{ id, relation, label, source, target, naryLegs, attributes }`
  — `source`/`target` are the first two formal endpoints; `naryLegs`
  (`{ role, target }[]`) carry any further endpoints (when `showNary`). `relation`
  is the `prov:`-prefixed key into `PROV_THEME.relations`; `label` is the PROV-N
  name (e.g. `wasDerivedFrom`).
- **`RenderBundle`** `{ id, label, uri? }` — a sub-bundle (DOT cluster).
- **`SkippedRelation`** `{ relation, identifier, reason }` — a relation with fewer
  than two resolvable endpoints. `prov.dot` would draw these to a blank node and
  otherwise drop them silently; this package records them **observably** instead
  (see `DEVIATIONS.md`, D15).

### Options

`SceneOptions` mirror `prov_to_dot`'s parameters; defaults match the reference:

| Option | Default | Effect |
| --- | --- | --- |
| `useLabels` | `false` | Use `prov:label` as a node's display text instead of its identifier. |
| `includeElementAttributes` | `true` | Include elements' non-formal attributes on their nodes. |
| `includeRelationAttributes` | `true` | Include relations' non-formal attributes on their edges. |
| `showNary` | `true` | Emit extra n-ary endpoints as `naryLegs`. |

Layout `direction` is a presentation concern and lives on `PROV_THEME`, not here.

## Writing a renderer

```ts
import type { Renderer, RendererOptions } from "@inflexa-ai/tsprov-render-core";
import { toRenderScene, PROV_THEME } from "@inflexa-ai/tsprov-render-core";
import type { ProvDocument } from "@inflexa-ai/tsprov";

class MyRenderer implements Renderer<string> {
  readonly format = "my-format";
  render(doc: ProvDocument, options?: RendererOptions): string {
    const theme = { ...PROV_THEME, ...options?.theme };
    const scene = toRenderScene(doc, options);
    // ...turn `scene` + `theme` into your output...
    return "";
  }
}
```

## Install once, render anywhere

`tsprov` is a **peer dependency** (`>=0.5.1 <2`), not a bundled one. Consumers
install the core exactly once; every renderer shares that single instance — so a
`ProvDocument` you create flows through any renderer and `instanceof` checks hold
across the package boundary.

```sh
bun add @inflexa-ai/tsprov @inflexa-ai/tsprov-render-core
# or: npm install @inflexa-ai/tsprov @inflexa-ai/tsprov-render-core
```

The package ships a dual **ESM + CJS** build with `.d.ts` declarations, consumable
under both `moduleResolution: bundler` and `nodenext`/`node16`.

## License

Apache-2.0. Part of the [tsprov](https://github.com/inflexa-ai/tsprov) project.
