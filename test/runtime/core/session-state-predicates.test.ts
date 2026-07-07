import { describe, expect, it } from "vitest";
import { isBusySessionState, isTerminalFailureSessionState } from "../../../src/core/session-state-predicates";

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

describe("isTerminalFailureSessionState", () => {
	it("is true only for the unsuccessful terminal states: failed or interrupted", () => {
		expect(isTerminalFailureSessionState("failed")).toBe(true);
		expect(isTerminalFailureSessionState("interrupted")).toBe(true);
	});

	it("is false for active, review, idle, paused, and nullish states", () => {
		for (const state of ["running", "queued", "awaiting_review", "idle", "paused"] as const) {
			expect(isTerminalFailureSessionState(state)).toBe(false);
		}
		expect(isTerminalFailureSessionState(null)).toBe(false);
		expect(isTerminalFailureSessionState(undefined)).toBe(false);
	});
});
