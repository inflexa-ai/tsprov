// The attribute store backing every `ProvRecord`.
//
// Python uses `defaultdict(QualifiedName -> set)` (model.py:293): attribute name
// to a *set* of values. Two semantics matter and are reproduced here:
//   - **value dedup**: equal values (by PROV value-equality) collapse — we key the
//     inner collection by `valueKey`.
//   - **no read-mutation**: Python's `defaultdict` inserts an empty set when a
//     missing key is *read* (`get_asserted_types`, etc.). We deliberately do NOT
//     (DEVIATIONS D-planned / 04 §5): reads never create entries.
//
// Unlike a Python `set`, our inner `Map` preserves *insertion order*, so the TS
// output is deterministic where Python's was not (a documented, harmless
// divergence — PROV equality is order-independent).

import type { QualifiedName } from "../identifier.js";
import { type AttrValue, valueKey } from "../value.js";

/** One attribute's name plus its ordered, value-deduped values. */
type AttrEntry = {
  attr: QualifiedName;
  /** `valueKey` → value, preserving insertion order and deduping by value. */
  values: Map<string, AttrValue>;
};

/**
 * An ordered, value-deduped multimap from attribute QName to values — the
 * storage behind a record's attributes. Replaces Python's `defaultdict(set)`.
 */
export class AttributeStore {
  /** `attr.uri` → entry. Outer insertion order is attribute insertion order. */
  private readonly byAttr = new Map<string, AttrEntry>();

  /**
   * Adds `value` under `attr`, deduping against existing values by
   * {@link valueKey}. A value equal to one already present is ignored.
   *
   * @param attr  The attribute name.
   * @param value The value to add.
   */
  add(attr: QualifiedName, value: AttrValue): void {
    let entry = this.byAttr.get(attr.uri);
    if (entry === undefined) {
      entry = { attr, values: new Map() };
      this.byAttr.set(attr.uri, entry);
    }
    const key = valueKey(value);
    if (!entry.values.has(key)) {
      entry.values.set(key, value);
    }
  }

  /**
   * Replaces all values under `attr` with the single `value`. Used by
   * `ProvActivity.setTime`'s raw-store quirk (`model.py:802`).
   *
   * @param attr  The attribute name.
   * @param value The sole value to store.
   */
  set(attr: QualifiedName, value: AttrValue): void {
    this.byAttr.set(attr.uri, {
      attr,
      values: new Map([[valueKey(value), value]]),
    });
  }

  /**
   * Returns the values stored under `attr`, in insertion order. Returns an empty
   * array for an unknown attribute **without** creating an entry (no
   * read-mutation).
   *
   * @param attr The attribute name.
   * @returns The values, or `[]`.
   */
  get(attr: QualifiedName): AttrValue[] {
    const entry = this.byAttr.get(attr.uri);
    return entry ? [...entry.values.values()] : [];
  }

  /**
   * Returns the first value stored under `attr`, or `undefined`. Mirrors
   * `first(self._attributes[name])` (`model.py:117`, `:364`).
   *
   * @param attr The attribute name.
   */
  first(attr: QualifiedName): AttrValue | undefined {
    const entry = this.byAttr.get(attr.uri);
    if (entry === undefined) {
      return undefined;
    }
    for (const value of entry.values.values()) {
      return value;
    }
    return undefined;
  }

  /**
   * True iff `attr` has at least one stored value. Does not create an entry.
   *
   * @param attr The attribute name.
   */
  has(attr: QualifiedName): boolean {
    return this.byAttr.has(attr.uri);
  }

  /** The attribute names that have values, in insertion order. */
  attrNames(): QualifiedName[] {
    return [...this.byAttr.values()].map((entry) => entry.attr);
  }

  /**
   * All `(name, value)` pairs, flattened in attribute-then-value insertion
   * order. Mirrors the Python `attributes` property (`model.py:344`).
   */
  pairs(): Array<[QualifiedName, AttrValue]> {
    const out: Array<[QualifiedName, AttrValue]> = [];
    for (const { attr, values } of this.byAttr.values()) {
      for (const value of values.values()) {
        out.push([attr, value]);
      }
    }
    return out;
  }

  /** The total number of `(name, value)` pairs. */
  get size(): number {
    let total = 0;
    for (const entry of this.byAttr.values()) {
      total += entry.values.size;
    }
    return total;
  }

  /** True iff no attributes have been stored. */
  isEmpty(): boolean {
    return this.byAttr.size === 0;
  }
}
