// Attribute values and the `valueKey` canonicalizer — the heart of PROV
// value-equality (04-typescript-feasibility §6).
//
// Python stores attribute values in `set`s and dedups/compares them by
// `__hash__`/`__eq__`. JS `Set`/`Map` key by reference, so every value that can
// appear in an attribute is mapped to a canonical, *type-tagged* string by
// `valueKey`. The tag matters: a `QualifiedName` whose URI is `"http://x"` and
// the plain string `"http://x"` are different Python types with different
// hashes, so they must NOT share a key. Every dedup, Set-membership, and record
// equality check bottoms out here.

import { DateTime } from "luxon";

import { Identifier, QualifiedName } from "./identifier.js";
import { Literal } from "./literal.js";
import { toXsdDateTime } from "./datetime.js";

/**
 * A value that may appear as a PROV attribute. Typed numerics (to distinguish
 * `xsd:int` from `xsd:double`) are expressed as a {@link Literal}; a bare
 * `number` is treated as an `xsd:double` on encode (04 §3.2).
 */
export type AttrValue =
  | string
  | number
  | boolean
  | DateTime
  | QualifiedName
  | Identifier
  | Literal;

/**
 * Maps any {@link AttrValue} to a stable, type-tagged string that reproduces the
 * Python hash/equality grouping. Equal values (by PROV semantics) yield equal
 * keys; values of different kinds never collide.
 *
 * Tags: `L` literal, `Q` qualified name, `I` identifier, `D` datetime,
 * `S` string, `N` number, `B` boolean. `QualifiedName` is checked before
 * `Identifier` because it is a subclass.
 *
 * @param value The attribute value.
 * @returns The canonical key string.
 */
export function valueKey(value: AttrValue): string {
  if (value instanceof Literal) {
    return value.key; // already "L\u0000…"
  }
  if (value instanceof QualifiedName) {
    return `Q\u0000${value.uri}`;
  }
  if (value instanceof Identifier) {
    return value.key; // "I\u0000<uri>"
  }
  if (value instanceof DateTime) {
    return `D\u0000${toXsdDateTime(value)}`;
  }
  switch (typeof value) {
    case "string":
      return `S\u0000${value}`;
    case "number":
      return `N\u0000${String(value)}`;
    case "boolean":
      return `B\u0000${value ? "1" : "0"}`;
    default: {
      // Unreachable: AttrValue is a closed union.
      const exhaustive: never = value;
      throw new Error(`Unsupported attribute value: ${String(exhaustive)}`);
    }
  }
}
