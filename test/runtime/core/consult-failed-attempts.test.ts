import { describe, expect, it } from "vitest";
import { buildAttemptEvent, buildTransitionEvent } from "../../../src/core/agent-attempt-ledger";
import {
	countConsultStuckEvidence,
	countGenuineFailedAttempts,
	countReviewRejectionBounces,
	GENUINE_FAILURE_OUTCOMES,
	REVIEW_REJECTION_REASON,
} from "../../../src/core/consult-failed-attempts";
import type { ModelOutcomeKind } from "../../../src/core/model-behavior-profile";

/**
 * F3.37's stuck-gate counter. The whole point of this module is the predicate it does NOT use: on the live
 * ledger (2026-08-01), `outcome !== "success"` would have counted 132 ABORTS as evidence of being stuck —
 * cancellations, mostly of cards nobody was working on. The wrong count fires more often, which reads as the
 * mechanism working.
 */

function attempt(outcome: ModelOutcomeKind, workflowId = "card-1", seq = 1) {
	return buildAttemptEvent({
		workflowId,
		taskId: workflowId,
		workspacePathHash: "hash",
		attemptId: `a-${workflowId}-${outcome}-${seq}`,
		modelId: "model-a",
		recordedAt: seq,
		outcome,
	});
}

describe("countGenuineFailedAttempts", () => {
	it("counts every genuine model-failure outcome", () => {
		const events = [...GENUINE_FAILURE_OUTCOMES].map((outcome, index) =>
			attempt(outcome as ModelOutcomeKind, "card-1", index),
		);
		expect(countGenuineFailedAttempts(events, "card-1")).toBe(GENUINE_FAILURE_OUTCOMES.size);
	});

	it("does NOT count success", () => {
		expect(countGenuineFailedAttempts([attempt("success")], "card-1")).toBe(0);
	});

	it("does NOT count aborted — a cancellation is not evidence of being stuck", () => {
		// Two aborts would satisfy CONSULT_MIN_FAILED_ATTEMPTS under `!== "success"`, admitting a consult on a
		// card that was merely cancelled twice. That is the mis-gate this module exists to prevent.
		const events = [attempt("aborted", "card-1", 1), attempt("aborted", "card-1", 2)];
		expect(countGenuineFailedAttempts(events, "card-1")).toBe(0);
	});

	it("scopes to the requested workflow only", () => {
		const events = [
			attempt("other_failure", "card-1", 1),
			attempt("other_failure", "card-2", 2),
			attempt("loop", "card-2", 3),
		];
		expect(countGenuineFailedAttempts(events, "card-2")).toBe(2);
	});

	it("ignores non-attempt events and unknown outcomes without counting them", () => {
		// A malformed row read back loosely (outcome absent) must not count: a missing classification is not
		// evidence of failure. Constructed via a cast because the schema itself forbids it — which is the point.
		const loose = { ...attempt("other_failure"), outcome: undefined } as unknown as ReturnType<typeof attempt>;
		expect(countGenuineFailedAttempts([loose], "card-1")).toBe(0);
	});
});

/**
 * The "bounced" half — live-found missing on the first F3.37 pilot: a 2B completed its attempt with
 * `outcome: "success"` (18/18 tool results) and entered review, so a quality-stuck card (work→reject→rework)
 * would NEVER have armed the gate on protocol failures alone. The kernel's command queue persists the bounce as
 * a transition whose `reason` is the command kind and whose `taskId` is the CARD id (the workflow's own id sits
 * in `workflowId` — the namespace lesson at write-shape level).
 */
function bounce(cardTaskId: string, seq: number, reason: string = REVIEW_REJECTION_REASON) {
	return buildTransitionEvent({
		workflowId: `kernel-wf-${cardTaskId}`,
		taskId: cardTaskId,
		workspacePathHash: "hash",
		from: "wf:reviewing",
		to: "wf:implementing",
		reason,
		recordedAt: seq,
	});
}

describe("countReviewRejectionBounces", () => {
	it("counts review_changes_requested transitions for the card", () => {
		expect(countReviewRejectionBounces([bounce("card-1", 1), bounce("card-1", 2)], "card-1")).toBe(2);
	});

	it("matches on the event's CARD taskId, not the kernel workflow id", () => {
		expect(countReviewRejectionBounces([bounce("card-1", 1)], "kernel-wf-card-1")).toBe(0);
	});

	it("ignores other transition reasons — parked/escalated cards must not arm the gate", () => {
		// Parked awaits an operator; escalation is the harness already switching models. Counting either would
		// admit consults nobody re-drives, or double-remedy the same stuckness.
		const events = [bounce("card-1", 1, "review_started"), bounce("card-1", 2, "acceptance_passed")];
		expect(countReviewRejectionBounces(events, "card-1")).toBe(0);
	});
});

describe("countConsultStuckEvidence", () => {
	it("adds DISJOINT streams: protocol failures plus review bounces", () => {
		// The disjointness is structural: a protocol-failed attempt never reaches review; a rejected attempt
		// records outcome success plus exactly one bounce transition. One quality-stuck cycle = one unit.
		const events = [attempt("other_failure", "card-1", 1), attempt("success", "card-1", 2), bounce("card-1", 3)];
		expect(countConsultStuckEvidence(events, "card-1")).toBe(2);
	});

	it("arms the stuck-gate for a card that only ever bounced — the confidently-wrong case", () => {
		const events = [
			attempt("success", "card-1", 1),
			bounce("card-1", 2),
			attempt("success", "card-1", 3),
			bounce("card-1", 4),
		];
		expect(countConsultStuckEvidence(events, "card-1")).toBe(2);
	});
});

describe("the genuine-set ratchet", () => {
	it("keeps the genuine set exactly ModelOutcomeKind minus success and aborted", () => {
		// Ratchet: a NEW §5.AA outcome kind must be classified here DELIBERATELY. `Record<ModelOutcomeKind, …>`
		// makes the compiler reject this test the moment the union grows, instead of the new kind silently not
		// counting (an array literal would stay type-valid as a subset and the drift would pass green).
		const classification: Record<ModelOutcomeKind, "genuine" | "excluded"> = {
			success: "excluded",
			no_tool_call: "genuine",
			narrated: "genuine",
			loop: "genuine",
			timeout: "genuine",
			malformed: "genuine",
			aborted: "excluded",
			other_failure: "genuine",
		};
		const expected = Object.entries(classification)
			.filter(([, verdict]) => verdict === "genuine")
			.map(([kind]) => kind);
		expect([...GENUINE_FAILURE_OUTCOMES].sort()).toEqual(expected.sort());
	});
});
