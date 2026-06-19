# prov → tsprov — Migration Document Set

This directory is the **initial analysis & planning effort** for porting the Python
[`prov`](https://github.com/trungdong/prov) library (W3C PROV Data Model, v2.1.1, vendored at
`reference/prov/`) to **first-class, idiomatic TypeScript** in this repo (`tsprov`).

No library code has been written yet. These four documents are the foundation the migration
builds on: what the code *is*, how to *sequence* the port, what the *dependencies* require, and
how to make it *idiomatic TS with great DX*.

> **Scope at a glance.** Source = ~5,800 LOC of core Python across 13 modules; the heart is
> `model.py` (2,838 LOC). Target = a strict-mode, ESM-first, dual-published (ESM+CJS) Bun/TypeScript
> library. Core runtime dependency after the port: **luxon only** (everything else is optional/leaf).

---

## The documents

| # | Document | What it answers | Read it when |
|---|----------|-----------------|--------------|
| **01** | [Codebase Analysis](01-codebase-analysis.md) | The mindmap: every module, class, registry, and control-flow path, anchored to `file:line`. The PROV data model *as implemented*. | You need to understand the existing Python design before touching anything. |
| **02** | [Migration Roadmap](02-migration-roadmap.md) | The execution plan: 10 milestones (M0–M9) in dependency order with an early vertical slice, guardrails, validation strategy, and a risk register. | You're planning the work or starting a milestone/PR. |
| **03** | [Dependency Analysis](03-dependency-analysis.md) | Every Python dependency + stdlib usage, where it's used, and its Node/TS parallel (with fit ratings). Optional-dep & packaging strategy. | You're choosing libraries or wiring `package.json`/exports. |
| **04** | [TypeScript Feasibility](04-typescript-feasibility.md) | The design study: how each Python construct becomes idiomatic TS, the DX-first authoring API, and the equality/hashing strategy that makes it all correct. | You're designing types or the public API. |

**Recommended reading order:** 01 → 04 → 03 → 02 (understand the code, see the target design,
confirm the dependency plan, then read the sequenced roadmap). For a quick decision-level pass,
read this overview + 02 §1–3 + 04 §1, §6.

---

## The decisions that thread through all four docs

These are the load-bearing conclusions. They are stated consistently across the set; the cited doc
is where each is argued in full.

1. **Value-equality / hashing is the #1 risk.** Python keys `dict`/`set` by
   `QualifiedName.__hash__` / `Literal.__hash__` / `ProvRecord.__hash__`; JS `Map`/`Set` key by
   *reference*, so a naïve port silently breaks round-trip equality. Solution: canonical **string
   keys** (`\u0000`-separated), a global **intern table**, and explicit `equals()` — every
   object-keyed collection becomes `Map<string, …>`. → *04 §6, 01 §8, 02 risk register.*
2. **Redesign, don't transliterate.** Operator overloading, `defaultdict`, `*args/**kwargs`,
   multiple inheritance, and metaclass-free registries each get an idiomatic TS replacement. → *04 §5.*
3. **Keep the class hierarchy** (`ProvRecord → ProvElement/ProvRelation →` 18 concrete classes:
   3 elements + 15 relation classes) rather than a discriminated union — the fluent API,
   `copy()`/registry dispatch, and `sorted_attributes` all need methods + static `FORMAL_ATTRIBUTES`. → *04 §3.*
4. **DX-first authoring API.** Preserve the fluent builder (`doc.entity(…)`, `e.wasGeneratedBy(a)`)
   with full type-safety: branded `QualifiedName`, typed `EntityRef`/`ActivityRef`/`AgentRef`,
   typed attribute bags. → *04 §4.*
5. **Datetime fidelity via luxon** (`DateTime.fromISO(s, {setZone:true})` + `.toISO()`), to preserve
   UTC offset and sub-second precision for byte-equivalent serialization. Bare `Date` is insufficient. → *03 §2, 04 §8.*
6. **Dependency-free core; gate the rest.** Core model + PROV-JSON + PROV-N ship with **luxon only**.
   XML (`@xmldom/xmldom`), RDF (`N3`), graph (`graphology`/hand-rolled), and DOT (`ts-graphviz`) are
   deferred behind **subpath exports + `peerDependencies` + `peerDependenciesMeta.optional`** (never
   `optionalDependencies`). → *03 §4, 02 §8.*
7. **Validate against the Python corpus.** The 398-file `tests/json/` corpus is the primary oracle;
   PROV-N is the exact-text oracle; a Python↔TS **differential CI harness** gates each milestone. → *02 §5, 04 §10.*
8. **Ship v1 = core + PROV-JSON + PROV-N** (M0–M6). XML/RDF/graph/dot/CLI are explicitly post-v1
   (M7–M9). → *02 §3, §8.*

---

## How these docs were produced & verified

The analysis was run as a multi-agent workflow: **8 parallel readers** deep-read each subsystem
(anchored to `file:line`), **3 writers** authored docs 01/03/04 from a shared ground-truth + a single
canonical target module layout, and the **roadmap (02)** was written last so its sequencing matches
the other three. Every document was then **adversarially verified** — one reviewer per doc re-checked
its factual claims against the actual Python source, plus a cross-document coherence critic.

**Post-verification accuracy (reviewer scores, then corrected):** 01 = 94, 02 = 90, 03 = 88, 04 = 90;
coherence = 82. The review caught and we **fixed**: a fabricated exception class
(`UnsupportedOperationError` — does not exist in Python; PROV-N's `deserialize` raises the built-in
`NotImplementedError`; the only serializer exception is `DoNotExist`), a dependency mischaracterization
(`dateutil` is a **core** dep, not an RDF-only extra), inconsistent record/relation counts (now
uniformly 18 record classes / 15 relation classes), a contradictory optional-deps recommendation, a
broken cross-reference, and ~25 off-by-one `file:line` anchors. All `file:line` anchors that were
touched were re-confirmed against source.

> **Caveat for readers:** anchors are accurate as of `prov` v2.1.1 at `reference/prov/`. Spot-check
> line numbers during implementation — a few container-method anchors in `model.py` were cited from
> structured analysis rather than re-opened in the final pass (flagged in 01's open questions).

---

## Consolidated open questions (resolve during M0–M1)

Carried forward from the four docs — these need a decision before or during the first vertical slice:

- **Datetime parity:** does luxon `.toISO()` reproduce Python `isoformat()` byte-for-byte for offsets
  like `+01:00` and microsecond precision in the golden fixtures? (*03, 04*)
- **Attribute ordering:** `PROV_RECORD_ATTRIBUTES` order derives from Python set-iteration (effectively
  nondeterministic); the TS port must define an **explicit** canonical order. (*01*)
- **Quirk parity:** preserve or deliberately fix `flattened()` returning `self`, `unified()` sharing the
  `NamespaceManager` by reference, and `add_bundle` mutating its argument? Log decisions in a
  `DEVIATIONS.md`. (*01, 02, 04*)
- **Naming inversion:** Python's snake_case builders are primary and camelCase are aliases; the TS design
  makes camelCase primary — record this as an intentional deviation. (*02*)
- **`%g` float / PROV-N escaping:** the exact C-style float formatting and `%%`/triple-quote escaping must
  be reproduced bit-for-bit; needs a vetted helper unit-tested against golden strings. (*04*)
- **RDF/XML feasibility:** `provrdf.py`'s `encode_container` (~760 LOC) and PROV-XML's structurally-unstable
  round-trip are the hardest ports — drive them from the conformance corpus, keep them gated/optional. (*03, 04*)
- **Shared util homes:** where do the consolidated `AnonymousIDGenerator` and the warning callback live in
  the target layout? (*coherence gaps*)

---

*Source of truth for every claim: `reference/prov/src/prov/` (prov v2.1.1).
Target repo conventions: `CLAUDE.md` (Bun-first), `package.json` (dual ESM+CJS), `tsconfig.json` (strict).*
