import { describe, expect, it } from "vitest";
import {
	ALL_WORKFLOW_PHASES,
	applyWorkflowCommand,
	classifyWorkflowPhase,
	holdsWorkerCapacity,
	isLiveWorkflowPhase,
	isTerminalWorkflowPhase,
	reservesWorkerCapacity,
	type WorkflowCommand,
	type WorkflowPhase,
} from "../../../src/core/workflow-kernel";

/**
 * P24.1 — EXHAUSTIVE property proof of the workflow kernel.
 *
 * ── WHY THIS FILE EXISTS ──
 * Every liveness defect in the G6.8a campaign (2026-07-29/30) was a race hunted AFTER it wedged a real board:
 * a duplicate start, a stale event arriving after a card moved on, a lease reclaimed off a healthy queued card,
 * a resource released twice. Each was found by killing a hung runtime and reading a stack dump — six defects,
 * roughly twenty real-model runs, and one two-hour hang caused by MY OWN attempted fix.
 *
 * The example-based suite next door (`workflow-kernel.test.ts`) checks the happy path and a handful of chosen
 * bounces. That is exactly the method that let those six through: an example proves a case, never a class.
 *
 * The state space here is 14 phases × 17 commands = 238 transitions. That is small enough to check COMPLETELY,
 * so these tests do not sample and do not guess — they enumerate. A property proven here holds for every input
 * the machine can ever receive, which is the difference between "we have not seen that race" and "that race
 * cannot happen". The properties are chosen to be the exact failure modes observed in production, not generic
 * FSM hygiene.
 *
 * ⚠️ If a property below ever fails, the answer is NOT to weaken the property. Each one is a real defect class
 * with a real incident behind it; a failure means the reducer regressed into that class.
 */

/**
 * Derived from the kernel's own exhaustive export rather than re-listed here.
 *
 * The export is built from a `Record<WorkflowPhase, true>`, so it cannot omit a phase without failing to compile.
 * A duplicate list in this file would have no such guarantee — and a list that silently missed a phase would not
 * fail any property below, it would quietly stop covering one.
 */
const ALL_PHASES: readonly WorkflowPhase[] = ALL_WORKFLOW_PHASES;

const ALL_COMMANDS: readonly WorkflowCommand["kind"][] = [
	"start_requested",
	"board_capacity_granted",
	"endpoint_granted",
	"sandbox_granted",
	"begin_implementation",
	"implementation_finished",
	"acceptance_passed",
	"acceptance_failed",
	"pause_requested",
	"resume_requested",
	"review_started",
	"review_passed",
	"review_changes_requested",
	"delivery_requested",
	"delivered",
	"failed",
	"cancel_requested",
	"reopened",
];

function apply(phase: WorkflowPhase, kind: WorkflowCommand["kind"]) {
	return applyWorkflowCommand(phase, { kind } as WorkflowCommand);
}

/** Every (phase, command) pair — the complete transition table, enumerated once and reused. */
function everyTransition(): { phase: WorkflowPhase; kind: WorkflowCommand["kind"] }[] {
	return ALL_PHASES.flatMap((phase) => ALL_COMMANDS.map((kind) => ({ phase, kind })));
}

/** Breadth-first closure of the phases reachable from `start` under any command sequence. */
function reachableFrom(start: WorkflowPhase): Set<WorkflowPhase> {
	const seen = new Set<WorkflowPhase>([start]);
	const queue: WorkflowPhase[] = [start];
	while (queue.length > 0) {
		const phase = queue.shift() as WorkflowPhase;
		for (const kind of ALL_COMMANDS) {
			const next = apply(phase, kind).phase;
			if (!seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		}
	}
	return seen;
}

describe("workflow kernel — totality and determinism", () => {
	it("is TOTAL: no (phase, command) pair falls off the table", () => {
		// A reducer with a reachable `undefined` return crashes the caller at the worst possible moment — mid-drain,
		// holding a sandbox. Types alone do not prove this: a `default:` branch returning nothing type-checks fine.
		for (const { phase, kind } of everyTransition()) {
			const result = apply(phase, kind);
			expect(ALL_PHASES, `${phase} + ${kind} produced an unknown phase`).toContain(result.phase);
			expect(Array.isArray(result.effects), `${phase} + ${kind} produced non-array effects`).toBe(true);
		}
	});

	it("is DETERMINISTIC: the same input always yields the same output", () => {
		// Pins purity. The moment a reducer consults a clock, a counter, or module state, board behaviour becomes
		// unreproducible and boot-replay stops being a real determinism guarantee.
		for (const { phase, kind } of everyTransition()) {
			expect(apply(phase, kind)).toEqual(apply(phase, kind));
		}
	});
});

describe("workflow kernel — the race classes that actually bit us", () => {
	it("DUPLICATE delivery is a no-op: applying any command twice equals applying it once", () => {
		// The defect class: an at-least-once event source (a retried tRPC call, a re-dispatched lease, an operator
		// double-click) delivers the same command twice. If the second application moved the phase or re-emitted an
		// effect, the card would enqueue twice or start two sessions — the shape of the v9 parent-reacquire wedge.
		for (const { phase, kind } of everyTransition()) {
			const once = apply(phase, kind);
			const twice = apply(once.phase, kind);
			expect(twice.phase, `${phase} + ${kind}×2 drifted to ${twice.phase}`).toBe(once.phase);
			expect(twice.effects, `${phase} + ${kind}×2 re-emitted effects — that is a double-acquire`).toEqual([]);
		}
	});

	it("STALE/out-of-order events are side-effect free: if the phase holds, nothing is emitted", () => {
		// The defect class: a command arrives for a phase the card already left (a review verdict landing after a
		// cancel, a grant landing after a failure). Holding the phase is only safe if it ALSO does nothing — a hold
		// that still emitted `enqueue` would leak a queue slot on every late event.
		for (const { phase, kind } of everyTransition()) {
			const result = apply(phase, kind);
			if (result.phase === phase) {
				expect(result.effects, `${phase} + ${kind} held the phase but emitted effects`).toEqual([]);
			}
		}
	});

	it("MAY emit release_resources more than once — superseded by the IDEMPOTENT decision", () => {
		// ⚠️ THIS PROPERTY WAS INVERTED ON 2026-07-31, and the reason matters.
		//
		// It originally asserted a release is never emitted twice in a life, which was the right guard while the
		// semantics were undecided: under a PAIRED reading a second release drives a counter-based consumer's host
		// occupancy negative — the v9 parent-reacquire wedge. David decided IDEMPOTENT ("ensure nothing is held"),
		// which moves that protection from the kernel to the consumer contract: duplicates are explicitly safe
		// because a consumer must implement release as a no-op when nothing is held.
		//
		// The `paused` phase made this concrete rather than theoretical: pausing releases the slot, and a later
		// `failed` releases again. That sequence is CORRECT under the decided semantics and would have been a
		// defect under the other one. Asserted here so the dependency between the two decisions stays visible.
		const paused = apply("implementing", "pause_requested");
		expect(paused.phase).toBe("paused");
		expect(paused.effects).toEqual([{ kind: "release_resources" }]);
		expect(apply(paused.phase, "failed").effects).toEqual([{ kind: "release_resources" }]);
	});

	it("still never emits release on a HOLD — a stale event is side-effect free either way", () => {
		// What survives the semantics change: idempotence excuses duplicate releases from real transitions, not
		// releases from events that changed nothing. A hold that emitted anything would fire on every late event.
		for (const { phase, kind } of everyTransition()) {
			const result = apply(phase, kind);
			if (result.phase === phase) {
				expect(result.effects, `${phase} + ${kind} held but emitted`).toEqual([]);
			}
		}
	});
});

describe("workflow kernel — liveness: no card can get stuck", () => {
	it("every phase is REACHABLE from idle — no phase is dead code", () => {
		// An unreachable phase is a phase no test can exercise and no operator can observe, yet every consumer must
		// still handle it. It is where stale assumptions accumulate.
		const reachable = reachableFrom("idle");
		const unreachable = ALL_PHASES.filter((phase) => !reachable.has(phase));
		expect(unreachable, `unreachable from idle: ${unreachable.join(", ")}`).toEqual([]);
	});

	it("from EVERY phase, completion is still reachable — there is no dead end", () => {
		// The defect class the board kept producing: a card alive by one definition and dead by another, parked in a
		// phase with no way forward, burning its retry budget until `max_attempts` cancelled it. If completion is
		// reachable from every phase (terminal ones via `reopened`), no state is a trap by construction.
		for (const phase of ALL_PHASES) {
			expect(
				reachableFrom(phase).has("completed"),
				`${phase} cannot reach completion — a card here is stuck forever`,
			).toBe(true);
		}
	});

	it("terminal phases ABSORB: only `reopened` moves a settled card, and `completed` never reopens", () => {
		for (const phase of ALL_PHASES.filter(isTerminalWorkflowPhase)) {
			for (const kind of ALL_COMMANDS) {
				const result = apply(phase, kind);
				const expected = kind === "reopened" && phase !== "completed" ? "idle" : phase;
				expect(result.phase, `${phase} + ${kind}`).toBe(expected);
			}
		}
		// Delivered work reopening would re-run delivery against an already-delivered branch.
		expect(apply("completed", "reopened").phase).toBe("completed");
	});
});

describe("workflow kernel — the canonical classification", () => {
	it("classifies every phase, and agrees with isTerminalWorkflowPhase", () => {
		// Two answers to "is this settled?" is precisely the drift this classification exists to end.
		for (const phase of ALL_PHASES) {
			const phaseClass = classifyWorkflowPhase(phase);
			expect(
				["idle", "waiting_capacity", "running", "reviewing", "paused", "awaiting_verdict", "terminal"],
				`${phase} unclassified`,
			).toContain(phaseClass);
			expect(phaseClass === "terminal", `${phase}: classification and isTerminalWorkflowPhase disagree`).toBe(
				isTerminalWorkflowPhase(phase),
			);
		}
	});

	it("treats queued-for-a-resource as ALIVE — the lease-reclaim defect, pinned", () => {
		// The v16 defect: the durable heartbeat counted only `running`, so a card correctly waiting for host capacity
		// looked like a dead worker and had its lease reclaimed. Anything the runtime owes a start to is alive.
		for (const phase of ["queued_for_board_capacity", "queued_for_endpoint", "queued_for_sandbox"] as const) {
			expect(isLiveWorkflowPhase(phase), `${phase} must be alive or its lease gets reclaimed mid-queue`).toBe(true);
		}
	});

	it("treats the review and delivery tail as ALIVE — the monitor defect, pinned", () => {
		// The dev-test monitor counted a review-lane card only until its first verdict, so bounce → re-review →
		// delivery read as an idle board and the run was declared stale while it was working.
		for (const phase of ["awaiting_review", "reviewing", "ready_for_delivery", "delivering"] as const) {
			expect(isLiveWorkflowPhase(phase), `${phase} must be alive or the board reads as dead mid-review`).toBe(true);
		}
	});

	it("PAUSED is alive but NOT capacity-holding — the distinction the kernel previously could not express", () => {
		// Before `paused` existed a held card classified as `running`, so a capacity consumer counted a slot the
		// card had already released and could starve the host. It must be LIVE (the runtime still owes it work —
		// reclaiming its lease would burn the retry budget of a card someone deliberately held, the v16 defect
		// with a different trigger) while sitting in its own class, so capacity logic can exclude it.
		expect(isLiveWorkflowPhase("paused")).toBe(true);
		expect(classifyWorkflowPhase("paused")).toBe("paused");
		expect(classifyWorkflowPhase("paused")).not.toBe("running");
	});

	it("pausing RELEASES the slot, and resuming re-enters the ladder", () => {
		// What makes `paused` genuinely non-capacity-holding rather than merely labelled so: the slot is given
		// back on the way in, and resuming re-acquires like any other card instead of jumping back to work.
		expect(apply("implementing", "pause_requested")).toEqual({
			phase: "paused",
			effects: [{ kind: "release_resources" }],
		});
		expect(apply("paused", "resume_requested")).toEqual({
			phase: "queued_for_endpoint",
			effects: [{ kind: "enqueue", queue: "endpoint" }],
		});
	});

	it("treats idle and every terminal phase as NOT alive — the other half of the same bug", () => {
		// Widening liveness to fix "in-flight looks dead" is what made "parked looks alive" and hung a dead board for
		// two hours (2026-07-30, reverted in cc2fbc340). Both directions are pinned so neither fix can drift.
		expect(isLiveWorkflowPhase("idle")).toBe(false);
		for (const phase of ALL_PHASES.filter(isTerminalWorkflowPhase)) {
			expect(isLiveWorkflowPhase(phase), `${phase} is settled and must not read as alive`).toBe(false);
		}
	});
});

describe("workflow kernel — what `release_resources` MEANS (one unresolved contract question)", () => {
	/**
	 * ⚠️ FOUND BY RUNNING THIS FILE, not by reading the reducer (2026-07-30). The first draft asserted what looked
	 * self-evident — "a release is never emitted for a card that holds nothing" — and the exhaustive walk refuted it
	 * in milliseconds, from `idle` + `failed`. Chasing that led to THREE sites that all disagree with a paired
	 * acquire/release reading, and they turn out to be one question, not three bugs:
	 *
	 *   **Is `release_resources` "ensure nothing is held" (idempotent), or "give back what you took" (paired)?**
	 *
	 *   (a) `idle` + `failed`/`cancel_requested` → emits a release having never enqueued anything.
	 *   (b) `implementing` + `reopened` → returns to `idle` emitting NO release, then re-enqueues and re-acquires.
	 *       (From a TERMINAL phase the same command is correct: the release already fired at the cancel/fail edge.)
	 *   (c) `delivering` + `delivered` → emits `mark_done` and no release.
	 *
	 * Under the IDEMPOTENT reading, (a) is fail-safe and correct, and (b)/(c) are correct only if the consumer tears
	 * down on `reopened`/`mark_done` anyway. Under the PAIRED reading, (a) drives a counter-based consumer's host
	 * occupancy NEGATIVE — the precise wedge shape of the v9 parent-reacquire deadlock — and (b) leaks a sandbox and
	 * an endpoint reservation on every reopen of a live card.
	 *
	 * ✅ DECIDED 2026-07-31 (David): the IDEMPOTENT reading, now stated in the effect-type doc. It makes (a) correct as written, costs one line of consumer discipline, and fails safe — a
	 * redundant release is recoverable, a leaked endpoint reservation is what wedges a host. Under it, (b) and (c)
	 * still need `reopened`/`mark_done` documented as implying teardown, or an explicit release added.
	 *
	 * Nothing here is "fixed" unilaterally: the reducer is not yet wired, both readings are defensible, and guessing
	 * at a liveness contract is exactly what caused the two-hour dead-board hang earlier today (reverted, cc2fbc340).
	 * These tests pin TODAY's behaviour so the resolution has to be deliberate enough to trip them.
	 */

	it('RESOLVED (David 2026-07-31): `release_resources` is IDEMPOTENT — "ensure nothing is held"', () => {
		// The question this block was written to surface is now decided, so the tests below stop being "pinned
		// ambiguity" and become the specification. Consumers must treat release as a no-op when nothing is held,
		// and must NOT implement it as a counter decrement — under the paired reading the `idle` emission below
		// would drive host occupancy negative, which is the v9 wedge shape.
		expect(apply("idle", "failed").effects).toEqual([{ kind: "release_resources" }]);
		expect(apply("implementing", "failed").effects).toEqual([{ kind: "release_resources" }]);
	});

	it("(a) emits a fail-safe release from `idle`, where nothing was ever acquired", () => {
		for (const kind of ["failed", "cancel_requested"] as const) {
			expect(apply("idle", kind).effects).toEqual([{ kind: "release_resources" }]);
		}
	});

	it("(b) reopening an ACTIVE card emits no release, then re-acquires from scratch", () => {
		expect(apply("implementing", "reopened")).toEqual({ phase: "idle", effects: [] });
		expect(apply("idle", "start_requested").effects).toEqual([{ kind: "enqueue", queue: "board_capacity" }]);
	});

	it("(b′) reopening a TERMINAL card correctly emits no release — the release already fired", () => {
		for (const phase of ["failed", "cancelled"] as const) {
			expect(apply(phase, "reopened")).toEqual({ phase: "idle", effects: [] });
		}
		expect(apply("implementing", "failed").effects).toEqual([{ kind: "release_resources" }]);
	});

	it("(c) completion emits mark_done and no release", () => {
		expect(apply("delivering", "delivered")).toEqual({ phase: "completed", effects: [{ kind: "mark_done" }] });
	});
});

describe("capacity predicates, over every phase", () => {
	it("holds ⊆ reserves ⊆ live, with each containment STRICT somewhere", () => {
		for (const phase of ALL_PHASES) {
			if (holdsWorkerCapacity(phase)) {
				expect(reservesWorkerCapacity(phase), `${phase} holds capacity but does not reserve it`).toBe(true);
			}
			if (reservesWorkerCapacity(phase)) {
				expect(isLiveWorkflowPhase(phase), `${phase} reserves capacity but is not live`).toBe(true);
			}
		}
		// Without these, three predicates that happened to be identical would satisfy every assertion above.
		expect(ALL_PHASES.some((phase) => reservesWorkerCapacity(phase) && !holdsWorkerCapacity(phase))).toBe(true);
		expect(ALL_PHASES.some((phase) => isLiveWorkflowPhase(phase) && !reservesWorkerCapacity(phase))).toBe(true);
	});

	it("never counts a TERMINAL phase as holding or reserving anything", () => {
		for (const phase of ALL_PHASES.filter(isTerminalWorkflowPhase)) {
			expect(holdsWorkerCapacity(phase)).toBe(false);
			expect(reservesWorkerCapacity(phase)).toBe(false);
		}
	});

	it("releases capacity on the way INTO paused — the phase is non-holding by construction, not by label", () => {
		const transition = applyWorkflowCommand("implementing", { kind: "pause_requested" });
		expect(transition.phase).toBe("paused");
		expect(transition.effects.some((effect) => effect.kind === "release_resources")).toBe(true);
		expect(holdsWorkerCapacity(transition.phase)).toBe(false);
		expect(reservesWorkerCapacity(transition.phase)).toBe(false);
	});

	it("re-enters the admission ladder on resume rather than jumping straight back to holding", () => {
		const resumed = applyWorkflowCommand("paused", { kind: "resume_requested" });
		expect(reservesWorkerCapacity(resumed.phase), "a resumed card is committed to a slot").toBe(true);
		expect(holdsWorkerCapacity(resumed.phase), "but does not hold one until admitted").toBe(false);
	});
});
