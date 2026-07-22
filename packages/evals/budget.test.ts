import { test, expect } from "bun:test";
import { readdirSync, existsSync, statSync } from "node:fs";
import { shouldRegen } from "./regen-scope.js";

// The size-budget ratchet: build each publishable rendering package's entry the way
// it ships (minified, peer/deps external), gzip it, and fail if it outweighs its
// committed budget. The budget is measured-plus-~10% headroom, so ordinary code
// growth is fine but a surprise weight gain (a heavy import, a mis-externalized dep)
// turns the test red with the measured-vs-budgeted numbers.
//
// Regenerate (ratchet DOWN only) with `TSPROV_EVAL_REGEN=budgets` (or `=all`). Regen can
// tighten a budget to track lighter code but can NEVER raise one — a raise is a reviewed
// hand-edit of budgets.json. See the regen block below and ./regen-scope.ts.

const TSPROV = "@inflexa-ai/tsprov";
const PACKAGES_DIR = `${import.meta.dir}/..`;
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
  for (const entry of readdirSync(PACKAGES_DIR).sort()) {
    const dir = `${PACKAGES_DIR}/${entry}`;
    const pkgPath = `${dir}/package.json`;
    const entryPath = `${dir}/src/index.ts`;
    if (!statSync(dir).isDirectory() || !existsSync(pkgPath)) continue;
    // Our own committed manifest, read as data.
    const manifest = require(pkgPath) as { name?: string; private?: boolean };
    // The core `@inflexa-ai/tsprov` now shares the packages/ root but carries no render
    // size budget (it answers to the core's own weight regime); skip it so the sweep stays
    // scoped to the render family. Private packages (the eval harness) ship nothing either.
    if (manifest.name === TSPROV) continue;
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

/** A package's seed budget: measured gzip bytes plus ~10% headroom, rounded up to 10. */
function seedBudget(bytes: number): { gzipBudgetBytes: number; measuredSeedBytes: number } {
  return { gzipBudgetBytes: Math.ceil((bytes * 1.1) / 10) * 10, measuredSeedBytes: bytes };
}

test("every publishable rendering package fits its gzipped size budget", async () => {
  const buildables = loadBuildables();
  expect(buildables.length).toBeGreaterThanOrEqual(1); // render-core at minimum

  const measured: Record<string, number> = {};
  for (const { name, entry } of buildables) {
    measured[name] = await measureGzipBytes(entry);
  }

  // Reads the env FIRST so an invalid scope (e.g. the retired blanket "1") fails loudly
  // before either the seed or the ratchet path runs.
  const regen = shouldRegen("budgets");
  const budgets = await loadBudgets();

  if (budgets === null) {
    // First run only: no committed budgets yet, so seed every package at measured + headroom.
    const packages = Object.fromEntries(
      Object.keys(measured)
        .sort()
        .map((name) => [name, seedBudget(measured[name] ?? 0)]),
    );
    await Bun.write(BUDGETS_PATH, `${JSON.stringify({ packages }, null, 2)}\n`);
    return;
  }

  if (regen) {
    // The ratchet only turns DOWN — that direction IS its entire value. Regeneration may
    // lower a committed budget to track code that got lighter, but it may NEVER raise one:
    // a budget that would go up means the package grew past its reviewed ceiling, and
    // blessing that silently is exactly the regression the ratchet exists to catch. So a
    // proposed increase fails the test even under regen; raising a ceiling is a deliberate
    // hand-edit of budgets.json (a reviewed diff), never a mechanical re-bless.
    const next: Record<string, { gzipBudgetBytes: number; measuredSeedBytes: number }> = {};
    const raises: string[] = [];
    for (const name of Object.keys(measured).sort()) {
      const bytes = measured[name] ?? 0;
      const seed = seedBudget(bytes);
      const committed = budgets.packages[name];
      if (committed === undefined) {
        // A newly added package has no committed ceiling yet — seed it (this is not a raise).
        next[name] = seed;
        continue;
      }
      if (seed.gzipBudgetBytes > committed.gzipBudgetBytes) {
        raises.push(
          `${name}: measured ${bytes} → proposed ${seed.gzipBudgetBytes} > committed ${committed.gzipBudgetBytes}`,
        );
      }
      // Ratchet down (or hold): never write a value above the committed ceiling.
      next[name] = seed.gzipBudgetBytes <= committed.gzipBudgetBytes ? seed : committed;
    }
    if (raises.length > 0) {
      throw new Error(
        `regen refused: the size-budget ratchet may only LOWER a committed budget, never raise one.\n` +
          `These packages grew past their committed ceiling:\n  ${raises.join("\n  ")}\n` +
          `Raising a budget is a reviewed hand-edit of budgets.json, not a regeneration — ` +
          `edit the number by hand so the increase shows up as a diff a reviewer signs off on.`,
      );
    }
    await Bun.write(BUDGETS_PATH, `${JSON.stringify({ packages: next }, null, 2)}\n`);
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
