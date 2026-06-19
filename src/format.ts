// PROV-N value formatting helpers.
//
// Port of the formatting functions in `model.py`:
// `_ensure_multiline_string_triple_quoted` (model.py:121), `encoding_provn_value`
// (model.py:132). The hard part is `formatFloatG`, which reproduces C's `%g`
// (used by Python's `'%g' % value`) — PROV-N output is asserted byte-for-byte, so
// this must match exactly (04 §7.4).

import { DateTime } from "luxon";

import type { AttrValue } from "./value";
import { toXsdDateTime } from "./datetime";

/**
 * Wraps a value as a double-quoted PROV-N string, triple-quoting it when it spans
 * multiple lines. Mirrors `_ensure_multiline_string_triple_quoted` (`model.py:121`).
 *
 * @param value The raw string value.
 * @returns The PROV-N-quoted form, with embedded double quotes escaped.
 */
export function quoteMaybeMultiline(value: string): string {
  const escaped = value.replace(/"/g, '\\"');
  return escaped.includes("\n") ? `"""${escaped}"""` : `"${escaped}"`;
}

/** Strips trailing fractional zeros (and a bare trailing `.`) from a decimal string. */
function stripTrailingZeros(s: string): string {
  if (!s.includes(".")) {
    return s;
  }
  return s.replace(/0+$/, "").replace(/\.$/, "");
}

/** Formats `value` in `%e` style with `fractionDigits`, C-style: stripped mantissa, signed 2+-digit exponent. */
function formatExponential(value: number, fractionDigits: number): string {
  const s = value.toExponential(fractionDigits); // e.g. "1.23457e+6"
  const eIndex = s.indexOf("e");
  const mantissa = stripTrailingZeros(s.slice(0, eIndex));
  const exponent = s.slice(eIndex + 1); // "+6" or "-5"
  const sign = exponent.startsWith("-") ? "-" : "+";
  const digits = exponent.replace(/^[+-]/, "").padStart(2, "0");
  return `${mantissa}e${sign}${digits}`;
}

/**
 * Formats a number like C's `%g` (Python `'%g' % value`): `%e` when the decimal
 * exponent is `< -4` or `>= precision`, otherwise `%f`; trailing zeros and a
 * trailing decimal point are stripped; the exponent is signed and at least two
 * digits. Verified byte-for-byte against the reference Python interpreter.
 *
 * @param value     The number to format.
 * @param precision Significant digits (C default 6; 0 is treated as 1).
 * @returns The `%g`-formatted string (`"inf"`/`"-inf"`/`"nan"`/`"-0"` for the special cases).
 */
export function formatFloatG(value: number, precision = 6): string {
  if (Number.isNaN(value)) {
    return "nan";
  }
  if (value === Infinity) {
    return "inf";
  }
  if (value === -Infinity) {
    return "-inf";
  }
  if (value === 0) {
    return Object.is(value, -0) ? "-0" : "0";
  }

  const sig = precision === 0 ? 1 : precision;
  // The decimal exponent as it appears in `%e` form (after rounding to `sig`
  // significant digits), which is what C uses to choose between %e and %f.
  const exponent = Number.parseInt(
    value.toExponential(sig - 1).split("e")[1]!,
    10,
  );

  if (exponent >= -4 && exponent < sig) {
    // %f with (sig - 1 - exponent) fraction digits.
    return stripTrailingZeros(value.toFixed(Math.max(0, sig - 1 - exponent)));
  }
  // %e with (sig - 1) fraction digits.
  return formatExponential(value, sig - 1);
}

/**
 * Renders a single attribute value in PROV-N, mirroring `encoding_provn_value`
 * (`model.py:132`): strings are quoted (no datatype suffix), datetimes/floats/
 * booleans get a `%% xsd:…` suffix, and everything else (QName, Identifier,
 * Literal) falls back to its string form.
 *
 * @param value The attribute value.
 * @returns The PROV-N rendering.
 */
export function encodingProvnValue(value: AttrValue | Date): string {
  if (typeof value === "string") {
    return quoteMaybeMultiline(value);
  }
  if (value instanceof DateTime || value instanceof Date) {
    return `"${toXsdDateTime(value)}" %% xsd:dateTime`;
  }
  if (typeof value === "number") {
    // A bare number encodes as xsd:float (model.py:140).
    return `"${formatFloatG(value)}" %% xsd:float`;
  }
  if (typeof value === "boolean") {
    // `'%i'` → 1/0 (model.py:142).
    return `"${value ? "1" : "0"}" %% xsd:boolean`;
  }
  // QName → "prefix:local", Literal → its PROV-N form, Identifier → its URI
  // (str(value), model.py:145).
  return String(value);
}
