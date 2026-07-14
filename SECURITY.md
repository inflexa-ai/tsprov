# Security Policy

_Last updated: 2026-07-14 · Stewarded by Inflexa, Inc._

## The threat model, in brief

tsprov is a pure, in-memory data-model library. It **executes no code, reads and writes no files, spawns no processes, and opens no sockets**, and it carries exactly one runtime dependency (luxon, for datetime fidelity). There is no sandbox to escape, no server to reach, and no credential to steal.

So its security surface is narrow, specific, and worth naming precisely:

**Parsing a provenance document you did not author.** `ProvDocument.deserialize(text, format)` and `read(text)` are the functions that consume input, and they are the whole of it. If your application hands tsprov PROV-JSON that came from a user, an upload, a queue, or a federated peer, that input is untrusted — and this policy is about you.

## What counts as a vulnerability

A malicious or malformed document causing tsprov to do anything other than **throw a `ProvError`**. Concretely:

- **Escaping the document being parsed** — corrupting state outside it, contaminating another document, or reaching an object prototype (via a crafted attribute name, prefix, or qualified name, say).
- **Resource consumption grossly disproportionate to input size** — a small document that costs unbounded memory or time, through pathological nesting or a blow-up in the graph or lineage walk.
- **Crashing the host process in a way the caller cannot catch.**

## Invariants we intend to hold

These are the properties a security fix would be restoring. They are written down so that they can be checked — by you, and by reviewers:

- **Record attributes live in `Map`s keyed by canonical strings**, never as properties on plain objects. A document-controlled attribute name therefore cannot reach an object's prototype chain. (This is the same invariant that makes PROV's value-equality semantics work — see `src/record/attributes.ts` and the value-equality rule in [`CLAUDE.md`](./CLAUDE.md). It is load-bearing twice over.)
- **The core does no I/O.** A pull request that introduces filesystem access, network access, or dynamic code execution (`eval`, `new Function`, a dynamic `import` of a path taken from input) into the core is a **security-relevant change** and will be reviewed as one, whatever else it does.
- **A failed parse throws.** Deserialization surfaces failure as a thrown `ProvError`, never as a silently partial document.

## Explicitly out of scope

**PROV is a description format, not an authentication mechanism. tsprov does not verify that a provenance document is true.** Anyone can author a document asserting any activity, agent, or derivation they like. A provenance document is exactly as trustworthy as the channel it arrived on, and if your threat model requires that provenance be *believed*, you need signatures or an attested source — tsprov gives you neither and does not pretend to. That is a property of PROV, not a gap in this library.

Also out of scope: what your application does with a document *after* parsing it. If you resolve a `prov:location` URI, fetch an entity a document names, or execute something it points at, that is your egress and your decision. tsprov only ever handed you data.

## Supported versions

| Version | Supported |
|---|---|
| Latest minor release | Security fixes |
| Older minor releases | Please upgrade |

tsprov is pre-1.0. Fixes ship in the latest release, and we may not backport them. We will state a clearer support window at 1.0.

## Reporting a vulnerability

**Do not open a public issue, pull request, or discussion.**

Use [**GitHub private vulnerability reporting**](https://github.com/inflexa-ai/tsprov/security/advisories/new) on this repository — preferred, since it keeps the report, the fix, and the advisory in one place — or email **security@inflexa.ai**.

Please include the document or input that triggers it, the tsprov version, the runtime and version (Node, Bun, or browser), and what you expected to happen instead. A failing fixture is worth a thousand words here, as it is everywhere else in this project.

What to expect: an acknowledgement within a few working days, an assessment of whether we agree it is in scope, then a fix in the latest release together with an advisory. We will credit you unless you would rather we did not.

## If it turns out not to be ours

A report may turn out to be a problem in the **specification**, or one affecting **other PROV implementations** — the Python library, ProvToolbox, ProvJS — rather than something peculiar to this port. In that case we will coordinate upstream with those maintainers and with the open provenance community at [openprovenance.org](https://openprovenance.org/). We will not quietly patch our own copy and leave the rest of the ecosystem exposed. This follows from the principle in [`GOVERNANCE.md`](./GOVERNANCE.md#the-governing-principle-we-are-downstream-of-the-spec): we are downstream of the spec, and that cuts both ways.
