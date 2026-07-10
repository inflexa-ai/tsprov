// `ProvGraph` — a multi-digraph view over a PROV document.
//
// Port of `reference/prov/src/prov/graph.py` (`prov_to_graph`/`graph_to_prov`),
// which builds a NetworkX `MultiDiGraph`: elements become nodes, each relation's
// first two formal attributes become an edge carrying the relation record, and
// endpoints that are referenced but never declared become synthetic "inferred"
// nodes. NetworkX gave Python forward AND reverse adjacency for free; this
// hand-rolled structure exists to provide the reverse index (edges by target
// uri) that a lineage layer needs, with zero new dependencies
// (03-dependency-analysis.md:75-80).
//
// Two deliberate divergences from Python (see DEVIATIONS.md):
//   1. Built from `document.flattened().unified(options)`, not bare `unified()`
//      (`graph.py:68`) — so records inside bundles participate. Python's
//      converter only ever sees document-level records.
//   2. An `inferred: boolean` node flag replaces Python's `bundle=None` sentinel
//      (`graph.py:82,103`): a `ProvRecord` here always requires a `RecordBundle`
//      resolver (`record.ts:165-175`), so the null-bundle sentinel cannot port
//      literally.

import { QualifiedName } from "../identifier.js";
import type { RecordBundle } from "../record/record.js";
import { ProvElement, ProvEntity, ProvActivity, ProvAgent } from "../record/element.js";
import { ProvRelation } from "../record/relation.js";
import { ProvDocument } from "../document.js";
import type { UnifiedOptions } from "../bundle.js";
import {
  PROV_ATTR_ENTITY,
  PROV_ATTR_ACTIVITY,
  PROV_ATTR_AGENT,
  PROV_ATTR_TRIGGER,
  PROV_ATTR_GENERATED_ENTITY,
  PROV_ATTR_USED_ENTITY,
  PROV_ATTR_DELEGATE,
  PROV_ATTR_RESPONSIBLE,
  PROV_ATTR_SPECIFIC_ENTITY,
  PROV_ATTR_GENERAL_ENTITY,
  PROV_ATTR_ALTERNATE1,
  PROV_ATTR_ALTERNATE2,
  PROV_ATTR_COLLECTION,
  PROV_ATTR_INFORMED,
  PROV_ATTR_INFORMANT,
  PROV_ATTR_PLAN,
  PROV_ATTR_ENDER,
  PROV_ATTR_STARTER,
} from "../constants.js";

/**
 * A node in a {@link ProvGraph}: a PROV element keyed by its identifier URI.
 *
 * @property uri      The element identifier's URI — the node's key in every
 *   collection (string-keyed per the value-equality invariant; never keyed by
 *   object reference).
 * @property element  The element record. For a declared element this is the
 *   record from {@link ProvGraph.document}; for an `inferred` endpoint it is a
 *   synthetic element (see {@link ProvGraph.of}).
 * @property inferred `true` when the element was never declared in the document
 *   but is referenced as a relation endpoint. {@link graphToProv} skips inferred
 *   nodes — the TypeScript-honest replacement for Python's `bundle is None`
 *   guard (`graph.py:103`).
 */
export type GraphNode = {
  readonly uri: string;
  readonly element: ProvElement;
  readonly inferred: boolean;
};

/**
 * A directed edge in a {@link ProvGraph}: one PROV relation, from the URI of its
 * first formal attribute to the URI of its second.
 *
 * @property from     Source node URI (the relation's first formal-attribute value).
 * @property to       Target node URI (the relation's second formal-attribute value).
 * @property relation The full relation record — the edge payload, so n-ary data
 *   (roles, times, extra attributes) is preserved, unlike a bare `(from, to)` pair.
 */
export type GraphEdge = {
  readonly from: string;
  readonly to: string;
  readonly relation: ProvRelation;
};

/** Why a relation did not become an edge (see {@link SkippedRelation}). */
export type SkipReason =
  /** One of the first two formal attributes had no value (Python's `if qn1 and qn2`, `graph.py:79`). */
  | "missing-endpoint"
  /** An undeclared endpoint's formal attribute is not in {@link INFERRED_ELEMENT_CLASS} (Python's caught `KeyError`, `graph.py:85-87`). */
  | "unmapped-attribute";

/**
 * A relation that {@link ProvGraph.of} could not turn into an edge, recorded so
 * the loss is observable rather than silent (spec: "Skips SHALL be observable").
 */
export type SkippedRelation = {
  readonly relation: ProvRelation;
  readonly reason: SkipReason;
};

/** Constructor shape shared by the concrete element classes an endpoint can be inferred as. */
type InferredElementCtor = new (
  resolver: RecordBundle,
  identifier: QualifiedName,
) => ProvElement;

/**
 * Formal-attribute URI → the {@link ProvElement} subclass to synthesize for an
 * endpoint referenced through that attribute but never declared. Port of Python's
 * `INFERRED_ELEMENT_CLASS` (`graph.py:36-56`).
 *
 * Deliberate omissions, both matching Python's *observable* behavior exactly:
 *   - `prov:influencee` / `prov:influencer` are absent (as in Python), so a
 *     `ProvInfluence` with an undeclared endpoint is always skipped
 *     (unmapped-attribute). This is the ONLY relation whose first-two attributes
 *     are unmapped, so it is the only relation that can be skipped for that reason.
 *   - `prov:bundle` is omitted. Python maps it to `ProvBundle`, but `prov:bundle`
 *     is only ever `mentionOf`'s THIRD formal attribute, and edge extraction reads
 *     only the first two (`graph.py:76`) — so that entry is unreachable in Python
 *     and here. A `ProvBundle` is a container, not a `ProvElement`, so it cannot
 *     be a node in this element-keyed graph; omitting it (rather than fabricating
 *     an impossible node) is behaviorally identical on every valid PROV document.
 */
const INFERRED_ELEMENT_CLASS: ReadonlyMap<string, InferredElementCtor> = new Map<
  string,
  InferredElementCtor
>([
  [PROV_ATTR_ENTITY.uri, ProvEntity],
  [PROV_ATTR_ACTIVITY.uri, ProvActivity],
  [PROV_ATTR_AGENT.uri, ProvAgent],
  [PROV_ATTR_TRIGGER.uri, ProvEntity],
  [PROV_ATTR_GENERATED_ENTITY.uri, ProvEntity],
  [PROV_ATTR_USED_ENTITY.uri, ProvEntity],
  [PROV_ATTR_DELEGATE.uri, ProvAgent],
  [PROV_ATTR_RESPONSIBLE.uri, ProvAgent],
  [PROV_ATTR_SPECIFIC_ENTITY.uri, ProvEntity],
  [PROV_ATTR_GENERAL_ENTITY.uri, ProvEntity],
  [PROV_ATTR_ALTERNATE1.uri, ProvEntity],
  [PROV_ATTR_ALTERNATE2.uri, ProvEntity],
  [PROV_ATTR_COLLECTION.uri, ProvEntity],
  [PROV_ATTR_INFORMED.uri, ProvActivity],
  [PROV_ATTR_INFORMANT.uri, ProvActivity],
  [PROV_ATTR_PLAN.uri, ProvEntity],
  [PROV_ATTR_ENDER.uri, ProvEntity],
  [PROV_ATTR_STARTER.uri, ProvEntity],
]);

/**
 * Resolves a relation endpoint to its graph node, inferring a synthetic element
 * when the endpoint was never declared. Returns `undefined` when the endpoint is
 * undeclared AND its formal attribute has no inferred class (Python's caught
 * `KeyError`), signalling the caller to skip the relation.
 *
 * The returned node is NOT yet committed to `nodes` — the caller commits both
 * endpoints only once both resolve, so a relation that ends up skipped never
 * leaves a half-inferred node behind.
 *
 * @param nodes    The committed nodes so far (declared elements plus already-inferred endpoints).
 * @param resolver The transformed document, used only as the synthetic element's qualified-name resolver.
 * @param attr     The formal-attribute QName the endpoint is referenced through (selects the inferred class).
 * @param endpoint The endpoint QName (the value of that formal attribute).
 */
function resolveEndpoint(
  nodes: ReadonlyMap<string, GraphNode>,
  resolver: ProvDocument,
  attr: QualifiedName,
  endpoint: QualifiedName,
): GraphNode | undefined {
  const existing = nodes.get(endpoint.uri);
  if (existing !== undefined) {
    return existing;
  }
  const ctor = INFERRED_ELEMENT_CLASS.get(attr.uri);
  if (ctor === undefined) {
    return undefined;
  }
  // The synthetic element is constructed against the transformed document purely
  // as its qualified-name resolver. The `ProvElement`/`ProvRecord` constructor
  // does NOT register the record — only `newRecord`/`addRecordInternal` do
  // (bundle.ts:389-435) — so building it here never mutates the document. That
  // non-registration is the invariant that makes an "inferred" node sound.
  const element = new ctor(resolver, endpoint);
  return { uri: endpoint.uri, element, inferred: true };
}

/** Appends `edge` to the adjacency list for `uri`, creating the list on first use. */
function pushAdjacency(
  index: Map<string, GraphEdge[]>,
  uri: string,
  edge: GraphEdge,
): void {
  const list = index.get(uri);
  if (list === undefined) {
    index.set(uri, [edge]);
  } else {
    list.push(edge);
  }
}

/**
 * A build-once multi-digraph over a PROV document: element nodes keyed by
 * `identifier.uri`, one edge per relation (its first two formal attributes)
 * carrying the full relation record, and forward + reverse adjacency.
 *
 * Construct it with {@link ProvGraph.of} (or the parity-named {@link provToGraph});
 * it is a snapshot of a transformed *copy* of the document, not a live view.
 */
export class ProvGraph {
  /**
   * The `flattened().unified()` transform the graph was built from — exactly the
   * records the graph indexed. Converters and later lineage layers operate on
   * this, not on the caller's original document (which is never mutated).
   */
  readonly document: ProvDocument;

  /** uri → node. Insertion order is: declared elements (document order), then inferred endpoints as encountered. */
  private readonly _nodes: ReadonlyMap<string, GraphNode>;
  /** Every edge, in document (relation) order — parallel edges included. */
  private readonly _edges: readonly GraphEdge[];
  /** Forward adjacency: source uri → its out-edges. */
  private readonly _outEdges: ReadonlyMap<string, readonly GraphEdge[]>;
  /** Reverse adjacency: target uri → its in-edges. */
  private readonly _inEdges: ReadonlyMap<string, readonly GraphEdge[]>;
  /** Relations that produced no edge, with the reason (never silent). */
  private readonly _skipped: readonly SkippedRelation[];

  private constructor(
    document: ProvDocument,
    nodes: ReadonlyMap<string, GraphNode>,
    edges: readonly GraphEdge[],
    outEdges: ReadonlyMap<string, readonly GraphEdge[]>,
    inEdges: ReadonlyMap<string, readonly GraphEdge[]>,
    skipped: readonly SkippedRelation[],
  ) {
    this.document = document;
    this._nodes = nodes;
    this._edges = edges;
    this._outEdges = outEdges;
    this._inEdges = inEdges;
    this._skipped = skipped;
  }

  /**
   * Builds the graph from `document.flattened().unified(options)` (`graph.py:59`).
   *
   * Every {@link ProvElement} in the transform becomes a node; every relation
   * whose first two formal attributes both resolve to a QName becomes one edge
   * carrying the relation record. Endpoints referenced but never declared become
   * `inferred` nodes; relations missing an endpoint, or referencing an undeclared
   * endpoint through an unmapped attribute, are skipped and recorded in
   * {@link skipped}.
   *
   * @param document The source document (never mutated).
   * @param options  Pass-through to {@link ProvDocument.unified}. Defaults to the
   *   parity `"throw"` policy, so a same-id formal-attribute clash throws exactly
   *   as Python's `unified()` does (consumers with replayed records pass
   *   `"first"`/`"last"`).
   */
  static of(document: ProvDocument, options?: UnifiedOptions): ProvGraph {
    // `flattened()` hoists bundle records to the document level (the divergence
    // from Python, which never sees inside bundles); `unified()` then merges
    // same-id records and always returns a fresh document, so the caller's
    // original is never touched. `unified("throw")` may throw on a genuine
    // same-id conflict — that is deliberate parity with Python (model.py:1681).
    const transformed = document.flattened().unified(options);

    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const outEdges = new Map<string, GraphEdge[]>();
    const inEdges = new Map<string, GraphEdge[]>();
    const skipped: SkippedRelation[] = [];

    for (const element of transformed.getRecords(ProvElement)) {
      // A `ProvElement` constructor rejects a null identifier
      // (element.ts:46-48), so `identifier` is always non-null here.
      const uri = element.identifier!.uri;
      nodes.set(uri, { uri, element, inferred: false });
    }

    for (const relation of transformed.getRecords(ProvRelation)) {
      const [pair1, pair2] = relation.formalAttributes;
      const value1 = pair1?.[1];
      const value2 = pair2?.[1];
      // The first two formal attributes of every relation class are QName-valued
      // (relation.ts), so a present value is a `QualifiedName`; an absent one is
      // `undefined`. A non-QName/absent endpoint is a missing endpoint.
      if (
        pair1 === undefined ||
        pair2 === undefined ||
        !(value1 instanceof QualifiedName) ||
        !(value2 instanceof QualifiedName)
      ) {
        skipped.push({ relation, reason: "missing-endpoint" });
        continue;
      }

      const node1 = resolveEndpoint(nodes, transformed, pair1[0], value1);
      const node2 = resolveEndpoint(nodes, transformed, pair2[0], value2);
      if (node1 === undefined || node2 === undefined) {
        skipped.push({ relation, reason: "unmapped-attribute" });
        continue;
      }

      // Commit any freshly-inferred endpoints (declared/prior-inferred nodes are
      // already present). A self-loop over one undeclared endpoint yields two
      // fresh nodes with the same uri; committing the first wins and the second
      // is discarded — harmless, since edges reference nodes by uri.
      if (!nodes.has(node1.uri)) {
        nodes.set(node1.uri, node1);
      }
      if (!nodes.has(node2.uri)) {
        nodes.set(node2.uri, node2);
      }

      const edge: GraphEdge = {
        from: value1.uri,
        to: value2.uri,
        relation,
      };
      edges.push(edge);
      pushAdjacency(outEdges, edge.from, edge);
      pushAdjacency(inEdges, edge.to, edge);
    }

    return new ProvGraph(transformed, nodes, edges, outEdges, inEdges, skipped);
  }

  /** Every node, in insertion order (declared elements first, then inferred endpoints). */
  get nodes(): GraphNode[] {
    return [...this._nodes.values()];
  }

  /** Every edge, in document (relation) order — parallel edges between the same endpoints are all present. */
  get edges(): readonly GraphEdge[] {
    return this._edges;
  }

  /** The relations that produced no edge, each with its {@link SkipReason} — the observable skip accounting. */
  get skipped(): readonly SkippedRelation[] {
    return this._skipped;
  }

  /** The node for `uri`, or `undefined` if there is none. */
  getNode(uri: string): GraphNode | undefined {
    return this._nodes.get(uri);
  }

  /** Whether a node exists for `uri`. */
  hasNode(uri: string): boolean {
    return this._nodes.has(uri);
  }

  /** Forward adjacency: the edges leaving `uri` (empty if none). "What does X point at?" */
  outEdges(uri: string): readonly GraphEdge[] {
    return this._outEdges.get(uri) ?? [];
  }

  /** Reverse adjacency: the edges entering `uri` (empty if none). "What points at X?" */
  inEdges(uri: string): readonly GraphEdge[] {
    return this._inEdges.get(uri) ?? [];
  }
}

/**
 * Converts a document to a {@link ProvGraph} — the parity-named entry for Python's
 * `prov_to_graph` (`graph.py:59`). Delegates to {@link ProvGraph.of}.
 *
 * @param document The source document (never mutated).
 * @param options  Pass-through to {@link ProvDocument.unified} (default `"throw"`).
 */
export function provToGraph(
  document: ProvDocument,
  options?: UnifiedOptions,
): ProvGraph {
  return ProvGraph.of(document, options);
}

/**
 * Rebuilds a {@link ProvDocument} from a graph — the parity-named entry for
 * Python's `graph_to_prov` (`graph.py:92-113`). Emits every non-inferred node's
 * element and every edge's relation into a fresh document; inferred nodes are
 * skipped (Python's `bundle is not None` guard, `graph.py:103`).
 *
 * Round-tripping `graphToProv(provToGraph(doc))` equals `doc.flattened().unified()`
 * whenever no relation was skipped; when relations were skipped, the result is
 * exactly the transform minus those relations (see {@link ProvGraph.skipped}).
 *
 * @param graph The graph to convert.
 */
export function graphToProv(graph: ProvGraph): ProvDocument {
  const document = new ProvDocument();
  for (const node of graph.nodes) {
    if (!node.inferred) {
      document.addRecord(node.element);
    }
  }
  for (const edge of graph.edges) {
    document.addRecord(edge.relation);
  }
  return document;
}
