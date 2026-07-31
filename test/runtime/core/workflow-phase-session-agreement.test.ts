import { describe, expect, it } from "vitest";
import {
	hasLiveTaskSession,
	isActiveWorkSessionState,
	isBusySessionState,
} from "../../../src/core/session-state-predicates";
import type { RuntimeTaskSessionState } from "../../../src/core/task-session-api-contract";
import { classifyWorkflowPhase, isLiveWorkflowPhase, type WorkflowPhase } from "../../../src/core/workflow-kernel";

/**
 * P24.1 — does the KERNEL's classification actually agree with the SESSION model it would replace?
 *
 * The plan for making the kernel authoritative starts with liveness, because that is where the evidence is: five
 * competing definitions of "is this alive?" produced the campaign's worst defects. But before any consumer is
 * migrated onto `isLiveWorkflowPhase`, the honest question is whether the kernel can even EXPRESS what the session
 * model expresses. This file is that check, run as pure logic — the shadow-mode comparison without the risk of
 * shadow-mode wiring.
 *
 * The mapping below is the natural correspondence, written down explicitly so disagreement is visible rather than
 * assumed. It is not a production mapping and nothing imports it; it exists to make the comparison checkable.
 */

/** The natural session-state → phase correspondence. `paused` is the interesting one — see the gap test below. */
const NATURAL_PHASE: Record<RuntimeTaskSessionState, WorkflowPhase> = {
	idle: "idle",
	// A queued session is somewhere on the admission ladder; board capacity is the first rung.
	queued: "queued_for_board_capacity",
	running: "implementing",
	// ✅ 2026-07-31: the kernel gained a real `paused` phase (David's decision), so this maps directly instead of
	// borrowing `implementing` and mis-classifying as `running`.
	paused: "paused",
	awaiting_review: "awaiting_review",
	failed: "failed",
	// An interrupted session was torn down rather than having errored — `cancelled` is its kernel analogue.
	interrupted: "cancelled",
};

const ALL_SESSION_STATES = Object.keys(NATURAL_PHASE) as RuntimeTaskSessionState[];

describe("kernel classification vs the session model it would replace", () => {
	it("AGREES on liveness for every session state — the precondition for migrating consumers", () => {
		// If this ever fails, `isLiveWorkflowPhase` is NOT a safe drop-in for `hasLiveTaskSession`, and migrating a
		// consumer would reintroduce the exact drift class P24.1 exists to remove. This passing is what makes the
		// migration a mechanical change rather than a semantic gamble.
		for (const state of ALL_SESSION_STATES) {
			const phase = NATURAL_PHASE[state];
			expect(
				isLiveWorkflowPhase(phase),
				`session "${state}" (live=${hasLiveTaskSession(state)}) vs phase "${phase}" (live=${isLiveWorkflowPhase(phase)})`,
			).toBe(hasLiveTaskSession(state));
		}
	});

	it("agrees that a QUEUED session is alive — the v16 lease-reclaim defect, checked across both models", () => {
		expect(hasLiveTaskSession("queued")).toBe(true);
		expect(isLiveWorkflowPhase(NATURAL_PHASE.queued)).toBe(true);
		expect(classifyWorkflowPhase(NATURAL_PHASE.queued)).toBe("waiting_capacity");
	});

	it("agrees that a failed or interrupted session is NOT alive — the other direction of the same bug", () => {
		for (const state of ["failed", "interrupted"] as const) {
			expect(hasLiveTaskSession(state)).toBe(false);
			expect(isLiveWorkflowPhase(NATURAL_PHASE[state])).toBe(false);
		}
	});
});

describe("✅ the representation gap is CLOSED (was: the kernel could not express `paused`)", () => {
	/**
	 * FOUND 2026-07-30 by writing the agreement check above, not from a failure.
	 *
	 * The session model draws a distinction the kernel currently cannot: `isBusySessionState` ("occupies a runtime
	 * slot") vs `isActiveWorkSessionState` ("work is still unfinished"). `paused` is precisely the state that
	 * separates them — a paused session holds NO capacity, but its work is not done.
	 *
	 * The kernel has no `paused` phase, so a paused card keeps its prior phase (`implementing`), which classifies as
	 * `running`. Liveness is unaffected — both models call it alive, which is why the agreement test above passes —
	 * but "running" would tell a capacity consumer the card is occupying a slot when it released one.
	 *
	 * **Consequence, stated plainly: `isLiveWorkflowPhase` is safe to migrate onto today; `classifyWorkflowPhase`
	 * is NOT yet a safe basis for admission or occupancy accounting.** Treating `running` as "holds a slot" would
	 * over-count a paused card and could starve the host — the same family as the v9 wedge, arrived at from the
	 * opposite direction (over-counting rather than under-counting).
	 *
	 * The fix is a kernel change (a `paused` phase, or splitting `running` into holds-capacity / work-unfinished),
	 * which is a DESIGN decision recorded for David in todo §5 P24.1 rather than guessed at here.
	 */
	it("session model separates 'holds a slot' from 'work unfinished'; paused is the discriminator", () => {
		expect(isBusySessionState("paused")).toBe(false);
		expect(isActiveWorkSessionState("paused")).toBe(true);
		expect(hasLiveTaskSession("paused")).toBe(true);
	});

	it("the kernel NOW expresses it — `paused` is its own class, not `running`", () => {
		// ⚠️ THIS TEST WAS INVERTED ON 2026-07-31. It previously pinned the GAP: a paused card classified as
		// `running`, so a capacity consumer would count a slot the card had released. David's decision added a real
		// `paused` phase, so the kernel now draws the same line the session model always did.
		expect(isBusySessionState("paused"), "the session model: holds no slot").toBe(false);
		expect(isActiveWorkSessionState("paused"), "the session model: work unfinished").toBe(true);
		expect(classifyWorkflowPhase(NATURAL_PHASE.paused), "the kernel now agrees").toBe("paused");
		expect(classifyWorkflowPhase(NATURAL_PHASE.paused)).not.toBe("running");
		// Liveness was never the problem and must stay unchanged.
		expect(isLiveWorkflowPhase(NATURAL_PHASE.paused)).toBe(hasLiveTaskSession("paused"));
	});
});
