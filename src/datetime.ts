// xsd:dateTime parsing and formatting, on a thin luxon facade.
//
// Port of the datetime helpers in `model.py` (`_ensure_datetime` model.py:65,
// `parse_xsd_datetime` model.py:72). Python uses `dateutil.parser.parse` and
// re-emits `value.isoformat()`; we use luxon `DateTime.fromISO(s, {setZone:true})`
// (preserves the source UTC offset) and a custom formatter that reproduces
// Python's `isoformat()` byte-for-byte for timezone-aware values.
//
// Known limitations vs Python (to revisit when the JSON corpus differential runs
// at M5 — see 03-dependency-analysis §2 / 00-overview open questions):
//   - luxon has millisecond resolution, so sub-millisecond microseconds are lost
//     on parse (`...123456` round-trips as `...123000`).
//   - luxon is ISO-8601-only, stricter than `dateutil` (which parses many
//     non-ISO forms). PROV xsd:dateTime values are ISO, so this is acceptable.
//   - a naive (offset-less) input is assigned a zone by luxon, whereas Python
//     keeps it naive (and `isoformat()` then emits no offset).

import { DateTime } from "luxon";

/** A value coercible to a {@link DateTime}: an ISO string, a JS `Date`, or a luxon `DateTime`. */
export type DateLike = string | Date | DateTime;

/**
 * Coerces a {@link DateLike} to a luxon {@link DateTime}, mirroring Python's
 * `_ensure_datetime` (`model.py:65`). A `DateTime` passes through unchanged; a
 * `Date` is wrapped; an ISO string is parsed with its offset preserved.
 *
 * @param value The value to coerce, or `null`/`undefined`.
 * @returns The `DateTime`, or `null` when `value` is `null`/`undefined`.
 * @throws {Error} When `value` is a string that is not valid ISO-8601 (like
 *   `dateutil.parser.parse`, which raises rather than returning `null`).
 */
export function ensureDateTime(
  value: DateLike | null | undefined,
): DateTime | null {
  if (value == null) {
    return null;
  }
  if (value instanceof DateTime) {
    return value;
  }
  if (value instanceof Date) {
    return DateTime.fromJSDate(value);
  }
  const dt = DateTime.fromISO(value, { setZone: true });
  if (!dt.isValid) {
    throw new Error(`Invalid datetime: ${value}`);
  }
  return dt;
}

/**
 * Parses an `xsd:dateTime` lexical string, preserving its UTC offset. Mirrors
 * `parse_xsd_datetime` (`model.py:72`): returns `null` on failure rather than
 * throwing.
 *
 * @param value The ISO-8601 lexical string.
 * @returns The parsed `DateTime`, or `null` if it cannot be parsed.
 */
export function parseXsdDateTime(value: string): DateTime | null {
  const dt = DateTime.fromISO(value, { setZone: true });
  return dt.isValid ? dt : null;
}

/**
 * Formats a {@link DateTime} (or `Date`) as an `xsd:dateTime` string equal to
 * Python's `datetime.isoformat()`: `YYYY-MM-DDTHH:MM:SS[.ffffff]±HH:MM`, with a
 * 6-digit fractional part only when sub-second precision is present, and `+00:00`
 * (never `Z`) for UTC.
 *
 * @param value The instant to format.
 * @returns The ISO-8601 representation matching Python `isoformat()`.
 */
export function toXsdDateTime(value: DateTime | Date): string {
  const dt = value instanceof DateTime ? value : DateTime.fromJSDate(value);
  const base = dt.toFormat("yyyy-MM-dd'T'HH:mm:ss");
  // Python emits microseconds (6 digits) only when non-zero; luxon resolves to
  // milliseconds, so multiply up to microseconds and pad.
  const fraction =
    dt.millisecond !== 0
      ? `.${String(dt.millisecond * 1000).padStart(6, "0")}`
      : "";
  const offset = dt.toFormat("ZZ"); // "+HH:MM" form; "+00:00" for UTC
  return `${base}${fraction}${offset}`;
}
