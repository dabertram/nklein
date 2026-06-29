/**
 * Task-complexity classifier (todo §5.AQ item B) — the signal that drives AUTO sysprompt-level selection
 * (`selectSysPromptLevel`) and, later, model routing (RouteLLM-style: cheap classifier → match the resource to the
 * task). Pure heuristic over cheap signals — no model call — so a trivial task gets a lean prompt + small model and a
 * novel/ambiguous one earns the deeper treatment.
 *
 * Bands (highest wins): `novel` (ambiguous spec or repeated failure or a design/research framing) → `complex`
 * (multi-file / many tools / a prior failed attempt / multi-step framing) → `trivial` (a short lookup/format ask with
 * no tools) → `standard` (everything else). Deliberately INCLUSIVE toward HIGHER complexity on weak signals: under-
 * powering a hard task costs more than a few extra tokens on an easy one.
 */

import type { TaskComplexity } from "./sysprompt-level";

export interface TaskComplexitySignals {
	/** The task / instruction text. */
	taskText?: string | null;
	/** How many distinct tools the task is expected to need. */
	estimatedToolCount?: number;
	/** Whether the task spans multiple files / components. */
	multiFile?: boolean;
	/** Prior failed attempts on this task (drives escalation — repeated failure ⇒ the deepest treatment). */
	priorFailedAttempts?: number;
	/** The spec is unclear / under-specified. */
	ambiguous?: boolean;
}

const NOVEL_MARKERS =
	/\b(?:design|architect|research|investigate|figure out|from scratch|novel|open[ -]ended|brainstorm|strategy)\b/i;
const COMPLEX_MARKERS =
	/\b(?:refactor|migrate|integrate|multi[- ]step|across|end[- ]to[- ]end|pipeline|orchestrate|debug|root[- ]cause)\b/i;
const TRIVIAL_MARKERS =
	/\b(?:rename|format|typo|lint|what is|look ?up|print|echo|list|show|spelling|comment|rephrase)\b/i;

/** Classify a task's complexity from cheap signals (no model call). */
export function classifyTaskComplexity(signals: TaskComplexitySignals): TaskComplexity {
	const text = signals.taskText?.trim() ?? "";
	const tools = Math.max(0, signals.estimatedToolCount ?? 0);
	const failures = Math.max(0, signals.priorFailedAttempts ?? 0);

	if (signals.ambiguous === true || failures >= 2 || NOVEL_MARKERS.test(text)) {
		return "novel";
	}
	if (signals.multiFile === true || tools >= 3 || failures >= 1 || COMPLEX_MARKERS.test(text)) {
		return "complex";
	}
	// Trivial only when it's a short, tool-free lookup/format ask.
	if (tools === 0 && text.length > 0 && text.length <= 80 && TRIVIAL_MARKERS.test(text)) {
		return "trivial";
	}
	return "standard";
}
