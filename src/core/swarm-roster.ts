/**
 * Named swarm rosters (todo §5.AB per-machine pools, user 2026-06-29).
 *
 * Encodes the two operator-approved per-machine model assignments from
 * [docs/dev/model-catalog-recommendations.md](../../docs/dev/model-catalog-recommendations.md) ("Swarm rosters") as
 * typed data, so the pool config can name a roster and a swarm spins up from one preset (the §5.AB pools leaf). This is
 * pure reference data + a resolver — the EFFECTFUL loading across machines (LM Link) is the deferred remote-control
 * cluster; this module just declares "which model, which role, which machine, which quant" so that orchestration (and
 * the docs/UI) read from ONE source.
 *
 *  - **Roster Q** — quality-leaning (a 2026-06-29 GPT suggestion, analyzed + adapted).
 *  - **Roster M** — absolute-minimum size, still role-capable (user-requested); leans on the §5.AA recovery ladder to
 *    carry the sub-8B models over the tool-call-chaining bar our §5.O/§5.Z sweeps flagged.
 *
 * Machine ids match the user's hardware (`m5max`, `m4mini`, `legion`); roles are the §5.AB {@link SwarmRole}s plus a
 * non-swarm `general` slot (a reasoning/critic/summarizer alternate). Models are HuggingFace GGUF repo refs at the
 * noted quant — all tool-capable per the §5.AL catalog (avoid the reasoning-only tool traps).
 */

import type { SwarmRole } from "./role-model-class";

/** A swarm role plus the non-core `general` slot (reasoning/critic/summarizer alternate, not one of the 3 core roles). */
export type RosterRole = SwarmRole | "general";

export interface RosterAssignment {
	/** Machine id (the pool): `m5max` | `m4mini` | `legion`. */
	machine: string;
	/** What this model does in the swarm. */
	role: RosterRole;
	/** HuggingFace GGUF repo ref (the model to load on `machine`). */
	model: string;
	/** Quantization to load (e.g. `Q4_K_M`, `UD-Q4_K_M`). */
	quant: string;
	/** Approx. on-disk/in-memory size at `quant`, for headroom planning. */
	approxSizeGb: number;
	/** Whether this is an ALTERNATE for its machine (a second profile, not loaded simultaneously with the primary). */
	alternate?: boolean;
	/** One-line fit note. */
	note: string;
}

export interface SwarmRoster {
	id: string;
	label: string;
	assignments: readonly RosterAssignment[];
}

/** Roster Q — quality-leaning (analyzed/adapted from a 2026-06-29 GPT suggestion). */
export const ROSTER_Q: SwarmRoster = {
	id: "quality",
	label: "Roster Q — quality-leaning",
	assignments: [
		{
			machine: "m5max",
			role: "architect",
			model: "unsloth/Qwen3-Coder-Next-GGUF",
			quant: "UD-Q4_K_M",
			approxSizeGb: 48,
			note: "80B/3B-active agentic coder, 256k ctx — the big-brain architect/planner/final reviewer; fits 128 GB.",
		},
		{
			machine: "m4mini",
			role: "worker",
			model: "Qwen/Qwen2.5-Coder-14B-Instruct-GGUF",
			quant: "Q4_K_M",
			approxSizeGb: 9,
			note: "Mid coder / reviewer / design critic; keep ctx 8-16k for speed in 24 GB.",
		},
		{
			machine: "legion",
			role: "worker",
			model: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
			quant: "Q4_K_M",
			approxSizeGb: 4.7,
			note: "Fast implementer / test+lint fixer; fully on the 4070m 8 GB with KV room at modest ctx.",
		},
		{
			machine: "legion",
			role: "general",
			model: "Qwen/Qwen3-8B-GGUF",
			quant: "Q4_K_M",
			approxSizeGb: 5,
			alternate: true,
			note: "Alt profile: general reasoning / critic / summarizer (thinking-capable, TOOL_NATIVE); fits 8 GB.",
		},
	],
};

/** Roster M — absolute-minimum size, still role-capable (user-requested); leans on the §5.AA ladder for ≤7B models. */
export const ROSTER_M: SwarmRoster = {
	id: "minimum",
	label: "Roster M — absolute-minimum size",
	assignments: [
		{
			machine: "m5max",
			role: "architect",
			model: "Qwen/Qwen3-8B-GGUF",
			quant: "Q4_K_M",
			approxSizeGb: 5,
			note: "Smallest with solid reasoning + thinking-mode + TOOL_NATIVE; below this, planning quality drops sharply.",
		},
		{
			machine: "m4mini",
			role: "worker",
			model: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
			quant: "Q4_K_M",
			approxSizeGb: 4.7,
			note: "Smallest reliably-tool-calling code model (3B is borderline on multi-tool chaining).",
		},
		{
			machine: "legion",
			role: "worker",
			model: "Qwen/Qwen2.5-Coder-3B-Instruct-GGUF",
			quant: "Q4_K_M",
			approxSizeGb: 2,
			note: "Micro-worker for trivial single-edit cards; escalate to 7B when it stalls (§5.AA ladder).",
		},
	],
};

export const SWARM_ROSTERS: readonly SwarmRoster[] = [ROSTER_Q, ROSTER_M];

/** Resolve a roster by id (case-insensitive); null when unknown. */
export function resolveSwarmRoster(id: string): SwarmRoster | null {
	const key = id.trim().toLowerCase();
	return SWARM_ROSTERS.find((roster) => roster.id === key) ?? null;
}

/** The PRIMARY (non-alternate) assignment for each machine in a roster — what the orchestrator loads by default. */
export function primaryAssignmentsByMachine(roster: SwarmRoster): Map<string, RosterAssignment> {
	const byMachine = new Map<string, RosterAssignment>();
	for (const assignment of roster.assignments) {
		if (assignment.alternate) {
			continue;
		}
		if (!byMachine.has(assignment.machine)) {
			byMachine.set(assignment.machine, assignment);
		}
	}
	return byMachine;
}

/**
 * The user's hardware budgets in GB — the FAST-RESIDENT constraint per machine (the m5max/m4mini are unified memory;
 * the legion's binding limit is its RTX 4070m's 8 GB VRAM, since a model must fit fully on the GPU to stay fast).
 */
export const USER_MACHINE_BUDGETS_GB: Readonly<Record<string, number>> = { m5max: 128, m4mini: 24, legion: 8 };

export interface MachineFit {
	machine: string;
	/** Sum of the machine's PRIMARY (non-alternate) assignment sizes. */
	usedGb: number;
	budgetGb: number;
	/** True when `usedGb` clears the budget minus the headroom reserve. */
	fits: boolean;
}

export interface RosterFit {
	fits: boolean;
	machines: readonly MachineFit[];
}

/**
 * Pure: does a roster fit the machine budgets (with a headroom reserve for KV-cache/OS)? Sums each machine's PRIMARY
 * assignments (alternates excluded — a second profile isn't loaded at the same time) and checks against
 * `budgetGb × (1 − headroomFraction)`. A machine in the roster but absent from `budgetsGb` is treated as 0 budget
 * (cannot fit) so a typo/unknown machine surfaces rather than silently passing.
 */
export function assessRosterFit(
	roster: SwarmRoster,
	budgetsGb: Readonly<Record<string, number>> = USER_MACHINE_BUDGETS_GB,
	headroomFraction = 0.1,
): RosterFit {
	const usedByMachine = new Map<string, number>();
	for (const assignment of roster.assignments) {
		if (assignment.alternate) {
			continue;
		}
		usedByMachine.set(assignment.machine, (usedByMachine.get(assignment.machine) ?? 0) + assignment.approxSizeGb);
	}
	const machines: MachineFit[] = [...usedByMachine.entries()].map(([machine, usedGb]) => {
		const budgetGb = budgetsGb[machine] ?? 0;
		return { machine, usedGb, budgetGb, fits: usedGb <= budgetGb * (1 - headroomFraction) };
	});
	return { fits: machines.every((m) => m.fits), machines };
}

/**
 * Pure: a human-readable report of a roster — its per-machine assignments (role · model · quant · size) annotated with
 * the fit verdict against the budgets. The operator-output core a `dev rosters` command / Settings panel renders.
 */
export function formatSwarmRosterReport(
	roster: SwarmRoster,
	budgetsGb: Readonly<Record<string, number>> = USER_MACHINE_BUDGETS_GB,
): string {
	const fit = assessRosterFit(roster, budgetsGb);
	const fitByMachine = new Map(fit.machines.map((m) => [m.machine, m]));
	const lines: string[] = [`${roster.label} — ${fit.fits ? "FITS ✓" : "OVERCOMMITS ✗"}`];
	for (const machine of [...new Set(roster.assignments.map((a) => a.machine))]) {
		const mf = fitByMachine.get(machine);
		const budget = mf ? `${mf.usedGb.toFixed(1)}/${mf.budgetGb} GB ${mf.fits ? "✓" : "✗"}` : "(no primary)";
		lines.push(`  ${machine}: ${budget}`);
		for (const a of roster.assignments.filter((x) => x.machine === machine)) {
			const alt = a.alternate ? " [alt]" : "";
			lines.push(`    - ${a.role}${alt}: ${a.model} ${a.quant} (~${a.approxSizeGb} GB) — ${a.note}`);
		}
	}
	return lines.join("\n");
}
