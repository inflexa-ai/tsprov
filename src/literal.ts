// Typed literal values and XSD datatype handling.
//
// Port of `Literal` and the datatype helpers in `model.py` (`Literal`
// model.py:148, `parse_boolean` model.py:80, `XSD_DATATYPE_PARSERS`
// model.py:98, `parse_xsd_types` model.py:109). A `Literal` carries its value
// (always a string), an optional XSD `datatype` QName, and an optional language
// tag; equality/`key` are structural over the triple, mirroring Python's
// `__eq__`/`__hash__` (model.py:182-197).
//
// Carrying the datatype ON the value is how we survive the JS `number` collapse
// (int vs double): a parsed numeric value is just a `number`, but the datatype
// QName preserves whether it was `xsd:int` or `xsd:double` (04 §3.2).

import { DateTime } from "luxon";

import { Identifier, type QualifiedName } from "./identifier.js";
import { parseXsdDateTime } from "./datetime.js";
import { warn } from "./error.js";
import { quoteMaybeMultiline } from "./format.js";
import {
  PROV_INTERNATIONALIZEDSTRING,
  XSD_STRING,
  XSD_DOUBLE,
  XSD_LONG,
  XSD_INT,
  XSD_BOOLEAN,
  XSD_DATETIME,
  XSD_ANYURI,
} from "./constants.js";

/**
 * Tri-state `xsd:boolean` parser, mirroring `parse_boolean` (`model.py:80`):
 * `"true"`/`"1"` → `true`, `"false"`/`"0"` → `false`, anything else → `null`.
 *
 * @param value The lexical boolean string (case-insensitive).
 * @returns `true`, `false`, or `null` when unrecognized.
 */
export function parseBoolean(value: string): boolean | null {
  const lower = value.toLowerCase();
  if (lower === "false" || lower === "0") {
    return false;
  }
  if (lower === "true" || lower === "1") {
    return true;
  }
  return null;
}

/** The native value an XSD-typed lexical string decodes to. */
export type XsdParsedValue =
  | string
  | number
  | boolean
  | DateTime
  | Identifier
  | null;

/** A function decoding an XSD lexical string to its native value. */
export type XsdParser = (lexical: string) => XsdParsedValue;

/**
 * Decoders for the XSD datatypes PROV recognizes, keyed by `datatype.uri`.
 * Mirrors `XSD_DATATYPE_PARSERS` (`model.py:98`) exactly — note `xsd:float` is
 * intentionally absent (Python maps only `xsd:double` to a float parser).
 *
 * Deviation: numeric parsers return `null` for malformed input rather than
 * throwing as Python's bare `int()`/`float()` do; corpus values are always
 * well-formed, so this only affects pathological input.
 */
export const XSD_DATATYPE_PARSERS: ReadonlyMap<string, XsdParser> = new Map([
  [XSD_STRING.uri, (s: string): XsdParsedValue => s],
  [XSD_DOUBLE.uri, (s: string): XsdParsedValue => parseNumber(s)],
  [XSD_LONG.uri, (s: string): XsdParsedValue => parseNumber(s)],
  [XSD_INT.uri, (s: string): XsdParsedValue => parseNumber(s)],
  [XSD_BOOLEAN.uri, (s: string): XsdParsedValue => parseBoolean(s)],
  [XSD_DATETIME.uri, (s: string): XsdParsedValue => parseXsdDateTime(s)],
  [XSD_ANYURI.uri, (s: string): XsdParsedValue => new Identifier(s)],
]);

/**
 * Decodes a lexical string to its native value for the given datatype, or
 * `null` when the datatype has no registered parser. Mirrors `parse_xsd_types`
 * (`model.py:109`).
 *
 * @param value    The lexical string.
 * @param datatype The XSD datatype QName.
 * @returns The native value, or `null` if the datatype is not parseable.
 */
export function parseXsdTypes(
  value: string,
  datatype: QualifiedName,
): XsdParsedValue {
  const parser = XSD_DATATYPE_PARSERS.get(datatype.uri);
  return parser ? parser(value) : null;
}

/** Parses a numeric lexical string, returning `null` (not `NaN`) on failure. */
function parseNumber(value: string): number | null {
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/** Undefined-safe QName equality: both absent ⇒ equal; one absent ⇒ not equal. */
function datatypeEquals(
  a: QualifiedName | undefined,
  b: QualifiedName | undefined,
): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.equals(b);
}

/**
 * A typed PROV literal: a string value with an optional XSD datatype and an
 * optional language tag. Mirrors `Literal` (`model.py:148`).
 */
export class Literal {
  /** The literal's value, always stored as a string (Python `str(value)`). */
  readonly value: string;
  /** The XSD datatype QName, or `undefined` when untyped. */
  readonly datatype: QualifiedName | undefined;
  /** The language tag, or `undefined` when absent. */
  readonly langtag: string | undefined;

  /**
   * @param value    The value; coerced to a string via `String()`.
   * @param datatype Optional XSD datatype QName. A language tag forces it to
   *   `prov:InternationalizedString` (warning if a conflicting type was given).
   * @param langtag  Optional language tag; a non-empty tag implies an
   *   internationalized string (`model.py:156-171`).
   */
  constructor(value: unknown, datatype?: QualifiedName, langtag?: string) {
    this.value = String(value);
    let resolved = datatype;
    if (langtag) {
      // `if langtag:` — a non-empty tag forces prov:InternationalizedString.
      if (resolved === undefined) {
        resolved = PROV_INTERNATIONALIZEDSTRING;
      } else if (!resolved.equals(PROV_INTERNATIONALIZEDSTRING)) {
        warn(
          `Invalid data type (${resolved}) for "${this.value}"@${langtag}, ` +
            `overridden as prov:InternationalizedString.`,
        );
        resolved = PROV_INTERNATIONALIZEDSTRING;
      }
    }
    this.datatype = resolved;
    // `str(langtag) if langtag is not None else None` — preserves "" vs absent.
    this.langtag = langtag != null ? String(langtag) : undefined;
  }

  /** True iff this literal has no language tag (`model.py:211`). */
  hasNoLangtag(): boolean {
    return this.langtag === undefined;
  }

  /** Structural equality over `(value, datatype, langtag)` (`model.py:182`). */
  equals(other: unknown): boolean {
    return (
      other instanceof Literal &&
      other.value === this.value &&
      datatypeEquals(other.datatype, this.datatype) &&
      other.langtag === this.langtag
    );
  }

  /**
   * Canonical key reproducing `hash((value, datatype, langtag))`
   * (`model.py:196`). The `@`-prefix on the language tag keeps an absent tag
   * (`undefined`) distinct from an empty-string tag.
   */
  get key(): string {
    const datatype = this.datatype?.uri ?? "";
    const langtag = this.langtag === undefined ? "" : `@${this.langtag}`;
    return `L\u0000${this.value}\u0000${datatype}\u0000${langtag}`;
  }

  /** PROV-N representation: `"value"@lang` or `"value" %% datatype` (`model.py:214`). */
  provnRepresentation(): string {
    const quoted = quoteMaybeMultiline(this.value);
    if (this.langtag) {
      return `${quoted}@${this.langtag}`;
    }
    // Degenerate case: an untyped literal. Python emits `%% None`; we emit the
    // datatype's display, or empty when absent (real literals always carry one).
    return `${quoted} %% ${this.datatype ? String(this.datatype) : ""}`;
  }

  /** PROV-N form, so a `Literal` stringifies like Python `__str__` (`model.py:176`). */
  toString(): string {
    return this.provnRepresentation();
  }
}
