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
	/** Repo-relative file paths touched WHILE this step was active (todo §5.N). Stamped by !Klein — the agent never
	 *  emits these — so the UI/telemetry can link a step to what it actually changed. Accumulated + deduped. */
	touchedFiles?: string[];
	/** Card ids this step touched (spawned/linked/depended on) while active — same accumulation as `touchedFiles`. */
	touchedCardIds?: string[];
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

/** Cap on how many distinct files/cards a single step links (small-model safety — bounds persisted growth). */
export const MAX_FOCUS_CHAIN_STEP_TOUCHES = 50;

/** New file/card touches observed since the last re-emit, to attribute to the currently-active step(s). */
export interface FocusChainStepTouchDelta {
	files?: readonly string[];
	cardIds?: readonly string[];
}

/** Trim, drop empties, dedupe (first-seen order), and cap a touch list. */
function normalizeTouchList(
	existing: readonly string[] | undefined,
	incoming: readonly string[] | undefined,
): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of [...(existing ?? []), ...(incoming ?? [])]) {
		const trimmed = typeof value === "string" ? value.trim() : "";
		if (!trimmed || seen.has(trimmed) || result.length >= MAX_FOCUS_CHAIN_STEP_TOUCHES) {
			continue;
		}
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result;
}

/**
 * Attribute file/card touches to the focus-chain step that was active when they happened (todo §5.N: "link a step to
 * the files/cards it touched"). Like {@link applyFocusChainStepTiming}, this carries prior accumulations across the
 * agent's wholesale re-emissions — matched by step text so a reorder/edit keeps them — and folds the NEW `delta`
 * touches into every step that is `in_progress` in `next` (the steps the agent has declared it is actively working).
 * When no step is in_progress the delta is dropped: a touch only links to a step the agent said was active, never
 * guessed onto an arbitrary one. Deduped + capped; pure (no I/O, no clock).
 */
export function applyFocusChainStepTouches(
	previous: FocusChain | null | undefined,
	next: FocusChain,
	delta: FocusChainStepTouchDelta = {},
): FocusChain {
	const priorByText = new Map<string, { touchedFiles?: string[]; touchedCardIds?: string[] }>();
	for (const step of previous?.steps ?? []) {
		priorByText.set(step.text, { touchedFiles: step.touchedFiles, touchedCardIds: step.touchedCardIds });
	}
	const steps = next.steps.map((step): FocusChainStep => {
		const prior = priorByText.get(step.text);
		const isActive = step.status === "in_progress";
		const touchedFiles = normalizeTouchList(prior?.touchedFiles, isActive ? delta.files : undefined);
		const touchedCardIds = normalizeTouchList(prior?.touchedCardIds, isActive ? delta.cardIds : undefined);
		return {
			...step,
			...(touchedFiles.length > 0 ? { touchedFiles } : {}),
			...(touchedCardIds.length > 0 ? { touchedCardIds } : {}),
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

/** The verdict of the F1.5 destructive-re-emit guard: the chain to keep, and why a repair fired (null = accepted). */
export interface FocusChainRepairVerdict {
	chain: FocusChain;
	repaired: boolean;
	reason: string | null;
}

/**
 * F1.5 — guard a focus-chain re-emit against ACCIDENTAL WHOLESALE LOSS. Agents re-emit the whole checklist each
 * update; a weak model occasionally emits an empty list or a fresh all-pending list mid-run, silently destroying
 * recorded progress. Two narrow, deterministic repairs (legitimate re-plans are untouched — a rewrite that keeps
 * ANY progress marker or reuses ANY completed step's text is accepted):
 *   1. `next` has no steps while `previous` had some → keep `previous`.
 *   2. `previous` had completed work (done steps), and `next` is ENTIRELY pending AND contains none of the
 *      previously-completed texts → an accidental reset, keep `previous`.
 */
export function repairFocusChainRegression(
	previous: FocusChain | null | undefined,
	next: FocusChain,
): FocusChainRepairVerdict {
	const previousSteps = previous?.steps ?? [];
	if (previousSteps.length === 0) {
		return { chain: next, repaired: false, reason: null };
	}
	if (next.steps.length === 0) {
		return {
			chain: previous as FocusChain,
			repaired: true,
			reason: `An empty focus-chain re-emit would have destroyed ${previousSteps.length} recorded step(s); kept the prior chain.`,
		};
	}
	const previousDoneTexts = previousSteps.filter((step) => step.status === "done").map((step) => step.text);
	if (previousDoneTexts.length === 0) {
		return { chain: next, repaired: false, reason: null };
	}
	const nextAllPending = next.steps.every((step) => step.status === "pending");
	const nextTexts = new Set(next.steps.map((step) => step.text));
	const keepsAnyDone = previousDoneTexts.some((text) => nextTexts.has(text));
	if (nextAllPending && !keepsAnyDone) {
		return {
			chain: previous as FocusChain,
			repaired: true,
			reason: `An all-pending re-emit dropped every completed step (${previousDoneTexts.length} done); kept the prior chain — re-emit the FULL list including finished steps.`,
		};
	}
	return { chain: next, repaired: false, reason: null };
}

/**
 * F1.5 — the CANONICAL current step: the first `in_progress` step, else the first `pending` one, else null (empty
 * or fully done/skipped chain). Reviewer prompts and attempt-ledger events both derive "what step was being worked"
 * from this one helper so they can never disagree.
 */
export function currentFocusChainStep(chain: FocusChain | null | undefined): FocusChainStep | null {
	const steps = chain?.steps ?? [];
	return (
		steps.find((step) => step.status === "in_progress") ?? steps.find((step) => step.status === "pending") ?? null
	);
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
	const list = steps.map((step) => `${FOCUS_CHAIN_STATUS_MARK[step.status]} ${step.text}`).join("\n");
	// F1.5: name the canonical current step explicitly so every prompt consumer (reviewer, re-anchor) agrees with
	// the attempt ledger on what "the current step" is — never re-derived per surface.
	const current = currentFocusChainStep(chain);
	return current ? `${list}\nCurrent step: ${current.text}` : list;
}
