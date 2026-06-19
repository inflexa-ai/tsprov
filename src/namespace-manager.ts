// `NamespaceManager` — prefix/URI resolution for documents and bundles.
//
// Port of `NamespaceManager` (model.py:1127). Python subclasses `dict` (the
// prefix→Namespace map) AND carries side registries; we **compose** instead: an
// internal `prefixes` map plays the dict role, alongside the URI/rename side-maps
// (04 §5). Maps that Python keys on a `Namespace` object are keyed here by
// `Namespace.key` (JS keys by reference).
//
// `add_namespace` may return a DIFFERENT namespace than passed (URI dedup or a
// prefix rename), so callers MUST use the return value (`model.py:1203`, risk
// register). `valid_qualified_name` is the precedence resolver the whole
// authoring API depends on.

import { Namespace, QualifiedName, Identifier } from "./identifier.js";
import type { QualifiedNameCandidate } from "./record/record.js";
import { PROV, XSD, XSI } from "./constants.js";

/** The namespaces every manager starts with (`DEFAULT_NAMESPACES`, `model.py:1121`). */
const DEFAULT_NAMESPACES: ReadonlyArray<readonly [string, Namespace]> = [
  ["prov", PROV],
  ["xsd", XSD],
  ["xsi", XSI],
];

/** Namespaces to add: a `{prefix: uri}` object or an iterable of {@link Namespace}. */
export type NamespaceCollection = Record<string, string> | Iterable<Namespace>;

/** Manages namespace prefixes and qualified-name resolution (`model.py:1127`). */
export class NamespaceManager {
  /** The prefix→namespace map (the Python `dict` role); seeded with the defaults. */
  private readonly prefixes = new Map<string, Namespace>();
  /** User-registered namespaces only (excludes the defaults) — `model.py:1151`. */
  private readonly userNamespaces = new Map<string, Namespace>();
  /** uri → namespace, for URI-based dedup. */
  private readonly uriMap = new Map<string, Namespace>();
  /** `Namespace.key` of an added namespace → the effective namespace it was mapped to. */
  private readonly renameMap = new Map<string, Namespace>();
  /** Original prefix → the renamed/deduped namespace. */
  private readonly prefixRenamedMap = new Map<string, Namespace>();
  private _default: Namespace | null = null;
  private anonIdCount = 0;
  /**
   * Parent manager (a bundle's parent document), consulted when local resolution
   * fails. Mutable: `ProvDocument.addBundle` re-links an added bundle's parent.
   */
  parent: NamespaceManager | null;

  /**
   * @param namespaces Optional namespaces to add.
   * @param defaultUri Optional default-namespace URI.
   * @param parent     Optional parent manager for delegated resolution.
   */
  constructor(
    namespaces?: NamespaceCollection | null,
    defaultUri?: string | null,
    parent?: NamespaceManager | null,
  ) {
    for (const [prefix, ns] of DEFAULT_NAMESPACES) {
      this.prefixes.set(prefix, ns);
    }
    if (defaultUri != null) {
      this.setDefaultNamespace(defaultUri);
    }
    this.parent = parent ?? null;
    if (namespaces != null) {
      this.addNamespaces(namespaces);
    }
  }

  /** Returns the registered namespace with the given URI, or `null` (`model.py:1166`). */
  getNamespace(uri: string): Namespace | null {
    for (const ns of this.prefixes.values()) {
      if (ns.uri === uri) {
        return ns;
      }
    }
    return null;
  }

  /** All user-registered namespaces (excludes the defaults) (`model.py:1178`). */
  getRegisteredNamespaces(): Namespace[] {
    return [...this.userNamespaces.values()];
  }

  /** Sets the default namespace to one with the given URI (`model.py:1186`). */
  setDefaultNamespace(uri: string): void {
    this._default = new Namespace("", uri);
    this.prefixes.set("", this._default);
  }

  /** The current default namespace, or `null` (`model.py:1195`). */
  getDefaultNamespace(): Namespace | null {
    return this._default;
  }

  /**
   * Registers a namespace, returning the **effective** namespace — which may
   * differ from the argument due to URI dedup or a prefix rename (`model.py:1203`).
   * Callers must use the returned value.
   *
   * @param namespace The namespace to add.
   * @returns The effective (possibly substituted) namespace.
   */
  addNamespace(namespace: Namespace): Namespace {
    for (const existing of this.prefixes.values()) {
      if (existing.equals(namespace)) {
        return namespace; // already present (by value) — return the argument
      }
    }
    const renamed = this.renameMap.get(namespace.key);
    if (renamed !== undefined) {
      return renamed; // already renamed and added
    }

    const uri = namespace.uri;
    let prefix = namespace.prefix;

    const existingByUri = this.uriMap.get(uri);
    if (existingByUri !== undefined) {
      // The URI is already defined under another prefix — reuse it.
      this.renameMap.set(namespace.key, existingByUri);
      this.prefixRenamedMap.set(prefix, existingByUri);
      return existingByUri;
    }

    let effective = namespace;
    if (this.prefixes.has(prefix)) {
      // Conflicting prefix — mint a fresh one.
      const newPrefix = this.getUnusedPrefix(prefix);
      const renamedNs = new Namespace(newPrefix, uri);
      this.renameMap.set(namespace.key, renamedNs);
      this.prefixRenamedMap.set(prefix, renamedNs);
      prefix = newPrefix;
      effective = renamedNs;
    }

    this.userNamespaces.set(prefix, effective);
    this.prefixes.set(prefix, effective);
    this.uriMap.set(uri, effective);
    return effective;
  }

  /** Adds multiple namespaces — a `{prefix: uri}` object or an iterable (`model.py:1245`). */
  addNamespaces(namespaces: NamespaceCollection): void {
    // A plain object is not iterable; an array/Set of Namespace is.
    const list: Namespace[] =
      Symbol.iterator in Object(namespaces)
        ? [...(namespaces as Iterable<Namespace>)]
        : Object.entries(namespaces as Record<string, string>).map(
            ([prefix, uri]) => new Namespace(prefix, uri),
          );
    for (const ns of list) {
      this.addNamespace(ns);
    }
  }

  /**
   * Resolves a candidate to a valid {@link QualifiedName}, registering any new
   * namespace as a side effect, or returns `null` on failure. The precedence
   * ladder (`model.py:1262`): a `QualifiedName` re-homes its namespace into this
   * manager; a `prefix:local` string resolves against registered/renamed
   * prefixes, else URI compaction; a bare string uses the default namespace;
   * finally the parent is consulted.
   *
   * @param qname A {@link QualifiedName}, a `prefix:local` string, or an Identifier.
   * @returns The resolved qualified name, or `null`.
   */
  validQualifiedName(
    qname: QualifiedNameCandidate | null | undefined,
  ): QualifiedName | null {
    if (qname === null || qname === undefined || qname === "") {
      return null;
    }

    if (qname instanceof QualifiedName) {
      const namespace = qname.namespace;
      const prefix = namespace.prefix;
      const localPart = qname.localpart;

      if (!prefix) {
        // Default (prefix-less) namespace.
        if (this._default !== null && this._default.equals(namespace)) {
          return this._default.qn(localPart);
        }
        if (this._default === null) {
          this._default = namespace;
          return qname; // reuse the given namespace as the default
        }
        // A different default already exists — re-home under a 'dn' prefix.
        const dnNamespace = this.addNamespace(new Namespace("dn", namespace.uri));
        return dnNamespace.qn(localPart);
      }

      const existing = this.prefixes.get(prefix);
      if (existing !== undefined && existing.equals(namespace)) {
        // Same prefix already mapped to an equal namespace.
        return existing === namespace ? qname : existing.qn(localPart);
      }
      // Re-home a copy so we never share the caller's namespace object.
      const ns = this.addNamespace(
        new Namespace(namespace.prefix, namespace.uri),
      );
      return ns.qn(qname.localpart);
    }

    if (!(typeof qname === "string" || qname instanceof Identifier)) {
      return null;
    }
    const strValue = qname instanceof Identifier ? qname.uri : qname;

    if (strValue.startsWith("_:")) {
      return null; // blank node id
    }

    if (strValue.includes(":")) {
      const idx = strValue.indexOf(":");
      const prefix = strValue.slice(0, idx);
      const localPart = strValue.slice(idx + 1);
      const registered = this.prefixes.get(prefix);
      if (registered !== undefined) {
        return registered.qn(localPart);
      }
      const renamed = this.prefixRenamedMap.get(prefix);
      if (renamed !== undefined) {
        return renamed.qn(localPart);
      }
      // Treat it as a URI and try compacting against a registered namespace.
      for (const namespace of this.prefixes.values()) {
        if (strValue.startsWith(namespace.uri)) {
          return namespace.qn(strValue.replaceAll(namespace.uri, ""));
        }
      }
    } else if (this._default !== null && typeof qname === "string") {
      // No colon and a default namespace is defined.
      return this._default.qn(qname);
    }

    if (this.parent !== null) {
      return this.parent.validQualifiedName(qname);
    }
    return null;
  }

  /** Returns a fresh anonymous (blank-node) identifier like `_:id1` (`model.py:1350`). */
  getAnonymousIdentifier(localPrefix = "id"): Identifier {
    this.anonIdCount += 1;
    return new Identifier(`_:${localPrefix}${this.anonIdCount}`);
  }

  /** Finds an unused prefix, appending `_1`, `_2`, … on conflict (`model.py:1361`). */
  private getUnusedPrefix(originalPrefix: string): string {
    if (!this.prefixes.has(originalPrefix)) {
      return originalPrefix;
    }
    let count = 1;
    for (;;) {
      const candidate = `${originalPrefix}_${count}`;
      if (this.prefixes.has(candidate)) {
        count += 1;
      } else {
        return candidate;
      }
    }
  }
}
