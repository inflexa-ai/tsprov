import { test, expect } from "bun:test";
import { ProvDocument, ns } from "@inflexa-ai/tsprov";

import { toRenderScene } from "./scene.js";
import { PROV_THEME } from "./theme.js";
import type { NodeKind } from "./theme.js";
import type { Renderer, RendererOptions } from "./renderer.js";

const ex = ns("ex", "http://example.org/");

/**
 * A minimal renderer proving the contract is implementable: it projects the scene
 * and emits one line per node and edge. Real renderers (dot/mermaid/…) do the same
 * over richer output types.
 */
class LineRenderer implements Renderer<string> {
  readonly format = "lines";

  render(doc: ProvDocument, options?: RendererOptions): string {
    const theme = { ...PROV_THEME, ...options?.theme };
    const scene = toRenderScene(doc, options);
    const shapeOf = (kind: NodeKind): string =>
      kind === "unknown"
        ? theme.generic.unknown.shape
        : theme.nodes[kind].shape;
    const nodeLines = scene.nodes.map(
      (n) => `${n.id} ${n.kind}[${shapeOf(n.kind)}] ${n.label}`,
    );
    const edgeLines = scene.edges.map(
      (e) => `${e.source} -${e.label}-> ${e.target}`,
    );
    return [...nodeLines, ...edgeLines].join("\n");
  }
}

test("a class implements Renderer<string> and renders through the interface", () => {
  const doc = new ProvDocument();
  doc.addNamespace(ex.prefix, ex.uri);
  const article = doc.entity(ex.qn("article"));
  const edit = doc.activity(ex.qn("edit"));
  article.wasGeneratedBy(edit);

  // Consume via the interface type, not the concrete class.
  const renderer: Renderer<string> = new LineRenderer();
  expect(renderer.format).toBe("lines");

  const out = renderer.render(doc);
  expect(typeof out).toBe("string");
  expect(out).toContain("n1 entity[oval] ex:article");
  expect(out).toContain("n2 activity[box] ex:edit");
  expect(out).toContain("n1 -wasGeneratedBy-> n2");
});

test("renderer options flow through to the projection", () => {
  const doc = new ProvDocument();
  doc.addNamespace(ex.prefix, ex.uri);
  const e = doc.entity(ex.qn("e"));
  e.wasAttributedTo(ex.qn("agent"));

  const renderer: Renderer<string> = new LineRenderer();
  // showNary:false is a SceneOption reachable via RendererOptions.
  const out = renderer.render(doc, { showNary: false });
  expect(out).toContain("-wasAttributedTo->");
});
