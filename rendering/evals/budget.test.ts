import { test, expect } from "bun:test";
import { readdirSync, existsSync, statSync } from "node:fs";

// The size-budget ratchet: build each publishable rendering package's entry the way
// it ships (minified, peer/deps external), gzip it, and fail if it outweighs its
// committed budget. The budget is measured-plus-~10% headroom, so ordinary code
// growth is fine but a surprise weight gain (a heavy import, a mis-externalized dep)
// turns the test red with the measured-vs-budgeted numbers.

const RENDERING_DIR = `${import.meta.dir}/..`;
const BUDGETS_PATH = `${import.meta.dir}/budgets.json`;

/** A publishable rendering package with a build entry point. */
type Buildable = { readonly name: string; readonly entry: string };

/** The committed budgets file shape. */
type Budgets = {
  readonly packages: Record<
    string,
    { readonly gzipBudgetBytes: number; readonly measuredSeedBytes: number }
  >;
};

function loadBuildables(): Buildable[] {
  const buildables: Buildable[] = [];
  for (const entry of readdirSync(RENDERING_DIR).sort()) {
    const dir = `${RENDERING_DIR}/${entry}`;
    const pkgPath = `${dir}/package.json`;
    const entryPath = `${dir}/src/index.ts`;
    if (!statSync(dir).isDirectory() || !existsSync(pkgPath)) continue;
    // Our own committed manifest, read as data.
    const manifest = require(pkgPath) as { name?: string; private?: boolean };
    // Private packages (the eval harness) ship nothing — no budget applies.
    if (manifest.private === true || manifest.name === undefined) continue;
    if (!existsSync(entryPath)) continue;
    buildables.push({ name: manifest.name, entry: entryPath });
  }
  return buildables;
}

/** Builds a package entry the way it ships and returns its gzipped minified byte size. */
async function measureGzipBytes(entry: string): Promise<number> {
  const built = await Bun.build({
    entrypoints: [entry],
    minify: true,
    // Externalize every package import: this measures the package's OWN shipped
    // weight, excluding the peer (tsprov) and any heavy peer deps a renderer carries.
    packages: "external",
    target: "node",
  });
  expect(built.success).toBe(true);
  const artifact = built.outputs[0];
  if (artifact === undefined) throw new Error(`no build output for ${entry}`);
  const bytes = new Uint8Array(await artifact.arrayBuffer());
  return Bun.gzipSync(bytes).length;
}

async function loadBudgets(): Promise<Budgets | null> {
  const file = Bun.file(BUDGETS_PATH);
  if (!(await file.exists())) return null;
  return (await file.json()) as Budgets;
}

test("every publishable rendering package fits its gzipped size budget", async () => {
  const buildables = loadBuildables();
  expect(buildables.length).toBeGreaterThanOrEqual(1); // render-core at minimum

  const measured: Record<string, number> = {};
  for (const { name, entry } of buildables) {
    measured[name] = await measureGzipBytes(entry);
  }

  const budgets = await loadBudgets();
  if (budgets === null || process.env.TSPROV_EVAL_REGEN === "1") {
    // Seed a budget of measured + ~10% headroom, recording the seed measurement.
    const packages = Object.fromEntries(
      Object.keys(measured)
        .sort()
        .map((name) => {
          const bytes = measured[name] ?? 0;
          return [
            name,
            {
              gzipBudgetBytes: Math.ceil((bytes * 1.1) / 10) * 10,
              measuredSeedBytes: bytes,
            },
          ];
        }),
    );
    await Bun.write(
      BUDGETS_PATH,
      `${JSON.stringify({ packages }, null, 2)}\n`,
    );
    return;
  }

  for (const { name } of buildables) {
    const budget = budgets.packages[name];
    // Every publishable package must carry a committed budget.
    expect(`${name} has a budget: ${budget !== undefined}`).toBe(
      `${name} has a budget: true`,
    );
    if (budget === undefined) continue;
    const bytes = measured[name] ?? 0;
    expect(
      `${name} gzip ${bytes} <= budget ${budget.gzipBudgetBytes}: ${bytes <= budget.gzipBudgetBytes}`,
    ).toBe(
      `${name} gzip ${bytes} <= budget ${budget.gzipBudgetBytes}: true`,
    );
  }
});
