/**
 * P20.3b — WHICH cards get a no-op ablation, and why most do not.
 *
 * The measurement costs TWO full test runs of the selection. On a cap-1 local host that is real time taken from
 * the board, so "ablate every card" is not a policy, it is a tax. This decides where the two runs are actually
 * worth spending.
 *
 * ── WHY SKIPPING IS SAFE HERE, WHICH IS NOT USUALLY TRUE OF A SKIPPED CHECK ──
 * `foldAblationIntoAcceptance(null)` returns `unmeasured` — never `supported`, never a hold. So a card that was
 * never ablated carries "we do not know", not "it passed". That composition is what lets this be aggressive
 * about skipping: the cost of a skip is a missing signal, plainly labelled, and never a false green.
 *
 * ── THE FIVE REASONS TO SKIP, EACH BECAUSE THE RUN COULD NOT ANSWER ANYTHING ──
 * Every skip below is "the measurement is not defined here", not "we could not be bothered". A policy that
 * skipped for expedience would eventually skip the case that mattered.
 */

export type AblationSkipReason =
	/** The card's diff touched no files at all. */
	| "no_changed_files"
	/**
	 * Files changed, but none is a stubbable TypeScript module. The ablation harness stubs `src/**\/*.ts` and
	 * re-runs vitest, so it is TypeScript-and-vitest specific BY CONSTRUCTION — a Python or Go project is not a
	 * card that changed nothing, it is a project this measurement does not apply to. Found on the first live run
	 * against a fixture project, where every card reported "no source change" while changing two real files.
	 */
	| "no_ablatable_module"
	/** The changed modules have no exercising test, so the ablated run has no baseline-green test to break. */
	| "no_exercising_test"
	/** The card's own tests are already red: the assessor would correctly return `inconclusive` from two runs. */
	| "baseline_not_green"
	/** More modules changed than the budget allows to measure one at a time. */
	| "too_many_changed_modules";

export interface AblationSchedulingDecision {
	readonly run: boolean;
	/** Present only when `run` is false. */
	readonly skipReason?: AblationSkipReason;
	readonly detail: string;
	/** The modules to ablate, one run each. Empty when `run` is false. */
	readonly modules: readonly string[];
}

/** At most this many modules per card. Beyond it the card is a refactor, and N×2 suite runs is not a check. */
export const MAX_ABLATED_MODULES_PER_CARD = 3;

const isSourceModule = (path: string): boolean =>
	path.startsWith("src/") && path.endsWith(".ts") && !path.endsWith(".d.ts") && !path.endsWith(".test.ts");

/**
 * Decide whether a delivered card earns an ablation.
 *
 * `exercisingTestsByModule` is the caller's pairing (conventional path, else importer grep) — a module absent
 * from it, or present with an empty list, has no exercising test.
 */
export function decideCardAblation(input: {
	readonly changedFiles: readonly string[];
	readonly acceptancePassed: boolean;
	readonly exercisingTestsByModule: Readonly<Record<string, readonly string[]>>;
}): AblationSchedulingDecision {
	if (input.changedFiles.length === 0) {
		return {
			run: false,
			skipReason: "no_changed_files",
			detail: "the card's diff touched no files — there is nothing to stub",
			modules: [],
		};
	}
	const changedModules = input.changedFiles.filter(isSourceModule);
	if (changedModules.length === 0) {
		return {
			run: false,
			skipReason: "no_ablatable_module",
			detail: `${input.changedFiles.length} file(s) changed but none is a stubbable \`src/**/*.ts\` module — this measurement is TypeScript-and-vitest specific, so a project of another shape is not a card that changed nothing`,
			modules: [],
		};
	}

	// Checked BEFORE the exercising-test lookup so the cheaper, more definite reason wins: a red suite makes the
	// measurement undefined no matter how well the modules are paired.
	if (!input.acceptancePassed) {
		return {
			run: false,
			skipReason: "baseline_not_green",
			detail:
				"the card's acceptance is not green, so every test is already failing at baseline and the assessor would return `inconclusive` after paying for two runs",
			modules: [],
		};
	}

	const measurable = changedModules.filter((module) => (input.exercisingTestsByModule[module] ?? []).length > 0);
	if (measurable.length === 0) {
		return {
			run: false,
			skipReason: "no_exercising_test",
			detail:
				"no changed module has an exercising test, so the ablated run has no baseline-green test left to break",
			modules: [],
		};
	}

	if (measurable.length > MAX_ABLATED_MODULES_PER_CARD) {
		return {
			run: false,
			skipReason: "too_many_changed_modules",
			detail: `${measurable.length} measurable modules exceeds the ${MAX_ABLATED_MODULES_PER_CARD}-module budget (${measurable.length * 2} suite runs) — this is a refactor, and ablating it one module at a time is not a check, it is a rebuild`,
			modules: [],
		};
	}

	return {
		run: true,
		detail: `${measurable.length} changed module(s) have exercising tests and the suite is green — the ablation can distinguish load-bearing from decorative`,
		modules: measurable,
	};
}
