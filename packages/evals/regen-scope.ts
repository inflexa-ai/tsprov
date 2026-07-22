// Scoped control over golden/snapshot regeneration for the eval harness.
//
// A blanket `TSPROV_EVAL_REGEN=1` used to re-bless every committed artifact across three
// independent families at once (~420 files: the corpus counts snapshot, the interactive
// payload goldens, and the size budgets). That is a footgun — one stray command silently
// overwrites reviewed reference data that a human is supposed to diff. So the env var now
// names WHICH family to regenerate; the literal "1" (and any other unknown value) is
// rejected loudly so it can never re-bless anything by accident.

/** The regeneration families, one per committed reference corpus a test owns. */
export type RegenFamily = "counts" | "interactive" | "budgets";

/** The accepted `TSPROV_EVAL_REGEN` values: a single family, or "all" for every family. */
const VALID_SCOPES: readonly string[] = ["counts", "interactive", "budgets", "all"];

/**
 * Whether the calling test's `family` should regenerate its committed artifacts this run,
 * per the scoped `TSPROV_EVAL_REGEN` env var. Unset/empty → never regenerate (assert against
 * the committed reference). A named family regenerates ONLY that family; "all" regenerates
 * every family. Any other value — notably the retired blanket "1" — THROWS, which fails the
 * calling test with a message naming the valid scopes: the whole point of scoping is that no
 * single value may silently re-bless artifacts the maintainer never chose to touch.
 */
export function shouldRegen(family: RegenFamily): boolean {
  const raw = process.env.TSPROV_EVAL_REGEN;
  if (raw === undefined || raw === "") return false;
  if (raw === "all" || raw === family) return true;
  // A valid scope, just not this family's: assert as normal, don't regenerate.
  if (VALID_SCOPES.includes(raw)) return false;
  throw new Error(
    `TSPROV_EVAL_REGEN=${JSON.stringify(raw)} is not a valid regen scope. ` +
      `Name the family to regenerate — one of: ${VALID_SCOPES.join(", ")} ` +
      `("all" regenerates every family; a single family regenerates only its own artifacts). ` +
      `Raising a size budget is NOT a regeneration: hand-edit budgets.json as a reviewed diff.`,
  );
}
