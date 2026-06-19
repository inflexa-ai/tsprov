// PROV identifiers: `Identifier`, `QualifiedName`, and `Namespace`.
//
// Port of `reference/prov/src/prov/identifier.py`. The single most important
// thing this module gets right is *value equality*: Python keys its dicts and
// sets on `__hash__`/`__eq__`, whereas JS `Map`/`Set` key by reference. Every
// value type here therefore exposes:
//   - `equals(other)` — structural equality, mirroring Python `__eq__`.
//   - `key`          — a canonical string that reproduces the exact Python
//                      `__hash__` inputs, for use as a `Map`/`Set` key.
//
// The deliberate Python asymmetry we preserve (see 04-typescript-feasibility §3.1):
//   - `QualifiedName` identity is by URI only — the prefix is irrelevant
//     (`identifier.py:99-100`, `__hash__ = hash(uri)`).
//   - `Namespace` identity includes the prefix
//     (`identifier.py:165-180`, `__hash__ = hash((uri, prefix))`).
//   - `Identifier` identity folds the *class* into the hash
//     (`identifier.py:38-39`, `__hash__ = hash((uri, class))`), so an
//     `Identifier` and a `QualifiedName` with the same URI are `equals()` yet
//     occupy distinct `key`s — exactly as they occupy distinct dict slots in
//     CPython.

/**
 * A `prefix:localpart` (or bare `localpart`) display form, branded so it cannot
 * be confused with an arbitrary string at the type level.
 */
export type QNameString = string & { readonly __qname: unique symbol };

/**
 * Base class for all identifiers; also represents an `xsd:anyURI` value.
 *
 * Mirrors `Identifier` (`identifier.py:8`). Equality is by `uri` only and
 * returns `false` for non-identifiers (`identifier.py:35-36`).
 */
export class Identifier {
  /** The URI string. Read-only, like the Python `uri` property. */
  readonly uri: string;

  /** @param uri The URI string; coerced via `String()` to mirror Python's `str(uri)`. */
  constructor(uri: string) {
    this.uri = String(uri); // ensure a string, matching `str(uri)` (identifier.py:20)
  }

  /** Returns the URI, mirroring Python `__str__` (`identifier.py:32-33`). */
  toString(): string {
    return this.uri;
  }

  /** Mirrors `Identifier.__eq__`: same identifier family and URI-equal. */
  equals(other: unknown): boolean {
    return other instanceof Identifier && other.uri === this.uri;
  }

  /**
   * Canonical key reproducing `Identifier.__hash__ = hash((uri, class))`
   * (`identifier.py:38-39`) — the class IS part of the key, so a plain
   * `Identifier` never shares a key with a `QualifiedName` of the same URI.
   */
  get key(): string {
    return `I\u0000${this.uri}`;
  }

  /** PROV-N representation of an `xsd:anyURI` (`identifier.py:44-51`). */
  provnRepresentation(): string {
    return `"${this.uri}" %% xsd:anyURI`;
  }
}

/**
 * A {@link https://www.w3.org/TR/prov-dm/#concept-qualifiedName | qualified name}:
 * a {@link Namespace} plus a local part.
 *
 * Mirrors `QualifiedName` (`identifier.py:54`). Note it extends `Identifier`,
 * so it inherits the URI-based `equals`; only the `key` (and display/PROV-N
 * forms) are overridden.
 */
export class QualifiedName extends Identifier {
  /** The {@link Namespace} this qualified name belongs to. */
  readonly namespace: Namespace;
  /** The local part — the portion of the name after the namespace URI. */
  readonly localpart: string;
  /** Precomputed `prefix:localpart` (or bare `localpart`) display form. */
  private readonly _display: QNameString;

  /**
   * @param namespace The owning namespace (supplies the prefix and base URI).
   * @param localpart The local part appended to the namespace URI.
   */
  constructor(namespace: Namespace, localpart: string) {
    super(namespace.uri + localpart); // identifier.py:76
    this.namespace = namespace;
    this.localpart = localpart;
    // `prefix:localpart`, or bare `localpart` when the prefix is empty
    // (identifier.py:79-81).
    this._display = (
      namespace.prefix ? `${namespace.prefix}:${localpart}` : localpart
    ) as QNameString;
  }

  /** Returns the `prefix:localpart` display form (`identifier.py:93-94`). */
  override toString(): QNameString {
    return this._display;
  }

  /**
   * Canonical key reproducing `QualifiedName.__hash__ = hash(uri)`
   * (`identifier.py:99-100`) — the class is dropped, so the key is simply the
   * URI and the prefix is irrelevant. This is the crux of QName value equality.
   */
  override get key(): string {
    return this.uri;
  }

  /** PROV-N representation of a qualified name (`identifier.py:102-104`). */
  override provnRepresentation(): string {
    return `'${this._display}'`;
  }
}

/** A PROV namespace: a `prefix` bound to a base `uri`. Mirrors `Namespace` (`identifier.py:107`). */
export class Namespace {
  /** The short prefix bound to this namespace (e.g. `prov`, `xsd`). */
  readonly prefix: string;
  /** The base URI this namespace expands to. */
  readonly uri: string;
  /** Per-instance memoization of `qn(localpart)`, like the Python `_cache` (`identifier.py:121`). */
  private readonly _cache = new Map<string, QualifiedName>();

  /**
   * @param prefix Short prefix for the namespace (may be empty for a default namespace).
   * @param uri    Base URI; must be non-empty and not whitespace-only.
   * @throws {Error} If `uri` is empty or whitespace-only (`identifier.py:117`).
   */
  constructor(prefix: string, uri: string) {
    if (!uri || /^\s*$/.test(uri)) {
      // Matches `not uri or uri.isspace()` (identifier.py:117).
      throw new Error("Not a valid URI to create a namespace.");
    }
    this.prefix = prefix;
    this.uri = uri;
  }

  /**
   * Returns the qualified name for `localpart` in this namespace, memoized.
   *
   * Replaces Python's `__getitem__` (`identifier.py:185-191`), so that
   * `ns.qn('Entity') === ns.qn('Entity')` for a single namespace instance.
   */
  qn(localpart: string): QualifiedName {
    let q = this._cache.get(localpart);
    if (q === undefined) {
      q = new QualifiedName(this, localpart);
      this._cache.set(localpart, q);
    }
    return q;
  }

  /** True iff `identifier`'s URI starts with this namespace's URI (`identifier.py:133-145`). */
  contains(identifier: string | Identifier): boolean {
    const uri = identifier instanceof Identifier ? identifier.uri : identifier;
    return uri != null && uri.startsWith(this.uri);
  }

  /**
   * Reverse lookup: resolves a full URI back to a {@link QualifiedName} in this
   * namespace, or `null` if it does not belong here (`identifier.py:147-163`).
   */
  qname(identifier: string | Identifier): QualifiedName | null {
    const uri = identifier instanceof Identifier ? identifier.uri : identifier;
    return uri != null && uri.startsWith(this.uri)
      ? this.qn(uri.slice(this.uri.length))
      : null;
  }

  /** Namespace identity INCLUDES the prefix (`identifier.py:165-180`) — deliberately unlike QName. */
  equals(other: unknown): boolean {
    return (
      other instanceof Namespace &&
      other.uri === this.uri &&
      other.prefix === this.prefix
    );
  }

  /** Canonical key reproducing `Namespace.__hash__ = hash((uri, prefix))` (`identifier.py:179-180`). */
  get key(): string {
    return `${this.prefix}\u0000${this.uri}`;
  }
}
