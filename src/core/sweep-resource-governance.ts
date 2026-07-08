/**
 * §5.AI/§10 sweep resource governance (operational) — the pure deciders that keep a background model-sweep from
 * starving the machine or the user's interactive work. Two orthogonal questions:
 *   - **Is there HEADROOM to start a sweep?** ({@link decideSweepStartHeadroom}) — enough free RAM/VRAM/disk for the
 *     model it will load + the workspaces it will scaffold, or it should wait.
 *   - **Should a running sweep YIELD?** ({@link decideSweepPriority}) — an interactive task always preempts an idle
 *     background sweep; a sweep only runs when the machine is otherwise idle.
 *
 * Pure + total + deterministic: the effectful runner samples the live figures (free RAM via the OS, VRAM/disk, whether
 * an interactive task is in flight) and feeds them in; these only classify. Composes the §5.AB `decideModelLoadAction`
 * (which governs the per-model load itself) — this governs whether the SWEEP as a whole may start/continue.
 */

export interface SweepHeadroomInput {
	/** Free system RAM in GB. */
	freeRamGb: number;
	/** RAM the sweep needs (≈ the model it will load + overhead). */
	requiredRamGb: number;
	/** Free disk in GB (for scaffolded dev-test workspaces + result branches). */
	freeDiskGb: number;
	/** Disk the sweep needs for its workspaces. */
	requiredDiskGb: number;
	/** Free VRAM in GB — omit when the model runs on CPU/unified memory (then no VRAM gate). */
	freeVramGb?: number | null;
	/** VRAM the sweep needs — omit/null to skip the VRAM gate. */
	requiredVramGb?: number | null;
}

export interface SweepHeadroomDecision {
	ok: boolean;
	/** The resources that are short (empty when ok). */
	blockers: Array<"ram" | "vram" | "disk">;
	reason: string;
}

function short(free: number, required: number): boolean {
	return Number.isFinite(free) && Number.isFinite(required) && free < required;
}

/**
 * Decide whether there is enough headroom to START a sweep. Checks RAM, disk, and (when both figures are provided) VRAM.
 * A missing/nullish VRAM pair skips the VRAM gate (unified-memory / CPU models don't have a separate VRAM budget).
 */
export function decideSweepStartHeadroom(input: SweepHeadroomInput): SweepHeadroomDecision {
	const blockers: Array<"ram" | "vram" | "disk"> = [];
	if (short(input.freeRamGb, input.requiredRamGb)) {
		blockers.push("ram");
	}
	if (
		typeof input.freeVramGb === "number" &&
		typeof input.requiredVramGb === "number" &&
		short(input.freeVramGb, input.requiredVramGb)
	) {
		blockers.push("vram");
	}
	if (short(input.freeDiskGb, input.requiredDiskGb)) {
		blockers.push("disk");
	}
	if (blockers.length === 0) {
		return { ok: true, blockers, reason: "Enough RAM/VRAM/disk headroom to start the sweep." };
	}
	return {
		ok: false,
		blockers,
		reason: `Insufficient headroom to start the sweep — short on: ${blockers.join(", ")}. Wait for resources to free up.`,
	};
}

export interface SweepPriorityInput {
	/** Is a user-facing interactive task (chat turn / board card the user is watching) in flight right now? */
	interactiveTaskActive: boolean;
	/** Is a background sweep currently running? */
	sweepRunning: boolean;
}

export type SweepPriorityAction =
	/** Nothing interactive in flight and no sweep running — a sweep may start. */
	| { action: "may_start_sweep"; reason: string }
	/** A sweep is running and nothing interactive contends — let it continue. */
	| { action: "continue_sweep"; reason: string }
	/** An interactive task is in flight while a sweep runs — the sweep must YIELD (pause) so the user isn't starved. */
	| { action: "preempt_sweep"; reason: string }
	/** An interactive task is in flight and no sweep runs — hold off starting one. */
	| { action: "hold_sweep"; reason: string };

/**
 * Decide the sweep's priority relative to interactive work: interactive ALWAYS wins. A running sweep yields
 * (`preempt_sweep`) the moment an interactive task appears; a new sweep is held (`hold_sweep`) while interactive work is
 * in flight, and may start (`may_start_sweep`) only when the machine is otherwise idle.
 */
export function decideSweepPriority(input: SweepPriorityInput): SweepPriorityAction {
	if (input.interactiveTaskActive) {
		return input.sweepRunning
			? {
					action: "preempt_sweep",
					reason: "An interactive task is in flight — the background sweep yields so the user isn't starved.",
				}
			: { action: "hold_sweep", reason: "An interactive task is in flight — hold off starting a background sweep." };
	}
	return input.sweepRunning
		? { action: "continue_sweep", reason: "No interactive work contends — the sweep continues." }
		: { action: "may_start_sweep", reason: "The machine is otherwise idle — a background sweep may start." };
}
