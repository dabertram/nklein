import { describe, expect, it } from "vitest";
import {
	decideOutwardActionApproval,
	type OutwardActionInput,
	resolveAutonomousApproval,
} from "../../../src/core/outward-action-approval";

const base: OutwardActionInput = {
	isOutwardOrIrreversible: true,
	contextTainted: false,
	backedByTrustedPlan: false,
	preAuthorized: false,
};

describe("decideOutwardActionApproval", () => {
	it("allows a non-outward action outright (a read or contained write)", () => {
		expect(decideOutwardActionApproval({ ...base, isOutwardOrIrreversible: false }).decision).toBe("allow");
	});

	it("requires approval for a novel outward action with no plan and no pre-authorization", () => {
		expect(decideOutwardActionApproval(base).decision).toBe("require_approval");
	});

	it("allows a pre-authorized (narrowly-scoped) outward action without a fresh prompt", () => {
		expect(decideOutwardActionApproval({ ...base, preAuthorized: true }).decision).toBe("allow");
	});

	it("allows an outward action backed by a trusted plan", () => {
		expect(decideOutwardActionApproval({ ...base, backedByTrustedPlan: true }).decision).toBe("allow");
	});

	it("DENIES an outward action when the context is tainted and no trusted plan backs it", () => {
		const result = decideOutwardActionApproval({ ...base, contextTainted: true });
		expect(result.decision).toBe("deny");
		expect(result.reason).toContain("injection");
	});

	it("a pre-authorization does NOT override a live taint (only a trusted plan does)", () => {
		expect(decideOutwardActionApproval({ ...base, contextTainted: true, preAuthorized: true }).decision).toBe("deny");
		expect(decideOutwardActionApproval({ ...base, contextTainted: true, backedByTrustedPlan: true }).decision).toBe(
			"allow",
		);
	});
});

describe("resolveAutonomousApproval", () => {
	it("maps require_approval to deny (fail-closed — no human mid-run) and allow to true", () => {
		expect(resolveAutonomousApproval("allow")).toBe(true);
		expect(resolveAutonomousApproval("require_approval")).toBe(false);
		expect(resolveAutonomousApproval("deny")).toBe(false);
	});
});
