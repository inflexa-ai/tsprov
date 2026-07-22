// The semantic scene projection — `toRenderScene`.
//
// This walks the PROV *document model* the way `prov_to_dot` walks it
// (`reference/prov/src/prov/dot.py:179-409`) and emits a renderer-agnostic,
// JSON-safe `RenderScene`. It deliberately walks the model, NOT `tsprov/graph`:
// `prov_to_dot` recurses into sub-bundles as clusters (dot.py:328-330) and draws
// n-ary legs from `formal_attributes` (dot.py:338-352), both of which `ProvGraph`
// discards (it flattens sub-bundles and binarizes relations). See DEVIATIONS.md.
//
// What the scene deliberately does NOT do (that dot.py does): materialize blank
// nodes for n-ary joins / annotation anchors, and note-box annotation layout —
// those are DOT *presentation* tricks left to a renderer (a Non-Goal this stage).

import {
  Identifier,
  QualifiedName,
  ProvElement,
  ProvRelation,
  ProvEntity,
  ProvActivity,
  ProvAgent,
  ProvException,
  PROV_ATTR_ENTITY,
  PROV_ATTR_ACTIVITY,
  PROV_ATTR_TRIGGER,
  PROV_ATTR_INFORMED,
  PROV_ATTR_INFORMANT,
  PROV_ATTR_STARTER,
  PROV_ATTR_ENDER,
  PROV_ATTR_AGENT,
  PROV_ATTR_PLAN,
  PROV_ATTR_DELEGATE,
  PROV_ATTR_RESPONSIBLE,
  PROV_ATTR_GENERATED_ENTITY,
  PROV_ATTR_USED_ENTITY,
  PROV_ATTR_GENERATION,
  PROV_ATTR_USAGE,
  PROV_ATTR_SPECIFIC_ENTITY,
  PROV_ATTR_GENERAL_ENTITY,
  PROV_ATTR_ALTERNATE1,
  PROV_ATTR_ALTERNATE2,
  PROV_ATTR_BUNDLE,
  PROV_ATTR_INFLUENCEE,
  PROV_ATTR_INFLUENCER,
  PROV_ATTR_COLLECTION,
} from "@inflexa-ai/tsprov";
import type {
  ProvDocument,
  ProvBundle,
  ProvRecord,
  AttrValue,
} from "@inflexa-ai/tsprov";

import { PROV_THEME, type NodeKind, type DeclaredNodeKind, type RelationKind } from "./theme.js";

/**
 * One non-formal attribute carried by a node or edge, reduced to JSON-safe
 * strings. Mirrors the data `dot.py`'s annotation rows are built from
 * (`dot.py:226-240`): the attribute's display name + URI, the value's display
 * string, and — when the value is itself an identifier — its dereferenceable URI.
 */
export type RenderAttr = {
  /** The attribute name's `prefix:localpart` display form. */
  readonly name: string;
  /** The attribute name's URI. */
  readonly nameUri: string;
  /** The value's display string (`String(value)`). */
  readonly value: string;
  /** The value's URI, present only when the value is an identifier/qualified name. */
  readonly valueUri?: string;
};

/**
 * An extra endpoint of an n-ary relation beyond source/target (`dot.py:379-388`).
 * `role` is the formal attribute's local part (the leg label dot.py draws);
 * `target` is the id of the endpoint {@link RenderNode}.
 */
export type NaryLeg = {
  /** The formal attribute local part naming this leg (e.g. `"activity"`). */
  readonly role: string;
  /** The id of the {@link RenderNode} this leg points to. */
  readonly target: string;
};

/**
 * A projected PROV element (or an inferred endpoint) — a graph node. `id`s are
 * `n1`, `n2`… assigned in document order, mirroring `dot.py`'s node counter so a
 * DOT/Mermaid renderer gets identifier-safe, deterministic ids for free.
 */
export type RenderNode = {
  /** Deterministic, identifier-safe node id (`n1`, `n2`, …). */
  readonly id: string;
  /** The element/endpoint kind driving its theme style. */
  readonly kind: NodeKind;
  /** The identifier's `prefix:localpart` display form. */
  readonly qualifiedName: string;
  /** Display text: the identifier, or `prov:label` when `useLabels` is set. */
  readonly label: string;
  /** The identifier's dereferenceable URI. */
  readonly uri?: string;
  /** Non-formal attributes (empty when element attributes are excluded). */
  readonly attributes: readonly RenderAttr[];
  /** The id of the containing {@link RenderBundle}; absent for top-level nodes. */
  readonly bundleId?: string;
  /** `true` when this node was inferred from a relation endpoint, not declared. */
  readonly inferred: boolean;
};

/**
 * A projected PROV relation — a graph edge. `id`s are `e1`, `e2`… in relation
 * processing order. Source/target are the first two formal endpoints; any further
 * formal endpoints become {@link NaryLeg}s when `showNary` is set.
 */
export type RenderEdge = {
  /** Deterministic edge id (`e1`, `e2`, …). */
  readonly id: string;
  /** The relation's `prov:` display form (e.g. `"prov:Derivation"`); the theme key. */
  readonly relation: RelationKind;
  /** The PROV-N relation name (e.g. `"wasDerivedFrom"`), from the theme. */
  readonly label: string;
  /** The id of the source {@link RenderNode} (first formal endpoint). */
  readonly source: string;
  /** The id of the target {@link RenderNode} (second formal endpoint). */
  readonly target: string;
  /** Extra endpoints beyond source/target (empty unless `showNary`). */
  readonly naryLegs: readonly NaryLeg[];
  /** Non-formal attributes (empty when relation attributes are excluded). */
  readonly attributes: readonly RenderAttr[];
};

/**
 * A relation `prov_to_dot` would draw but the scene omits because it has fewer
 * than two resolvable endpoints (`dot.py:354-355`). dot.py drops these with a
 * silent `continue`; the scene records them here instead — the loop forbids silent
 * drops (an observable-skip deviation logged in DEVIATIONS.md).
 */
export type SkippedRelation = {
  /** The relation's `prov:` display form. */
  readonly relation: RelationKind;
  /** The relation's identifier display form, or `null` for an unidentified relation. */
  readonly identifier: string | null;
  /** Why it was skipped. */
  readonly reason: string;
};

/**
 * A projected sub-bundle — a cluster in DOT terms. Its member records' nodes carry
 * this bundle's `id` as their `bundleId` (`dot.py:249-257`).
 */
export type RenderBundle = {
  /** Deterministic bundle id (`c1`, `c2`, …, mirroring dot.py's cluster counter). */
  readonly id: string;
  /** The bundle identifier's display form. */
  readonly label: string;
  /** The bundle identifier's URI. */
  readonly uri?: string;
};

/**
 * The complete renderer-agnostic projection of a PROV document: nodes, edges,
 * sub-bundles, and the observably-skipped relations. JSON-safe plain data by
 * construction (no class instances, no `Map`/`Set`), so a projection round-trips
 * through `JSON.stringify` and two projections of one document are byte-identical.
 */
export type RenderScene = {
  /** Every declared element and inferred endpoint, in document order. */
  readonly nodes: readonly RenderNode[];
  /** Every drawable relation, in processing order. */
  readonly edges: readonly RenderEdge[];
  /** Every sub-bundle, in document order. */
  readonly bundles: readonly RenderBundle[];
  /** Relations omitted from `edges` with the reason (an observable deviation). */
  readonly skipped: readonly SkippedRelation[];
};

/**
 * Projection options, one-to-one with `prov_to_dot`'s behavioral parameters
 * (`dot.py:179-186`); defaults match the reference. Layout `direction` is a
 * presentation concern and lives on {@link PROV_THEME}, not here.
 */
export type SceneOptions = {
  /** Use `prov:label` as a node's display text instead of its identifier (default `false`). */
  readonly useLabels?: boolean;
  /** Include elements' non-formal attributes on their nodes (default `true`). */
  readonly includeElementAttributes?: boolean;
  /** Include relations' non-formal attributes on their edges (default `true`). */
  readonly includeRelationAttributes?: boolean;
  /** Emit extra n-ary endpoints as {@link NaryLeg}s (default `true`). */
  readonly showNary?: boolean;
};

// The QName-valued formal attributes — the endpoint slots of a relation. Mirrors
// the core's `PROV_ATTRIBUTE_QNAMES` (constants.ts:381), rebuilt here from the
// individually-exported QNames because the aggregate set is not on the public
// barrel. `dot.py` filters both endpoint candidates AND "other" (annotation)
// attributes against exactly this set (dot.py:217, :342), so it is the single
// boundary between formal endpoints and displayable attributes. The time-valued
// formal attributes (startTime/endTime/time) are intentionally NOT here — matching
// the reference, they surface as node/edge attributes.
const PROV_ENDPOINT_ATTR_URIS: ReadonlySet<string> = new Set(
  [
    PROV_ATTR_ENTITY,
    PROV_ATTR_ACTIVITY,
    PROV_ATTR_TRIGGER,
    PROV_ATTR_INFORMED,
    PROV_ATTR_INFORMANT,
    PROV_ATTR_STARTER,
    PROV_ATTR_ENDER,
    PROV_ATTR_AGENT,
    PROV_ATTR_PLAN,
    PROV_ATTR_DELEGATE,
    PROV_ATTR_RESPONSIBLE,
    PROV_ATTR_GENERATED_ENTITY,
    PROV_ATTR_USED_ENTITY,
    PROV_ATTR_GENERATION,
    PROV_ATTR_USAGE,
    PROV_ATTR_SPECIFIC_ENTITY,
    PROV_ATTR_GENERAL_ENTITY,
    PROV_ATTR_ALTERNATE1,
    PROV_ATTR_ALTERNATE2,
    PROV_ATTR_BUNDLE,
    PROV_ATTR_INFLUENCEE,
    PROV_ATTR_INFLUENCER,
    PROV_ATTR_COLLECTION,
  ].map((qn) => qn.uri),
);

// The inferred-kind table: attribute URI → the element kind implied by that formal
// attribute's PROV-DM domain. A faithful transcription of `graph.py`'s
// `INFERRED_ELEMENT_CLASS` (graph.py:36-56). Deliberately faithful oddities kept
// verbatim: `prov:ender`/`prov:starter` map to ENTITY (not activity) exactly as the
// reference does; `prov:generation`/`prov:usage` and `prov:influencee`/
// `prov:influencer` are ABSENT — an inferred endpoint on those legs is `unknown`
// (in graph.py the missing key skips the relation; dot.py falls back to the generic
// node — we mirror dot.py's tolerance and style it generic).
const INFERRED_KIND_BY_ATTR: ReadonlyMap<string, DeclaredNodeKind> = new Map<
  string,
  DeclaredNodeKind
>([
  [PROV_ATTR_ENTITY.uri, "entity"],
  [PROV_ATTR_ACTIVITY.uri, "activity"],
  [PROV_ATTR_AGENT.uri, "agent"],
  [PROV_ATTR_TRIGGER.uri, "entity"],
  [PROV_ATTR_GENERATED_ENTITY.uri, "entity"],
  [PROV_ATTR_USED_ENTITY.uri, "entity"],
  [PROV_ATTR_DELEGATE.uri, "agent"],
  [PROV_ATTR_RESPONSIBLE.uri, "agent"],
  [PROV_ATTR_SPECIFIC_ENTITY.uri, "entity"],
  [PROV_ATTR_GENERAL_ENTITY.uri, "entity"],
  [PROV_ATTR_ALTERNATE1.uri, "entity"],
  [PROV_ATTR_ALTERNATE2.uri, "entity"],
  [PROV_ATTR_COLLECTION.uri, "entity"],
  [PROV_ATTR_INFORMED.uri, "activity"],
  [PROV_ATTR_INFORMANT.uri, "activity"],
  [PROV_ATTR_BUNDLE.uri, "bundle"],
  [PROV_ATTR_PLAN.uri, "entity"],
  [PROV_ATTR_ENDER.uri, "entity"],
  [PROV_ATTR_STARTER.uri, "entity"],
]);

/** The declared-element kind of an element record; `unknown` is unreachable for well-formed elements. */
function elementKind(element: ProvElement): NodeKind {
  if (element instanceof ProvEntity) return "entity";
  if (element instanceof ProvActivity) return "activity";
  if (element instanceof ProvAgent) return "agent";
  // ProvElement has exactly three concrete subclasses; anything else is a future
  // element kind with no theme entry yet.
  return "unknown";
}

/** Stringifies an attribute value into a JSON-safe display string (mirrors `str(value)`). */
function attrValueToString(value: AttrValue): string {
  return String(value);
}

/** Builds a {@link RenderAttr} from a formal/non-formal attribute pair. */
function toRenderAttr(name: QualifiedName, value: AttrValue): RenderAttr {
  const attr: RenderAttr = {
    name: String(name),
    nameUri: name.uri,
    value: attrValueToString(value),
  };
  // `dot.py:232` links the value cell when the value is an `Identifier`
  // (`QualifiedName` is a subclass), exposing its URI as an href.
  if (value instanceof Identifier) {
    return { ...attr, valueUri: value.uri };
  }
  return attr;
}

/** The non-formal attributes of a record as {@link RenderAttr}s, in record (insertion) order. */
function nonFormalAttrs(record: ProvRecord): RenderAttr[] {
  // Insertion order is deterministic per document; dot.py's presentational
  // `sorted_attributes` re-ordering (dot.py:224) is a renderer concern, not scene
  // data — so the scene preserves the record's own order.
  return record.attributes
    .filter(([name]) => !PROV_ENDPOINT_ATTR_URIS.has(name.uri))
    .map(([name, value]) => toRenderAttr(name, value));
}

/**
 * Projects a PROV document into a renderer-agnostic {@link RenderScene}.
 *
 * The walk mirrors `prov_to_dot` (`dot.py:179-409`): it calls `doc.unified()` and
 * falls back to the original document if unification throws (dot.py:401-408); adds
 * a node per declared element; recurses into sub-bundles as {@link RenderBundle}s
 * (dot.py:328-330); then, per relation, resolves the first two formal endpoints as
 * source/target and the rest as n-ary legs (dot.py:338-352), inferring undeclared
 * endpoints as nodes. Relations with fewer than two resolvable endpoints are
 * recorded in `skipped` rather than drawn (dot.py:354-355, made observable).
 *
 * The input document is never mutated. Two projections of one document are
 * byte-identical when `JSON.stringify`d.
 *
 * @param doc     The document to project.
 * @param options Behavioral toggles; defaults match `prov_to_dot`.
 * @returns The scene.
 */
export function toRenderScene(
  doc: ProvDocument,
  options?: SceneOptions,
): RenderScene {
  const useLabels = options?.useLabels ?? false;
  const includeElementAttributes = options?.includeElementAttributes ?? true;
  const includeRelationAttributes = options?.includeRelationAttributes ?? true;
  const showNary = options?.showNary ?? true;

  const nodes: RenderNode[] = [];
  const edges: RenderEdge[] = [];
  const bundles: RenderBundle[] = [];
  const skipped: SkippedRelation[] = [];

  // uri → node id. Shared across the whole document (including sub-bundles),
  // exactly like dot.py's single `node_map` closure (dot.py:208): an endpoint that
  // matches any already-added node reuses it; only a truly undeclared endpoint
  // mints an inferred node.
  const nodeIdByUri = new Map<string, string>();
  const counters = { node: 0, edge: 0, bundle: 0 };

  function addElementNode(element: ProvElement, bundleId?: string): void {
    const identifier = element.identifier;
    // ProvElement's constructor rejects a null identifier (element.ts:46), so a
    // declared element always has one; this guard documents that invariant.
    if (identifier === null) return;
    counters.node += 1;
    const id = `n${counters.node}`;
    const node: RenderNode = {
      id,
      kind: elementKind(element),
      qualifiedName: String(identifier),
      label: useLabels ? element.label : String(identifier),
      uri: identifier.uri,
      attributes: includeElementAttributes ? nonFormalAttrs(element) : [],
      inferred: false,
    };
    nodeIdByUri.set(identifier.uri, id);
    nodes.push(bundleId === undefined ? node : { ...node, bundleId });
  }

  /** Resolves an endpoint QName to a node id, minting an inferred node on first sight. */
  function endpointNodeId(
    qname: QualifiedName,
    attrUri: string,
    bundleId?: string,
  ): string {
    const existing = nodeIdByUri.get(qname.uri);
    if (existing !== undefined) return existing;
    counters.node += 1;
    const id = `n${counters.node}`;
    const kind: NodeKind = INFERRED_KIND_BY_ATTR.get(attrUri) ?? "unknown";
    const node: RenderNode = {
      id,
      kind,
      qualifiedName: String(qname),
      label: String(qname),
      uri: qname.uri,
      attributes: [],
      inferred: true,
    };
    nodeIdByUri.set(qname.uri, id);
    nodes.push(bundleId === undefined ? node : { ...node, bundleId });
    return id;
  }

  function processRelation(relation: ProvRelation, bundleId?: string): void {
    // `relation` is one of the 15 concrete ProvRelation subclasses; the record
    // registry is closed (no extension mechanism), and each subclass returns a fixed
    // `prov:`-prefixed type QName whose String() form is exactly a RelationKind key.
    // A new relation subclass upstream would first have to gain a PROV_THEME.relations
    // entry to type-check, so this assertion cannot silently produce a non-key.
    const relationKind = String(relation.getType()) as RelationKind;
    const identifierDisplay =
      relation.identifier === null ? null : String(relation.identifier);

    // The QName-valued formal endpoints, in FORMAL_ATTRIBUTES order (dot.py:338-344).
    const endpointPairs = relation.formalAttributes.filter(([name]) =>
      PROV_ENDPOINT_ATTR_URIS.has(name.uri),
    );

    // dot.py:335 skips a record whose formal-attribute list is empty; dot.py:354
    // skips one with fewer than two endpoint slots — neither is drawable.
    if (endpointPairs.length < 2) {
      skipped.push({
        relation: relationKind,
        identifier: identifierDisplay,
        reason: "relation has fewer than two formal endpoints",
      });
      return;
    }

    const sourcePair = endpointPairs[0];
    const targetPair = endpointPairs[1];
    // `endpointPairs.length >= 2` guarantees both are present; the guard satisfies
    // `noUncheckedIndexedAccess` without a non-null assertion.
    if (sourcePair === undefined || targetPair === undefined) return;

    const sourceQn =
      sourcePair[1] instanceof QualifiedName ? sourcePair[1] : null;
    const targetQn =
      targetPair[1] instanceof QualifiedName ? targetPair[1] : null;
    // An unset (or non-QName) source/target is an unresolved endpoint. dot.py draws
    // it via a blank node; the scene forbids blank nodes (a presentation trick), so
    // the edge is unrepresentable and skipped observably.
    if (sourceQn === null || targetQn === null) {
      skipped.push({
        relation: relationKind,
        identifier: identifierDisplay,
        reason: "relation has fewer than two resolvable endpoints",
      });
      return;
    }

    // Source before target so inferred-node ids increment in dot.py's order.
    const source = endpointNodeId(sourceQn, sourcePair[0].uri, bundleId);
    const target = endpointNodeId(targetQn, targetPair[0].uri, bundleId);

    const naryLegs: NaryLeg[] = [];
    if (showNary) {
      for (const [name, value] of endpointPairs.slice(2)) {
        // dot.py:382 only draws a leg whose endpoint is set.
        if (value instanceof QualifiedName) {
          naryLegs.push({
            role: name.localpart,
            target: endpointNodeId(value, name.uri, bundleId),
          });
        }
      }
    }

    // `relationKind: RelationKind` keys the theme's exhaustive relation record, so
    // the lookup is total — every relation resolves to a style, hence a label.
    const style = PROV_THEME.relations[relationKind];
    counters.edge += 1;
    edges.push({
      id: `e${counters.edge}`,
      relation: relationKind,
      label: style.label,
      source,
      target,
      naryLegs,
      attributes: includeRelationAttributes ? nonFormalAttrs(relation) : [],
    });
  }

  function walk(container: ProvBundle, bundleId?: string): void {
    const relations: ProvRelation[] = [];
    // Elements first (nodes n1…nk in record order), relations deferred — dot.py's
    // exact two-pass over `get_records()` (dot.py:319-326).
    for (const record of container.getRecords()) {
      if (record instanceof ProvElement) {
        addElementNode(record, bundleId);
      } else if (record instanceof ProvRelation) {
        relations.push(record);
      }
    }

    // Only a document (not a plain bundle) holds sub-bundles; recurse into each as a
    // cluster before this container's relations, matching dot.py:328-330 ordering.
    if (container.isDocument()) {
      for (const sub of container.bundles) {
        counters.bundle += 1;
        const subId = `c${counters.bundle}`;
        const subIdentifier = sub.identifier;
        bundles.push(
          subIdentifier === null
            ? { id: subId, label: "", uri: undefined }
            : { id: subId, label: String(subIdentifier), uri: subIdentifier.uri },
        );
        walk(sub, subId);
      }
    }

    for (const relation of relations) {
      processRelation(relation, bundleId);
    }
  }

  let root: ProvDocument;
  try {
    root = doc.unified();
  } catch (error) {
    // dot.py:403 catches only `ProvException` and renders the original; any other
    // failure is a real bug and must propagate.
    if (!(error instanceof ProvException)) throw error;
    root = doc;
  }

  walk(root);

  return { nodes, edges, bundles, skipped };
}
