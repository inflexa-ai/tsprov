# Curated golden fixtures

The DOT-parity golden eval (`../../golden-parity.test.ts`) renders each PROV-JSON
fixture here through `DotRenderer` and compares the result **structurally** against a
committed Python `prov.dot` golden in `../../goldens/python-dot/<name>.gv`. The
goldens are produced once, by hand, with `../../scripts/generate-python-goldens.py`
(see that file's header for the exact `uv` invocation and versions).

Each fixture is chosen to exercise a distinct slice of `prov_to_dot`'s output. Six
are **hand-authored** to isolate a single feature; the rest are **corpus picks** from
`reference/prov/src/prov/tests/json/`. Per-fixture render options (only `uselabels`
deviates from the reference defaults) live in `render-options.json`, read by both the
generator and the eval so the golden and the TS render use identical options.

## Hand-authored

| Fixture | Why it is here |
| --- | --- |
| `primer-triangle.json` | The canonical entity→activity→agent triangle: the three colored element styles (oval `#FFFC87`, box `#9FB1FC`, house `#FED37F`) plus `wasGeneratedBy` (darkgreen), `wasAssociatedWith` and `wasAttributedTo` (`#FED37F`). Its `wasAssociatedWith` (a 3-slot relation with the plan unset) also exercises the blank-node-collapse tolerance: the scene draws it binary, `prov.dot` splits it through a blank node — reconstruction makes them equal. |
| `uselabels.json` | The only fixture rendered with `useLabels: true`. Exercises the two-line HTML node label (`<label<br/><font…>identifier</font>>`) that appears only when `prov:label` differs from the identifier, plus the `prov:label` annotation note that accompanies it. |
| `annotated-entity.json` | An element annotation note (`shape=note` HTML-TABLE): a `prov:type` whose QName value is `href`-linked, an Identifier-valued custom attribute (`href` on the value cell), and a plain string attribute (no value `href`). The attribute-name cell always links to the attribute URI. |
| `annotated-relation.json` | A 2-slot `wasGeneratedBy` carrying one non-formal attribute: forces a blank node whose sole purpose is to anchor the annotation note (`ann → bnode`), the relation-attribute path distinct from the element-attribute path above. |
| `nary-derivation.json` | The full five-endpoint `wasDerivedFrom`: declared source/target/activity (colored) and inferred generation/usage (gray). The canonical n-ary route — first segment labeled + `arrowhead=none`, second unlabeled, extra gray legs labeled with the endpoint local parts (`activity`/`generation`/`usage`). |
| `delegation-chain.json` | Two chained `actedOnBehalfOf` edges (`ag1 → ag2 → ag3`), each with an `activity` leg. Chained `#FED37F` delegation through blank nodes, gray activity legs, and agent `house` nodes; a second blank node (`b2`) proves the counter advances across relations. |

## Corpus picks

| Fixture | Why it is here |
| --- | --- |
| `bundle1.json` | Two sub-bundles as `cluster_c1`/`cluster_c2` subgraphs (each with `URL` + `label`), each holding a `used` (`red4`) relation; top-level bundle entities carry `prov:type = prov:Bundle` annotations. The clean bundles-as-clusters case. |
| `bundle2.json` | A cross-bundle **same-identifier collision**: `ex:e1` is an entity in one bundle and an activity in another (same URI, two nodes with different styles), and `ex:a1` the reverse. Proves one URI can map to multiple distinctly-styled nodes. |
| `member2.json` | `hadMember` with a multi-valued collection (`ex:c → ex:e1, ex:e2`) expanded to two binary `hadMember` edges (no blank node); all three endpoints are inferred (gray) generic nodes. |
| `communication3.json` | A plain binary `wasInformedBy` — an untinted relation label — between two inferred `activity` (box, gray) endpoints. |
| `specialization1.json` | A plain binary `specializationOf` between two inferred `entity` endpoints; an untinted relation. |
| `alternate1.json` | A plain binary `alternateOf` between two inferred `entity` endpoints; covers the alternate relation styling and confirms endpoint ordering. |
| `start1.json` | The **D15** fixture: `wasStartedBy` with only the trigger set (activity + starter unset). The scene skips it entirely (0 nodes, 0 edges, 1 `skipped`); `prov.dot` draws dangling blank-node edges. The comparator excludes exactly those, count-matched to `scene.skipped`. |

## Bundle fixtures not included

The upstream corpus ships `bundle1`–`bundle4`. Only `bundle1` and `bundle2` are
curated here:

- `bundle3.json` is **byte-identical** to `bundle1.json` in the corpus — zero added
  coverage.
- `bundle4.json` is a namespace-shadowing torture test (the document-level `ex`
  prefix is redefined inside each sub-bundle). It exposes a **tsprov↔Python
  divergence in how a bundle's own identifier QName resolves** (tsprov resolves it in
  the document namespace and disambiguates the prefix to `ex_1`; Python resolves it in
  the bundle-local namespace). That divergence lives in `unified()` /
  `toRenderScene`, **not** in the DOT emitter — `DotRenderer` faithfully renders
  whichever URI the scene provides (verified: the cluster *members* match; only the
  bundle's own URI/label differ). It is the wrong probe for a DOT-fidelity golden, so
  it is excluded.
