import { test, expect, describe } from "bun:test";

import { ns } from "./intern.js";
import {
  XSD,
  PROV,
  XSI,
  PROV_ENTITY,
  PROV_ACTIVITY,
  PROV_DERIVATION,
  PROV_REVISION,
  PROV_PLAN,
  PROV_MEMBERSHIP,
  PROV_ATTR_ENTITY,
  PROV_ATTR_TIME,
  PROV_ATTR_ENDTIME,
  PROV_N_MAP,
  PROV_RECORD_IDS_MAP,
  ADDITIONAL_N_MAP,
  PROV_BASE_CLS,
  PROV_ATTRIBUTE_QNAMES,
  PROV_ATTRIBUTE_LITERALS,
  PROV_ATTRIBUTES,
  PROV_ATTRIBUTES_ORDER,
  PROV_ID_ATTRIBUTES_MAP,
  PROV_ATTRIBUTES_ID_MAP,
  XSD_INT,
  XSD_DOUBLE,
} from "./constants.js";

describe("namespaces", () => {
  test("are interned singletons with the right URIs", () => {
    expect(PROV.uri).toBe("http://www.w3.org/ns/prov#");
    expect(XSD.uri).toBe("http://www.w3.org/2001/XMLSchema#");
    expect(XSI.uri).toBe("http://www.w3.org/2001/XMLSchema-instance");
    expect(PROV).toBe(ns("prov", "http://www.w3.org/ns/prov#")); // same instance
  });
});

describe("type QNames", () => {
  test("have the expected URIs and are interned singletons", () => {
    expect(PROV_ENTITY.uri).toBe("http://www.w3.org/ns/prov#Entity");
    expect(PROV_ENTITY).toBe(PROV.qn("Entity"));
    expect(String(PROV_ENTITY)).toBe("prov:Entity");
    expect(XSD_INT.uri).toBe("http://www.w3.org/2001/XMLSchema#int");
    expect(XSD_DOUBLE.uri).toBe("http://www.w3.org/2001/XMLSchema#double");
  });
});

describe("PROV_N_MAP / PROV_RECORD_IDS_MAP", () => {
  test("map type → PROV-N name, keyed by URI", () => {
    expect(PROV_N_MAP.get(PROV_ENTITY.uri)).toBe("entity");
    expect(PROV_N_MAP.get(PROV_DERIVATION.uri)).toBe("wasDerivedFrom");
    expect(PROV_N_MAP.get(PROV_MEMBERSHIP.uri)).toBe("hadMember");
    expect(PROV_N_MAP.size).toBe(19);
  });

  test("the inverse maps PROV-N name → type QName", () => {
    expect(PROV_RECORD_IDS_MAP.get("entity")).toBe(PROV_ENTITY);
    expect(PROV_RECORD_IDS_MAP.get("wasGeneratedBy")).toBe(
      PROV.qn("Generation"),
    );
    expect(PROV_RECORD_IDS_MAP.size).toBe(19);
  });

  test("the two maps are exact inverses", () => {
    for (const [uri, name] of PROV_N_MAP) {
      expect(PROV_RECORD_IDS_MAP.get(name)!.uri).toBe(uri);
    }
  });
});

describe("ADDITIONAL_N_MAP", () => {
  test("covers the 9 subtype names, keyed by URI", () => {
    expect(ADDITIONAL_N_MAP.get(PROV_REVISION.uri)).toBe("wasRevisionOf");
    expect(ADDITIONAL_N_MAP.get(PROV.qn("EmptyCollection").uri)).toBe(
      "emptyCollection",
    );
    expect(ADDITIONAL_N_MAP.size).toBe(9);
  });
});

describe("PROV_BASE_CLS", () => {
  test("maps subtypes to their base class and base types to themselves", () => {
    expect(PROV_BASE_CLS.get(PROV_ENTITY.uri)).toBe(PROV_ENTITY); // self
    expect(PROV_BASE_CLS.get(PROV_REVISION.uri)).toBe(PROV_DERIVATION); // subtype → base
    expect(PROV_BASE_CLS.get(PROV_PLAN.uri)).toBe(PROV_ENTITY); // Plan is an Entity
    expect(PROV_BASE_CLS.get(PROV.qn("SoftwareAgent").uri)).toBe(
      PROV.qn("Agent"),
    );
    expect(PROV_BASE_CLS.size).toBe(28);
  });
});

describe("attribute sets", () => {
  test("have the expected cardinalities and partition", () => {
    expect(PROV_ATTRIBUTE_QNAMES.size).toBe(23);
    expect(PROV_ATTRIBUTE_LITERALS.size).toBe(3);
    expect(PROV_ATTRIBUTES.size).toBe(26);
  });

  test("membership is keyed by URI; literals and qnames are disjoint", () => {
    expect(PROV_ATTRIBUTE_QNAMES.has(PROV_ATTR_ENTITY.uri)).toBe(true);
    expect(PROV_ATTRIBUTE_LITERALS.has(PROV_ATTR_TIME.uri)).toBe(true);
    expect(PROV_ATTRIBUTE_QNAMES.has(PROV_ATTR_TIME.uri)).toBe(false);
    expect(PROV_ATTRIBUTES.has(PROV_ATTR_ENTITY.uri)).toBe(true);
    expect(PROV_ATTRIBUTES.has(PROV_ATTR_TIME.uri)).toBe(true);
  });

  test("PROV_ATTRIBUTES_ORDER is canonical: QNames first, literals last", () => {
    expect(PROV_ATTRIBUTES_ORDER.length).toBe(26);
    expect(PROV_ATTRIBUTES_ORDER[0]).toBe(PROV_ATTR_ENTITY);
    expect(PROV_ATTRIBUTES_ORDER.at(-1)).toBe(PROV_ATTR_ENDTIME);
  });
});

describe("attribute id maps", () => {
  test("PROV_ID_ATTRIBUTES_MAP: URI → prov:-prefixed display string", () => {
    expect(PROV_ID_ATTRIBUTES_MAP.get(PROV_ATTR_ENTITY.uri)).toBe("prov:entity");
    // The RDF serializer relies on splitting on "prov:" — verify that works.
    expect(PROV_ID_ATTRIBUTES_MAP.get(PROV_ATTR_ENTITY.uri)!.split("prov:")[1]).toBe(
      "entity",
    );
  });

  test("PROV_ATTRIBUTES_ID_MAP: display string → QName (inverse)", () => {
    expect(PROV_ATTRIBUTES_ID_MAP.get("prov:entity")).toBe(PROV_ATTR_ENTITY);
    expect(PROV_ATTRIBUTES_ID_MAP.get("prov:time")).toBe(PROV_ATTR_TIME);
    expect(PROV_ATTRIBUTES_ID_MAP.size).toBe(26);
  });
});
