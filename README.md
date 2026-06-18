# tsprov

A TypeScript library that publishes dual ESM + CJS output with type declarations, so it works in Node.js, bundlers, and Bun.

## Install

```bash
bun install
```

## Usage

```ts
import { greet } from "tsprov";

const { message } = greet("world");
console.log(message); // "Hello, world!"
```

CommonJS consumers can use `require("tsprov")` — both formats are shipped.

## Develop

```bash
bun test            # run tests
bun run build       # emit dist/ (ESM + CJS + .d.ts)
```

## Publish

`prepublishOnly` runs the build automatically, so:

```bash
npm publish
```

The published tarball contains `dist/` (ESM + CJS + `.d.ts` + sourcemaps) and `src/`
(minus tests) — see the `files` field in `package.json`. Shipping the source lets
declaration maps and sourcemaps resolve, so consumers' editors can "go to definition"
straight into the original TypeScript.

This project was created using `bun init` in bun v1.3.8. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
