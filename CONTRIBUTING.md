# Contributing to tsprov

Thanks for looking. tsprov is a TypeScript implementation of the [W3C PROV Data Model](https://www.w3.org/TR/prov-dm/) — a port of the Python [`prov`](https://github.com/trungdong/prov) library — and it gets better the more people who actually work with provenance push on it.

Participation is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md), and the project runs according to [`GOVERNANCE.md`](./GOVERNANCE.md). The one-line summary of both: **tsprov implements a standard it does not own, so correctness here is checkable by anyone — it is not decided by us.**

## The thing to understand before anything else

tsprov's value is **fidelity**, not features. It is validated against a public oracle: the 398 PROV-JSON conformance documents from the Python reference implementation, every one of which must survive `deserialize → serialize → deserialize` and compare `.equals()`-stable.

That gives you a very short rule for whether a change will land:

- Does the corpus stay green?
- Does the behavior match the Python reference?
- If it deliberately does not, is the divergence recorded in [`DEVIATIONS.md`](./DEVIATIONS.md), with a `file.py:NN` anchor into the reference and a reason?

Satisfy those three and you have already passed most of the review. It also means you can disagree with a maintainer and *win*, by producing a document that round-trips wrong. Please do.

## Ways to contribute

**Round-trip and conformance failures — the most valuable bug report in this project.** A PROV document that tsprov mangles, drops, or reads differently from the Python library is a direct hit on the one thing tsprov exists to do. Attach the document; that is the whole bug report.

**Interop reports.** Feed tsprov's output to [ProvToolbox](https://github.com/lucmoreau/ProvToolbox), to the [openprovenance validator](https://openprovenance.org/services/view/validator), or to the Python library, and tell us what broke. We cannot easily run this against every implementation, and you may already have the other half set up. It is enormously useful and almost nobody does it.

**The missing pieces.** [`GOVERNANCE.md`](./GOVERNANCE.md#scope-and-what-is-openly-missing) lists what is not implemented — PROV-XML, PROV-RDF, a PROV-N *parser*, PROV-CONSTRAINTS validation, DOT rendering. None of it is blocked on us. It is waiting for someone who wants it.

**Parity gaps.** Anything the Python reference does that tsprov does not, or does differently without a `DEVIATIONS.md` entry.

**The graph and lineage layer.** `@inflexa-ai/tsprov/graph` is the newest part of the library and the least battle-tested. Lineage queries over real provenance graphs will find things our tests do not.

**Documentation.** The [guide](./docs/guide.md) is where people learn what PROV even is. A confusing passage is a bug.

**Types and API ergonomics.** The fluent API *is* the library's surface. If it fights you, say so.

**Triage and review.**

## Development setup

No Docker, no services, no API keys, nothing to sign up for. It is a pure library.

```bash
git clone https://github.com/inflexa-ai/tsprov.git
cd tsprov
bun install
bun run bootstrap   # fetch the PROV-JSON conformance corpus — see below
bun test
```

**About that bootstrap step.** Two suites — `packages/tsprov/src/serializers/json.test.ts` and `packages/tsprov/src/graph/graph.test.ts` — read the 398-document corpus from `reference/prov/src/prov/tests/json`. That corpus belongs to the upstream Python project and is deliberately *not* vendored here: a copied oracle is a forked oracle, and one that silently stops matching the reference is worse than none at all. `bun run bootstrap` shallow-clones it into a gitignored `reference/` directory and does nothing if it is already there. Skip it and those two suites fail with `ENOENT` — meaning you are not testing the thing that matters.

`bun run test` bootstraps the corpus for you and then runs the **full workspace** suite (it is `bun run bootstrap && bun test` — every package's tests, not just the core library's). A bare `bun test` runs the same full workspace suite but skips the bootstrap (Bun's test runner bypasses lifecycle scripts), so reach for it only when the corpus is already in place.

## Making changes

Branch from `main` (`fix/…`, `feat/…`) and use [Conventional Commits](https://www.conventionalcommits.org/), e.g. `fix(serializers): preserve xsd:int across a JSON round-trip`. Keep pull requests focused — one logical change is far easier to review, and far easier to revert.

Before you push:

```bash
bun test            # includes the corpus oracle
bun run build       # this IS the typecheck — it runs tsc over the whole package
bun run smoke       # loads the built ESM and CJS entry points and round-trips a document
```

There is no separate `lint` or `typecheck` script. `bun run build` is the typecheck.

## House rules a reviewer will check

These are the repo's real conventions — the full set lives in [`CLAUDE.md`](./CLAUDE.md). They are repeated here so you do not have to discover them one review comment at a time:

- **Relative imports carry a `.js` extension** — `from "./identifier.js"`, even though the file on disk is `identifier.ts`. That is what makes the published `.d.ts` consumable under `moduleResolution: nodenext` with no post-build rewrite step. An extensionless import breaks consumers; a `.ts` one breaks the build.
- **Named exports only.** `packages/tsprov/src/index.ts` is the single barrel; internal modules import each other directly.
- **Value equality is the load-bearing invariant.** Every value type exposes `equals(other)` and a canonical `key`. Never key a `Map` or `Set` by object identity — JavaScript keys by reference, which would silently break PROV's value semantics.
- **JSDoc (`/** … */`) on every exported declaration**, never a `//` line comment. JSDoc is what the language server surfaces on hover, which is where the documentation is actually read.
- **No new runtime dependencies without sign-off.** The core is luxon-only, deliberately: it must stay browser-safe and tree-shakeable.
- **Never loosen `tsconfig` strictness to land a change.**
- **Comment the *why*, not the *what*.** Every type assertion, `any`, or `@ts-expect-error` carries a comment naming the invariant that makes it safe.
- **Log intentional divergences from Python** in [`DEVIATIONS.md`](./DEVIATIONS.md), with the source anchor and the reason.

## Submitting a pull request

Say what changed and why, and link the issue it addresses. Before requesting review:

- [ ] `bun test`, `bun run build`, and `bun run smoke` pass locally.
- [ ] Tests added or updated — and if you fixed a round-trip bug, the document that exposed it is now a fixture.
- [ ] Any deliberate divergence from the Python reference is recorded in `DEVIATIONS.md`.
- [ ] Docs updated if public behavior changed.
- [ ] Commits follow Conventional Commits, and are **signed off** (below).
- [ ] One logical change.

Review follows [`GOVERNANCE.md`](./GOVERNANCE.md#how-decisions-get-made): maintainers merge by lazy consensus, and questions about what PROV *means* are settled by the specification, the reference, and the corpus — not by seniority.

## Developer Certificate of Origin

tsprov uses the [Developer Certificate of Origin](https://developercertificate.org/) 1.1 — a lightweight statement that you have the right to submit your contribution under the project's license. You agree to it by **signing off** each commit:

```bash
git commit -s -m "fix(serializers): preserve xsd:int across a JSON round-trip"
```

That appends a `Signed-off-by: Your Name <your@email>` trailer, which certifies the DCO. CI checks for it. If you forget, `git commit --amend -s` fixes the last commit and a rebase fixes several.

By contributing, you agree that your contributions are licensed under the project's [`LICENSE`](./LICENSE) (Apache-2.0). Use a name and address you are comfortable having in public Git history permanently.

## Security

**Do not report vulnerabilities in public issues, pull requests, or discussions.** Follow the private process in [`SECURITY.md`](./SECURITY.md). tsprov parses documents its callers did not necessarily author, and that is the whole of its attack surface — that file explains what counts and what does not.

## Recognition

Contributions of every kind are recognized, and sustained good work leads to maintainership; [`GOVERNANCE.md`](./GOVERNANCE.md#becoming-a-maintainer--and-an-open-invitation) explains how. To repeat the invitation there: if you work on PROV elsewhere in the ecosystem, we would rather have you inside this project than outside it.

## Questions

Open an [issue](../../issues) or a [Discussion](../../discussions). Welcome aboard.
