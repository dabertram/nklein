/**
 * N5/N7 — the invariant-pack REGISTRY: what each nightly project's `invariantPack` name actually resolves to.
 *
 * `nightly-manifest.json` has named `core-invariants` since N1 shipped, and until now **nothing defined it.** The
 * name resolved to nothing and the runner never looked it up, so every cell was judged on the coarse outcome
 * (did the drain script exit non-zero?) rather than on what "finishes properly" means. `resolvePack` returning
 * `null` for an unknown name is what makes that visible instead of silently asserting nothing.
 *
 * ── WHY THE PACKS ARE DELIBERATELY SMALL RIGHT NOW ──
 * A pack should assert what the harness can actually OBSERVE. N5 reports a signal it was not watching as
 * `indeterminate`, never as a pass — so declaring a rich pack today would not make the nightly stricter, it would
 * make it produce a wall of `indeterminate` that nobody reads. The honest sequencing is: **add a signal to a pack
 * when the collector can genuinely observe it**, not in advance of that.
 *
 * That ordering matters more than it looks. A pack full of unobservable expectations and a pack that asserts
 * nothing produce the same amount of real checking; the difference is that the first one LOOKS thorough. Every
 * entry here should be traceable to something the drain actually emits.
 */

import type { InvariantPack } from "./nightly-invariant-pack";

/**
 * The baseline pack every nightly project composes from.
 *
 * `expectedTerminalLanes` is the one thing the simulated drain reliably reaches. `mustFire` / `mustStayQuiet` are
 * EMPTY on purpose — the runner does not subscribe to signals yet (see N5b's collector wire), and listing them
 * here would produce `indeterminate` for each rather than any additional checking.
 */
export const CORE_INVARIANTS: InvariantPack = {
	id: "core-invariants",
	// "completed" is the BOARD's lane name, taken from the drain's own `finalCounts`. An earlier draft said "done",
	// which would have failed every cell spuriously — a pack whose vocabulary does not match the board's is worse
	// than no pack, because it produces confident wrong verdicts rather than silence.
	expectedTerminalLanes: ["completed"],
	// N7c: signals the drain DEMONSTRABLY emits — taken from a real run's self-observation log (313 observations,
	// 2026-07-20), not from a list of what would be nice to assert. A pack entry for a signal nothing emits
	// produces `indeterminate` forever, which looks like rigour and adds no checking.
	mustFire: ["second_opinion_review_session", "agent_sandbox_result_patch"],
	// Guards that must stay quiet on a healthy run. `board_liveness_watchdog` (the frozen-board self-heal, as
	// distinct from its routine `_tick`) firing means the board stalled — the exact N7d failure. Asserting it here
	// means the nightly now CATCHES that class rather than only reporting a lane count.
	mustStayQuiet: ["board_liveness_watchdog", "runtime_error"],
	// N5 2026-07-26: the FLAKY profile's recordings inject faults on purpose (empty completions, malformed tool
	// args, endpoint failures), so recoverable `runtime_error` events are that profile's expected working noise —
	// the run's health is judged by full drain + mustFire instead. `board_liveness_watchdog` stays asserted for
	// flaky too: even under injected faults the board must never freeze into the self-heal path.
	quietExemptionsByProfile: { flaky: ["runtime_error"] },
};

/**
 * Projects that legitimately end PARKED rather than done — a card the harness deliberately cannot finish. Kept
 * separate rather than widening `core-invariants`, because adding "parked" to the baseline would make every
 * project accept a parked card as success, which is the failure `expectedTerminalLanes` exists to catch.
 */
export const PARKED_TERMINAL: InvariantPack = {
	id: "parked-terminal",
	// 🐛 CAUGHT BY `nightly-registry-integrity.test.ts` ON ITS FIRST RUN: this said `["parked", "attention"]`, and
	// NEITHER is a board lane. A parked card sits in `review` awaiting an operator — "parked" is a session state,
	// not a column. The pack would have failed every cell it judged, and the symptom would have read as "the
	// nightly is broken" rather than "the pack names a lane that does not exist".
	//
	// Exactly the failure this pack's sibling had hours earlier (`done` vs `completed`), found by hand then and by
	// test now — which is the difference the guard makes.
	expectedTerminalLanes: ["review"],
	mustFire: [],
	mustStayQuiet: [],
	includes: ["core-invariants"],
};

/**
 * N2 `loop_park` mechanism profile: the recording makes a worker repeat one tool call with identical input
 * until the repeated-tool-call guard parks the card — proving the loop guard AND `budget_wall` fire for real.
 * Deliberately NOT composed from `core-invariants`: a parked run never reaches review/capture, so the core
 * `mustFire` gates (second_opinion_review_session, agent_sandbox_result_patch) would be false failures here.
 * The parked card sits in the `review` lane awaiting the operator (a session state, not a column — the same
 * lesson PARKED_TERMINAL's bug comment records).
 */
export const LOOP_PARK_TERMINAL: InvariantPack = {
	id: "loop-park-terminal",
	// The DESIGNED shape (validated live 2026-07-27): the seed + pre-loop cards complete; the looping card parks
	// (budget_wall), the bounded terminal-redrive escalation gives a swapped model one chance to break the loop —
	// in a single-model sim that loops again → second park → attempts exhausted → the card ends FAILED; its
	// dependents legitimately starve in planning. budget_wall fired twice in the validating run, proving both the
	// guard AND the escalation's bounded retry.
	expectedTerminalLanes: ["completed", "review", "planning", "failed"],
	mustFire: ["budget_wall"],
	// The park is a deliberate guard action on a stuck card, not a frozen board — the self-heal must stay quiet.
	mustStayQuiet: ["board_liveness_watchdog"],
};

export const NIGHTLY_PACK_REGISTRY: ReadonlyMap<string, InvariantPack> = new Map([
	[CORE_INVARIANTS.id, CORE_INVARIANTS],
	[PARKED_TERMINAL.id, PARKED_TERMINAL],
	[LOOP_PARK_TERMINAL.id, LOOP_PARK_TERMINAL],
]);
