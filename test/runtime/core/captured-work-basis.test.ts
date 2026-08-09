import { describe, expect, it } from "vitest";
import { foldCapturedWorkProbe, type ResultBranchProbeLike } from "../../../src/core/captured-work-basis";
import { decideOffTrackRemedy } from "../../../src/core/off-track-intervention";
import type { TaskResultBranchProbe } from "../../../src/workspace/task-result-branches";

/**
 * P18.4b — the second of the two signals the off-track wire was missing.
 *
 * Every test here is about ONE asymmetry, because the module is nothing but that asymmetry made explicit:
 *
 *   wrongly `false` → a restart destroys a real diff. Irreversible, and it is the user's work.
 *   wrongly `true`  → a park surfaces a card with nothing to save. Costs attention, not work.
 *
 * So `false` is reachable ONLY from a probe that positively said "there is no branch". Everything else — an
 * error, an absent probe — resolves to `true` and is labelled `assumed_safe`, because an assumption that reads
 * as an observation is how a park stops being attributable.
 *
 * Note this deliberately differs from `card-depth-basis.ts`, which ABSTAINS on unknown. That is not
 * inconsistency: there both defaults are expensive, so refusing is right; here one direction is plainly safe.
 * Consistency of shape would have been the wrong thing to optimise for, and the last suite proves the
 * difference matters by driving the real decider.
 */
/**
 * COMPILE-TIME: the core takes the probe STRUCTURALLY so it stays free of git, which means nothing would stop
 * the real shape drifting away from the stand-in — the fold would then be typechecked against a contract no
 * caller actually satisfies. This assignment fails to compile the moment they diverge.
 */
const _shapesStayAssignable: ResultBranchProbeLike = null as unknown as TaskResultBranchProbe;
void _shapesStayAssignable;

const found: ResultBranchProbeLike = { status: "found", commit: "abc1234" };
const missing: ResultBranchProbeLike = { status: "missing", commit: null };
const errored: ResultBranchProbeLike = { status: "error", commit: null, message: "repo unreadable" };

describe("`false` is reachable only from a positive 'no branch'", () => {
	it("says false ONLY for a probe that found nothing", () => {
		expect(foldCapturedWorkProbe(missing)).toMatchObject({ hasCapturedWork: false, basis: "observed" });
	});

	it("does NOT say false when the probe errored", () => {
		// The destructive direction. A probe that could not read the repo has said nothing about the card, and
		// treating silence as "no work" is what turns an infrastructure failure into a deleted diff.
		expect(foldCapturedWorkProbe(errored).hasCapturedWork).toBe(true);
	});

	it("does NOT say false when no probe ran at all", () => {
		expect(foldCapturedWorkProbe(null).hasCapturedWork).toBe(true);
	});

	it("says true for a branch that exists, and names the commit", () => {
		const signal = foldCapturedWorkProbe(found);

		expect(signal).toMatchObject({ hasCapturedWork: true, basis: "observed" });
		expect(signal.detail).toMatch(/abc1234/);
	});
});

describe("an assumption never reads as an observation", () => {
	it("labels both unknown paths `assumed_safe`", () => {
		// The label is the whole reason the module returns a basis rather than a bare boolean: "parked because we
		// could not check" and "parked because there is a diff" are different facts, and only one is about the card.
		expect(foldCapturedWorkProbe(errored).basis).toBe("assumed_safe");
		expect(foldCapturedWorkProbe(null).basis).toBe("assumed_safe");
	});

	it("labels both answered paths `observed`", () => {
		expect(foldCapturedWorkProbe(found).basis).toBe("observed");
		expect(foldCapturedWorkProbe(missing).basis).toBe("observed");
	});

	it("carries the probe's own failure text, so a park is attributable", () => {
		// Without the reason, an operator seeing a parked card cannot tell a repo problem from a real diff, and
		// the fix for each is entirely different.
		expect(foldCapturedWorkProbe(errored).detail).toMatch(/repo unreadable/);
	});

	it("explains the asymmetry in the detail rather than only in the code", () => {
		// The reasoning has to survive into the log, because the log is where someone questions the decision.
		expect(foldCapturedWorkProbe(errored).detail).toMatch(/discards a diff/i);
		expect(foldCapturedWorkProbe(null).detail).toMatch(/rather than risking a restart/i);
	});
});

describe("driven through the real decider", () => {
	const offTrack = (hasCapturedWork: boolean) =>
		decideOffTrackRemedy({ onTrack: false, hasCapturedWork, contextUtilisation: 0.95, restartsSoFar: 0 });

	it("an unreadable probe PARKS the card instead of restarting it", () => {
		// The end-to-end consequence, and the reason the fold exists at all. With a bare boolean and the natural
		// default, this same card would have been restarted and its diff discarded.
		const signal = foldCapturedWorkProbe(errored);

		expect(offTrack(signal.hasCapturedWork).remedy).toBe("park");
	});

	it("a genuinely empty card still restarts — the safe default does not swallow the useful case", () => {
		// If every unknown parked AND every known-empty also parked, the restart remedy would never fire and the
		// safety would have quietly disabled the feature.
		const signal = foldCapturedWorkProbe(missing);

		expect(offTrack(signal.hasCapturedWork).remedy).toBe("restart_with_restatement");
	});

	it("a card with a branch parks, and the reason names the artefacts", () => {
		const decision = offTrack(foldCapturedWorkProbe(found).hasCapturedWork);

		expect(decision.remedy).toBe("park");
		expect(decision.reason).toMatch(/reviewable work|artefacts/i);
	});
});
