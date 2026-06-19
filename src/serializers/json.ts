// The PROV-JSON serializer.
//
// Port of `serializers/provjson.py`. PROV-JSON
// (https://openprovenance.org/prov-json/) maps a document to a nested object
// keyed by record-type then identifier. The fiddly bits, all reproduced here:
//   - the **singleton-or-list collapse**: a second record under the same id turns
//     the slot into a list (`provjson.py:178`);
//   - the **membership HACK**: a JSON membership with several entities fans out
//     into one membership relation per entity on decode (`provjson.py:244`);
//   - `AnonymousIDGenerator` for blank-id records (keyed by record VALUE, so equal
//     blank records share an anon id);
//   - typed-literal representation (`literal_json_representation`).
// Inputs are never mutated (Python `del`s keys; we copy/destructure first).
//
// `any` appears at the JSON boundary (parsed JSON is untyped) — each use is local
// to encode/decode of a single value and noted.

import { DateTime } from "luxon";

import { Identifier, Namespace, QualifiedName } from "../identifier";
import { Literal } from "../literal";
import { toXsdDateTime, parseXsdDateTime } from "../datetime";
import { ProvDocument } from "../document";
import type { ProvBundle } from "../bundle";
import type { ProvRecord } from "../record/record";
import type { AttrValue } from "../value";
import { ProvError } from "../error";
import { type Serializer, registerSerializer } from "./serializer";
import {
  PROV_N_MAP,
  PROV_RECORD_IDS_MAP,
  PROV_ATTRIBUTE_QNAMES,
  PROV_ATTRIBUTE_LITERALS,
  PROV_ATTRIBUTES,
  PROV_ATTRIBUTES_ID_MAP,
  PROV_QUALIFIEDNAME,
  XSD_ANYURI,
  PROV_MEMBERSHIP,
  PROV_ATTR_ENTITY,
  PROV_ATTR_COLLECTION,
} from "../constants";

// A parsed-JSON object/value. `any` is unavoidable at the JSON boundary.
// ANY-BUDGET: PROV-JSON containers are dynamically shaped, narrowed locally.
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Raised for malformed PROV-JSON (`provjson.py:35`). */
export class ProvJSONException extends ProvError {
  override readonly name: string = "ProvJSONException";
}

/** Assigns stable `_:idN` identifiers to blank-id records, keyed by record value. */
class AnonymousIDGenerator {
  private readonly cache = new Map<string, Identifier>();
  private count = 0;

  getAnonId(record: ProvRecord, localPrefix = "id"): Identifier {
    // Keyed by `record.key` so equal blank records share an id (Python keys by
    // the hashable ProvRecord — `provjson.py:45`).
    const key = record.key;
    let id = this.cache.get(key);
    if (id === undefined) {
      this.count += 1;
      id = new Identifier(`_:${localPrefix}${this.count}`);
      this.cache.set(key, id);
    }
    return id;
  }
}

// ── Encoding ──────────────────────────────────────────────────────────────

/** Encodes a document to the PROV-JSON object shape (`provjson.py:126`). */
function encodeJsonDocument(document: ProvDocument): Json {
  const container = encodeJsonContainer(document);
  for (const bundle of document.bundles) {
    const bundleJson = encodeJsonContainer(bundle);
    (container["bundle"] ??= {})[String(bundle.identifier)] = bundleJson;
  }
  return container;
}

/** Encodes one container (document-level or a bundle) (`provjson.py:135`). */
function encodeJsonContainer(bundle: ProvBundle): Json {
  const container: Json = {};

  const prefixes: Record<string, string> = {};
  for (const ns of bundle.getRegisteredNamespaces()) {
    prefixes[ns.prefix] = ns.uri;
  }
  const defaultNs = bundle.getDefaultNamespace();
  if (defaultNs) {
    prefixes["default"] = defaultNs.uri;
  }
  if (Object.keys(prefixes).length > 0) {
    container["prefix"] = prefixes;
  }

  const idGenerator = new AnonymousIDGenerator();
  const realOrAnonId = (r: ProvRecord): Identifier =>
    r.identifier ?? idGenerator.getAnonId(r);

  for (const record of bundle.records) {
    const recLabel = PROV_N_MAP.get(record.getType().uri);
    if (recLabel === undefined) {
      throw new ProvJSONException(`Unknown record type ${String(record.getType())}`);
    }
    const identifier = String(realOrAnonId(record));

    const recordJson: Json = {};
    for (const [attr, values] of record.attributeEntries()) {
      if (values.length === 0) {
        continue;
      }
      const attrName = String(attr);
      if (PROV_ATTRIBUTE_QNAMES.has(attr.uri)) {
        recordJson[attrName] = String(values[0]); // a single QName, as a string
      } else if (PROV_ATTRIBUTE_LITERALS.has(attr.uri)) {
        const value = values[0]!;
        recordJson[attrName] =
          value instanceof DateTime ? toXsdDateTime(value) : String(value);
      } else if (values.length === 1) {
        recordJson[attrName] = encodeJsonRepresentation(values[0]!);
      } else {
        recordJson[attrName] = values.map((v) => encodeJsonRepresentation(v));
      }
    }

    const group = (container[recLabel] ??= {});
    if (!(identifier in group)) {
      group[identifier] = recordJson; // first instance of this id
    } else {
      // The singleton-or-list collapse (provjson.py:178).
      if (!Array.isArray(group[identifier])) {
        group[identifier] = [group[identifier]];
      }
      group[identifier].push(recordJson);
    }
  }
  return container;
}

/** Encodes a single attribute value to its PROV-JSON form (`provjson.py:296`). */
function encodeJsonRepresentation(value: AttrValue): Json {
  if (value instanceof Literal) {
    return literalJsonRepresentation(value);
  }
  if (value instanceof DateTime) {
    return { $: toXsdDateTime(value), type: "xsd:dateTime" };
  }
  if (value instanceof QualifiedName) {
    return { $: String(value), type: String(PROV_QUALIFIEDNAME) };
  }
  if (value instanceof Identifier) {
    return { $: value.uri, type: "xsd:anyURI" };
  }
  if (typeof value === "number") {
    // JS has one number type; Python keys int→xsd:int, float→xsd:double. Use the
    // integral-ness of the value as the closest deterministic proxy (DEVIATIONS D5).
    return { $: value, type: Number.isInteger(value) ? "xsd:int" : "xsd:double" };
  }
  // string / boolean are represented natively in PROV-JSON.
  return value;
}

/** The JSON form of a typed/tagged literal (`provjson.py:334`). */
function literalJsonRepresentation(literal: Literal): Json {
  if (literal.langtag) {
    return { $: literal.value, lang: literal.langtag };
  }
  return { $: literal.value, type: String(literal.datatype) };
}

// ── Decoding ────────────────────────────────────────────────────────────────

/** Decodes a PROV-JSON object into the given document (`provjson.py:194`). */
function decodeJsonDocument(content: Json, document: ProvDocument): void {
  // Copy without mutating the parsed input (Python `del content["bundle"]`).
  const { bundle: bundles, ...containerContent } = content;
  decodeJsonContainer(containerContent, document);
  if (bundles) {
    for (const bundleId of Object.keys(bundles)) {
      // `document.bundle()` creates + registers the child with the document as
      // parent — sidestepping the (deferred) `add_bundle` mutation path.
      const child = document.bundle(bundleId);
      decodeJsonContainer(bundles[bundleId], child);
    }
  }
}

/** Decodes one container's prefixes and records into `bundle` (`provjson.py:208`). */
function decodeJsonContainer(jc: Json, bundle: ProvBundle): void {
  const { prefix: prefixes, ...records } = jc;
  if (prefixes) {
    for (const [prefix, uri] of Object.entries(prefixes)) {
      if (prefix !== "default") {
        bundle.addNamespace(new Namespace(prefix, uri as string));
      } else {
        bundle.setDefaultNamespace(uri as string);
      }
    }
  }

  for (const recTypeStr of Object.keys(records)) {
    const recType = PROV_RECORD_IDS_MAP.get(recTypeStr);
    if (recType === undefined) {
      throw new ProvJSONException(`Unknown record type "${recTypeStr}"`);
    }
    const recordsOfType = records[recTypeStr];
    for (const recId of Object.keys(recordsOfType)) {
      const content = recordsOfType[recId];
      const elements = Array.isArray(content) ? content : [content];
      for (const element of elements) {
        decodeRecord(recType, recId, element, bundle);
      }
    }
  }
}

/** Decodes a single record element, handling the membership HACK (`provjson.py:228`). */
function decodeRecord(
  recType: QualifiedName,
  recId: string,
  element: Json,
  bundle: ProvBundle,
): void {
  const attributes: Array<[QualifiedName, AttrValue | null]> = [];
  const otherAttributes: Array<[QualifiedName, AttrValue]> = [];
  let membershipExtraMembers: Json[] | null = null;
  let collectionValue: AttrValue | null = null;

  for (const [attrName, rawValues] of Object.entries(element)) {
    const attr =
      PROV_ATTRIBUTES_ID_MAP.get(attrName) ??
      bundle.mandatoryValidQname(attrName);

    if (PROV_ATTRIBUTES.has(attr.uri)) {
      let value: Json;
      if (Array.isArray(rawValues)) {
        if (rawValues.length > 1) {
          if (
            recType.uri === PROV_MEMBERSHIP.uri &&
            attr.uri === PROV_ATTR_ENTITY.uri
          ) {
            // Membership with multiple entities → fan out (provjson.py:244).
            membershipExtraMembers = rawValues.slice(1);
            value = rawValues[0];
          } else {
            throw new ProvJSONException(
              "The prov package does not support PROV attributes having multiple values.",
            );
          }
        } else {
          value = rawValues[0];
        }
      } else {
        value = rawValues;
      }
      const resolved: AttrValue | null = PROV_ATTRIBUTE_QNAMES.has(attr.uri)
        ? bundle.validQualifiedName(value)
        : parseXsdDateTime(value);
      attributes.push([attr, resolved]);
      if (attr.uri === PROV_ATTR_COLLECTION.uri) {
        collectionValue = resolved;
      }
    } else if (Array.isArray(rawValues)) {
      for (const v of rawValues) {
        otherAttributes.push([attr, decodeJsonRepresentation(v, bundle)]);
      }
    } else {
      otherAttributes.push([attr, decodeJsonRepresentation(rawValues, bundle)]);
    }
  }

  bundle.newRecord(recType, recId, attributes, otherAttributes);

  if (membershipExtraMembers && collectionValue instanceof QualifiedName) {
    for (const member of membershipExtraMembers) {
      bundle.hadMember(collectionValue, bundle.mandatoryValidQname(member));
    }
  }
}

/** Decodes a single attribute value from its PROV-JSON form (`provjson.py:313`). */
function decodeJsonRepresentation(literal: Json, bundle: ProvBundle): AttrValue {
  if (literal !== null && typeof literal === "object" && !Array.isArray(literal)) {
    const value = literal["$"];
    const datatypeStr = "type" in literal ? literal["type"] : null;
    const datatype =
      datatypeStr != null ? bundle.validQualifiedName(datatypeStr) : null;
    const langtag = "lang" in literal ? literal["lang"] : null;
    if (datatype !== null && datatype.uri === XSD_ANYURI.uri) {
      return new Identifier(value);
    }
    if (datatype !== null && datatype.uri === PROV_QUALIFIEDNAME.uri) {
      const qn = bundle.validQualifiedName(value);
      if (qn === null) {
        throw new ProvJSONException(`Invalid qualified name "${String(value)}"`);
      }
      return qn;
    }
    return new Literal(value, datatype ?? undefined, langtag ?? undefined);
  }
  return literal; // a simple JSON scalar
}

/** PROV-JSON serializer (`provjson.py:60`). */
export class ProvJsonSerializer implements Serializer {
  /** Encodes the document to a PROV-JSON string. */
  serialize(doc: ProvDocument): string {
    return JSON.stringify(encodeJsonDocument(doc));
  }

  /** Parses a PROV-JSON string/bytes into a new document. */
  deserialize(input: string | Uint8Array): ProvDocument {
    const text =
      typeof input === "string" ? input : new TextDecoder().decode(input);
    const document = new ProvDocument();
    decodeJsonDocument(JSON.parse(text), document);
    return document;
  }
}

registerSerializer("json", () => new ProvJsonSerializer());
