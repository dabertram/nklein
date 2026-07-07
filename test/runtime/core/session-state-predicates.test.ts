import { describe, expect, it } from "vitest";
import { isBusySessionState } from "../../../src/core/session-state-predicates";

describe("isBusySessionState", () => {
	it("is true only for running or queued (a session holding, or about to hold, a slot)", () => {
		expect(isBusySessionState("running")).toBe(true);
		expect(isBusySessionState("queued")).toBe(true);
	});

	it("is false for every non-occupying state (incl. awaiting_review and idle, which are separate concepts)", () => {
		for (const state of ["awaiting_review", "idle", "interrupted", "failed", "paused"] as const) {
			expect(isBusySessionState(state)).toBe(false);
		}
	});

	it("treats a nullish state as not busy (matches the pre-consolidation inline checks)", () => {
		expect(isBusySessionState(null)).toBe(false);
		expect(isBusySessionState(undefined)).toBe(false);
	});
});
