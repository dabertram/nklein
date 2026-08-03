// §5.AF/§5.AK workflow kernel (seed) — the PURE task-lifecycle state machine the future durable scheduler builds on.
//
// A total reducer over `(phase, command) → { phase, effects }`. It is the orthogonal *scheduler* view of a task: finer
// grained than the board column (it distinguishes WHY a task is queued — board capacity vs endpoint vs sandbox — and
// the acceptance/review/delivery sub-states a single column can't express), so a durable scheduler can persist a phase
// + a command log and resume/replay exactly where it left off. **No behavior change and NOT yet wired:** the board
// mutation helpers (`task-board-mutations`, §5.B lane reconcile) remain the single source of truth for board/lane
// moves; this kernel is a seam for the §5.AF durable scheduler to grow into. Pure + total: every command in every phase
// has a defined result (unhandled commands are a no-op that holds the phase), so it never throws on an unexpected event.

export type WorkflowPhase =
	| "idle"
	| "queued_for_board_capacity"
	| "queued_for_endpoint"
	| "queued_for_sandbox"
	| "planning"
	| "implementing"
	| "awaiting_acceptance"
	/**
	 * Deliberately held: work is UNFINISHED but the card holds no runtime slot (David's decision, 2026-07-31).
	 *
	 * Added because the kernel could not express what the session model already distinguished —
	 * `isBusySessionState` ("occupies a slot") vs `isActiveWorkSessionState` ("work unfinished"). Without it a
	 * paused card classified as `running`, so a capacity consumer would count a slot the card had released and
	 * could starve the host. It is LIVE (the runtime still owes it work) but NOT capacity-holding.
	 */
	| "paused"
	| "awaiting_review"
	| "reviewing"
	| "ready_for_delivery"
	| "delivering"
	| "completed"
	| "failed"
	| "cancelled";

export type WorkflowCommand =
	/** The user/board started the card — admit it into the queue ladder. */
	| { kind: "start_requested" }
	| { kind: "board_capacity_granted" }
	| { kind: "endpoint_granted" }
	| { kind: "sandbox_granted" }
	/** §5.B: the refinement/planning lane promotes the card to active implementation. */
	| { kind: "begin_implementation" }
	/** The agent finished a turn and the acceptance gate should run. */
	| { kind: "implementation_finished" }
	| { kind: "acceptance_passed" }
	| { kind: "acceptance_failed" }
	/** Hold an in-flight card without discarding its work; it releases its slot and keeps its place. */
	| { kind: "pause_requested" }
	/** Resume a held card back into implementation. */
	| { kind: "resume_requested" }
	| { kind: "review_started" }
	| { kind: "review_passed" }
	| { kind: "review_changes_requested" }
	| { kind: "delivery_requested" }
	| { kind: "delivered" }
	/** Honored from any active phase. */
	| { kind: "failed" }
	| { kind: "cancel_requested" }
	/** F1.27b: re-admit a dead/parked card (failed/cancelled/any active phase → idle). `completed` never reopens. */
	| { kind: "reopened" };

export type WorkflowEffect =
	| { kind: "enqueue"; queue: "board_capacity" | "endpoint" | "sandbox" }
	| { kind: "start_session" }
	| { kind: "run_acceptance" }
	| { kind: "request_review" }
	| { kind: "capture_result_branch" }
	| { kind: "mark_done" }
	/**
	 * Release whatever this card holds. **SEMANTICS: IDEMPOTENT — "ensure nothing is held", NOT "give back what
	 * you took"** (David's decision, 2026-07-31).
	 *
	 * ── THE CONTRACT THIS PLACES ON CONSUMERS ──
	 * A consumer MUST implement release so that releasing something it does not hold is a no-op. It must NOT be a
	 * counter decrement. This effect is emitted from any non-terminal phase, INCLUDING `idle`, where nothing was
	 * ever acquired — a card cancelled before it enqueued still emits one.
	 *
	 * ── WHY THIS READING AND NOT THE PAIRED ONE ──
	 * Under paired semantics that `idle` emission is a bug: a counter-based consumer would drop host occupancy
	 * below zero and permanently wedge admission — the exact shape of the v9 parent-reacquire deadlock. The
	 * asymmetry decides it: **a redundant release is recoverable; a leaked endpoint reservation wedges a host.**
	 * So the effect fires whenever release *might* be needed, and consumers absorb the duplicates.
	 *
	 * ── WHAT THIS DOES NOT EXCUSE ──
	 * Idempotence is not a licence to skip releasing. `reopened` from an ACTIVE phase currently emits no release
	 * while the card re-enters the ladder and re-acquires; under this reading that is safe only if the consumer
	 * tears down on `reopened` anyway. Same for `mark_done`. Both are noted in the kernel's property tests, and
	 * an explicit release should be added if either consumer turns out not to tear down.
	 */
	| { kind: "release_resources" };

export interface WorkflowTransition {
	phase: WorkflowPhase;
	effects: WorkflowEffect[];
}

const TERMINAL_PHASES: ReadonlySet<WorkflowPhase> = new Set(["completed", "failed", "cancelled"]);

/** Whether the phase is terminal (no further commands transition it). */
export function isTerminalWorkflowPhase(phase: WorkflowPhase): boolean {
	return TERMINAL_PHASES.has(phase);
}

/**
 * The CANONICAL coarse classification of a phase — the vocabulary every consumer should DERIVE its predicates
 * from instead of inventing another one (P24.1 step 2).
 *
 * ── WHY THIS EXISTS (evidence, 2026-07-29/30) ──
 * !Klein carries four parallel state spaces: board lane, session state, durable job state, and this phase. Every
 * liveness defect found in the G6.8a campaign was two of them DISAGREEING about what a state means, never a torn
 * read — so no amount of locking would have prevented any of them:
 *   • the durable lease heartbeat counted only `running`, while the terminal-retry sweep counted
 *     running|queued|paused|awaiting_review — so a card waiting its turn was "alive" to one and "a dead worker"
 *     to the other, and its retry budget was burned until `max_attempts` cancelled it;
 *   • the dev-test monitor counted a review-lane card only until its FIRST verdict, so the entire
 *     bounce → re-review → delivery phase read as an idle board;
 *   • widening that same monitor to trust `awaiting_review` then made a card PARKED after failing look alive,
 *     hanging a dead board for two hours. Too narrow and too broad are the same bug.
 * The session produced FIVE competing answers to "is this alive?". The durable fix is not another predicate but
 * ONE classification that predicates are computed from.
 *
 * `waiting_capacity` — admitted and queued for a resource; nothing is executing, but the runtime OWES it a start,
 * so it must never be reclaimed as a dead worker. `running` — work is genuinely in flight, including the review
 * and delivery tail, which is where the monitor bug lived. `terminal` — settled; safe to reclaim and release.
 *
 * Exhaustive by construction: the switch has no `default`, so adding a phase without classifying it is a compile
 * error rather than a silent misclassification.
 */
/**
 * Every phase, as data — for exhaustive tests and for any consumer that must enumerate rather than switch.
 *
 * Built from a `Record<WorkflowPhase, true>` on purpose: TypeScript requires that record to name every member of
 * the union, so **adding a phase without adding it here is a compile error.** A hand-maintained array would have
 * no such guarantee, and an under-enumerated list is the worst possible failure here — it does not break the
 * exhaustive property tests, it silently narrows what they cover.
 */
const PHASE_MEMBERSHIP: Record<WorkflowPhase, true> = {
	idle: true,
	queued_for_board_capacity: true,
	queued_for_endpoint: true,
	queued_for_sandbox: true,
	planning: true,
	implementing: true,
	awaiting_acceptance: true,
	paused: true,
	awaiting_review: true,
	reviewing: true,
	ready_for_delivery: true,
	delivering: true,
	completed: true,
	failed: true,
	cancelled: true,
};

export const ALL_WORKFLOW_PHASES = Object.keys(PHASE_MEMBERSHIP) as readonly WorkflowPhase[];

export type WorkflowPhaseClass =
	| "idle"
	| "waiting_capacity"
	| "running"
	| "reviewing"
	| "paused"
	| "awaiting_verdict"
	| "terminal";

export function classifyWorkflowPhase(phase: WorkflowPhase): WorkflowPhaseClass {
	switch (phase) {
		case "idle":
			return "idle";
		case "queued_for_board_capacity":
		case "queued_for_endpoint":
		case "queued_for_sandbox":
			return "waiting_capacity";
		case "paused":
			// NOT `running`: the card is alive and unfinished, but holds no slot. Collapsing it into `running`
			// is exactly the over-count that could starve a host.
			return "paused";
		case "awaiting_review":
			// DECIDED 2026-07-31 (David): its own class, NOT `running`.
			//
			// The kernel and the session model disagreed on exactly this one phase out of seven, because they were
			// counting DIFFERENT RESOURCES: the session means "no worker session is running" (so not busy), while
			// `running` meant "the runtime still has work in flight". Both were internally coherent, which is why
			// the disagreement survived — one phase wearing two meanings.
			//
			// The split is possible because the kernel ALREADY distinguishes waiting-for-a-verdict from
			// performing one: `reviewing` stays `running` (a review really is executing on a model endpoint),
			// while `awaiting_review` is a card parked for a verdict it cannot produce itself.
			//
			// Getting it wrong in either direction is a known wedge shape: count it as capacity and cards awaiting
			// a HUMAN verdict starve the board forever; count `reviewing` as free and a saturated board admits
			// more work while every endpoint is busy reviewing.
			return "awaiting_verdict";
		case "reviewing":
			// DECIDED 2026-08-03 (David, "split the phase — its own capacity class"; consistent with his
			// 2026-07-31 awaiting_verdict split): a review in flight occupies a MODEL ENDPOINT but no WORKER
			// slot — the worker session ended when the card entered review. Sharing the `running` class made
			// one class answer two different capacity questions; the resource-split predicates below need the
			// distinction to exist here, where phases are classified, not at every call site.
			return "reviewing";
		case "planning":
		case "implementing":
		case "awaiting_acceptance":
		case "ready_for_delivery":
		case "delivering":
			return "running";
		case "completed":
		case "failed":
		case "cancelled":
			return "terminal";
	}
}

/**
 * Whether the runtime still owes this card work — the ONE definition of "alive" (P24.1). A card is alive while it
 * is queued for a resource or actively working; `idle` and terminal phases are not. Consumers that today hand-roll
 * a session-state or lane check should migrate onto this once the kernel is authoritative.
 */
export function isLiveWorkflowPhase(phase: WorkflowPhase): boolean {
	const phaseClass = classifyWorkflowPhase(phase);
	// `paused` and `awaiting_verdict` count as LIVE: the runtime still owes the card work, and reclaiming the
	// lease of a card that was deliberately held — or that is waiting on a verdict — would burn the retry budget
	// of work nobody abandoned. That is the v16 defect with a different trigger, and it is also the exact bug
	// that hung a dead board for two hours when the monitor was widened the OTHER way.
	return (
		phaseClass === "waiting_capacity" ||
		phaseClass === "running" ||
		phaseClass === "reviewing" ||
		phaseClass === "paused" ||
		phaseClass === "awaiting_verdict"
	);
}

/**
 * Whether this card currently OCCUPIES a runtime slot — the phase-side counterpart of `isBusySessionState`.
 *
 * ── WHY THIS IS A SECOND PREDICATE AND NOT A SYNONYM FOR LIVENESS ──
 * "The runtime owes this card work" and "this card is consuming a slot right now" are different questions, and
 * the phases where they DISAGREE are the ones that cause wedges:
 *   • `queued_for_endpoint` — alive, holds nothing. Counting it as occupancy would have the scheduler refuse to
 *     admit the very card it is waiting to start.
 *   • `paused` — alive, holds nothing (pausing emits `release_resources` on the way in). Counting it as occupancy
 *     over-counts a card that gave its slot back, and can starve a host of capacity that is genuinely free.
 * Collapsing the two into one predicate is how a system ends up with five competing definitions of "busy"; this
 * is the second half of the canonical vocabulary P24.1 step 2 migrates consumers onto.
 *
 * **This was NOT safe to define before the `paused` phase existed.** A paused card used to sit in `implementing`
 * and classify as `running`, so any occupancy predicate built on the classification would have counted it — the
 * v9 parent-reacquire wedge family, approached from the opposite direction. The gap was recorded rather than
 * guessed at, and this closes it.
 */
export function holdsWorkerCapacity(phase: WorkflowPhase): boolean {
	return classifyWorkflowPhase(phase) === "running";
}

/**
 * Whether MODEL-ENDPOINT work is in flight for this card — the OTHER resource (David 2026-08-03, the
 * split-by-resource decision). A `reviewing` card holds an endpoint (the reviewer is generating —
 * live-confirmed: cards queue behind the busy reviewer) while holding NO worker slot; every worker-running
 * phase holds its endpoint too (the worker generates on one). Admission for model endpoints reads THIS;
 * admission for worker slots reads {@link holdsWorkerCapacity}/{@link reservesWorkerCapacity}. One phase no
 * longer wears two meanings — the 6-of-7 agreement gap this replaces was two models counting different
 * resources with one word.
 */
export function holdsEndpointCapacity(phase: WorkflowPhase): boolean {
	const phaseClass = classifyWorkflowPhase(phase);
	return phaseClass === "running" || phaseClass === "reviewing";
}

/**
 * Whether this card holds a slot OR is committed to taking one — the ADMISSION-facing predicate.
 *
 * ── WHY BOTH THIS AND `holdsWorkerCapacity` EXIST ──
 * "How many slots are consumed right now?" and "how many more cards may I admit?" are different questions, and
 * answering the second with the first over-admits: a queued card is going to take the slot it is waiting for, so
 * an admission check that ignores it hands the same slot out twice.
 *
 * **The session model's `isBusySessionState` is THIS predicate, not `holdsWorkerCapacity` — despite its name.**
 * Its own doc-comment carries both readings in three lines: *"actively occupies a runtime/model slot"* and then
 * *"holding (**or about to hold**) capacity"*. A consumer migrating on the strength of the first sentence would
 * silently stop counting queued cards. That ambiguity, sitting in the definition itself, is the drift class P24.1
 * exists to end — so the kernel names the two readings apart instead of inheriting one word for both.
 *
 * ⚠️ **This agrees with `isBusySessionState` on six of seven session states. The exception is `awaiting_review`,
 * and it is a real design question rather than an oversight** — see `workflow-phase-session-agreement.test.ts`.
 * The two models count DIFFERENT RESOURCES there: the session means "no worker session is running", the kernel's
 * `running` class means "the runtime still has work in flight", and a review IS in flight on a model endpoint.
 * Until that is resolved deliberately, neither predicate is a mechanical drop-in for the other at a capacity
 * call site.
 */
export function reservesWorkerCapacity(phase: WorkflowPhase): boolean {
	const phaseClass = classifyWorkflowPhase(phase);
	return phaseClass === "waiting_capacity" || phaseClass === "running";
}

/**
 * Apply one command to the current phase. Pure + total. `cancel_requested` and `failed` are honored from any
 * non-terminal phase (releasing resources); otherwise each phase advances only on its expected command, and any other
 * command is a no-op that holds the phase (so out-of-order/duplicate events are safe to replay).
 */
export function applyWorkflowCommand(phase: WorkflowPhase, command: WorkflowCommand): WorkflowTransition {
	const hold: WorkflowTransition = { phase, effects: [] };

	// F1.27b `reopened`: the ONLY command honored at a terminal phase — a failed/cancelled card the recovery
	// rungs (or the operator) restart goes back to idle so the admission ladder replays cleanly. Delivered work
	// never reopens; reopening an already-idle card is a natural hold (idle → idle, no effects).
	if (command.kind === "reopened") {
		return phase === "completed" ? hold : { phase: "idle", effects: [] };
	}

	if (isTerminalWorkflowPhase(phase)) {
		return hold;
	}

	if (command.kind === "cancel_requested") {
		return { phase: "cancelled", effects: [{ kind: "release_resources" }] };
	}
	if (command.kind === "failed") {
		return { phase: "failed", effects: [{ kind: "release_resources" }] };
	}

	switch (phase) {
		case "idle":
			return command.kind === "start_requested"
				? { phase: "queued_for_board_capacity", effects: [{ kind: "enqueue", queue: "board_capacity" }] }
				: hold;
		case "queued_for_board_capacity":
			return command.kind === "board_capacity_granted"
				? { phase: "queued_for_endpoint", effects: [{ kind: "enqueue", queue: "endpoint" }] }
				: hold;
		case "queued_for_endpoint":
			return command.kind === "endpoint_granted"
				? { phase: "queued_for_sandbox", effects: [{ kind: "enqueue", queue: "sandbox" }] }
				: hold;
		case "queued_for_sandbox":
			return command.kind === "sandbox_granted" ? { phase: "planning", effects: [{ kind: "start_session" }] } : hold;
		case "planning":
			return command.kind === "begin_implementation" ? { phase: "implementing", effects: [] } : hold;
		case "implementing":
			if (command.kind === "pause_requested") {
				// Releases the slot on the way in — which is what makes `paused` non-capacity-holding rather than
				// merely labelled so.
				return { phase: "paused", effects: [{ kind: "release_resources" }] };
			}
			return command.kind === "implementation_finished"
				? { phase: "awaiting_acceptance", effects: [{ kind: "run_acceptance" }] }
				: hold;
		case "paused":
			// Resuming re-enters the admission ladder rather than jumping straight back to work: the slot was
			// released, so it must be re-acquired like any other card.
			return command.kind === "resume_requested"
				? { phase: "queued_for_endpoint", effects: [{ kind: "enqueue", queue: "endpoint" }] }
				: hold;
		case "awaiting_acceptance":
			if (command.kind === "acceptance_passed") {
				return { phase: "awaiting_review", effects: [{ kind: "request_review" }] };
			}
			// A failed acceptance bounces back to implementation for another attempt.
			return command.kind === "acceptance_failed" ? { phase: "implementing", effects: [] } : hold;
		case "awaiting_review":
			return command.kind === "review_started" ? { phase: "reviewing", effects: [] } : hold;
		case "reviewing":
			if (command.kind === "review_passed") {
				return { phase: "ready_for_delivery", effects: [{ kind: "capture_result_branch" }] };
			}
			// Requested changes bounce back to implementation.
			return command.kind === "review_changes_requested" ? { phase: "implementing", effects: [] } : hold;
		case "ready_for_delivery":
			return command.kind === "delivery_requested" ? { phase: "delivering", effects: [] } : hold;
		case "delivering":
			return command.kind === "delivered" ? { phase: "completed", effects: [{ kind: "mark_done" }] } : hold;
		default:
			return hold;
	}
}
