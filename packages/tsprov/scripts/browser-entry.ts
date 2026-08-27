// Bundler entry for the prebuilt browser artifact (`dist/browser/tsprov.min.js`) —
// consumed ONLY by the `build:browser` script, never by package code or the tsc
// builds (both tsconfigs `include` just `src/`, which is the point: an entry like
// this inside `src/` would land in the ESM/CJS dists as a module that assigns a
// global as an import-time side effect, a footgun for bundler consumers).
//
// The target page opens on `file://`, where a browser refuses ES modules, so the
// consumer can load only a classic `<script src>` — hence one IIFE that registers
// one global instead of an exports map.
//
// The `build:browser` invocation names the output via `--outdir` +
// `--entry-naming "tsprov.min.[ext]"`, NOT `--outfile`: on Bun 1.3.14,
// `--outfile` combined with `--sourcemap=linked` drops the directory part and
// writes both files into the cwd (observed empirically; exit code varies).
import * as core from "../src/index.js";
import * as graph from "../src/graph/index.js";

// One flat namespace over both package entry points (`.` and `./graph`): the
// consumer's walk calls `read`, `provToGraph`, `resolve`, `resolveUnique`, and
// `lineage` off a single global. The barrels share no value-export name, so the
// spread is lossless; were a future graph export to shadow a core name, the
// smoke test's surface assertions would go red before it could publish. The
// core/graph layering rule is untouched — nothing in `src/` imports this file.
Object.assign(globalThis, { tsprov: { ...core, ...graph } });
