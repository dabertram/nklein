import { describe, expect, it } from "vitest";
import {
	hasLiveTaskSession,
	isActiveWorkSessionState,
	isBusySessionState,
	isTerminalFailureSessionState,
} from "../../../src/core/session-state-predicates";

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

describe("hasLiveTaskSession (G6.8a v16 — the lease-heartbeat drift)", () => {
	it("counts every state in which a session still exists: running, queued, paused, awaiting_review", () => {
		for (const state of ["running", "queued", "paused", "awaiting_review"] as const) {
			expect(hasLiveTaskSession(state)).toBe(true);
		}
	});

	it("QUEUED is live — the regression that cancelled a healthy card", () => {
		// v16: the card's session sat `queued` in model-turn admission behind a cap-1 host while a sibling's turn
		// ran 19 minutes. The durable heartbeat filtered `running` only, so the lease was reclaimed three times and
		// the job hit max_attempts — then the card started for real 11 minutes later, against a cancelled job.
		expect(hasLiveTaskSession("queued")).toBe(true);
	});

	it("AWAITING_REVIEW is live — a card under a slow review must not be reclaimed and re-dispatched", () => {
		// Reviews in the same run took ~10 minutes, longer than the 5-minute lease; the summary path already
		// heartbeats this state (mapTaskSessionStateToDurableRunReaction), so the tick path must agree.
		expect(hasLiveTaskSession("awaiting_review")).toBe(true);
	});

	it("is false when nothing is alive: idle, failed, interrupted, or no session at all", () => {
		for (const state of ["idle", "failed", "interrupted"] as const) {
			expect(hasLiveTaskSession(state)).toBe(false);
		}
		expect(hasLiveTaskSession(null)).toBe(false);
		expect(hasLiveTaskSession(undefined)).toBe(false);
	});

	it("is strictly broader than isActiveWorkSessionState, by exactly awaiting_review", () => {
		const states = ["idle", "queued", "running", "paused", "awaiting_review", "failed", "interrupted"] as const;
		const extra = states.filter((s) => hasLiveTaskSession(s) && !isActiveWorkSessionState(s));
		expect(extra).toEqual(["awaiting_review"]);
	});
});
