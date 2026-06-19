// `read()` — the convenience reader with format auto-detection.
//
// Port of `read()` (`__init__.py:23`). Given serialized content and an optional
// format, returns a `ProvDocument`. With no format, it probes each registered
// serializer in turn (Python's lazy try/except loop, `__init__.py:47-53`) — a
// format whose `deserialize` throws (e.g. PROV-N, or JSON on non-JSON input) is
// skipped; if none succeed, a `TypeError` is raised.
//
// File/URL loading is the caller's job (the async I/O edge): pass the text, e.g.
// `read(await Bun.file(path).text())`.

import { ProvDocument } from "./document";
import { registeredFormats } from "./serializers/serializer";

/**
 * Parses serialized PROV content into a {@link ProvDocument}.
 *
 * @param content The serialized document text (or bytes).
 * @param format  Optional format name; omit to auto-detect by probing serializers.
 * @returns The parsed document.
 * @throws {TypeError} If `format` is omitted and no registered format can parse the content.
 */
export function read(
  content: string | Uint8Array,
  format?: string,
): ProvDocument {
  if (format !== undefined) {
    return ProvDocument.deserialize(content, format);
  }
  for (const name of registeredFormats()) {
    try {
      return ProvDocument.deserialize(content, name);
    } catch {
      // This format did not match; try the next one (like Python's bare except).
    }
  }
  throw new TypeError(
    "Could not read the source: no registered format could parse it. " +
      "Pass an explicit `format` for a precise error.",
  );
}
