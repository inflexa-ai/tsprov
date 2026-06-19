// The PROV record-type registry: type QName → concrete record constructor.
//
// Port of `PROV_REC_CLS` (model.py:1101). Drives `ProvRecord.copy()` and the
// serializers' "type name → class" construction. Keyed by `qn.uri` (string), not
// the QName object, like every other constants map.
//
// Cycle-free by construction: this module imports ONLY types from `record.ts`
// (erased at runtime), so it is a dependency leaf. The concrete classes register
// themselves at module load (`element.ts`/`relation.ts` call
// `registerRecordClass`); `record.ts` calls `getRecordClass` from `copy()`.

import type { QualifiedName } from "../identifier";
import type { ProvRecord, RecordBundle, ProvAttributes } from "./record";

/** Constructor signature shared by every concrete record class. */
export type RecordCtor = new (
  bundle: RecordBundle,
  identifier: QualifiedName | null,
  attributes?: ProvAttributes,
) => ProvRecord;

/**
 * A {@link QualifiedName} tagged — at the type level only — with the concrete
 * record class it constructs. The fluent builders pass these so `newRecord` can
 * return the right type without a cast; `__record` is phantom (never set at
 * runtime), so a branded QName is still an ordinary `QualifiedName` everywhere else.
 */
export type RecordTypeQName<T extends ProvRecord> = QualifiedName & {
  readonly __record?: T;
};

/** `type.uri` → constructor. Mirrors `PROV_REC_CLS` (`model.py:1101`). */
const PROV_REC_CLS = new Map<string, RecordCtor>();

/**
 * Registers a concrete record class under its PROV type QName.
 *
 * @param qn   The record's type QName (its `static prov_type`).
 * @param ctor The concrete constructor.
 */
export function registerRecordClass(qn: QualifiedName, ctor: RecordCtor): void {
  PROV_REC_CLS.set(qn.uri, ctor);
}

/**
 * Looks up the constructor registered for a PROV type QName.
 *
 * @param qn The record type QName.
 * @returns The constructor, or `undefined` if no class is registered.
 */
export function getRecordClass(qn: QualifiedName): RecordCtor | undefined {
  return PROV_REC_CLS.get(qn.uri);
}

/** The number of registered record classes (18 once the class modules have loaded). */
export function registeredRecordCount(): number {
  return PROV_REC_CLS.size;
}
