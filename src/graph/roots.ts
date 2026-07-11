// Shared root/endpoint resolution for the lineage layer.
//
// Two callers turn a caller-supplied `LineageRoot` into the node-key URIs it
// names: the walk (lineage.ts `normalizeRoots`) and path enumeration (views.ts
// `resolveEndpointUris`). They diverge on what they DO with the result — the
// walk partitions into found roots vs. `unknownRoots`, path enumeration just
// collects endpoints — but the form-by-form resolution (string / QName /
// relation / element) is identical. It lives here once so a new
// `LineageRoot` form is handled by every consumer by construction, rather than
// drifting between two hand-kept copies.
//
// `LineageRoot` is defined here (its natural home is the resolution it feeds)
// and re-exported from lineage.ts, so the public `./graph` barrel is unchanged.

import { QualifiedName } from "../identifier.js";
import { ProvRecord } from "../record/record.js";
import { ProvRelation } from "../record/relation.js";
import type { ProvGraph } from "./graph.js";

/**
 * A lineage root/endpoint: a resolved {@link ProvRecord} (element or relation), a
 * {@link QualifiedName}, or a string (a URI or `prefix:localpart`, resolved
 * against the graph's document the same way `resolve`'s `id` selector is).
 */
export type LineageRoot = ProvRecord | QualifiedName | string;

/** The URIs a {@link LineageRoot} names, plus the raw value of an unresolvable string. */
export type ResolvedRoot = {
  /** The node-key URIs this root resolved to (possibly empty — e.g. a blank relation). */
  readonly uris: readonly string[];
  /**
   * Set only for a string that could not resolve to a qualified name (an
   * unregistered prefix, a blank-node id): there is no URI to key a node by, so
   * the raw string is surfaced for the caller to report. The walk sends it to
   * `unknownRoots`; path enumeration drops it (an unresolvable endpoint yields no
   * paths).
   */
  readonly unresolved?: string;
};

/**
 * Resolves one {@link LineageRoot} to the node-key URIs it names.
 * A relation contributes the URIs of its first two formal-attribute values that
 * are present — an edge is a legal root, seeding the closure from both endpoints.
 * The graph is used only as the qualified-name resolver for string forms; it is
 * never mutated.
 *
 * @internal — shared across the graph layer, not part of the public surface.
 */
export function rootToUris(graph: ProvGraph, root: LineageRoot): ResolvedRoot {
  if (typeof root === "string") {
    const qn = graph.document.validQualifiedName(root);
    return qn === null ? { uris: [], unresolved: root } : { uris: [qn.uri] };
  }
  if (root instanceof ProvRecord) {
    if (root instanceof ProvRelation) {
      const uris: string[] = [];
      for (const value of root.args.slice(0, 2)) {
        if (value instanceof QualifiedName) {
          uris.push(value.uri);
        }
      }
      return { uris };
    }
    // A non-relation record is an element, whose constructor guarantees a
    // non-null identifier (element.ts:46-48).
    const id = root.identifier;
    return { uris: id === null ? [] : [id.uri] };
  }
  // A QualifiedName: its `uri` is already canonical — no namespace resolution.
  return { uris: [root.uri] };
}
