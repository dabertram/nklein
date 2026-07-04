import { describe, expect, it } from "vitest";
import { decideRepairAction, type RepairControllerInput } from "../../../src/core/repair-controller-decision";

const clean: RepairControllerInput = {
	validationFailed: false,
	unmetDependency: false,
	downstreamInvalidated: false,
	needsReReview: false,
	specAmbiguous: false,
	nodeTooLarge: false,
	retriesRemaining: true,
	refinementExhausted: false,
};

describe("decideRepairAction", () => {
	it("an unmet dependency wins over everything (wire the input first)", () => {
		const d = decideRepairAction({ ...clean, unmetDependency: true, validationFailed: true, specAmbiguous: true });
		expect(d.action).toBe("add_dependency");
	});

	it("downstream invalidation is handled before re-touching the node", () => {
		expect(decideRepairAction({ ...clean, downstreamInvalidated: true, validationFailed: true }).action).toBe(
			"invalidate_downstream",
		);
	});

	it("a passing node needing re-review ⇒ re_review", () => {
		expect(decideRepairAction({ ...clean, needsReReview: true }).action).toBe("re_review");
	});

	it("a spec-ambiguous failure ⇒ refine_spec before any retry", () => {
		expect(decideRepairAction({ ...clean, validationFailed: true, specAmbiguous: true }).action).toBe("refine_spec");
	});

	it("a too-large failing node ⇒ split_node", () => {
		expect(decideRepairAction({ ...clean, validationFailed: true, nodeTooLarge: true }).action).toBe("split_node");
	});

	it("a plain failure with retries left ⇒ retry_node", () => {
		expect(decideRepairAction({ ...clean, validationFailed: true }).action).toBe("retry_node");
	});

	it("a failure with retries+refinement exhausted ⇒ global_re_decompose (last resort)", () => {
		expect(
			decideRepairAction({ ...clean, validationFailed: true, retriesRemaining: false, refinementExhausted: true })
				.action,
		).toBe("global_re_decompose");
	});

	it("refine_spec/split_node take priority over the last-resort even when exhausted", () => {
		expect(
			decideRepairAction({
				...clean,
				validationFailed: true,
				refinementExhausted: true,
				retriesRemaining: false,
				specAmbiguous: true,
			}).action,
		).toBe("refine_spec");
	});

	it("no failure signal ⇒ a safe retry default", () => {
		expect(decideRepairAction(clean).action).toBe("retry_node");
	});
});
