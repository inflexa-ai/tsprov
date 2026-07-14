# tsprov

[![Test](https://github.com/inflexa-ai/tsprov/actions/workflows/test.yml/badge.svg)](https://github.com/inflexa-ai/tsprov/actions/workflows/test.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/inflexa-ai/tsprov/badge)](https://scorecard.dev/viewer/?uri=github.com/inflexa-ai/tsprov)
[![DOI](https://zenodo.org/badge/1273314586.svg)](https://doi.org/10.5281/zenodo.21356355)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/github/package-json/v/inflexa-ai/tsprov?label=version)](#install)
[![Types: TypeScript](https://img.shields.io/badge/types-TypeScript-3178c6.svg)](https://www.typescriptlang.org/)
![PROV-JSON corpus: 398/398](https://img.shields.io/badge/PROV--JSON%20corpus-398%2F398-brightgreen.svg)

An idiomatic TypeScript implementation of the [W3C PROV Data Model](https://www.w3.org/TR/prov-dm/) —
a port of the Python [`prov`](https://github.com/trungdong/prov) library. Author provenance documents
with a fully-typed fluent API, and round-trip them through PROV-JSON and PROV-N.

> 📖 **New to PROV or want the full tour?** See the [**tsprov guide**](docs/guide.md) — provenance
> concepts, a worked example, the data model in depth, and design notes.

- **Value-equality that works.** `doc.equals(other)` is content-based — validated against the full
  398-file Python PROV-JSON conformance corpus (every fixture round-trips: `deserialize → serialize →
  deserialize` is `.equals()`-stable).
- **Fluent, typed authoring.** `doc.entity("ex:report")`, `e.wasGeneratedBy(a).wasAttributedTo(agent)`,
  with the camelCase PROV vocabulary as the primary API.
- **Dependency-light core.** Only [luxon](https://moment.github.io/luxon/) (datetime fidelity). Browser-
  safe and tree-shakeable.
- **Dual ESM + CJS** with `.d.ts` declarations — works in Node, Bun, and bundlers.

## Install

tsprov is published to [GitHub Packages](https://docs.github.com/en/packages). Map the
`@inflexa-ai` scope to the GitHub registry in an `.npmrc` (and authenticate with a token that
has `read:packages`):

```ini
# .npmrc
@inflexa-ai:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```bash
npm install @inflexa-ai/tsprov     # or: bun add @inflexa-ai/tsprov
```

## Quick start

```ts
import { ProvDocument } from "@inflexa-ai/tsprov";

const doc = new ProvDocument();
doc.addNamespace("ex", "http://example.org/");

// Elements
const article = doc.entity("ex:article", { "prov:type": "ex:Article" });
const compile = doc.activity("ex:compile", "2024-01-01T09:00:00+00:00", "2024-01-01T09:05:00+00:00");
const author = doc.agent("ex:alice");

// Relations — container form
doc.wasGeneratedBy(article, compile, "2024-01-01T09:05:00+00:00");
doc.wasAttributedTo(article, author);

// …or the fluent record form (chainable; returns the record)
article.wasDerivedFrom(doc.entity("ex:draft")).wasAttributedTo(author);

console.log(doc.serialize("provn"));
// document
//   prefix ex <http://example.org/>
//   …
// endDocument
```

## Serialization

```ts
const json = doc.serialize("json");            // PROV-JSON
const provn = doc.serialize("provn");          // PROV-N (text)

const parsed = ProvDocument.deserialize(json, "json");
doc.equals(parsed); // true

// read() auto-detects the format
import { read } from "@inflexa-ai/tsprov";
const back = read(json);
```

PROV-JSON supports both `serialize` and `deserialize`. PROV-N is serialize-only (matching the
reference library — there is no standard PROV-N parser).

## Bundles

```ts
const doc = new ProvDocument();
doc.addNamespace("ex", "http://example.org/");

const bundle = doc.bundle("ex:bundle1"); // a named sub-bundle (inherits the document's namespaces)
bundle.entity("ex:nested");

doc.hasBundles();   // true
doc.flattened();    // a new document with all bundle records lifted to the top level
```

## Typed literals

JavaScript has a single `number` type, so to preserve the XSD datatype distinction, wrap typed values
in a `Literal`:

```ts
import { Literal, XSD_INT } from "@inflexa-ai/tsprov";

doc.entity("ex:dataset", { "ex:rows": new Literal(10_000, XSD_INT) });
```

A bare `number` defaults to `xsd:double` on encode; a bare `string` is an `xsd:string`.

## Graph & lineage

Provenance *is* a graph, so tsprov ships a graph view and a lineage walker under the optional
`@inflexa-ai/tsprov/graph` subpath — zero extra dependencies (the core stays luxon-only). The
headline: **a lineage answer is itself a PROV document** you can serialize and feed to any PROV
tool.

```ts
import { ProvDocument } from "@inflexa-ai/tsprov";
import { ProvGraph, resolve, lineage, toProvDocument } from "@inflexa-ai/tsprov/graph";

const doc = new ProvDocument();
doc.addNamespace("ex", "http://example.org/");
const article = doc.entity("ex:article", { "prov:type": "ex:Article" });
const compile = doc.activity("ex:compile", "2024-01-01T09:00:00+00:00", "2024-01-01T09:05:00+00:00");
article.wasGeneratedBy(compile).wasDerivedFrom(doc.entity("ex:draft"));

const graph = ProvGraph.of(doc);                         // flattened().unified() multi-digraph
const found = resolve(graph, { localpart: "article" });  // git-style resolve → all matches
if (found.kind !== "matched") throw new Error("no such record");

const ancestry = lineage(graph, found.records, { direction: "backward" }); // "where did this come from?"
const { document } = toProvDocument(graph, ancestry);    // …the answer is itself a PROV document

console.log(document.serialize("provn"));
// document
//   prefix ex <http://example.org/>
//
//   entity(ex:article, [prov:type="ex:Article"])
//   activity(ex:compile, 2024-01-01T09:00:00+00:00, 2024-01-01T09:05:00+00:00)
//   entity(ex:draft)
//   wasGeneratedBy(ex:article, ex:compile, -)
//   wasDerivedFrom(ex:article, ex:draft, -, -, -)
// endDocument
```

The default `backward`/`"dataflow"` walk answers ancestry; `direction: "forward"` and `"both"`
answer descendants, `depth` bounds the hops (every cutoff surfaces as explicit `frontier` data,
never a silent truncation). `toFlatGraph(result)` gives a JSON-safe `{ nodes, edges }` projection,
and `lineagePaths(graph, result, target)` enumerates the connecting paths. See
[**§8 of the guide**](docs/guide.md#8-graph--lineage-queries) for the full tour.

## What's included

- The full PROV-DM in-memory model: `Identifier` / `QualifiedName` / `Namespace` / `Literal`, all 3
  elements + 15 relation classes, `NamespaceManager`, `ProvBundle`, `ProvDocument`.
- The complete fluent authoring API (camelCase PROV vocabulary primary; descriptive aliases).
- **PROV-JSON** (serialize + deserialize) and **PROV-N** (serialize), with `read()` auto-detection.
- Content-based `equals()`, plus `flattened()` and sub-bundles.
- **[Graph & lineage](#graph--lineage)** under the optional `@inflexa-ai/tsprov/graph` subpath —
  a multi-digraph view, composable record `resolve()`, and a directional, bounded `lineage()` walk,
  with no extra dependencies.

PROV-XML, PROV-RDF, DOT (graph-visualisation) rendering, and the CLI are out of scope for now.

## Develop

```bash
bun install
bun run bootstrap   # fetch the 398-file PROV-JSON conformance corpus into reference/
bun test            # run the test suite (incl. the corpus oracle)
bun run build       # emit dist/ (ESM + CJS + .d.ts)
```

The corpus is the Python reference implementation's, and is deliberately not vendored — see
[**CONTRIBUTING.md**](CONTRIBUTING.md#development-setup) for why. Without `bootstrap`, the two
suites that read it fail with `ENOENT`.

## Contributing

Contributions are welcome, and PROV is a standard we implement rather than own — so if you work
on PROV elsewhere in the ecosystem, we would rather have you inside this project than outside it.
Start with [**CONTRIBUTING.md**](CONTRIBUTING.md); [**GOVERNANCE.md**](GOVERNANCE.md) explains how
decisions get made and what is openly missing (PROV-XML, PROV-RDF, a PROV-N parser,
PROV-CONSTRAINTS validation). Vulnerabilities go through [**SECURITY.md**](SECURITY.md), never a
public issue.

## License

Apache-2.0. tsprov is a port of the Python [`prov`](https://github.com/trungdong/prov) library,
used under the MIT License — see [`NOTICE`](NOTICE).
