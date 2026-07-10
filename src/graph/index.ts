// Public API for the `@inflexa-ai/tsprov/graph` subpath — the multi-digraph view
// over a PROV document.
//
// This is a subpath package entry point, and therefore the one sanctioned barrel
// for the graph layer (the same carve-out `src/index.ts` gets for the core, per
// CLAUDE.md's "no new barrels" rule: a subpath IS a package entry). Internal
// graph modules import each other directly with `.js` specifiers; only this file
// re-exports. The core barrel (`src/index.ts`) stays unaware of the graph layer.

export { ProvGraph, provToGraph, graphToProv } from "./graph.js";
export type {
  GraphNode,
  GraphEdge,
  SkipReason,
  SkippedRelation,
} from "./graph.js";

export { resolve, resolveUnique, normalizeAttrValue } from "./resolve.js";
export type {
  RecordSelector,
  AttributePredicate,
  Resolution,
  UniqueResolution,
} from "./resolve.js";
