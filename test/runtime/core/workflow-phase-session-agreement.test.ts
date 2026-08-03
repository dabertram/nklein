import { describe, expect, it } from "vitest";
import {
	hasLiveTaskSession,
	isActiveWorkSessionState,
	isBusySessionState,
} from "../../../src/core/session-state-predicates";
import type { RuntimeTaskSessionState } from "../../../src/core/task-session-api-contract";
import {
	ALL_WORKFLOW_PHASES,
	classifyWorkflowPhase,
	holdsEndpointCapacity,
	holdsWorkerCapacity,
	isLiveWorkflowPhase,
	reservesWorkerCapacity,
	type WorkflowPhase,
} from "../../../src/core/workflow-kernel";

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

/**
 * The OCCUPANCY half of the same argument — and it does NOT come out like the liveness half did.
 *
 * Liveness agreed across all seven session states, which is what made migrating `hasLiveTaskSession` consumers a
 * mechanical change. Capacity was held back pending the `paused` gap. **Closing `paused` turned out to be
 * necessary but not sufficient:** asking the question properly surfaces a second, deeper mismatch, and these
 * tests record the true correspondence rather than asserting the agreement that was hoped for.
 *
 * ── FINDING 1: `isBusySessionState` IS A RESERVATION PREDICATE, NOT AN OCCUPANCY ONE ──
 * Its doc says *"actively occupies a runtime/model slot"* and, three lines later, *"holding (or about to hold)
 * capacity"* — both readings, in the same definition. It returns true for `queued`. So its kernel counterpart is
 * `reservesWorkerCapacity`, and a consumer that migrated to `holdsWorkerCapacity` on the strength of the
 * first sentence would stop counting queued cards and hand the same slot out twice.
 *
 * ── FINDING 2 (RESOLVED in two steps): the models counted DIFFERENT RESOURCES with one word ──
 * 2026-07-31 (David): `awaiting_review` became `awaiting_verdict` — parked for a verdict, holding nothing.
 * 2026-08-03 (David, "split the phase — its own capacity class"): `reviewing` became its OWN class, and
 * capacity split BY RESOURCE — `holdsWorkerCapacity`/`reservesWorkerCapacity` (worker slots; a review holds
 * none: the worker session ended at review entry) vs `holdsEndpointCapacity` (model-endpoint work in flight;
 * a review holds one — live-confirmed by cards queueing behind the busy reviewer). Each model now maps onto
 * the predicate that names ITS resource, and the assertions below pin the RESOLUTION instead of the
 * disagreement they used to pin.
 *
 * ⇒ Liveness consumers may migrate, and CAPACITY consumers now may too — worker-slot decisions read the
 * worker predicates, endpoint decisions read the endpoint one.
 */
describe("kernel capacity vs the session model's `isBusySessionState`", () => {
	it("RESERVATION is the right counterpart — it agrees everywhere occupancy does not", () => {
		// Was six of seven; `awaiting_review` was resolved 2026-07-31 and is asserted separately below too.
		for (const state of ALL_SESSION_STATES) {
			const phase = NATURAL_PHASE[state];
			expect(
				reservesWorkerCapacity(phase),
				`session "${state}" (busy=${isBusySessionState(state)}) vs phase "${phase}"`,
			).toBe(isBusySessionState(state));
		}
	});

	it("AGREES on `awaiting_review` too — the last disagreement, now resolved", () => {
		// This test previously PINNED the disagreement, with a note that resolving it should rewrite the test
		// rather than delete it. Resolved 2026-07-31 (David): `awaiting_review` got its own class.
		//
		// The split was possible because the kernel already separates waiting-for-a-verdict from performing one.
		// `reviewing` stays capacity-holding — a review really is executing on a model endpoint — while
		// `awaiting_review` is a card parked for a verdict it cannot produce itself.
		expect(isBusySessionState("awaiting_review"), "session: the worker session has ended").toBe(false);
		expect(reservesWorkerCapacity("awaiting_review"), "kernel: parked for a verdict, holding nothing").toBe(false);
		expect(isLiveWorkflowPhase("awaiting_review"), "still ALIVE — the runtime owes this card a verdict").toBe(true);
		// DECIDED 2026-08-03 (David, split-by-resource): PERFORMING a review holds an ENDPOINT but no WORKER
		// slot — the two resources now have separate predicates instead of one word wearing two meanings.
		expect(reservesWorkerCapacity("reviewing"), "a review reserves no WORKER slot").toBe(false);
		expect(holdsEndpointCapacity("reviewing"), "but it DOES hold a model endpoint").toBe(true);
		expect(holdsWorkerCapacity("implementing"), "a working card holds its worker slot").toBe(true);
		expect(holdsEndpointCapacity("implementing"), "and its endpoint (the worker generates on one)").toBe(true);
	});

	it("now agrees on ALL SEVEN session states, which is what unblocks capacity migration", () => {
		for (const state of ALL_SESSION_STATES) {
			const phase = NATURAL_PHASE[state];
			expect(
				reservesWorkerCapacity(phase),
				`session "${state}" (busy=${isBusySessionState(state)}) vs phase "${phase}"`,
			).toBe(isBusySessionState(state));
		}
	});

	it("distinguishes HOLDS from RESERVES — a queued card is committed but consuming nothing", () => {
		// Answering "how many more may I admit?" with the occupancy predicate hands the same slot out twice.
		for (const phase of ["queued_for_board_capacity", "queued_for_endpoint", "queued_for_sandbox"] as const) {
			expect(holdsWorkerCapacity(phase)).toBe(false);
			expect(reservesWorkerCapacity(phase)).toBe(true);
		}
	});

	it("counts a PAUSED card as live but as neither holding nor reserving", () => {
		// The gap that blocked this whole half. Pausing emits `release_resources` on the way in, so a paused card
		// really has given its slot back — counting it either way would starve the host.
		expect(isLiveWorkflowPhase("paused")).toBe(true);
		expect(holdsWorkerCapacity("paused")).toBe(false);
		expect(reservesWorkerCapacity("paused")).toBe(false);
	});

	it("keeps holds ⊆ reserves ⊆ live across EVERY phase", () => {
		// The containment that makes three predicates safe to reason about. Checked over every phase the kernel
		// has, not only the ones a session state happens to map to.
		const everyPhase = ALL_WORKFLOW_PHASES;
		for (const phase of everyPhase) {
			if (holdsWorkerCapacity(phase)) {
				expect(reservesWorkerCapacity(phase), `${phase} holds but does not reserve`).toBe(true);
			}
			if (reservesWorkerCapacity(phase)) {
				expect(isLiveWorkflowPhase(phase), `${phase} reserves but is not live`).toBe(true);
			}
		}
		// Non-degenerate: each containment is STRICT somewhere, so the three are genuinely different predicates.
		expect(everyPhase.some((phase) => reservesWorkerCapacity(phase) && !holdsWorkerCapacity(phase))).toBe(true);
		expect(everyPhase.some((phase) => isLiveWorkflowPhase(phase) && !reservesWorkerCapacity(phase))).toBe(true);
	});
});

describe("the endpoint-capacity chain (split-by-resource, 2026-08-03)", () => {
	it("keeps holdsWorker ⊂ holdsEndpoint ⊆ live, with `reviewing` as the strictness witness", () => {
		for (const phase of ALL_WORKFLOW_PHASES) {
			if (holdsWorkerCapacity(phase)) {
				expect(holdsEndpointCapacity(phase), `${phase} holds a worker slot but no endpoint?`).toBe(true);
			}
			if (holdsEndpointCapacity(phase)) {
				expect(isLiveWorkflowPhase(phase), `${phase} holds an endpoint but is not alive?`).toBe(true);
			}
		}
		// Strict at exactly the phase the decision split: endpoint without worker slot.
		expect(holdsWorkerCapacity("reviewing")).toBe(false);
		expect(holdsEndpointCapacity("reviewing")).toBe(true);
	});
});
