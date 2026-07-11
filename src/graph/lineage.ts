// Directional, bounded, cycle-safe lineage walk over a `ProvGraph`.
//
// This is the stage that answers "where did this come from / what came from
// this?". Resolution (resolve.ts) finds the query subject; this module walks
// from it; views over the returned edges (PROV document, flat graph, paths)
// live in views.ts. The walk deliberately never materializes a document, never
// infers, and never widens beyond the edges it traverses.
//
// The load-bearing choices:
//   - ONE breadth-first pass from all seeds at once, one visited set per
//     direction run. BFS reaches every node at its minimum hop distance, so a
//     depth-cut node is cut at its shallowest — the depth-bounded-DFS artifact
//     where a node first reached on a DEEP path gets marked visited and a later
//     shallower path can no longer improve its cut cannot arise, which is why
//     the depth rules stay this simple.
//   - Direction is edge orientation. Every relation's first-two-formal-
//     attributes edge points effect → cause (verified for all 15 classes,
//     graph.ts builds exactly those edges). `alternateOf` is the one symmetric
//     exception (traversed from both endpoints under every direction).
//   - The result is flat and reference-based (the graph's own `GraphNode`/
//     `GraphEdge` objects), and the BFS is an internal fold over visit events,
//     so other consumers can attach a different visitor to the same traversal
//     without a public algebra API existing today.

import type { RecordClass } from "../bundle.js";
import {
  ProvRelation,
  ProvAlternate,
  ProvGeneration,
  ProvUsage,
  ProvDerivation,
  ProvCommunication,
  ProvStart,
  ProvEnd,
  ProvInvalidation,
  ProvAttribution,
  ProvAssociation,
  ProvDelegation,
  ProvSpecialization,
  ProvMembership,
} from "../record/relation.js";
import type { ProvGraph, GraphNode, GraphEdge } from "./graph.js";
import { rootToUris, type LineageRoot } from "./roots.js";

// Re-exported so the public `./graph` barrel (which points at this module) is
// unchanged; the definition lives with the resolution it feeds (roots.ts).
export type { LineageRoot };

/**
 * Which way a walk follows edges.
 *
 * - `"backward"` (ancestry, the default) — follow edges in their asserted
 *   direction (effect → cause); "where did this come from?".
 * - `"forward"` (descendants) — follow edges reversed (cause → effect); "what
 *   came from this?".
 * - `"both"` — the UNION of one backward and one forward walk from the same
 *   roots, each with its own visited set and depth bound. Deliberately NOT the
 *   undirected connected component: an undirected walk through a shared input
 *   would pull in every sibling output ("what else did my ancestor produce?"),
 *   a different question — `lineagePaths` territory.
 */
export type LineageDirection = "backward" | "forward" | "both";

/**
 * A named set of relation classes the walk may traverse (composes with
 * `edgeWhere` by AND).
 *
 * - `"dataflow"` (the default) — Generation, Usage, Derivation, Communication,
 *   Start, End, Invalidation: the edges along which data and events flow, i.e.
 *   what "where did this artifact come from?" traverses.
 * - `"responsibility"` — Attribution, Association, Delegation.
 * - `"structure"` — Specialization (and therefore Mention, its subclass, matched
 *   by `instanceof ProvSpecialization`), Alternate, Membership.
 * - `"all"` — every relation class, INCLUDING Influence.
 *
 * `wasInfluencedBy` (`ProvInfluence`) belongs to no named profile other than
 * `"all"`: it is PROV's unspecific superrelation (it can relate any element
 * kinds), so placing it in a semantically-scoped profile would smuggle
 * unknown-kind edges into a walk that promised "data flow" or "responsibility".
 */
export type RelationProfile = "dataflow" | "responsibility" | "structure" | "all";


/**
 * Options for {@link lineage}.
 *
 * @property direction Which way to walk (default `"backward"`).
 * @property relations The traversable relation set — a {@link RelationProfile}
 *   name or an explicit `readonly RecordClass[]` (default `"dataflow"`). Composes
 *   with {@link edgeWhere} by AND.
 * @property depth Per-direction hop bound (one hop = one edge traversal). A bare
 *   number applies to every direction that runs; `{ back?, forward? }` bounds the
 *   backward and forward runs independently (dbt's `3+model+2` maps to
 *   `{ direction: "both", depth: { back: 3, forward: 2 } }`). Any direction left
 *   unset — the whole option, or one key of the object form — is unbounded,
 *   backed by the {@link MAX_WALK_DEPTH} safety ceiling.
 * @property edgeWhere A caller-injected edge predicate that further restricts
 *   traversal (AND with the profile) — the same injection philosophy as resolve's
 *   `where`. Derivation-subtype refinement is a documented usage, not a bespoke
 *   option: filter on `edge.relation.getAssertedTypes()` containing
 *   `PROV_REVISION` etc.
 */
export type LineageOptions = {
  readonly direction?: LineageDirection;
  readonly relations?: RelationProfile | readonly RecordClass[];
  readonly depth?: number | { readonly back?: number; readonly forward?: number };
  readonly edgeWhere?: (edge: GraphEdge) => boolean;
};

/**
 * The concrete direction of a single walk run — one of the two orientations a
 * {@link LineageDirection} expands to, never `"both"` (a cutoff always belongs to
 * one concrete run; a `"both"` result carries {@link FrontierEntry} entries from
 * each run). Exported so {@link FrontierEntry.direction}'s type is nameable at the
 * call site, like its sibling {@link LineageDirection}.
 */
export type WalkDirection = "backward" | "forward";

/**
 * One truncation point: a node that was reached but whose onward edges were NOT
 * traversed because a bound was hit. `reason` distinguishes a caller `depth`
 * bound from the {@link MAX_WALK_DEPTH} `ceiling` — nothing truncates
 * silently. A node with no traversable onward edges is exhaustion, not
 * truncation, and never appears here.
 *
 * @property uri       The reached node's URI.
 * @property direction The run that stopped here.
 * @property reason    `"depth"` for a caller bound; `"ceiling"` for the safety cap.
 */
export type FrontierEntry = {
  readonly uri: string;
  readonly direction: WalkDirection;
  readonly reason: "depth" | "ceiling";
};

/**
 * The outcome of {@link lineage}: flat, deduplicated, reference-based.
 *
 * @property roots        The resolved root URIs that ARE nodes in the graph
 *   (dedup, first-seen order) — the walk's actual seeds.
 * @property unknownRoots Roots that resolved to no node, surfaced as data rather
 *   than thrown: a resolvable-but-absent reference contributes its
 *   URI; a string that cannot even resolve to a qualified name contributes its
 *   raw form (there is no URI to key a node by, so the caller sees exactly what
 *   they passed).
 * @property nodes        Each visited node exactly once, in BFS discovery order
 *   with roots first — the graph's own {@link GraphNode} objects.
 * @property edges        Each traversed edge exactly once, deduped by reference
 *   (including across the `"both"` union) — the graph's own {@link GraphEdge}
 *   objects.
 * @property frontier     Every truncation point (see {@link FrontierEntry}).
 */
export type LineageResult = {
  readonly roots: string[];
  readonly unknownRoots: string[];
  readonly nodes: GraphNode[];
  readonly edges: GraphEdge[];
  readonly frontier: FrontierEntry[];
};

/**
 * The hard safety ceiling on hops when a direction is unbounded: far beyond any
 * real pipeline's depth, but it prevents a pathological chain from
 * walking forever. Hitting it produces the same explicit frontier as a caller
 * bound, with `reason: "ceiling"` — so a caller who legitimately needs more can
 * detect the cap and re-run with an explicit larger `depth`.
 */
export const MAX_WALK_DEPTH = 1000;

// ── Relation profiles ─────────────────────────────────────────────────────────
// Fixed class sets; membership is documented on `RelationProfile`. `instanceof`
// against a base class subsumes its subclasses, which is load-bearing twice:
// `ProvSpecialization` catches `ProvMention` (structure), and — for `"all"` —
// the `ProvRelation` base catches all 15 concrete classes without enumerating
// them, INCLUDING `ProvInfluence` (which no named profile carries). `ProvInfluence`
// has no subclasses of its own here, so it is never pulled into another profile.

const DATAFLOW_CLASSES: readonly RecordClass[] = [
  ProvGeneration,
  ProvUsage,
  ProvDerivation,
  ProvCommunication,
  ProvStart,
  ProvEnd,
  ProvInvalidation,
];

const RESPONSIBILITY_CLASSES: readonly RecordClass[] = [
  ProvAttribution,
  ProvAssociation,
  ProvDelegation,
];

const STRUCTURE_CLASSES: readonly RecordClass[] = [
  ProvSpecialization, // subsumes ProvMention (mentionOf IS-A specializationOf)
  ProvAlternate,
  ProvMembership,
];

/** Every relation, via the base class — see the block comment above. */
const ALL_CLASSES: readonly RecordClass[] = [ProvRelation];

/** Resolves the `relations` option to the concrete class set to test edges against. */
function relationClassesOf(
  relations: RelationProfile | readonly RecordClass[] | undefined,
): readonly RecordClass[] {
  if (relations === undefined) {
    return DATAFLOW_CLASSES; // default profile
  }
  if (typeof relations !== "string") {
    return relations; // explicit class list
  }
  switch (relations) {
    case "dataflow":
      return DATAFLOW_CLASSES;
    case "responsibility":
      return RESPONSIBILITY_CLASSES;
    case "structure":
      return STRUCTURE_CLASSES;
    case "all":
      return ALL_CLASSES;
    default: {
      // Exhaustiveness: a new profile name must add its own arm rather than
      // silently defaulting. Unreachable at runtime — a programmer error, not a
      // user condition — so a plain Error (not a catchable domain error).
      const unhandled: never = relations;
      throw new Error(`Unhandled relation profile: ${String(unhandled)}`);
    }
  }
}

// ── The BFS core as an internal fold ──────────────────────────────────────────

/**
 * The visit-event sink the BFS folds into: a node was discovered, an edge was
 * traversed, or a node was cut off (frontier). Kept module-private on purpose.
 *
 * TODO(extend): this is the algebra seam. A future traversal variant (a
 * semiring/weighted walk, say) attaches a different
 * visitor to the same event stream — so the traversal is written once and folded
 * many ways, without committing to a public algebra API now.
 */
type WalkVisitor = {
  readonly node: (node: GraphNode) => void;
  readonly edge: (edge: GraphEdge) => void;
  readonly frontier: (entry: FrontierEntry) => void;
};

/** One onward step: the edge to record and the neighbor URI to move to. */
type OnwardStep = { readonly edge: GraphEdge; readonly next: string };

/**
 * The traversable edges leaving `uri` under `direction`, already filtered by the
 * profile+edgeWhere predicate. "Backward" follows the asserted orientation
 * (`outEdges`, to `edge.to`); "forward" follows it reversed (`inEdges`, to
 * `edge.from`). In BOTH directions, `alternateOf` edges are additionally
 * traversed from the endpoint they would otherwise be unreachable from — PROV-DM
 * declares `alternateOf` symmetric, so a one-way traversal would assert an
 * ordering PROV does not. The alternate edges are still subject to
 * `traversable`, so a profile that excludes Alternate never traverses them.
 */
function onwardSteps(
  graph: ProvGraph,
  uri: string,
  direction: WalkDirection,
  traversable: (edge: GraphEdge) => boolean,
): OnwardStep[] {
  const steps: OnwardStep[] = [];
  if (direction === "backward") {
    for (const edge of graph.outEdges(uri)) {
      if (traversable(edge)) {
        steps.push({ edge, next: edge.to });
      }
    }
    // Symmetric alternateOf: also cross an alternate edge whose TARGET is `uri`,
    // reaching its source — the direction backward would otherwise miss.
    for (const edge of graph.inEdges(uri)) {
      if (edge.relation instanceof ProvAlternate && traversable(edge)) {
        steps.push({ edge, next: edge.from });
      }
    }
  } else {
    for (const edge of graph.inEdges(uri)) {
      if (traversable(edge)) {
        steps.push({ edge, next: edge.from });
      }
    }
    // Mirror of the backward case: cross an alternate edge whose SOURCE is `uri`.
    for (const edge of graph.outEdges(uri)) {
      if (edge.relation instanceof ProvAlternate && traversable(edge)) {
        steps.push({ edge, next: edge.to });
      }
    }
  }
  return steps;
}

/**
 * One breadth-first direction run from all `seeds` at once, emitting visit events
 * to `visitor`. A private per-run visited set makes cycles terminate (a node
 * expands once) and — because BFS discovers each node at its minimum hop distance
 * — makes the depth bound exact without the DFS "shallower path" caveat.
 *
 * A node at depth `< bound` is expanded (its onward edges traversed); a node at
 * depth `=== bound` is NOT expanded, and becomes a frontier entry IFF it has at
 * least one traversable onward edge — checked against the FILTERED onward set, so
 * a node whose onward edges are all profile-/predicate-excluded is exhausted, not
 * truncated. Every edge is emitted even when its neighbor is already
 * visited (so the diamond's second path and the cycle's back-edge are recorded);
 * reference dedup happens in the visitor.
 */
function walkDirection(
  graph: ProvGraph,
  seeds: readonly string[],
  direction: WalkDirection,
  bound: number,
  reason: FrontierEntry["reason"],
  traversable: (edge: GraphEdge) => boolean,
  visitor: WalkVisitor,
): void {
  const visited = new Set<string>();
  // A plain array + head cursor is the queue; entries are dequeued in FIFO order,
  // which is what makes the traversal breadth-first (and discovery order stable).
  const queue: Array<{ uri: string; depth: number }> = [];

  for (const uri of seeds) {
    if (visited.has(uri)) {
      continue;
    }
    visited.add(uri);
    // Seeds are pre-filtered to real nodes by root normalization, so `getNode`
    // never returns undefined here; the guard satisfies the type checker.
    const node = graph.getNode(uri);
    if (node !== undefined) {
      visitor.node(node);
    }
    queue.push({ uri, depth: 0 });
  }

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]!; // head < length, so never undefined
    const steps = onwardSteps(graph, current.uri, direction, traversable);

    if (current.depth >= bound) {
      // Reached the bound: do not traverse onward. Truncation only if there IS
      // something onward that we are declining to follow.
      if (steps.length > 0) {
        visitor.frontier({ uri: current.uri, direction, reason });
      }
      continue;
    }

    for (const { edge, next } of steps) {
      visitor.edge(edge);
      if (!visited.has(next)) {
        visited.add(next);
        const node = graph.getNode(next);
        if (node !== undefined) {
          visitor.node(node);
        }
        queue.push({ uri: next, depth: current.depth + 1 });
      }
    }
  }
}

// ── Root normalization ────────────────────────────────────────────────────────

/** The seeds to walk from, plus the roots/unknownRoots accounting. */
type NormalizedRoots = { readonly roots: string[]; readonly unknownRoots: string[] };

/**
 * Turns the caller's roots into seed URIs, partitioning each into `roots` (URIs
 * that are graph nodes — the actual seeds) or `unknownRoots` (surfaced, never
 * thrown, so one bad root cannot destroy a multi-root query). See
 * {@link LineageResult} for what `unknownRoots` carries.
 */
function normalizeRoots(
  graph: ProvGraph,
  input: LineageRoot | readonly LineageRoot[],
): NormalizedRoots {
  const roots: string[] = [];
  const unknownRoots: string[] = [];
  const seenRoot = new Set<string>();
  const seenUnknown = new Set<string>();

  const pushUnknown = (value: string): void => {
    if (!seenUnknown.has(value)) {
      seenUnknown.add(value);
      unknownRoots.push(value);
    }
  };
  // A resolved URI seeds the walk iff it names a node; otherwise it is unknown.
  const classifyUri = (uri: string): void => {
    if (graph.hasNode(uri)) {
      if (!seenRoot.has(uri)) {
        seenRoot.add(uri);
        roots.push(uri);
      }
    } else {
      pushUnknown(uri);
    }
  };

  // `Array.isArray` does not narrow the `readonly` array arm of the union, so
  // the non-array branch needs the assertion; sound because the union has
  // exactly these two arms.
  const list = Array.isArray(input) ? input : [input as LineageRoot];
  for (const root of list) {
    const { uris, unresolved } = rootToUris(graph, root);
    // An unresolvable string has no node key, so its raw form is directly unknown;
    // a resolved URI seeds the walk iff it names a node, else it is unknown too.
    if (unresolved !== undefined) {
      pushUnknown(unresolved);
    }
    for (const uri of uris) {
      classifyUri(uri);
    }
  }

  return { roots, unknownRoots };
}

// ── Depth bounds ──────────────────────────────────────────────────────────────

/**
 * The hop bound and its truncation reason for one direction run.
 *
 * A `NaN` bound throws {@link TypeError}: `current.depth >= NaN` is always false,
 * so a `NaN` depth would silently defeat the {@link MAX_WALK_DEPTH} ceiling and
 * walk unbounded. A `NaN` is a programmer error (a leaked `parseInt`/arithmetic
 * failure), not a query outcome, so we surface it rather than mask it — both the
 * bare-number and the `{ back, forward }` forms are checked. `Infinity` is legal
 * (explicit "no bound"): the caller's per-run visited set still terminates the
 * walk, so only `NaN` is rejected.
 */
function boundFor(
  depth: LineageOptions["depth"],
  direction: WalkDirection,
): { bound: number; reason: FrontierEntry["reason"] } {
  if (depth === undefined) {
    return { bound: MAX_WALK_DEPTH, reason: "ceiling" };
  }
  if (typeof depth === "number") {
    if (Number.isNaN(depth)) {
      throw new TypeError("lineage: depth must not be NaN");
    }
    return { bound: depth, reason: "depth" };
  }
  const value = direction === "backward" ? depth.back : depth.forward;
  // An omitted key of the object form is unbounded for that direction — the same
  // ceiling as an entirely unset `depth`.
  if (value === undefined) {
    return { bound: MAX_WALK_DEPTH, reason: "ceiling" };
  }
  if (Number.isNaN(value)) {
    throw new TypeError("lineage: depth must not be NaN");
  }
  return { bound: value, reason: "depth" };
}

/** The concrete direction runs a {@link LineageDirection} expands to. */
function runsFor(direction: LineageDirection): readonly WalkDirection[] {
  switch (direction) {
    case "backward":
      return ["backward"];
    case "forward":
      return ["forward"];
    case "both":
      return ["backward", "forward"];
    default: {
      const unhandled: never = direction;
      throw new Error(`Unhandled lineage direction: ${String(unhandled)}`);
    }
  }
}

/**
 * Walks the lineage of `roots` over `graph`, returning a flat {@link LineageResult}
 * of the visited nodes, traversed edges, and truncation frontier. Never throws for
 * a query outcome — unresolvable roots are surfaced in `unknownRoots`.
 *
 * Defaults: `direction: "backward"` (ancestry), `relations: "dataflow"`, and an
 * unbounded depth backed by {@link MAX_WALK_DEPTH}. A `depth` of `Infinity` is a
 * legal "no bound" — the per-direction visited set still terminates the walk (a
 * node expands once), so it exhausts the reachable component with an empty
 * frontier rather than truncating at the ceiling.
 *
 * The walk is reference-based and non-mutating: `nodes`/`edges` are `graph`'s own
 * objects, and neither the graph nor its document is touched (materialization is
 * `toProvDocument`'s job). Edge dedup across the `"both"` union is by object
 * reference — the `GraphEdge` objects are stable identities owned by
 * `ProvGraph`, so a `Set` of references is exact without value-keying.
 *
 * @param graph   The graph to walk.
 * @param roots   One root or an array (see {@link LineageRoot}).
 * @param options Direction, relation scope, depth bounds, and edge predicate.
 * @throws {TypeError} If `options.depth` is `NaN`, in either the bare-number or
 *   the `{ back, forward }` form — a `NaN` bound is a programmer error (a leaked
 *   `parseInt`/arithmetic failure) that would silently defeat the
 *   {@link MAX_WALK_DEPTH} ceiling, so it is rejected rather than reinterpreted.
 */
export function lineage(
  graph: ProvGraph,
  roots: LineageRoot | readonly LineageRoot[],
  options?: LineageOptions,
): LineageResult {
  const { roots: seedUris, unknownRoots } = normalizeRoots(graph, roots);

  const classes = relationClassesOf(options?.relations);
  const edgeWhere = options?.edgeWhere;
  // Profile membership AND the injected predicate must both hold to traverse.
  const traversable = (edge: GraphEdge): boolean =>
    classes.some((cls) => edge.relation instanceof cls) &&
    (edgeWhere === undefined || edgeWhere(edge));

  // The accumulating fold: a Map dedups nodes by URI while preserving discovery
  // (insertion) order — roots first, since seeds are emitted first in each run;
  // a Set dedups edges by reference across both runs; frontier is a flat log.
  const nodesByUri = new Map<string, GraphNode>();
  const edgeSet = new Set<GraphEdge>();
  const frontier: FrontierEntry[] = [];
  const visitor: WalkVisitor = {
    node: (node) => {
      if (!nodesByUri.has(node.uri)) {
        nodesByUri.set(node.uri, node);
      }
    },
    edge: (edge) => {
      edgeSet.add(edge);
    },
    frontier: (entry) => {
      frontier.push(entry);
    },
  };

  const direction = options?.direction ?? "backward";
  for (const run of runsFor(direction)) {
    const { bound, reason } = boundFor(options?.depth, run);
    walkDirection(graph, seedUris, run, bound, reason, traversable, visitor);
  }

  return {
    roots: seedUris,
    unknownRoots,
    nodes: [...nodesByUri.values()],
    edges: [...edgeSet],
    frontier,
  };
}
