// The serializer contract and registry.
//
// Port of `serializers/__init__.py`. Redesigned for TS (`04 §7.1`): a serializer
// returns a value (no `io.IOBase` streams); the document owns format dispatch.
// Formats register themselves on import (the core ones from `document.ts`; the
// optional XML/RDF from their subpath modules).

import { ProvError } from "../error";
import type { ProvDocument } from "../document";

/** Options passed to {@link Serializer.serialize} (format-specific). */
export type SerializeOptions = Record<string, unknown>;
/** Options passed to {@link Serializer.deserialize} (format-specific). */
export type DeserializeOptions = Record<string, unknown>;

/** A bidirectional PROV serializer for one format. */
export interface Serializer {
  /** Encodes a document to text (or bytes, for binary formats). */
  serialize(doc: ProvDocument, options?: SerializeOptions): string | Uint8Array;
  /** Decodes input to a document; may throw {@link UnsupportedOperationError} for serialize-only formats. */
  deserialize(
    input: string | Uint8Array,
    options?: DeserializeOptions,
  ): ProvDocument;
}

/** Thrown when no serializer is registered for a requested format (`serializers/__init__.py:49`). */
export class DoNotExist extends ProvError {
  override readonly name: string = "DoNotExist";
}

/** Thrown by serialize-only formats (e.g. PROV-N) when `deserialize` is called (`provn.py:31`). */
export class UnsupportedOperationError extends ProvError {
  override readonly name: string = "UnsupportedOperationError";
}

const REGISTRY = new Map<string, () => Serializer>();

/**
 * Registers a serializer factory under a format name.
 *
 * @param name Format name (e.g. `"json"`, `"provn"`).
 * @param make Factory producing a fresh {@link Serializer}.
 */
export function registerSerializer(name: string, make: () => Serializer): void {
  REGISTRY.set(name, make);
}

/**
 * Returns a serializer for the named format.
 *
 * @param name Format name.
 * @returns A fresh serializer instance.
 * @throws {DoNotExist} If no serializer is registered for `name`.
 */
export function getSerializer(name: string): Serializer {
  const make = REGISTRY.get(name);
  if (make === undefined) {
    throw new DoNotExist(`No serializer registered for format "${name}".`);
  }
  return make();
}

/** The names of all registered serializers. */
export function registeredFormats(): string[] {
  return [...REGISTRY.keys()];
}
