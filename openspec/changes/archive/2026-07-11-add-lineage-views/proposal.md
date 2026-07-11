## Why

The walk (change #3) returns a flat reference-based result; nothing yet turns it into
something a consumer can hand to another tool. The direction doc's headline decision —
the one thing an app-side implementation fundamentally cannot offer — is that a lineage
answer is itself **a valid PROV document** (IVOA ProvSAP precedent), serializable to
PROV-JSON/PROV-N and consumable by any PROV tool. This is change #4, the last of the
lineage sequence: the representations over `LineageResult`.

## What Changes

- `toProvDocument(graph, result, options?)` — materialize a walk result as a fresh
  `ProvDocument` (non-inferred nodes' elements + traversed relations), with:
  - `closure: "referenced"` (default) — a fixpoint **reference** closure: any identifier
    a included record references that is declared in `graph.document` but missing from
    the output pulls in that record's full declaration (n-ary legs: a derivation's
    activity / generation / usage, an association's plan, start/end's starter/ender);
    references never chase adjacency, so the closure stays near-linear and the depth
    bound is never bypassed by edges. Closure-added records are reported separately —
    distinguishable from walked content (direction-doc D4).
  - `closure: "none"` — the exact slice; unresolved references dangle (legal PROV).
  - `annotateFrontier` (opt-in, default off) — frontier nodes' re-created elements carry
    a `tsprovq:truncated` attribute (dedicated query namespace) so even the serialized
    document distinguishes "walk stopped here" from "nothing more was known".
- `toFlatGraph(result)` — the JSON-safe projection (PR #72's `formatJson`, generalized):
  roots, unknownRoots, kind-discriminated nodes with `inferred`/`truncated` marks, edges
  in asserted PROV orientation regardless of walk direction, frontier.
- `lineagePaths(graph, result, target, options?)` — bounded simple-path enumeration
  between a start (default: each root) and a target over the result's edge set, with an
  explicit truncation flag when the cap is hit (full path enumeration is the
  representation that notoriously does not scale — bounded by design).
- No inference, no `connect()`, no dot, no new dependencies, core untouched.

## Capabilities

### New Capabilities
- `lineage-views`: the three representations over a walk result — PROV-document
  materialization with closure policy and opt-in frontier annotation, the flat
  JSON-safe graph, and bounded path enumeration.

### Modified Capabilities

_None — `graph-view`, `record-resolution`, and `lineage-walk` requirements are unchanged._

## Impact

- New `src/graph/views.ts` + `src/graph/views.test.ts`; barrel lines in
  `src/graph/index.ts`. Nothing else changes.
