// `ProvRecord` — the abstract base of every PROV element and relation.
//
// Port of `ProvRecord` (model.py:269-609). Built on the `AttributeStore` +
// `valueKey`. The load-bearing pieces:
//   - `addAttributes` enforces the single-valued-formal rule (model.py:505-524),
//     including the "non-comparable second value counts as different" branch
//     (model.py:514-516) — here a `valueKey` mismatch.
//   - `equals`/`key` reproduce `__eq__`/`__hash__` (model.py:528-536, :297),
//     including the asymmetric blank-id rule (compare ids only when *this* has one).
//
// Bundle seam: Python resolves attribute-name strings via the bundle's
// `NamespaceManager`. That layer is M4, so `ProvRecord` depends only on the
// minimal `RecordBundle` resolver interface below; M4's `ProvBundle` implements it.

import { DateTime } from "luxon";

import { Identifier, QualifiedName } from "../identifier";
import { type AttrValue, valueKey } from "../value";
import { Literal, parseXsdTypes } from "../literal";
import { parseXsdDateTime, ensureDateTime, toXsdDateTime } from "../datetime";
import { encodingProvnValue } from "../format";
import { ProvException } from "../error";
import { AttributeStore } from "./attributes";
import { getRecordClass } from "./registry";
import {
  PROV_TYPE,
  PROV_LABEL,
  PROV_VALUE,
  PROV_ATTR_COLLECTION,
  PROV_ATTRIBUTE_QNAMES,
  PROV_ATTRIBUTE_LITERALS,
  PROV_ATTRIBUTES,
  PROV_N_MAP,
} from "../constants";
// Type-only: lets `isElement`/`isRelation` narrow at the call site. Erased at
// compile time (`import type`), so it adds no runtime edge to the element/relation
// modules that import this one.
import type { ProvElement } from "./element";
import type { ProvRelation } from "./relation";

/** A value that can be resolved to a {@link QualifiedName}: a QName, a prefixed string, or an Identifier. */
export type QualifiedNameCandidate = QualifiedName | string | Identifier;

/** An attribute-name candidate (same shape as {@link QualifiedNameCandidate}). */
export type AttrKey = QualifiedNameCandidate;

/**
 * A raw attribute value as accepted by the authoring API. A {@link ProvRecord}
 * is resolved to its identifier; `null`/`undefined` values are skipped (so the
 * fluent builders can pass optional formal arguments through).
 */
export type AttributeValue = AttrValue | ProvRecord;

/** One attribute value (or a list, for the object form), or `null`/`undefined`. */
type AttributeInput = AttributeValue | null | undefined;

/**
 * Attributes passed to a record: an ordered pair-array (allows duplicate keys),
 * a `Map`, or a plain object (a value array means multiple values for that key).
 */
export type ProvAttributes =
  | ReadonlyArray<readonly [AttrKey, AttributeInput]>
  | ReadonlyMap<AttrKey, AttributeInput | readonly AttributeValue[]>
  | Record<string, AttributeInput | readonly AttributeValue[]>;

/**
 * The minimal bundle contract a {@link ProvRecord} needs: qualified-name
 * resolution. Implemented by `ProvBundle`'s `NamespaceManager` at M4.
 */
export type RecordBundle = {
  /** Resolves a candidate to a {@link QualifiedName}, or `null` if it cannot be resolved. */
  validQualifiedName(name: QualifiedNameCandidate): QualifiedName | null;
  /** Resolves a candidate to a {@link QualifiedName}, throwing if it cannot be resolved. */
  mandatoryValidQname(name: QualifiedNameCandidate): QualifiedName;
};

/** Set equality over canonical strings. */
function setEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const x of a) {
    if (!b.has(x)) {
      return false;
    }
  }
  return true;
}

/** Normalizes any {@link ProvAttributes} shape to an ordered list of `(key, value)` pairs. */
export function normalizeAttributes(
  attributes: ProvAttributes,
): Array<[AttrKey, AttributeInput]> {
  if (Array.isArray(attributes)) {
    return (
      attributes as ReadonlyArray<readonly [AttrKey, AttributeInput]>
    ).map(([key, value]): [AttrKey, AttributeInput] => [key, value]);
  }
  const out: Array<[AttrKey, AttributeInput]> = [];
  const entries: Iterable<
    readonly [AttrKey, AttributeInput | readonly AttributeValue[]]
  > =
    attributes instanceof Map
      ? attributes.entries()
      : (Object.entries(attributes) as Array<
          [string, AttributeInput | readonly AttributeValue[]]
        >);
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      for (const item of value as readonly AttributeValue[]) {
        out.push([key, item]);
      }
    } else {
      out.push([key, value as AttributeInput]);
    }
  }
  return out;
}

/** True for values carrying a `provnRepresentation()` (Literal/QName/Identifier). */
function hasProvnRepresentation(
  value: AttrValue,
): value is Literal | Identifier {
  return value instanceof Literal || value instanceof Identifier;
}

/** Base class for all PROV records (elements and relations). Mirrors `ProvRecord` (`model.py:269`). */
export abstract class ProvRecord {
  /** The record's PROV type QName; overridden by every concrete subclass. */
  static readonly prov_type: QualifiedName | null = null;
  /** The record's formal-attribute QNames, in order; overridden per subclass. */
  static readonly FORMAL_ATTRIBUTES: readonly QualifiedName[] = [];

  /** The record's (possibly null) identifier. */
  readonly identifier: QualifiedName | null;
  /** The owning bundle / qualified-name resolver. */
  protected readonly _bundle: RecordBundle;
  /** Backing attribute storage. */
  protected readonly attrs = new AttributeStore();

  /**
   * @param bundle     The owning bundle (qualified-name resolver).
   * @param identifier The record identifier, or `null` for a blank node.
   * @param attributes Optional initial attributes.
   */
  constructor(
    bundle: RecordBundle,
    identifier: QualifiedName | null,
    attributes?: ProvAttributes,
  ) {
    this._bundle = bundle;
    this.identifier = identifier;
    if (attributes !== undefined) {
      this.addAttributes(attributes);
    }
  }

  /** The owning bundle. */
  get bundle(): RecordBundle {
    return this._bundle;
  }

  /** Returns the record's PROV type, from the subclass's `static prov_type` (`model.py:308`). */
  getType(): QualifiedName {
    const type = (this.constructor as typeof ProvRecord).prov_type;
    if (type === null) {
      throw new Error("Type not defined for this record.");
    }
    return type;
  }

  /** The subclass's formal-attribute order (`static FORMAL_ATTRIBUTES`). */
  get formalAttributesOrder(): readonly QualifiedName[] {
    return (this.constructor as typeof ProvRecord).FORMAL_ATTRIBUTES;
  }

  /** Narrows to {@link ProvElement} (overridden there to return `true`). */
  isElement(): this is ProvElement {
    return false;
  }

  /** Narrows to {@link ProvRelation} (overridden there to return `true`). */
  isRelation(): this is ProvRelation {
    return false;
  }

  /** The asserted `prov:type` values (`model.py:315`). */
  getAssertedTypes(): AttrValue[] {
    return this.attrs.get(PROV_TYPE);
  }

  /** Adds a `prov:type` assertion (`model.py:319`). */
  addAssertedType(typeIdentifier: QualifiedName): void {
    this.attrs.add(PROV_TYPE, typeIdentifier);
  }

  /** Returns the value(s) for `attrName`, resolving the name first (`model.py:327`). */
  getAttribute(attrName: AttrKey): AttrValue[] {
    return this.attrs.get(this._bundle.mandatoryValidQname(attrName));
  }

  /** All `(name, value)` pairs (`model.py:344`). */
  get attributes(): Array<[QualifiedName, AttrValue]> {
    return this.attrs.pairs();
  }

  /** Attributes grouped by name: `(name, values[])` in insertion order (mirrors `record._attributes.items()`). */
  attributeEntries(): Array<[QualifiedName, AttrValue[]]> {
    return this.attrs
      .attrNames()
      .map((attr): [QualifiedName, AttrValue[]] => [attr, this.attrs.get(attr)]);
  }

  /** The formal attributes in order, each paired with its single value (or `undefined`) (`model.py:368`). */
  get formalAttributes(): Array<[QualifiedName, AttrValue | undefined]> {
    return this.formalAttributesOrder.map(
      (attr): [QualifiedName, AttrValue | undefined] => [
        attr,
        this.attrs.first(attr),
      ],
    );
  }

  /** The values of the formal attributes, in order (`model.py:357`). */
  get args(): Array<AttrValue | undefined> {
    return this.formalAttributesOrder.map((attr) => this.attrs.first(attr));
  }

  /** The non-formal attributes as `(name, value)` pairs (`model.py:380`). */
  get extraAttributes(): Array<[QualifiedName, AttrValue]> {
    const formal = new Set(this.formalAttributesOrder.map((q) => q.uri));
    return this.attrs.pairs().filter(([name]) => !formal.has(name.uri));
  }

  /** Identifying label: the `prov:label`, else the identifier (`model.py:402`). */
  get label(): string {
    const labels = this.attrs.get(PROV_LABEL);
    return String(labels.length > 0 ? labels[0] : this.identifier);
  }

  /** The `prov:value` value(s) (`model.py:411`). */
  get value(): AttrValue[] {
    return this.attrs.get(PROV_VALUE);
  }

  /**
   * Normalizes a single literal/value the way `_auto_literal_conversion` does
   * (`model.py:417`): records → their identifier; strings pass through; QNames
   * are resolved; a langtag-free typed `Literal` whose datatype is parseable is
   * converted to its native value (others are kept as `Literal`).
   */
  protected autoLiteralConversion(input: AttributeValue): AttrValue | null {
    let literal: AttributeValue | null = input;
    if (literal instanceof ProvRecord) {
      literal = literal.identifier;
    }
    if (typeof literal === "string") {
      return literal;
    }
    if (literal instanceof QualifiedName) {
      return this._bundle.validQualifiedName(literal);
    }
    if (literal instanceof Literal && literal.hasNoLangtag()) {
      const converted: AttrValue | null = literal.datatype
        ? parseXsdTypes(literal.value, literal.datatype)
        : this.autoLiteralConversion(literal.value);
      if (converted !== null && converted !== undefined) {
        return converted;
      }
    }
    return literal;
  }

  /**
   * Adds attributes, enforcing PROV's rules (`model.py:443`): QName-valued
   * formal attrs resolve to qualified names; literal-valued formal attrs must be
   * datetimes; a second value for a single-valued formal attribute is ignored if
   * equal and rejected if different (unless this is a collection).
   *
   * @param attributes The attributes to add (any {@link ProvAttributes} shape).
   * @throws {ProvException} On an invalid value or a conflicting formal value.
   */
  addAttributes(attributes: ProvAttributes): void {
    const pairs = normalizeAttributes(attributes);
    if (pairs.length === 0) {
      return;
    }

    // A collection (an attr resolving to prov:collection among the inputs) lifts
    // the single-valued rule (model.py:460). Python checks the raw keys.
    const isCollection = pairs.some(
      ([key]) =>
        key instanceof QualifiedName && key.uri === PROV_ATTR_COLLECTION.uri,
    );

    for (const [attrName, original] of pairs) {
      if (original === null || original === undefined) {
        continue;
      }
      const attr = this._bundle.mandatoryValidQname(attrName);

      let value: AttrValue | null;
      if (PROV_ATTRIBUTE_QNAMES.has(attr.uri)) {
        // Expecting a qualified name.
        let candidate: AttributeValue | null = original;
        if (candidate instanceof ProvRecord) {
          candidate = candidate.identifier;
          if (candidate === null) {
            throw new ProvException(
              `Invalid value for attribute ${attr}: ${String(original)}. The record has no identifier.`,
            );
          }
        }
        value = this._bundle.mandatoryValidQname(
          candidate as QualifiedNameCandidate,
        );
      } else if (PROV_ATTRIBUTE_LITERALS.has(attr.uri)) {
        // Expecting a datetime (object or parseable string).
        value =
          typeof original === "string"
            ? parseXsdDateTime(original)
            : original instanceof DateTime
              ? original
              : original instanceof Date
                ? ensureDateTime(original)
                : null;
        if (!(value instanceof DateTime)) {
          throw new ProvException(
            `Invalid value for attribute ${attr}: ${String(original)}. ` +
              `Expected a datetime object or a string that can be parsed as a datetime.`,
          );
        }
      } else {
        value = this.autoLiteralConversion(original);
      }

      if (value === null || value === undefined) {
        throw new ProvException(
          `Invalid value for attribute ${attr}: ${String(original)}`,
        );
      }

      if (
        !isCollection &&
        PROV_ATTRIBUTES.has(attr.uri) &&
        this.attrs.has(attr)
      ) {
        const existing = this.attrs.first(attr)!;
        // A non-comparable second value counts as different (model.py:514-516);
        // valueKey is total, so a key mismatch covers both "different" cases.
        if (valueKey(value) !== valueKey(existing)) {
          throw new ProvException(
            `Cannot have more than one value for attribute ${attr}`,
          );
        }
        continue; // same value → ignore
      }

      this.attrs.add(attr, value);
    }
  }

  /** The set of canonical `name∥value` keys — the multiset of `(name, value)` pairs. */
  private attributeKeySet(): Set<string> {
    const keys = new Set<string>();
    for (const [name, value] of this.attrs.pairs()) {
      keys.add(`${name.uri}\u0000${valueKey(value)}`);
    }
    return keys;
  }

  /**
   * Returns an independent copy of this record, dispatched through the registry
   * (`model.py:300`). Requires the concrete class to be registered (it is, once
   * `element.ts`/`relation.ts` have loaded).
   *
   * @throws {Error} If no class is registered for this record's type.
   */
  copy(): ProvRecord {
    const ctor = getRecordClass(this.getType());
    if (ctor === undefined) {
      throw new Error(
        `No record class registered for type ${this.getType()}.`,
      );
    }
    return new ctor(this._bundle, this.identifier, this.attributes);
  }

  /** Value equality (`model.py:528`): same type, ids equal *when this has one*, equal attribute multisets. */
  equals(other: unknown): boolean {
    if (!(other instanceof ProvRecord)) {
      return false;
    }
    if (!this.getType().equals(other.getType())) {
      return false;
    }
    // Asymmetric blank-id rule: only compare ids when THIS has one (model.py:533).
    if (this.identifier !== null) {
      if (
        other.identifier === null ||
        !this.identifier.equals(other.identifier)
      ) {
        return false;
      }
    }
    return setEqual(this.attributeKeySet(), other.attributeKeySet());
  }

  /** Canonical key reproducing `hash((type, identifier, frozenset(attributes)))` (`model.py:297`). */
  get key(): string {
    const attrKeys = [...this.attributeKeySet()].sort().join("\u0001");
    return `${this.getType().uri}\u0000${this.identifier?.uri ?? ""}\u0000${attrKeys}`;
  }

  /** PROV-N representation of the record (`model.py:541`). */
  getProvN(): string {
    const items: string[] = [];
    let relationId = "";
    if (this.identifier !== null) {
      const id = String(this.identifier);
      if (this.isElement()) {
        items.push(id);
      } else {
        relationId = `${id}; `;
      }
    }

    // Formal attributes, in order, with "-" placeholders for the missing ones.
    for (const attr of this.formalAttributesOrder) {
      const value = this.attrs.has(attr) ? this.attrs.first(attr) : undefined;
      if (value === undefined) {
        items.push("-");
      } else if (value instanceof DateTime || value instanceof Date) {
        items.push(toXsdDateTime(value));
      } else {
        items.push(String(value));
      }
    }

    // Extra (non-formal) attributes as a `[name=value, …]` block.
    const formal = new Set(this.formalAttributesOrder.map((q) => q.uri));
    const extra: string[] = [];
    for (const attr of this.attrs.attrNames()) {
      if (formal.has(attr.uri)) {
        continue;
      }
      for (const value of this.attrs.get(attr)) {
        const repr = hasProvnRepresentation(value)
          ? value.provnRepresentation()
          : encodingProvnValue(value);
        extra.push(`${String(attr)}=${repr}`);
      }
    }
    if (extra.length > 0) {
      items.push(`[${extra.join(", ")}]`);
    }

    const provName = PROV_N_MAP.get(this.getType().uri) ?? String(this.getType());
    return `${provName}(${relationId}${items.join(", ")})`;
  }

  /** PROV-N form, so a record stringifies like Python `__str__` (`model.py:538`). */
  toString(): string {
    return this.getProvN();
  }
}
