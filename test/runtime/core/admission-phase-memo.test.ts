import { describe, expect, it } from "vitest";
import { createAdmissionPhaseMemo } from "../../../src/core/admission-phase-memo";

/**
 * 2026-09-14: the admission breadcrumbs were gated against the PREVIOUS phase only; the four phases cycle on every
 * retry of a capacity-queued card, so nothing was suppressed — 7,628 rows from three waiting cards in 104 minutes.
 */
describe("createAdmissionPhaseMemo", () => {
	const phases = ["admission evaluating", "config loaded", "ps snapshot fetched", "registry snapshot resolved"];

	it("stamps each phase once per waiting episode, however many retries cycle through them", () => {
		const memo = createAdmissionPhaseMemo();
		let stamped = 0;
		for (let retry = 0; retry < 50; retry += 1) {
			for (const phase of phases) if (memo.stamp("card-1", phase)) stamped += 1;
		}
		expect(stamped).toBe(phases.length);
		expect(memo.stamped("card-1")).toEqual(phases);
	});

	it("a settled episode narrates itself afresh on the next wait", () => {
		const memo = createAdmissionPhaseMemo();
		expect(memo.stamp("card-1", "admission evaluating")).toBe(true);
		memo.settle("card-1");
		expect(memo.stamp("card-1", "admission evaluating")).toBe(true);
	});

	it("episodes are per task", () => {
		const memo = createAdmissionPhaseMemo();
		expect(memo.stamp("a", "config loaded")).toBe(true);
		expect(memo.stamp("b", "config loaded")).toBe(true);
		expect(memo.stamp("a", "config loaded")).toBe(false);
	});
});
