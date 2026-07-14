/**
 * Plan cursor (pure) — ported from opencode-swarm's plan_cursor. Compresses a full plan into a token-bounded injection
 * so a long decomposition doesn't re-spend the whole plan's tokens on every turn. The shape mirrors PRM's rationale:
 * the model needs FULL detail for what it's about to do and only a one-line reminder of everything else.
 *
 *   - DONE work collapses to a single per-phase tally line ("Phase 1: 4/4 done").
 *   - The current task + the next `lookaheadTasks` render in FULL detail.
 *   - Everything further out renders as a one-line title.
 *   - If the result still exceeds `maxTokens`, the farthest-future FULL entries degrade to title-only until it fits
 *     (never dropping the current task — the one thing the model must not lose).
 *
 * Pure + deterministic: the caller passes the plan snapshot + where the cursor sits; token cost is estimated with a
 * conventional chars/4 heuristic (no tokenizer dependency). The effectful b-leaf reads the live plan and substitutes
 * this compressed block for the full plan text at the injection seam.
 */

export interface PlanCursorTask {
	readonly id: string;
	readonly title: string;
	/** The phase/group this task belongs to (drives the done-phase tally lines). */
	readonly phase: string;
	/** The full detail text shown only when the task is within the lookahead window. */
	readonly detail: string;
	readonly status: "done" | "active" | "pending";
}

export interface PlanCursorConfig {
	/** Upper bound on the compressed block's estimated tokens (default 1500). */
	readonly maxTokens: number;
	/** How many tasks AFTER the current one render in full detail (default 2). */
	readonly lookaheadTasks: number;
}

export const DEFAULT_PLAN_CURSOR_CONFIG: PlanCursorConfig = { maxTokens: 1500, lookaheadTasks: 2 };

export interface PlanCursorResult {
	readonly text: string;
	/** How many tasks rendered in full detail (after any budget-driven degradation). */
	readonly fullDetailCount: number;
	/** How many tasks rendered as a one-line title. */
	readonly summarizedCount: number;
	readonly estimatedTokens: number;
}

/** Conventional token estimate — ~4 chars/token. Deterministic; avoids a tokenizer dependency in the pure core. */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** The cursor index: the given current task, else the first non-done task, else the end (all done). */
function resolveCursorIndex(tasks: readonly PlanCursorTask[], currentTaskId: string | null | undefined): number {
	if (currentTaskId) {
		const explicit = tasks.findIndex((task) => task.id === currentTaskId);
		if (explicit !== -1) {
			return explicit;
		}
	}
	const firstPending = tasks.findIndex((task) => task.status !== "done");
	return firstPending === -1 ? tasks.length : firstPending;
}

export function compressPlanForInjection(
	input: {
		tasks: readonly PlanCursorTask[];
		currentTaskId?: string | null;
	},
	config: PlanCursorConfig = DEFAULT_PLAN_CURSOR_CONFIG,
): PlanCursorResult {
	const { tasks } = input;
	const cursor = resolveCursorIndex(tasks, input.currentTaskId);
	const lookahead = Math.max(0, config.lookaheadTasks);
	// The full-detail window is [cursor, cursor + lookahead]; a set of indices lets budget degradation flip entries off.
	const fullWindow = new Set<number>();
	for (let i = cursor; i <= cursor + lookahead && i < tasks.length; i += 1) {
		fullWindow.add(i);
	}

	const render = (): { text: string; full: number; summarized: number } => {
		const lines: string[] = [];
		let full = 0;
		let summarized = 0;

		// Done phases → one tally line each, in first-seen order.
		const doneByPhase = new Map<string, number>();
		const totalByPhase = new Map<string, number>();
		const phaseOrder: string[] = [];
		for (const task of tasks) {
			if (!totalByPhase.has(task.phase)) {
				phaseOrder.push(task.phase);
			}
			totalByPhase.set(task.phase, (totalByPhase.get(task.phase) ?? 0) + 1);
			if (task.status === "done") {
				doneByPhase.set(task.phase, (doneByPhase.get(task.phase) ?? 0) + 1);
			}
		}
		for (const phase of phaseOrder) {
			const done = doneByPhase.get(phase) ?? 0;
			if (done > 0) {
				lines.push(`✓ ${phase}: ${done}/${totalByPhase.get(phase)} done`);
			}
		}

		for (let i = 0; i < tasks.length; i += 1) {
			const task = tasks[i];
			if (task.status === "done") {
				continue; // already covered by the phase tally
			}
			if (fullWindow.has(i)) {
				lines.push(`▶ [${task.phase}] ${task.title}\n    ${task.detail}`);
				full += 1;
			} else {
				lines.push(`· [${task.phase}] ${task.title}`);
				summarized += 1;
			}
		}
		return { text: lines.join("\n"), full, summarized };
	};

	let rendered = render();
	// Degrade farthest-future full entries to title-only until under budget (never the cursor itself).
	const degradable = [...fullWindow].filter((i) => i !== cursor).sort((a, b) => b - a);
	for (const index of degradable) {
		if (estimateTokens(rendered.text) <= config.maxTokens) {
			break;
		}
		fullWindow.delete(index);
		rendered = render();
	}

	return {
		text: rendered.text,
		fullDetailCount: rendered.full,
		summarizedCount: rendered.summarized,
		estimatedTokens: estimateTokens(rendered.text),
	};
}
