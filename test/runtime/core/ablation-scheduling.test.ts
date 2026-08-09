import { describe, expect, it } from "vitest";
import { foldAblationIntoAcceptance } from "../../../src/core/ablation-acceptance";
import { decideCardAblation, MAX_ABLATED_MODULES_PER_CARD } from "../../../src/core/ablation-scheduling";

/**
 * P20.3b — the cost decision.
 *
 * An ablation costs TWO full runs of the selection, so the interesting question is not "does it run" but
 * **"is every skip a case where the measurement was undefined, rather than a case we could not be bothered
 * with?"** A policy that skipped for expedience would eventually skip the one card that mattered, so each skip
 * below is pinned together with the reason it could not have answered anything.
 *
 * The last suite is the one that makes aggressive skipping legitimate: a skip composes with
 * `foldAblationIntoAcceptance(null)` into `unmeasured` — never `supported`, never a hold. The cost of a skip is
 * a missing signal, plainly labelled. If that composition ever broke, skipping would start manufacturing green.
 */
const paired = { "src/core/thing.ts": ["test/runtime/core/thing.test.ts"] };

describe("it runs where the measurement is defined", () => {
	it("runs for a green card whose changed module has an exercising test", () => {
		const decision = decideCardAblation({
			changedFiles: ["src/core/thing.ts", "test/runtime/core/thing.test.ts", "README.md"],
			acceptancePassed: true,
			exercisingTestsByModule: paired,
			cardProjectIsRuntimeRepo: true,
		});

		expect(decision.run).toBe(true);
		expect(decision.modules).toEqual(["src/core/thing.ts"]);
	});

	it("ablates each measurable module, up to the budget", () => {
		const modules = ["src/core/a.ts", "src/core/b.ts", "src/core/c.ts"];
		const decision = decideCardAblation({
			changedFiles: modules,
			acceptancePassed: true,
			exercisingTestsByModule: Object.fromEntries(modules.map((m) => [m, ["t.test.ts"]])),
			cardProjectIsRuntimeRepo: true,
		});

		expect(decision.run).toBe(true);
		expect(decision.modules).toHaveLength(MAX_ABLATED_MODULES_PER_CARD);
	});
});

describe("every skip is a case the run could not have answered", () => {
	it("skips a card that changed no source module", () => {
		const decision = decideCardAblation({
			changedFiles: ["README.md", "todo.md", "test/runtime/core/thing.test.ts"],
			acceptancePassed: true,
			exercisingTestsByModule: paired,
			cardProjectIsRuntimeRepo: true,
		});

		expect(decision).toMatchObject({ run: false, skipReason: "no_ablatable_module" });
	});

	it("separates 'no files at all' from 'no file we can ablate'", () => {
		// Found on the first LIVE run: every card reported "no source change" while changing two real files,
		// because the harness only recognises `src/**/*.ts`. Collapsing the two says a card changed nothing when
		// the truth is that this measurement does not apply to the project's shape.
		expect(
			decideCardAblation({
				changedFiles: [],
				acceptancePassed: true,
				exercisingTestsByModule: {},
				cardProjectIsRuntimeRepo: true,
			}).skipReason,
		).toBe("no_changed_files");
		expect(
			decideCardAblation({
				changedFiles: ["app/main.py", "requirements.txt"],
				acceptancePassed: true,
				exercisingTestsByModule: {},
				cardProjectIsRuntimeRepo: true,
			}).skipReason,
		).toBe("no_ablatable_module");
	});

	it("does not treat a TEST file as a source module — there is nothing to stub in it", () => {
		// A test-only card is the common shape of a coverage card, and stubbing a test file measures nothing.
		const decision = decideCardAblation({
			changedFiles: ["src/core/thing.test.ts"],
			acceptancePassed: true,
			exercisingTestsByModule: paired,
			cardProjectIsRuntimeRepo: true,
		});

		expect(decision.skipReason).toBe("no_ablatable_module");
	});

	it("skips a RED card, because two runs would only buy an `inconclusive`", () => {
		// The assessor filters to baseline-GREEN tests; with none, stubbing cannot make anything newly fail. The
		// verdict is knowable in advance, so paying for it is pure waste.
		const decision = decideCardAblation({
			changedFiles: ["src/core/thing.ts"],
			acceptancePassed: false,
			exercisingTestsByModule: paired,
			cardProjectIsRuntimeRepo: true,
		});

		expect(decision).toMatchObject({ run: false, skipReason: "baseline_not_green" });
		expect(decision.detail).toMatch(/inconclusive/);
	});

	it("prefers the RED reason over the pairing reason when both apply", () => {
		// Ordering matters for the message a human reads: "your suite is red" is actionable and definite; "no
		// exercising test" would send them to write a test that still could not be measured.
		const decision = decideCardAblation({
			changedFiles: ["src/core/unpaired.ts"],
			acceptancePassed: false,
			exercisingTestsByModule: {},
			cardProjectIsRuntimeRepo: true,
		});

		expect(decision.skipReason).toBe("baseline_not_green");
	});

	it("skips when no changed module has an exercising test", () => {
		const decision = decideCardAblation({
			changedFiles: ["src/core/unpaired.ts"],
			acceptancePassed: true,
			exercisingTestsByModule: { "src/core/unpaired.ts": [] },
			cardProjectIsRuntimeRepo: true,
		});

		expect(decision).toMatchObject({ run: false, skipReason: "no_exercising_test" });
	});

	it("measures the paired subset when only SOME changed modules are paired", () => {
		// The partial case must not skip the whole card: one measurable module is still a real measurement.
		const decision = decideCardAblation({
			changedFiles: ["src/core/thing.ts", "src/core/unpaired.ts"],
			acceptancePassed: true,
			exercisingTestsByModule: paired,
			cardProjectIsRuntimeRepo: true,
		});

		expect(decision.run).toBe(true);
		expect(decision.modules).toEqual(["src/core/thing.ts"]);
	});

	it("skips a wide refactor rather than running N×2 suites", () => {
		const modules = Array.from({ length: MAX_ABLATED_MODULES_PER_CARD + 1 }, (_, i) => `src/core/m${i}.ts`);
		const decision = decideCardAblation({
			changedFiles: modules,
			acceptancePassed: true,
			exercisingTestsByModule: Object.fromEntries(modules.map((m) => [m, ["t.test.ts"]])),
			cardProjectIsRuntimeRepo: true,
		});

		expect(decision).toMatchObject({ run: false, skipReason: "too_many_changed_modules" });
		// The cost is named, so the budget can be argued with rather than merely obeyed.
		expect(decision.detail).toMatch(new RegExp(`${(MAX_ABLATED_MODULES_PER_CARD + 1) * 2} suite runs`));
	});

	it("never returns modules to ablate alongside a skip", () => {
		// The contract a caller relies on: `run: false` means there is nothing to schedule, so a caller reading
		// only `modules` cannot start a run the policy declined.
		for (const decision of [
			decideCardAblation({
				changedFiles: [],
				acceptancePassed: true,
				exercisingTestsByModule: {},
				cardProjectIsRuntimeRepo: true,
			}),
			decideCardAblation({
				changedFiles: ["src/a.ts"],
				acceptancePassed: false,
				exercisingTestsByModule: {},
				cardProjectIsRuntimeRepo: true,
			}),
			decideCardAblation({
				changedFiles: ["src/a.ts"],
				acceptancePassed: true,
				exercisingTestsByModule: {},
				cardProjectIsRuntimeRepo: true,
			}),
		]) {
			expect(decision.run).toBe(false);
			expect(decision.modules).toEqual([]);
		}
	});
});

describe("a foreign project is refused first of all", () => {
	it("skips before any other reason, because the runner would stub the wrong tree", () => {
		// `scripts/ablate.mts` copies `process.cwd()` — the RUNTIME's repo — and runs the runtime's vitest. For a
		// card in someone else's project a "run" decision would ablate !Klein's file at that path. Checked first:
		// no other reason matters when the measurement is aimed at the wrong tree.
		const decision = decideCardAblation({
			changedFiles: ["src/core/thing.ts"],
			acceptancePassed: true,
			exercisingTestsByModule: paired,
			cardProjectIsRuntimeRepo: false,
		});

		expect(decision).toMatchObject({ run: false, skipReason: "foreign_project" });
		expect(decision.modules).toEqual([]);
	});
});

describe("a skip is never a pass — the composition that makes skipping safe", () => {
	it("composes into `unmeasured`, which neither supports nor holds the card", () => {
		// THE probe. Aggressive skipping is only defensible because a card that was never ablated carries "we do
		// not know" rather than "it passed". If this ever became `supported`, every skip would manufacture a green.
		const skipped = decideCardAblation({
			changedFiles: ["README.md"],
			acceptancePassed: true,
			exercisingTestsByModule: {},
			cardProjectIsRuntimeRepo: true,
		});
		expect(skipped.run).toBe(false);

		const evidence = foldAblationIntoAcceptance(null);
		expect(evidence.status).toBe("unmeasured");
		expect(evidence.testsMeasureTheChange).toBe(false);
		expect(evidence.holdsAcceptance).toBe(false);
	});

	it("gives every skip a reason a human can act on or argue with", () => {
		for (const decision of [
			decideCardAblation({
				changedFiles: ["README.md"],
				acceptancePassed: true,
				exercisingTestsByModule: {},
				cardProjectIsRuntimeRepo: true,
			}),
			decideCardAblation({
				changedFiles: ["src/a.ts"],
				acceptancePassed: false,
				exercisingTestsByModule: {},
				cardProjectIsRuntimeRepo: true,
			}),
			decideCardAblation({
				changedFiles: ["src/a.ts"],
				acceptancePassed: true,
				exercisingTestsByModule: {},
				cardProjectIsRuntimeRepo: true,
			}),
		]) {
			expect(decision.skipReason).toBeDefined();
			expect(decision.detail.length).toBeGreaterThan(30);
		}
	});
});
