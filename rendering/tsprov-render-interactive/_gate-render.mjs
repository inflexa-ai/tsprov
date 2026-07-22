// Throwaway: render prov-inflexa.2.html for the browser gate using consistent in-repo resolution.
import { ProvDocument } from "@inflexa-ai/tsprov";
import { toRenderScene } from "@inflexa-ai/tsprov-render-core";
import {
  renderInteractiveHtml,
  buildScenePayload,
  INITIAL_CAP,
  EXPAND_CAP,
  WHOLE_GRAPH_MAX,
} from "./src/interactive.ts";

const GATE = "/private/tmp/claude-504/-Users-s-ved-repos-inflexa-tsprov/d6a2ff2e-a305-4aa2-b9ca-fe9983c904ac/scratchpad/interactive-gate";
const fixture = "/Users/s-ved/repos/inflexa/tsprov/rendering/evals/fixtures/real-world/prov-inflexa.2.json";

const text = await Bun.file(fixture).text();
const doc = ProvDocument.deserialize(text, "json");
const scene = toRenderScene(doc);
const payload = buildScenePayload(doc, { title: "prov-inflexa.2" });
const d = payload.meta.disclosure;

const inc = {};
for (const n of payload.nodes) inc[n.id] = new Set();
for (const e of payload.edges) {
  const parts = [e.source, e.target, ...e.naryLegs.map((l) => l.target)];
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++)
      if (parts[i] !== parts[j]) { inc[parts[i]].add(e.id); inc[parts[j]].add(e.id); }
}
const focusDegree = d.focusId ? inc[d.focusId].size : 0;

console.log("CAPS: WHOLE_GRAPH_MAX=%d INITIAL_CAP=%d EXPAND_CAP=%d", WHOLE_GRAPH_MAX, INITIAL_CAP, EXPAND_CAP);
console.log("records=%d sceneNodes=%d payloadNodes=%d edges=%d", doc.getRecords().length, scene.nodes.length, payload.nodes.length, payload.edges.length);
console.log("wholeGraph=%s focusId=%s focusDegree=%d initialVisible=%d", d.wholeGraph, d.focusId, focusDegree, d.initialVisibleIds.length);

const html = renderInteractiveHtml(doc, { title: "prov-inflexa.2" });
await Bun.write(`${GATE}/prov-inflexa.2.html`, html);
console.log("wrote prov-inflexa.2.html (%d bytes) deterministic=%s", html.length, html === renderInteractiveHtml(doc, { title: "prov-inflexa.2" }));
