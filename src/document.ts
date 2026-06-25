// `ProvDocument` — the top-level PROV container.
//
// Port of `ProvDocument` (model.py:2500). Extends `ProvBundle` with sub-bundle
// support: a document holds document-level records plus named child bundles, and
// child bundles inherit the document's namespaces (their `NamespaceManager`'s
// parent is the document's).

import { ProvBundle } from "./bundle.js";
import type { ProvRecord, QualifiedNameCandidate } from "./record/record.js";
import type { QualifiedName } from "./identifier.js";
import type { NamespaceCollection } from "./namespace-manager.js";
import { ProvException } from "./error.js";
import { getSerializer } from "./serializers/serializer.js";
import type { ProvFormat } from "./serializers/serializer.js";
// Side-effect import: registers the core PROV-N serializer.
import "./serializers/provn.js";

/** A PROV document: document-level records plus named sub-bundles (`model.py:2500`). */
export class ProvDocument extends ProvBundle {
  /** `bundle.identifier.uri` → child bundle (`model.py:2518`). */
  private readonly _bundles = new Map<string, ProvBundle>();

  /**
   * @param records    Optional document-level records.
   * @param namespaces Optional namespaces to register.
   */
  constructor(
    records?: Iterable<ProvRecord> | null,
    namespaces?: NamespaceCollection | null,
  ) {
    super(records ?? null, null, namespaces ?? null, null);
  }

  override isDocument(): this is ProvDocument {
    return true;
  }

  /** Renders each child bundle's PROV-N, nested one indent level in (`model.py:1610`). */
  protected override subBundleProvN(indentLevel: number): string[] {
    return [...this._bundles.values()].map((bundle) =>
      bundle.getProvN(indentLevel),
    );
  }

  /**
   * Serializes the document in the given format (`model.py:2707`).
   *
   * @param format Registered format name (default `"json"`); built-ins autocomplete.
   * @returns The serialized text.
   * @throws {DoNotExist} If the format has no registered serializer.
   */
  serialize(format: ProvFormat = "json"): string {
    const result = getSerializer(format).serialize(this);
    return typeof result === "string"
      ? result
      : new TextDecoder().decode(result);
  }

  /**
   * Deserializes input in the given format into a new document (`model.py:2752`).
   *
   * @param input  The serialized input.
   * @param format Registered format name (default `"json"`); built-ins autocomplete.
   * @returns The parsed document.
   * @throws {DoNotExist} If the format has no registered serializer.
   * @throws {UnsupportedOperationError} For serialize-only formats (e.g. PROV-N).
   */
  static deserialize(
    input: string | Uint8Array,
    format: ProvFormat = "json",
  ): ProvDocument {
    return getSerializer(format).deserialize(input);
  }

  override isBundle(): boolean {
    return false;
  }

  override hasBundles(): boolean {
    return this._bundles.size > 0;
  }

  /** The child bundles contained in this document (`model.py:2565`). */
  get bundles(): ProvBundle[] {
    return [...this._bundles.values()];
  }

  /**
   * Creates and registers a new named child bundle (`model.py:2684`). The child
   * inherits this document's namespaces via its parent NamespaceManager.
   *
   * @param identifier The bundle identifier (required).
   * @returns The new child bundle.
   * @throws {ProvException} If the identifier is missing, invalid, or already used.
   */
  bundle(identifier: QualifiedNameCandidate): ProvBundle {
    if (identifier === null || identifier === undefined) {
      throw new ProvException(
        "An identifier is required. Cannot create an unnamed bundle.",
      );
    }
    const validId = this.validQualifiedName(identifier);
    if (validId === null) {
      throw new ProvException(
        `The provided identifier "${String(identifier)}" is not valid`,
      );
    }
    if (this._bundles.has(validId.uri)) {
      throw new ProvException("A bundle with that identifier already exists");
    }
    const child = new ProvBundle(null, validId, null, this);
    this._bundles.set(validId.uri, child);
    return child;
  }

  /**
   * Flattens the document, moving every bundle's records up to the document
   * level (`model.py:2575`). Returns a **new** document when there are bundles;
   * otherwise returns `this` unchanged (a deliberate Python quirk — DEVIATIONS).
   */
  flattened(): ProvDocument {
    if (this._bundles.size === 0) {
      return this;
    }
    const flat = new ProvDocument();
    const records: ProvRecord[] = [...this._records];
    for (const bundle of this._bundles.values()) {
      records.push(...bundle.getRecords());
    }
    for (const record of records) {
      flat.addRecord(record);
    }
    return flat;
  }

  /**
   * Adds an existing bundle to this document, rewriting its identifier and
   * linking its namespaces to the document's (`model.py:2637`). A document with
   * no nested bundles is converted to a plain bundle first.
   *
   * @param bundle     The bundle to add.
   * @param identifier Optional identifier; defaults to the bundle's own.
   * @throws {ProvException} On a nested-bundle document, a missing identifier, or a duplicate.
   */
  addBundle(bundle: ProvBundle, identifier?: QualifiedName | null): void {
    let b = bundle;
    if (b.isDocument()) {
      if (b.hasBundles()) {
        throw new ProvException(
          "Cannot add a document with nested bundles as a bundle.",
        );
      }
      const plain = new ProvBundle(null, null, b.namespaces);
      plain.update(b);
      b = plain;
    }
    const id = identifier ?? b.identifier;
    if (id === null || id === undefined) {
      throw new ProvException("The provided bundle has no identifier");
    }
    // Link the bundle's namespaces to this document's, then resolve the id with
    // the parent in place (model.py:2672-2676).
    b._setNamespaceParent(this._namespaces);
    const validId = b.mandatoryValidQname(id);
    if (this._bundles.has(validId.uri)) {
      throw new ProvException("A bundle with that identifier already exists");
    }
    this._bundles.set(validId.uri, b);
    b._attachToDocument(this, validId); // rewrite id + set owner for consistency
  }

  /**
   * Appends another document/bundle's records into this document; sub-bundles
   * with matching identifiers are merged (`model.py:2609`).
   *
   * @param other The document or bundle to merge in.
   */
  override update(other: ProvBundle): void {
    for (const record of other.getRecords()) {
      this.addRecord(record);
    }
    // `isDocument()` narrows `other` to `ProvDocument` (so `.bundles` needs no
    // cast); `hasBundles()` keeps Python's exact guard (`model.py:2620`). Any
    // bundle-carrying container is necessarily a document, so this is equivalent.
    if (other.isDocument() && other.hasBundles()) {
      for (const bundle of other.bundles) {
        const bundleId = bundle.identifier;
        if (bundleId === null) {
          continue;
        }
        const existing = this._bundles.get(bundleId.uri);
        if (existing) {
          existing.update(bundle);
        } else {
          this.bundle(bundleId).update(bundle);
        }
      }
    }
  }

  /**
   * Returns a new document with same-identifier records unified, including those
   * inside bundles (`model.py:2595`). The new document **shares** this one's
   * namespace manager (a deliberate Python quirk — DEVIATIONS).
   */
  override unified(): ProvDocument {
    const doc = new ProvDocument(this.unifiedRecords());
    doc._namespaces = this._namespaces; // shared by reference (model.py:2603)
    for (const bundle of this.bundles) {
      doc.addBundle(bundle.unified());
    }
    return doc;
  }

  /**
   * Document equality: the document-level records match (via `ProvBundle.equals`)
   * **and** every child bundle is matched by an equal bundle in `other`
   * (`model.py:2523`). Like Python, this only iterates this document's bundles.
   */
  override equals(other: unknown): boolean {
    if (!(other instanceof ProvDocument)) {
      return false;
    }
    if (!super.equals(other)) {
      return false;
    }
    for (const [uri, bundle] of this._bundles) {
      const otherBundle = other._bundles.get(uri);
      if (otherBundle === undefined || !bundle.equals(otherBundle)) {
        return false;
      }
    }
    return true;
  }
}
