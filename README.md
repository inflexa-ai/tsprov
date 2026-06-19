# tsprov

An idiomatic TypeScript implementation of the [W3C PROV Data Model](https://www.w3.org/TR/prov-dm/) —
a port of the Python [`prov`](https://github.com/trungdong/prov) library. Author provenance documents
with a fully-typed fluent API, and round-trip them through PROV-JSON and PROV-N.

- **Value-equality that works.** `doc.equals(other)` is content-based — validated against the full
  398-file Python PROV-JSON conformance corpus (every fixture round-trips: `deserialize → serialize →
  deserialize` is `.equals()`-stable).
- **Fluent, typed authoring.** `doc.entity("ex:report")`, `e.wasGeneratedBy(a).wasAttributedTo(agent)`,
  with the camelCase PROV vocabulary as the primary API.
- **Dependency-light core.** Only [luxon](https://moment.github.io/luxon/) (datetime fidelity). Browser-
  safe and tree-shakeable.
- **Dual ESM + CJS** with `.d.ts` declarations — works in Node, Bun, and bundlers.

## Install

```bash
npm install tsprov     # or: bun add tsprov
```

## Quick start

```ts
import { ProvDocument } from "tsprov";

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
import { read } from "tsprov";
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
import { Literal, XSD_INT } from "tsprov";

doc.entity("ex:dataset", { "ex:rows": new Literal(10_000, XSD_INT) });
```

A bare `number` defaults to `xsd:double` on encode; a bare `string` is an `xsd:string`.

## What's included

- The full PROV-DM in-memory model: `Identifier` / `QualifiedName` / `Namespace` / `Literal`, all 3
  elements + 15 relation classes, `NamespaceManager`, `ProvBundle`, `ProvDocument`.
- The complete fluent authoring API (camelCase PROV vocabulary primary; descriptive aliases).
- **PROV-JSON** (serialize + deserialize) and **PROV-N** (serialize), with `read()` auto-detection.
- Content-based `equals()`, plus `flattened()` and sub-bundles.

PROV-XML, PROV-RDF, graph/DOT visualisation, and the CLI are out of scope for now.

## Develop

```bash
bun install
bun test            # run the test suite (incl. the 398-file PROV-JSON corpus oracle)
bun run build       # emit dist/ (ESM + CJS + .d.ts)
```

## License

Apache-2.0.
