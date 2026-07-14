# tsprov Governance

_Last updated: 2026-07-14 · Stewarded by Inflexa, Inc._

## What tsprov is

tsprov is an open-source TypeScript implementation of the [W3C PROV Data Model](https://www.w3.org/TR/prov-dm/), ported from the Python [`prov`](https://github.com/trungdong/prov) library. It is a library, not a product: it has no interface, no service, and no opinion about what you use provenance *for*.

It is **stewarded by Inflexa, Inc.**, and it is worth being plain about why. Inflexa builds a CLI for reproducible biological data analysis, and that CLI depends on `@inflexa-ai/tsprov` to record what an analysis did. tsprov is maintained because we need it to be correct. That is the funding model, and it is also the bias — you should know both.

But tsprov is not an internal artifact dressed up as open source. It implements a public standard, it is Apache-2.0, and it is meant to be useful to anyone working with PROV in TypeScript, whether or not they have ever heard of us. If it only ever serves Inflexa, it has failed at what it is for.

## The governing principle: we are downstream of the spec

**tsprov does not own PROV, and does not get to invent it.**

PROV is a W3C standard — PROV-DM, PROV-N, PROV-O, PROV-CONSTRAINTS — and the community that carries it forward is centered at **[openprovenance.org](https://openprovenance.org/)**: it curates the specifications, runs the validator and the translator services, publishes serialization submissions such as PROV-JSONLD, and is home to the major implementations ([ProvToolbox](https://github.com/lucmoreau/ProvToolbox) in Java, [`prov`](https://github.com/trungdong/prov) in Python, ProvJS in JavaScript). We do not lead that work and we do not intend to. tsprov's entire job is to be a *faithful* implementation of it.

Three things follow, and they are the closest thing this project has to law:

1. **Where tsprov and the specification disagree, the specification is right and tsprov has a bug.** Not a design difference. A bug.
2. **Where tsprov and the Python reference disagree, it is either a bug or a deliberate divergence** — and every deliberate divergence is recorded in [`DEVIATIONS.md`](./DEVIATIONS.md) with an anchor into the Python source (`file.py:NN`) and a reason. There are no silent divergences.
3. **We do not extend PROV.** New vocabulary, new semantics, changes to what the model *means* — those belong upstream, at the W3C and in the open provenance community, not in a downstream implementation's issue tracker. If you need PROV to say something it cannot, we would rather help you take that upstream than quietly fork the meaning of a standard inside a TypeScript package.

This is not modesty. It is the most useful property the project has, and it is what makes the invitation below a real one: **correctness here is not a matter of maintainer taste.** The specification is public. The reference implementation is public. The 398-document conformance corpus we validate against is public. If you think tsprov is wrong, you do not need our permission or our goodwill to prove it — you need a failing fixture. Bring one and you win the argument.

## Roles

**Contributors** — anyone who contributes. Opening an issue, reporting a round-trip failure, reviewing a pull request, fixing the guide, or shipping a serializer all count. There is no sign-up; you become a contributor by contributing. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

**Maintainers** — hold write access: they triage, review, merge, and cut releases. Maintainers are expected to act in the interest of the library and its users, hold the line described above, and uphold the [Code of Conduct](./CODE_OF_CONDUCT.md).

**Inflexa, Inc.** — the steward of record. It funds the work, owns the repository and the `@inflexa-ai` package scope, and breaks ties when maintainers genuinely cannot agree. That last power should be used rarely; if it is being used often, something has gone wrong with the principle above.

There is deliberately no core team, no steering committee, and no voting procedure. This is a focused library with a public oracle. Governance heavier than the project would be theatre.

## How decisions get made

Day to day: **lazy consensus**. A pull request merges when a maintainer approves it and no maintainer raises a substantive objection within a reasonable review window. Discussion happens in public — in issues and pull requests, not in private.

When there is disagreement, the first move is to ask which *kind* of question it is:

- **"What should PROV do here?"** — not a matter of opinion. It is settled by the specification, then the Python reference, then the conformance corpus, in that order. Seniority does not enter into it, and neither does employment.
- **"What should tsprov do here?"** — API shape, scope, naming, dependencies, performance. These are genuine judgment calls. Maintainers discuss them in the open and aim for consensus; if consensus does not come, Inflexa decides and records the reasoning publicly.

Some changes want a proposal — an issue or a design note — and a chance for public comment *before* the code, because they are hard to undo:

- a new serialization format, or a parser for an existing one;
- breaking changes to the public API;
- **any new runtime dependency**, since the core ships with luxon and nothing else on purpose (it has to stay browser-safe and tree-shakeable);
- anything touching `equals()` semantics or the canonical `key` form, since value equality is the invariant the whole library rests on.

## Becoming a maintainer — and an open invitation

Maintainership is earned the ordinary way: sustained, high-quality participation, good judgment, constructive conduct. Any maintainer may nominate a contributor, and Inflexa confirms. There is no quota and no obligation to promote. Maintainers who go quiet for a long stretch move to emeritus, with a standing invitation back.

That is the process. Here is the part we actually mean:

**If you work on PROV — on ProvToolbox, on the Python library, on ProvJS, on the validator, or anywhere in the research community around [openprovenance.org](https://openprovenance.org/) — and you want a say in how the TypeScript implementation behaves, we would rather have you inside this project than outside it.** You do not need to serve a probation of drive-by patches to earn a hearing. Open an issue, or write to us, and tell us what tsprov gets wrong. Someone who has spent years thinking about what `wasDerivedFrom` actually means is worth more to this library than we are.

The same goes for anyone who simply *uses* PROV in TypeScript and has hit a wall. The wall is the contribution.

## Scope, and what is openly missing

**In scope:** the PROV-DM in-memory model; PROV-JSON (read and write); PROV-N (write); the graph and lineage layer under the `/graph` subpath; and fidelity to the Python reference, enforced by the corpus.

**Not implemented — and these are the project's clearest open doors, not closed ones:**

- **PROV-XML** and **PROV-RDF / PROV-O** serialization.
- A **PROV-N parser**. tsprov writes PROV-N but cannot read it, matching the Python reference, which has the same gap because no standard parser exists. This is substantial and genuinely wanted work.
- **PROV-CONSTRAINTS validation.** tsprov models PROV-DM; it does not check a document against the constraints specification.
- **DOT / graph visualisation** rendering, and a command-line interface.

If one of these matters to you, it is not sitting on a roadmap waiting for us to reach it. It is waiting for someone to want it enough. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Releases

Releases follow [semantic versioning](https://semver.org/) and are recorded in [`CHANGELOG.md`](./CHANGELOG.md) in [Keep a Changelog](https://keepachangelog.com/) form. Security issues follow the private process in [`SECURITY.md`](./SECURITY.md) and are not discussed in public issues until a fix is available.

## Code of Conduct

Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). The maintainers are responsible for enforcing it.

## Changing this document

Inflexa, Inc. may amend this document, and material changes go through a public pull request so that they can be seen and argued with. Questions about governance: open a [Discussion](../../discussions), or write to **oss-governance@inflexa.ai**.
