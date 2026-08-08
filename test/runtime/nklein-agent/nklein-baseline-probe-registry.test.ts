import { afterEach, describe, expect, it } from "vitest";
import {
	forgetBaselineProbe,
	getBaselineProbe,
	recordBaselineProbe,
} from "../../../src/nklein-agent/nklein-baseline-probe-registry";

/**
 * Coverage for a module the extended coverage audit found unexercised (2026-08-08).
 *
 * A Map behind three functions — but the values it holds answer an ATTRIBUTION question, and that is what makes
 * it worth pinning. When a card's acceptance check is red at review time, the probe's record is how the review
 * runner decides whether the worker broke it or whether the base tree was already red. There are four
 * distinguishable states and collapsing any pair blames the wrong party:
 *
 *   null                            no probe was run (it is opt-in) — nothing can be concluded
 *   { present: false }              the card has no acceptance command — a probe of it would prove nothing
 *   { present: true, passed: null } the command exists but produced no verdict — still nothing concluded
 *   { present: true, passed: X }    the base tree's real answer
 *
 * The dangerous collapse is any of the first three reading as `passed: false`, because that turns "we do not
 * know" into "it was already broken" and lets a worker's regression through as pre-existing.
 */
afterEach(() => {
	for (const taskId of ["t1", "t2", "t3", "t4"]) {
		forgetBaselineProbe(taskId);
	}
});

describe("the four states stay distinguishable", () => {
	it("returns NULL when no probe was run — absence, not a verdict", () => {
		// The probe is opt-in and costs a full sandbox acceptance run, so most cards have no record at all. A
		// falsy-looking stand-in here would read as "the base tree failed".
		expect(getBaselineProbe("t1")).toBeNull();
	});

	it("keeps 'no acceptance command' separate from 'the command failed'", () => {
		recordBaselineProbe("t1", { present: false, passed: null });

		const probe = getBaselineProbe("t1");
		expect(probe).not.toBeNull();
		expect(probe?.present).toBe(false);
		expect(probe?.passed).toBeNull();
	});

	it("keeps 'no verdict' separate from 'failed' when the command DOES exist", () => {
		// The subtlest of the four: the probe ran, the command is there, and it still produced nothing. Reading
		// that null as false would label every later red acceptance pre-existing.
		recordBaselineProbe("t1", { present: true, passed: null });
		recordBaselineProbe("t2", { present: true, passed: false });

		expect(getBaselineProbe("t1")?.passed).toBeNull();
		expect(getBaselineProbe("t2")?.passed).toBe(false);
	});

	it("round-trips a real green verdict", () => {
		recordBaselineProbe("t1", { present: true, passed: true });

		expect(getBaselineProbe("t1")).toEqual({ present: true, passed: true });
	});
});

describe("keying and lifetime", () => {
	it("does not let one card's probe answer for another", () => {
		// Attribution is per card; a cross-read would label one card's regression with another's baseline.
		recordBaselineProbe("t1", { present: true, passed: true });

		expect(getBaselineProbe("t2")).toBeNull();
	});

	it("lets a re-probe replace the earlier verdict", () => {
		recordBaselineProbe("t1", { present: true, passed: false });
		recordBaselineProbe("t1", { present: true, passed: true });

		expect(getBaselineProbe("t1")?.passed).toBe(true);
	});

	it("forgets a card's probe, returning to 'nothing is known'", () => {
		// Teardown must restore ABSENCE, not a stale verdict: a probe surviving its session would be applied to a
		// tree it never ran against.
		recordBaselineProbe("t1", { present: true, passed: true });
		forgetBaselineProbe("t1");

		expect(getBaselineProbe("t1")).toBeNull();
	});

	it("forgets only the card asked for", () => {
		recordBaselineProbe("t1", { present: true, passed: true });
		recordBaselineProbe("t2", { present: true, passed: false });
		forgetBaselineProbe("t1");

		expect(getBaselineProbe("t1")).toBeNull();
		expect(getBaselineProbe("t2")?.passed).toBe(false);
	});

	it("is silent when forgetting a card that has no probe", () => {
		expect(() => forgetBaselineProbe("never-probed")).not.toThrow();
	});
});
