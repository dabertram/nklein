/**
 * F12.18b(a) — the per-role `alwaysKeep` set: tools the catalog gate must NEVER drop. PURE core.
 *
 * `tool-catalog-retrieval-gate.ts` states the hazard precisely: *"A relevance gate that drops the tool the agent
 * needs to FINISH does not degrade the turn, it DEADLOCKS it."* A reviewer without `submit_review` cannot submit
 * a review; a worker without its completion tool cannot end a turn. Those are not degraded outcomes — they are
 * a hung card that a human has to notice.
 *
 * ── WHY THIS EXISTS BEFORE ENFORCEMENT, NOT AFTER ──
 * F12.18b says the observe→enforce flip must wait for the measured drop rate. **But the observation running
 * today passes NO `alwaysKeep` at all** — it measures a gate that would drop anything, including the tools that
 * deadlock a turn. So the drop rate being collected does not describe the configuration anyone would enforce; it
 * is systematically worse, and a decision made on it would be a decision about a gate that will never ship.
 *
 * Supplying the real set makes the observation measure the thing under consideration. That is the entire point:
 * **an observation that does not observe the enforcing configuration cannot license enforcement**, however many
 * samples it accumulates.
 *
 * ── THE SET IS DELIBERATELY SMALL ──
 * Every tool kept is a tool not gated, and the gate exists because 40+ offered tools cause 62% of tool-use
 * failures (target ~7). An `alwaysKeep` set that grows to cover "probably useful" tools reinstates the problem
 * while looking like safety. Only two kinds qualify:
 *  1. **Terminal tools** — without them the turn cannot END. Deadlock, not degradation.
 *  2. **Universal read** — without any way to look at the repo, a worker cannot begin, and every scoring failure
 *     becomes a hung card rather than a bad edit.
 * Anything else is a preference and belongs to the gate's scoring, where it can be outranked.
 */

import type { SwarmRole } from "./role-model-class";

/**
 * Tools that end a turn. Dropping one of these is the deadlock case — spelled per role because a reviewer's
 * terminal tool is not a worker's, and keeping the union everywhere would inflate every role's floor.
 */
const TERMINAL_TOOLS_BY_ROLE: Record<SwarmRole, readonly string[]> = {
	architect: ["decompose_project"],
	// `decompose_project` is worker-terminal-class BY DECISION (David, 2026-08-02), not by oversight of the
	// union warning above. The A/B replicated 2/2: with workers narrowed to ~7 tools, decompose_project scored
	// out, the ACT seed stopped fanning out entirely (0 children vs 5–7), and enforcement silently became a
	// decomposition-suppressor. Fan-out is the swarm's core shape, so a worker that decides to split must always
	// be ABLE to — the gate's job is dropping distractors, not changing the product's topology.
	worker: ["attempt_completion", "mark_task_complete", "decompose_project"],
	reviewer: ["submit_review"],
};

/**
 * The minimum read capability. Kept for every role: a turn that cannot read cannot do anything useful, and the
 * failure presents as a stall rather than as a wrong answer — the harder kind to diagnose.
 */
const UNIVERSAL_TOOLS: readonly string[] = ["read_file", "read_files"];

/**
 * The tools the gate must never drop for this role.
 *
 * Returns names that may not exist in a given catalog — that is intentional and harmless. The gate matches by
 * name, so an absent name simply never matches, and listing a tool the harness has since renamed is far safer
 * than omitting one it still has. **The failure directions are not symmetric:** a spurious entry costs one
 * un-gated slot; a missing entry costs a hung card.
 */
export function alwaysKeepToolsForRole(role: SwarmRole): readonly string[] {
	return [...TERMINAL_TOOLS_BY_ROLE[role], ...UNIVERSAL_TOOLS];
}

/**
 * Check a catalog actually offers a terminal tool for this role BEFORE gating it.
 *
 * If the catalog contains no terminal tool at all, `alwaysKeep` cannot save the turn — there is nothing to keep.
 * That is a harness misconfiguration rather than a gating decision, and it must be reported as such: gating
 * would proceed innocently and the deadlock would be blamed on the gate.
 */
export function assertTerminalToolPresent(
	role: SwarmRole,
	catalogToolNames: readonly string[],
): { readonly present: boolean; readonly reason: string } {
	const names = new Set(catalogToolNames.map((name) => name.trim().toLowerCase()));
	const terminal = TERMINAL_TOOLS_BY_ROLE[role].filter((name) => names.has(name));
	return terminal.length > 0
		? { present: true, reason: `terminal tool(s) present for ${role}: ${terminal.join(", ")}` }
		: {
				present: false,
				reason: `NO terminal tool for ${role} in a catalog of ${catalogToolNames.length} — expected one of ${TERMINAL_TOOLS_BY_ROLE[role].join(", ")}. alwaysKeep cannot protect what is not offered, so this is a HARNESS misconfiguration, not a gating decision; gating would proceed innocently and the resulting deadlock would be blamed on the gate`,
			};
}

/** Every name any role protects — for tests and for a catalog-wide sanity check. */
export function allAlwaysKeepToolNames(): readonly string[] {
	return [...new Set([...Object.values(TERMINAL_TOOLS_BY_ROLE).flat(), ...UNIVERSAL_TOOLS])].sort();
}
