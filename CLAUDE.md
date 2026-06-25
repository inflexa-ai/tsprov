
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## Code Comments

Comment the why, not the what.

- Do NOT write comments that restate what the code already says. If a comment paraphrases the line below it, delete it. TypeScript's types and good names already document the "what"; lean on them.
- DO write comments that capture intent and reasoning: why the code works this way, what problem it solves, and what would otherwise be non-obvious to a future reader.
- Prefer making the "what" self-evident through the type system (descriptive types, unions, branded types, `readonly`, exhaustive `switch`) so prose doesn't have to carry it.

Document the decisions you made.

- Record which alternative approaches were considered and discarded, and why.
- Record which downsides or trade-offs were explicitly accepted, and why (e.g., why you reached for `any`/`as`, why you disabled a lint rule, why you chose a library).
- Every `// eslint-disable`, `@ts-expect-error`, `@ts-ignore`, or type assertion (`as X`, `!`) should carry a comment explaining why it is safe and necessary — these are the TS equivalent of escape hatches and must never be silent.

Document what is NOT there.

- Flag shortcuts and unhandled cases explicitly rather than leaving them silent. Use `throw new Error("not implemented")` (or a `// TODO:` with an issue link) instead of a stub that returns a fake value.
- In exhaustive `switch`/discriminated-union handling, use a `never`-typed default branch so the compiler flags any case you forgot — this documents "everything is handled" and breaks the build when it stops being true.
- Note future optimization opportunities and the deliberate absence of an implementation (e.g., why a method is intentionally not provided, why a type guard is omitted).

Treat comments as first-class, and write them early.

- Comments are among the most important code you write; treat them with the same care as the logic.
- Consider writing the comment/contract before the implementation — sketch the intended behavior, inputs, and invariants in prose (or a JSDoc block) first, then fill in the code beneath it.

Comment the surprising, the unsafe, and the load-bearing.

- Clearly comment anything a reader would find unexpected: reliance on external or global state, mutation of shared objects, ordering or timing requirements (async sequencing, microtask vs. macrotask), subtle invariants, or a non-obvious algorithm choice.
- The TypeScript analogue of "unsafe" is anywhere you defeat the type checker: `as`/`as unknown as`, non-null assertions (`!`), `any`, `@ts-expect-error`, type predicates (`x is T`), and unchecked casts of external data (JSON, API responses). Each such site needs a comment stating exactly which invariant the surrounding code upholds to make it sound (e.g., "validated by the zod schema above", "guaranteed non-null because we just `.set()` it").

**Comments are not changelogs.** Never write change-history phrasing like "Bumped from X to Y", "Refactored to W", "Now does Z", "Renamed from V", "Extracted from U", "Previously did A". Git tracks history; comments describe the static rationale as a fresh reader will encounter it tomorrow. If a value is unusual, justify the value — not the diff.

## Project: tsprov

This repo ports the Python [`prov`](https://github.com/trungdong/prov) library (W3C PROV-DM,
vendored at `reference/prov/`) to idiomatic TypeScript. The plan and progress live in
`docs/migration/` — **read `docs/migration/00-overview.md` and the newest entry in
`docs/migration/05-progress-log.md` (the running progress log) before starting work.** The
reference Python is the spec:
drive every port from it and its test corpus, and anchor non-obvious decisions to the source
as `file.py:NN`.

## TypeScript

Adapted from the team conventions in `../inflexa/inflexa/CLAUDE.md` — only the rules that apply
to a **library** are kept (no TUI/db/CLI/module/event-bus rules).

- **Document every exported declaration — types, their properties, classes, methods, and
  functions — with a JSDoc (`/** … */`) block, never a `//` line comment.** JSDoc is the only
  form the LSP surfaces on hover and completion, so a `//` above an export is invisible at the
  call site where you read it. Reserve `//` for inline implementation notes (the WHY) inside a
  body. Place the block on the line directly above what it documents.
- Prefer `const` over `let` and named `function` declarations over arrow functions.
- **`type` vs `interface`: default to `type`; reach for `interface` only when a class `implements`
  the shape (a contract).** Use `type` for everything else — unions, intersections, mapped/conditional
  types, tuples, function types, and plain object-shape aliases (a `type` keeps the surface uniform and
  cannot be accidentally reopened via declaration merging). The exception is a **contract a class
  implements**: there, `interface` is the idiomatic choice — it names the contract as implementable,
  reads as intent at the `class X implements Y` site, and leaves the door open to extension/merging.
  In this codebase that means `RecordBundle` (implemented by `ProvBundle`) and `Serializer`
  (implemented by `ProvNSerializer`/`ProvJsonSerializer`) stay `interface`s; do **not** "simplify" them
  to `type`. This is distinct from the PROV **record hierarchy**, which is class-based *by design*
  (`docs/migration/04-typescript-feasibility.md §3`) — use classes where the design mandates them.
- Always type function parameters and return values.
- Comment every `any`/`unknown` usage with the WHY. The conventional `equals(other: unknown)`
  signature and `unknown` at deserialize boundaries are expected; explain any other use.
- **Use domain/branded types, never a raw `string` for a known value set** (e.g. `QNameString`
  for a `prefix:localpart` display form). A raw `string` where a QName/URI is meant is a smell.
- Keep the existing strict flags (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`). Never loosen tsconfig to land a change.

## Conventions

- **Value equality is the load-bearing invariant.** Every PROV value type exposes `equals(other)`
  plus a canonical `key` getter — a `\u0000`-separated string that reproduces the exact Python
  `__hash__` inputs. **Never** use an object-keyed `Map`/`Set` for value semantics (JS keys by
  reference); key by `.key` instead. See `docs/migration/04-typescript-feasibility.md §6`.
- **Named exports only; no default exports.** The single exception is `src/index.ts` — the
  package's public barrel (the entry point `package.json` resolves to). Internal modules import
  each other directly; never add other barrels or re-export files.
- **Relative imports carry a `.js` extension** (`from "./identifier.js"`, never `"./identifier"`
  or `"./identifier.ts"`) — even though the file on disk is `identifier.ts`. Bun and `tsc`
  (`moduleResolution: bundler`) both resolve the `.js` specifier to the `.ts` source, and `tsc`
  emits the specifier verbatim, so the published `dist/*.d.ts` is consumable under
  `moduleResolution: nodenext`/`node16` (which rejects extensionless relative imports, TS2834)
  with **no post-build rewrite step**. A `.ts`-suffixed import breaks `bun run build:types`
  (`tsconfig.build.json` sets `allowImportingTsExtensions: false`); an extensionless one breaks
  nodenext consumers. Package/bare imports (`luxon`, `bun:test`) take no extension.
- **Filenames:** lowercase, kebab-case for multi-word names (`namespace-manager.ts`), matching
  the canonical layout in `docs/migration/04-typescript-feasibility.md §2`.
- Explain **WHY** in comments, not HOW.
- **No new dependencies without explicit approval.** The core ships with **luxon only**;
  XML/RDF/graph/dot deps are optional peers behind subpath exports
  (`docs/migration/03-dependency-analysis.md`). A package the migration docs did not already
  call out needs sign-off first.
- **TODO format:** `// TODO(<tag>): <reason>` — never a bare `// TODO`. Tags: `extend` (revisit
  when capabilities grow), `perf` (fine now, optimize at scale), `slop` (works but should be
  cleaned up), `robustness` (missing hardening).
- Log every intentional divergence from Python behavior in `DEVIATIONS.md` with the source
  anchor and the reason.
- When moving code, update all importers; never leave a shim or re-export behind.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
