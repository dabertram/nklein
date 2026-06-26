/**
 * Pure prompt-parsing helpers for NKlein task sessions (extracted from `nklein-task-session-service` per the §5.U
 * "decompose the oversized service" finding). These classify/extract from a task's kickoff prompt — no session
 * state, SDK, or I/O — so they're trivially testable and keep the session service focused on lifecycle and
 * orchestration. No behaviour change from the in-file versions.
 */

const WORD_NUMBER_BY_TEXT: Record<string, number> = {
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
	eleven: 11,
	twelve: 12,
};

/** Smallest task count the prompt explicitly asks the decomposition for ("at least 8", "minimum task count: 12"). */
export function parseRequestedMinimumTaskCount(prompt: string): number | null {
	const numericMatch =
		/\bat least\s+(\d{1,3})\b/i.exec(prompt) ??
		/\bminimum(?:TaskCount|\s+task\s+count|\s+count)\s*:?\s*(\d{1,3})\b/i.exec(prompt);
	if (numericMatch?.[1]) {
		return Number.parseInt(numericMatch[1], 10);
	}
	const wordPattern = Object.keys(WORD_NUMBER_BY_TEXT).join("|");
	const wordMatch = new RegExp(`\\bat least\\s+(${wordPattern})\\b`, "i").exec(prompt);
	if (!wordMatch?.[1]) {
		return null;
	}
	return WORD_NUMBER_BY_TEXT[wordMatch[1].toLowerCase()] ?? null;
}

/** The acceptance command a card declares via an `Acceptance command:` line, if any. */
export function parseAcceptanceCommand(prompt: string): string | null {
	const match = /^Acceptance command:\s*(.+)$/im.exec(prompt);
	const command = match?.[1]?.trim();
	return command && command.length > 0 ? command : null;
}

/** Broad heuristic: does the prompt describe decomposition/planning work (a DAG of implementation cards)? */
export function isDecompositionPlanningPrompt(prompt: string): boolean {
	return (
		/\bdecompose_project\b/.test(prompt) ||
		/\bminimumTaskCount\b/.test(prompt) ||
		/\bdecompos(?:e|ed|es|ing|ition)\b/i.test(prompt) ||
		/\btask\s+graph\b/i.test(prompt) ||
		/\bimplementation[- ]card\s+graph\b/i.test(prompt) ||
		/\bimplementation[- ]card breakdown\b/i.test(prompt) ||
		/\bdependent implementation cards?\b/i.test(prompt) ||
		/\bat least\s+(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:dependent\s+)?(?:implementation\s+)?cards?\b/i.test(
			prompt,
		)
	);
}

/** Narrow heuristic: does the prompt explicitly invoke the decompose tool / minimum-task-count contract? */
export function isExplicitDecompositionPrompt(prompt: string): boolean {
	return /\bdecompose_project\b/.test(prompt) || /\bminimumTaskCount\b/.test(prompt);
}
