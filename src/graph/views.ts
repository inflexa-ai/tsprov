// Views over a lineage walk result.
//
// The walk (lineage.ts) returns a flat, reference-based `LineageResult`; this
// module provides three representations of it:
//   - `toProvDocument` — the headline: a lineage answer that is itself a valid,
//     serializable PROV document (the IVOA ProvSAP precedent), with a reference-
//     closure policy and opt-in frontier annotation.
//   - `toFlatGraph`   — the JSON-safe projection for scripts.
//   - `lineagePaths`  — bounded simple-path explanation over the result.
//
// These are free functions over `(graph, result)`, not `LineageResult`
// methods — the walk's result is a plain object, and free named
// functions match the module's idiom (`resolve`, `lineage`). Nothing here
// mutates the graph, its document, or the result: output documents are built
// fresh via `addRecord` re-creation (the same mechanism `graphToProv` relies
// on, graph.ts:388-399), and the flat/path views only read.

import { ProvDocument } from "../document.js";
import { QualifiedName, type QNameString } from "../identifier.js";
import { ns } from "../intern.js";
import { ProvRecord } from "../record/record.js";
import {
  ProvEntity,
  ProvActivity,
  ProvAgent,
  type ProvElement,
} from "../record/element.js";
import { ProvAlternate } from "../record/relation.js";
import type { ProvGraph, GraphEdge } from "./graph.js";
import type { LineageResult, FrontierEntry } from "./lineage.js";
import { rootToUris, type LineageRoot } from "./roots.js";

/**
 * The tsprov query namespace (prefix `tsprovq`) — the vendor vocabulary for
 * walk-result annotations (currently just `tsprovq:truncated`). Exported so a
 * consumer can resolve or strip the annotation attributes
 * (`TSPROVQ.qn("truncated")`); it is declared on an output document ONLY when
 * `annotateFrontier` actually annotated something, so a default
 * {@link toProvDocument} output carries no non-standard vocabulary at all.
 * Interned via `ns`, so it is the process-wide singleton for this
 * `(prefix, uri)` pair.
 */
export const TSPROVQ = ns("tsprovq", "https://tsprov.dev/ns/query#");

// The one attribute currently minted from TSPROVQ. Module-private on purpose:
// keeping the exported surface to the single namespace constant gives the
// vocabulary exactly one anchor; consumers reach the attribute as
// `TSPROVQ.qn("truncated")` (memoized, so it is this very object).
const TSPROVQ_TRUNCATED = TSPROVQ.qn("truncated");

/**
 * How {@link toProvDocument} completes references.
 *
 * - `"referenced"` (the default) — fixpoint reference closure: any identifier a
 *   record in the output references through its formal-attribute values that is
 *   declared in the graph's document but missing from the output pulls in that
 *   record's full declaration. References of pulled records are chased too;
 *   adjacency never is, so the walk's depth bound is not bypassed.
 * - `"none"` — the exact slice; unresolved references dangle (legal PROV).
 */
export type ClosurePolicy = "referenced" | "none";

/**
 * Options for {@link toProvDocument}.
 *
 * @property closure How referenced-but-missing declarations are completed
 *   (default `"referenced"`; see {@link ClosurePolicy}).
 * @property annotateFrontier When `true`, each frontier node's re-created
 *   element carries `tsprovq:truncated = "depth" | "ceiling"` and the
 *   {@link TSPROVQ} namespace is declared on the output document. Default off:
 *   the default output must be vocabulary-clean — programmatic
 *   consumers already get `result.frontier` and `closureAdded` as data.
 */
export type ToProvDocumentOptions = {
  readonly closure?: ClosurePolicy;
  readonly annotateFrontier?: boolean;
};

/**
 * The return of {@link toProvDocument}.
 *
 * @property document The fresh PROV document holding the materialized result.
 * @property closureAdded The records the reference closure pulled in, in pull
 *   order. These are the RE-CREATED records that live in `document` — not the
 *   graph's source records — so a caller can partition the OUTPUT's contents
 *   into walked vs pulled by reference (`document.getRecords()` minus
 *   `closureAdded` is the walked slice) without re-resolving identifiers; the
 *   source declarations remain reachable via `graph.document.getRecord(id)`.
 *   Empty under `closure: "none"`.
 */
export type LineageDocument = {
  readonly document: ProvDocument;
  readonly closureAdded: ProvRecord[];
};

/**
 * Materializes a walk result as a standalone {@link ProvDocument}:
 * every non-inferred visited node's element and every traversed edge's relation
 * are re-created into a fresh document via `addRecord` — `graphToProv`
 * restricted to the result. Inferred nodes are never emitted (they were never
 * asserted), so an edge whose endpoint was inferred dangles — legal PROV.
 *
 * The default `closure: "referenced"` then completes the document to a
 * reference fixpoint (see {@link ClosurePolicy}); `annotateFrontier` optionally
 * marks truncation points in the serialized form (see
 * {@link ToProvDocumentOptions}). Neither the graph, nor its document, nor the
 * result is mutated — annotation lands on the re-created records only.
 *
 * @param graph   The graph the result was walked over (supplies declarations
 *   for the closure; never mutated).
 * @param result  The walk result to materialize (never mutated).
 * @param options Closure policy and frontier annotation.
 */
export function toProvDocument(
  graph: ProvGraph,
  result: LineageResult,
  options?: ToProvDocumentOptions,
): LineageDocument {
  const document = new ProvDocument();

  // ── Emission ────────────────────────────────────────────────────────────
  // Output-membership bookkeeping is split across three structures because
  // `addRecord` RE-CREATES records (bundle.ts:438-445) — the output never holds
  // the graph's objects, so membership cannot be tracked by reference alone:
  //   - `outputUris`: identifier URIs present in the output — the closure's
  //     membership test. Pulls happen only through a QName reference, so every
  //     pull target is an IDENTIFIED record; a walked blank relation (null id)
  //     contributes no URI and can never collide with a pull.
  //   - `walkedSources`: the walked SOURCE records (elements + relations, blank
  //     ones included), seeding the closure worklist — their formal attributes
  //     are what the fixpoint chases first.
  //   - `recreatedElementByUri`: node uri → the re-created element in the
  //     output, so frontier annotation can target the copy, never the graph's
  //     record.
  const walkedSources: ProvRecord[] = [];
  const outputUris = new Set<string>();
  const recreatedElementByUri = new Map<string, ProvRecord>();

  for (const node of result.nodes) {
    if (node.inferred) {
      continue; // never asserted — graphToProv's guard (graph.ts:391)
    }
    walkedSources.push(node.element);
    outputUris.add(node.uri);
    recreatedElementByUri.set(node.uri, document.addRecord(node.element));
  }
  for (const edge of result.edges) {
    walkedSources.push(edge.relation);
    const id = edge.relation.identifier;
    if (id !== null) {
      outputUris.add(id.uri);
    }
    document.addRecord(edge.relation);
  }

  // ── Reference closure ───────────────────────────────────────────────────
  const closureAdded: ProvRecord[] = [];
  const closure = options?.closure ?? "referenced";
  switch (closure) {
    case "referenced": {
      // uri → declared record of the graph's document (elements AND identified
      // relations — a derivation's generation/usage legs name relation records).
      // `graph.document` is post-`unified()`, so at most one record exists per
      // id; the first-wins guard is a no-op kept only so a hypothetical
      // duplicate could not make the index nondeterministic.
      const declaredByUri = new Map<string, ProvRecord>();
      for (const record of graph.document.getRecords()) {
        const id = record.identifier;
        if (id !== null && !declaredByUri.has(id.uri)) {
          declaredByUri.set(id.uri, record);
        }
      }

      // Fixpoint worklist over FORMAL-attribute references only. Chasing pulled
      // records too is what makes it a fixpoint (a pulled generation must not
      // leave its own entity/activity dangling); never consulting the graph's
      // adjacency is what keeps the walk's depth bound intact — the closure
      // adds declarations, not lineage. Terminates because the output only
      // grows and is bounded by the document's record count.
      const worklist: ProvRecord[] = [...walkedSources];
      for (let head = 0; head < worklist.length; head += 1) {
        const record = worklist[head]!; // head < length, so never undefined
        for (const [, value] of record.formalAttributes) {
          if (!(value instanceof QualifiedName) || outputUris.has(value.uri)) {
            continue;
          }
          const declared = declaredByUri.get(value.uri);
          if (declared === undefined) {
            continue; // declared nowhere — dangles, legal PROV
          }
          outputUris.add(value.uri);
          // `closureAdded` holds the RE-CREATED output record (see
          // `LineageDocument`); the worklist chases the SOURCE record — same
          // formal values, but resolved against the graph's document rather
          // than re-resolved through the output's namespaces.
          closureAdded.push(document.addRecord(declared));
          worklist.push(declared);
        }
      }
      break;
    }
    case "none":
      break; // the exact slice — dangling references are legal PROV
    default: {
      // Exhaustiveness: a new policy must add its own arm. Unreachable at
      // runtime — a programmer error, not a query outcome — hence plain Error.
      const unhandled: never = closure;
      throw new Error(`Unhandled closure policy: ${String(unhandled)}`);
    }
  }

  // ── Frontier annotation ─────────────────────────────────────────────────
  if (options?.annotateFrontier === true) {
    // One annotation per node: a node can carry several frontier entries (one
    // per direction under `"both"`); the first entry wins. Arbitrary but
    // stable — the frontier log's order is deterministic (backward run before
    // forward, BFS order within a run), and either value already says "the
    // walk stopped here, more exists beyond".
    const reasonByUri = new Map<string, FrontierEntry["reason"]>();
    for (const entry of result.frontier) {
      if (!reasonByUri.has(entry.uri)) {
        reasonByUri.set(entry.uri, entry.reason);
      }
    }
    let namespaceDeclared = false;
    for (const [uri, reason] of reasonByUri) {
      const recreated = recreatedElementByUri.get(uri);
      if (recreated === undefined) {
        continue; // an inferred frontier node was never emitted — nothing to mark
      }
      // Declare the namespace lazily, on the FIRST actual annotation: with an
      // empty frontier (or an all-inferred one) even `annotateFrontier: true`
      // must leave the serialized output free of tsprovq. The
      // declaration API is the document's `addNamespace` (bundle.ts:238-248) —
      // registration there is exactly what the serializers emit as prefix
      // declarations (json.ts:87-90, bundle.ts:368-371).
      if (!namespaceDeclared) {
        document.addNamespace(TSPROVQ);
        namespaceDeclared = true;
      }
      recreated.addAttributes([[TSPROVQ_TRUNCATED, reason]]);
    }
  }

  return { document, closureAdded };
}

// ── The flat projection ─────────────────────────────────────────────────────

/**
 * The element-kind discriminator of a {@link LineageFlatNode}. `"element"`
 * covers custom `ProvElement` subclasses registered by consumers — the flat
 * view must not throw on vocabulary it does not know.
 */
export type FlatNodeKind = "entity" | "activity" | "agent" | "element";

/**
 * One node of the flat projection — plain JSON data.
 *
 * @property uri       The node's identifier URI.
 * @property kind      The element kind (see {@link FlatNodeKind}).
 * @property inferred  Whether the node was inferred (referenced but never
 *   declared) rather than asserted.
 * @property truncated Present exactly when the node is a frontier member: the
 *   truncation reason (`"depth"` for a caller bound, `"ceiling"` for the
 *   safety cap). Absent — not `undefined` — otherwise, so `"truncated" in node`
 *   distinguishes a cut from an exhausted terminal.
 */
export type LineageFlatNode = {
  readonly uri: string;
  readonly kind: FlatNodeKind;
  readonly inferred: boolean;
  readonly truncated?: FrontierEntry["reason"];
};

/**
 * One edge of the flat projection, in ASSERTED PROV orientation regardless of
 * the walk's direction — the walk records the graph's own edges, which always
 * point effect → cause, so a script can re-derive either walk from the same
 * output.
 *
 * @property from     Source URI (the relation's first formal-attribute value).
 * @property to       Target URI (the relation's second formal-attribute value).
 * @property relation The relation's PROV type in `prefix:localpart` display
 *   form (e.g. `prov:Generation`) — the branded {@link QNameString}, not a raw
 *   string.
 */
export type LineageFlatEdge = {
  readonly from: string;
  readonly to: string;
  readonly relation: QNameString;
};

/**
 * The JSON-safe projection of a {@link LineageResult}: plain data throughout —
 * `JSON.stringify` works with no replacer.
 *
 * @property roots        The resolved root URIs the walk seeded from.
 * @property unknownRoots Roots that resolved to no node (the walk's contract).
 * @property nodes        The visited nodes (see {@link LineageFlatNode}).
 * @property edges        The traversed edges (see {@link LineageFlatEdge}).
 * @property frontier     The truncation log, copied verbatim from the result.
 */
export type LineageFlatGraph = {
  readonly roots: string[];
  readonly unknownRoots: string[];
  readonly nodes: LineageFlatNode[];
  readonly edges: LineageFlatEdge[];
  readonly frontier: FrontierEntry[];
};

/** The flat kind of an element — `instanceof` against the three concrete classes. */
function kindOf(element: ProvElement): FlatNodeKind {
  if (element instanceof ProvEntity) {
    return "entity";
  }
  if (element instanceof ProvActivity) {
    return "activity";
  }
  if (element instanceof ProvAgent) {
    return "agent";
  }
  return "element"; // a consumer-registered ProvElement subclass
}

/**
 * Projects a walk result to plain, JSON-safe data. Needs no graph
 * parameter — the result's nodes carry their elements. The input result is
 * never mutated; every array and object in the return is fresh, so mutating
 * the projection cannot reach back into the result.
 *
 * @param result The walk result to project.
 */
export function toFlatGraph(result: LineageResult): LineageFlatGraph {
  // Direction-agnostic truncation marks: a node cut in ANY direction is
  // truncated. First frontier entry per uri wins — arbitrary but stable (the
  // frontier log's order is deterministic; see the same rule in
  // `toProvDocument`'s annotation pass).
  const reasonByUri = new Map<string, FrontierEntry["reason"]>();
  for (const entry of result.frontier) {
    if (!reasonByUri.has(entry.uri)) {
      reasonByUri.set(entry.uri, entry.reason);
    }
  }

  const nodes: LineageFlatNode[] = result.nodes.map((node) => {
    const kind = kindOf(node.element);
    const reason = reasonByUri.get(node.uri);
    // Two literal shapes instead of a conditional spread: the `truncated` key
    // must be genuinely ABSENT (not present-but-undefined) on non-frontier
    // nodes, so that `"truncated" in node` and `JSON.stringify` both draw the
    // truncated/terminal distinction.
    return reason === undefined
      ? { uri: node.uri, kind, inferred: node.inferred }
      : { uri: node.uri, kind, inferred: node.inferred, truncated: reason };
  });

  const edges: LineageFlatEdge[] = result.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    relation: edge.relation.getType().toString(),
  }));

  return {
    roots: [...result.roots],
    unknownRoots: [...result.unknownRoots],
    nodes,
    edges,
    frontier: result.frontier.map((entry) => ({ ...entry })),
  };
}

// ── Path enumeration ────────────────────────────────────────────────────────

/**
 * Which way a path runs between the endpoints, both in ASSERTED edge direction:
 * `"asserted"` paths go from → target (how a backward result connects a root to
 * an ancestor); `"reversed"` paths go target → from (how a forward result
 * connects a root to a descendant — the asserted edges point back at it).
 */
export type PathOrientation = "asserted" | "reversed";

/**
 * One simple path over a result's edges.
 *
 * @property orientation See {@link PathOrientation}.
 * @property nodes The node URIs along the path, endpoints included.
 * @property edges The crossed edges — the graph's own {@link GraphEdge}
 *   objects, one per hop (`edges.length === nodes.length - 1`).
 */
export type LineagePath = {
  readonly orientation: PathOrientation;
  readonly nodes: string[];
  readonly edges: GraphEdge[];
};

/**
 * Options for {@link lineagePaths}.
 *
 * @property from The starting endpoint(s), accepting the walk's root forms;
 *   defaults to every root of the result.
 * @property limit Total cap on enumerated paths across all endpoint pairs and
 *   both orientations (default {@link DEFAULT_PATH_LIMIT}). Full path
 *   enumeration notoriously does not scale; the cap is the design, not a
 *   safeguard bolted on.
 */
export type LineagePathsOptions = {
  readonly from?: LineageRoot | readonly LineageRoot[];
  readonly limit?: number;
};

/**
 * The return of {@link lineagePaths}.
 *
 * @property paths The enumerated simple paths, `"asserted"` and `"reversed"`
 *   interleaved per endpoint pair.
 * @property truncated `true` when the enumeration stopped because the cap was
 *   reached. Deliberately conservative: when EXACTLY `limit` paths exist the
 *   flag is still `true` — proving completeness would cost the very
 *   enumeration the cap exists to avoid, and "possibly incomplete" is the
 *   honest reading of a capped search (a capped enumeration must
 *   never present itself as complete).
 */
export type LineagePathsResult = {
  readonly paths: LineagePath[];
  readonly truncated: boolean;
};

/**
 * The default {@link LineagePathsOptions.limit}: generous for explanation
 * output a human or tool will consume, small enough that a diamond-dense
 * result (whose path count grows exponentially in the number of diamonds)
 * cannot blow up the enumeration.
 */
export const DEFAULT_PATH_LIMIT = 100;

/** One onward hop in a path search: the crossed edge and the URI it leads to. */
type PathStep = { readonly edge: GraphEdge; readonly next: string };

/**
 * One frame of {@link lineagePaths}' explicit-stack DFS: the node being visited
 * and a cursor into its onward {@link PathStep}s. The explicit stack replaces
 * recursion because a linear result chain can be tens of thousands of hops deep
 * — past the JS engine's call-stack limit, so a recursive walk would overflow on
 * real (not pathological) input. The cursor advances a node's steps in their
 * array order, which is what reproduces the recursive enumeration order exactly.
 */
type PathFrame = {
  readonly uri: string;
  readonly steps: readonly PathStep[];
  cursor: number;
};

/**
 * Resolves path endpoints via the shared root resolver ({@link rootToUris})
 * — the same form-by-form resolution the walk uses.
 *
 * Unlike the walk there is deliberately no `unknownRoots` channel here: an
 * endpoint that does not resolve (or resolves to a URI absent from the
 * result's edges) simply contributes no paths — the walk already surfaced
 * unknown roots when the result was produced, and an empty enumeration is the
 * honest answer for a disconnected pair. So an unresolvable string is dropped
 * (only its resolved URIs, if any, are collected).
 */
function resolveEndpointUris(
  graph: ProvGraph,
  input: LineageRoot | readonly LineageRoot[],
): string[] {
  const uris: string[] = [];
  const seen = new Set<string>();
  const push = (uri: string): void => {
    if (!seen.has(uri)) {
      seen.add(uri);
      uris.push(uri);
    }
  };

  // `Array.isArray` does not narrow the `readonly` array arm of the union, so
  // the non-array branch needs the assertion; sound because the union has
  // exactly these two arms.
  const list = Array.isArray(input) ? input : [input as LineageRoot];
  for (const endpoint of list) {
    for (const uri of rootToUris(graph, endpoint).uris) {
      push(uri);
    }
  }
  return uris;
}

/**
 * Enumerates simple paths between `from` and `target` over the RESULT's edges
 * only — never the full graph, so a path explanation cannot
 * smuggle in edges the walk excluded. Paths are searched in each asserted
 * orientation (see {@link PathOrientation}); `alternateOf` edges are crossable
 * from either endpoint within a path (the walk's symmetry rule). The
 * enumeration is a per-path-visited-set DFS (simple paths, cycle-safe),
 * capped by `limit` with an explicit `truncated` flag.
 *
 * A `from` equal to `target` yields no paths: a zero-length path explains
 * nothing, and cycle enumeration back to the start answers a different
 * question than "how are these two nodes connected" — deliberately skipped.
 *
 * @param graph   The graph the result was walked over — used ONLY to resolve
 *   string endpoints against its document's namespaces (never mutated).
 * @param result  The walk result whose edges are the search space.
 * @param target  The target endpoint (the walk's root forms).
 * @param options Starting endpoint(s) and the cap (see
 *   {@link LineagePathsOptions}).
 * @throws {TypeError} If `options.limit` is `NaN` — a `NaN` cap is a programmer
 *   error (a leaked `parseInt`/arithmetic failure), not a query outcome, and
 *   silently reinterpreting it would mask the caller's bug. `Infinity` is legal
 *   (explicit "no cap"); only `NaN` throws.
 */
export function lineagePaths(
  graph: ProvGraph,
  result: LineageResult,
  target: LineageRoot,
  options?: LineagePathsOptions,
): LineagePathsResult {
  const limit = options?.limit ?? DEFAULT_PATH_LIMIT;
  // `??` only defaults null/undefined, so an explicit `NaN` limit survives to
  // here. `paths.length >= NaN` is always false, which would silently disable the
  // cap; reject it as a programmer error rather than mask it (see @throws).
  if (Number.isNaN(limit)) {
    throw new TypeError("lineagePaths: limit must not be NaN");
  }
  const targetUris = resolveEndpointUris(graph, target);
  const fromUris =
    options?.from === undefined
      ? [...result.roots] // the walk's actual seeds, already deduped URIs
      : resolveEndpointUris(graph, options.from);

  // Asserted-direction adjacency over result.edges, built once. An alternate
  // edge is additionally indexed from its target back to its source, so BOTH
  // orientations of the search can cross it from either endpoint — PROV-DM
  // declares alternateOf symmetric, and a one-way traversal would assert an
  // ordering PROV does not (the walk's symmetry rule, restated for paths).
  const steps = new Map<string, PathStep[]>();
  const pushStep = (uri: string, step: PathStep): void => {
    const list = steps.get(uri);
    if (list === undefined) {
      steps.set(uri, [step]);
    } else {
      list.push(step);
    }
  };
  for (const edge of result.edges) {
    pushStep(edge.from, { edge, next: edge.to });
    if (edge.relation instanceof ProvAlternate) {
      pushStep(edge.to, { edge, next: edge.from });
    }
  }

  const paths: LineagePath[] = [];
  let truncated = false;

  // Simple-path DFS, one shared cap across every pair and both orientations.
  // Once `truncated` flips, every in-flight search unwinds immediately.
  //
  // Written with an EXPLICIT stack (not recursion): a linear result chain can run
  // tens of thousands of hops deep, past the JS call-stack limit, so a recursive
  // walk would overflow on real input. The index-cursor {@link PathFrame}
  // reproduces the old recursion's enumeration ORDER exactly — each node's steps
  // are advanced in array order, and a child frame is opened only after its
  // connecting node is recorded, so the goal is reached along the same paths in
  // the same sequence (pinned by the ordering-sensitive path tests + a
  // determinism probe).
  function enumerate(
    start: string,
    goal: string,
    orientation: PathOrientation,
  ): void {
    // nodePath/edgePath/visited are mutated in lockstep with `stack`: they
    // describe the current partial path from `start`, and `visited` enforces
    // simple paths (a node appears once per path, deleted on backtrack so it can
    // reappear in a different path). The root `start` frame is the last popped
    // and owns no incoming edge, so it never contributes to edgePath.
    const nodePath: string[] = [start];
    const edgePath: GraphEdge[] = [];
    const visited = new Set<string>([start]);
    const stack: PathFrame[] = [
      { uri: start, steps: steps.get(start) ?? [], cursor: 0 },
    ];

    // Returning from a frame's visit: drop it and undo its node from the path —
    // except the root frame (stack now empty), seeded before the loop with no
    // incoming edge.
    function unwind(): void {
      const done = stack.pop()!; // called only with a non-empty stack
      if (stack.length > 0) {
        visited.delete(done.uri);
        nodePath.pop();
        edgePath.pop();
      }
    }

    while (stack.length > 0) {
      if (truncated) {
        break; // cap filled — abandon every in-flight frame at once
      }
      const frame = stack[stack.length - 1]!; // length > 0, so never undefined

      // Goal handling runs once, at frame entry (cursor still 0): a simple path
      // ends at the goal, so the frame records and unwinds WITHOUT iterating its
      // steps (continuing could never reach the now-visited goal again).
      if (frame.cursor === 0 && frame.uri === goal) {
        // Pre-push guard: a degenerate `limit <= 0` yields zero paths. Post-push
        // check: stop AT the cap (see `LineagePathsResult.truncated`
        // for why exactly-limit reads as truncated).
        if (paths.length < limit) {
          paths.push({ orientation, nodes: [...nodePath], edges: [...edgePath] });
          if (paths.length >= limit) {
            truncated = true;
          }
        } else {
          truncated = true;
        }
        unwind();
        continue;
      }

      if (frame.cursor >= frame.steps.length) {
        unwind(); // steps exhausted — this frame's visit returns
        continue;
      }

      const step = frame.steps[frame.cursor]!; // cursor < length, so defined
      frame.cursor += 1;
      if (visited.has(step.next)) {
        continue; // simple paths only — never revisit within one path
      }
      // Descend one hop and open the child frame; its own goal-record or step
      // exhaustion unwinds it later, restoring the path.
      visited.add(step.next);
      nodePath.push(step.next);
      edgePath.push(step.edge);
      stack.push({ uri: step.next, steps: steps.get(step.next) ?? [], cursor: 0 });
    }
  }

  for (const fromUri of fromUris) {
    for (const targetUri of targetUris) {
      if (fromUri === targetUri) {
        continue; // self-path: skipped by design — see the JSDoc above
      }
      enumerate(fromUri, targetUri, "asserted");
      enumerate(targetUri, fromUri, "reversed");
    }
  }

  return { paths, truncated };
}
