// The PROV-N serializer (serialize-only).
//
// Port of `serializers/provn.py`. Serialization simply delegates to the
// document's `getProvN()`; deserialization is unsupported (Python raises
// `NotImplementedError`, `provn.py:31` — we raise our `UnsupportedOperationError`).

import type { ProvDocument } from "../document.js";
import {
  type Serializer,
  UnsupportedOperationError,
  registerSerializer,
} from "./serializer.js";

/** Serialize-only PROV-N serializer (`provn.py`). */
export class ProvNSerializer implements Serializer {
  /** Returns the document's PROV-N text. */
  serialize(doc: ProvDocument): string {
    return doc.getProvN();
  }

  /** Always throws — PROV-N has no parser (`provn.py:31`). */
  deserialize(): ProvDocument {
    throw new UnsupportedOperationError(
      "PROV-N deserialization is not supported.",
    );
  }
}

registerSerializer("provn", () => new ProvNSerializer());
