// Global intern tables for `Namespace` and `QualifiedName`.
//
// Python relies on per-`Namespace` memoization (`identifier.py:185-191`) so that
// `PROV['Entity'] is PROV['Entity']`. We go one better with a *process-global*
// intern keyed by the canonical string `key`: equal namespaces/QNames become the
// same object, so hot paths may use `===` and constants (`PROV_ENTITY`, …) are
// guaranteed singletons.
//
// This is the single best leverage point for the value-equality problem (see
// 04-typescript-feasibility §6). It stays `sideEffects: false`-safe because the
// tables are mutated only lazily, when these functions are actually called.

import { Namespace, QualifiedName } from "./identifier";

/** Canonical `Namespace.key` (`prefix\u0000uri`) → the one interned instance. */
const namespaces = new Map<string, Namespace>();

/** Canonical `QualifiedName.key` (the bare URI) → the one interned instance. */
const qnames = new Map<string, QualifiedName>();

/**
 * Returns the canonical {@link Namespace} for `(prefix, uri)`, creating it once
 * and reusing it thereafter. Two calls with the same prefix and URI return the
 * exact same object (`===`), reproducing Python's per-namespace identity while
 * adding global sharing.
 *
 * @param prefix Short prefix for the namespace (may be empty for a default namespace).
 * @param uri    Base URI; must be non-empty (validated by the `Namespace` constructor).
 * @returns The interned namespace instance.
 */
export function internNamespace(prefix: string, uri: string): Namespace {
  const key = `${prefix}\u0000${uri}`;
  let n = namespaces.get(key);
  if (n === undefined) {
    n = new Namespace(prefix, uri);
    namespaces.set(key, n);
  }
  return n;
}

/**
 * Convenience alias for {@link internNamespace}, used when declaring namespace
 * constants (e.g. `const PROV = ns("prov", "http://www.w3.org/ns/prov#")`).
 *
 * @param prefix Short prefix for the namespace.
 * @param uri    Base URI for the namespace.
 * @returns The interned namespace instance.
 */
export function ns(prefix: string, uri: string): Namespace {
  return internNamespace(prefix, uri);
}

/**
 * Interns a {@link QualifiedName} by its URI so that equal QNames are `===`.
 *
 * Unlike {@link Namespace.qn} (which memoizes per namespace and so preserves
 * each namespace's display prefix), this unifies QNames produced from *different*
 * namespace instances that share a URI. The first instance seen for a given URI
 * wins; pass QNames through this only where reference-identity matters more than
 * the display prefix (e.g. URI-keyed lookup maps).
 *
 * @param qn The qualified name to intern.
 * @returns The canonical instance for `qn.uri` — `qn` itself if it was the first seen.
 */
export function internQName(qn: QualifiedName): QualifiedName {
  const existing = qnames.get(qn.uri);
  if (existing !== undefined) {
    return existing;
  }
  qnames.set(qn.uri, qn);
  return qn;
}
