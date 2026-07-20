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
	mustFire: [],
	mustStayQuiet: [],
};

/**
 * Projects that legitimately end PARKED rather than done — a card the harness deliberately cannot finish. Kept
 * separate rather than widening `core-invariants`, because adding "parked" to the baseline would make every
 * project accept a parked card as success, which is the failure `expectedTerminalLanes` exists to catch.
 */
export const PARKED_TERMINAL: InvariantPack = {
	id: "parked-terminal",
	expectedTerminalLanes: ["parked", "attention"],
	mustFire: [],
	mustStayQuiet: [],
	includes: ["core-invariants"],
};

export const NIGHTLY_PACK_REGISTRY: ReadonlyMap<string, InvariantPack> = new Map([
	[CORE_INVARIANTS.id, CORE_INVARIANTS],
	[PARKED_TERMINAL.id, PARKED_TERMINAL],
]);
