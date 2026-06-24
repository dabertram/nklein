/**
 * Per-agent focus chain (todo.md §5.N) — the agent-authored, ordered checklist it drafts at the start of a task
 * and works through step by step (like Cline's focus chain / Claude Code / Cursor todo lists). Keeping a small
 * model on-task across a long run, and making the plan-of-attack + live progress legible to the user.
 *
 * This pure core owns the data shape and the normalization of an agent-emitted chain (the agent re-emits the
 * whole list with per-step statuses each time it updates, which is the most reliable shape for small models —
 * no fragile incremental ops). The persistence (board card / chat session) and the checklist UI consume this;
 * `formatFocusChainForPrompt` re-projects it back into the model's context so it stays anchored to its plan.
 */

export type FocusChainStepStatus = "pending" | "in_progress" | "done" | "skipped";

export interface FocusChainStep {
	text: string;
	status: FocusChainStepStatus;
	/** When the step first became active (in_progress/done/skipped). Stamped by !Klein, not the agent. */
	startedAt?: number;
	/** When the step first finished (done/skipped). Cleared if the step is later re-opened. */
	completedAt?: number;
}

export interface FocusChain {
	steps: FocusChainStep[];
	updatedAt: number;
}

export interface FocusChainSummary {
	total: number;
	done: number;
	inProgress: number;
	pending: number;
	skipped: number;
	/** True when every step is done or skipped (nothing left actionable). */
	complete: boolean;
}

/** Caps so a runaway model can't blow the context budget or persist an unbounded chain (small-model safety). */
export const MAX_FOCUS_CHAIN_STEPS = 30;
export const MAX_FOCUS_CHAIN_STEP_TEXT = 240;

const FOCUS_CHAIN_STEP_STATUSES = new Set<FocusChainStepStatus>(["pending", "in_progress", "done", "skipped"]);

function coerceStatus(value: unknown): FocusChainStepStatus {
	return typeof value === "string" && FOCUS_CHAIN_STEP_STATUSES.has(value as FocusChainStepStatus)
		? (value as FocusChainStepStatus)
		: "pending";
}

/**
 * Normalize an agent-emitted focus chain: trim + clamp each step's text, drop empty/whitespace steps, coerce
 * unknown statuses to `pending`, and cap the step count. Returns null when there is no usable step (so callers
 * can treat "no chain" distinctly from "an empty chain").
 */
export function normalizeFocusChain(
	rawSteps: ReadonlyArray<{ text?: unknown; status?: unknown }> | null | undefined,
	now: number = Date.now(),
): FocusChain | null {
	if (!Array.isArray(rawSteps)) {
		return null;
	}
	const steps: FocusChainStep[] = [];
	for (const raw of rawSteps) {
		if (steps.length >= MAX_FOCUS_CHAIN_STEPS) {
			break;
		}
		const text = typeof raw?.text === "string" ? raw.text.trim().slice(0, MAX_FOCUS_CHAIN_STEP_TEXT) : "";
		if (!text) {
			continue;
		}
		steps.push({ text, status: coerceStatus(raw?.status) });
	}
	if (steps.length === 0) {
		return null;
	}
	return { steps, updatedAt: now };
}

/**
 * Carry per-step timing across an agent re-emission (todo §5.N). The agent re-emits the whole list (text+status)
 * each turn with no timestamps; this merges the prior chain's timings into the new one — matched by step text so
 * a reordered/edited list keeps its timings — and stamps `startedAt` when a step first becomes active and
 * `completedAt` when it first finishes (cleared if the step is re-opened to a non-final status). Pure.
 */
export function applyFocusChainStepTiming(
	previous: FocusChain | null | undefined,
	next: FocusChain,
	now: number = Date.now(),
): FocusChain {
	const priorByText = new Map<string, { startedAt?: number; completedAt?: number }>();
	for (const step of previous?.steps ?? []) {
		priorByText.set(step.text, { startedAt: step.startedAt, completedAt: step.completedAt });
	}
	const steps = next.steps.map((step): FocusChainStep => {
		const prior = priorByText.get(step.text);
		const isActive = step.status !== "pending";
		const isFinished = step.status === "done" || step.status === "skipped";
		const startedAt = prior?.startedAt ?? (isActive ? now : undefined);
		const completedAt = isFinished ? (prior?.completedAt ?? now) : undefined;
		return {
			text: step.text,
			status: step.status,
			...(startedAt !== undefined ? { startedAt } : {}),
			...(completedAt !== undefined ? { completedAt } : {}),
		};
	});
	return { steps, updatedAt: next.updatedAt };
}

export function summarizeFocusChain(chain: FocusChain | null | undefined): FocusChainSummary {
	const steps = chain?.steps ?? [];
	const done = steps.filter((step) => step.status === "done").length;
	const inProgress = steps.filter((step) => step.status === "in_progress").length;
	const pending = steps.filter((step) => step.status === "pending").length;
	const skipped = steps.filter((step) => step.status === "skipped").length;
	return {
		total: steps.length,
		done,
		inProgress,
		pending,
		skipped,
		complete: steps.length > 0 && done + skipped === steps.length,
	};
}

const FOCUS_CHAIN_STATUS_MARK: Record<FocusChainStepStatus, string> = {
	done: "[x]",
	in_progress: "[~]",
	skipped: "[-]",
	pending: "[ ]",
};

/** Render the chain as a compact markdown checklist for re-injecting into the model's context (keeps it on-plan). */
export function formatFocusChainForPrompt(chain: FocusChain | null | undefined): string {
	const steps = chain?.steps ?? [];
	if (steps.length === 0) {
		return "(no focus chain yet)";
	}
	return steps.map((step) => `${FOCUS_CHAIN_STATUS_MARK[step.status]} ${step.text}`).join("\n");
}
