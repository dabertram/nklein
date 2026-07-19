/**
 * F12.81 ledger-sourced dynamic few-shot injection — PURE core.
 *
 * The single biggest measured lever for small-model tool use is a few CONCRETE examples of the tool-calling shape
 * you want (Haiku 11%→75% with three), and two details matter: examples must be real MESSAGE turns rather than a
 * string blob, and they must be selected PER CARD rather than fixed. This is DSPy's BootstrapFewShot idea over
 * !Klein's own passing traces: retrieve the most similar SUCCESSFUL past attempts and replay them as ChatML.
 *
 * Distinct from F11.2h, which retrieves in-repo code exemplars — this retrieves *behavioural* exemplars (how a
 * past card was actually driven to success).
 *
 * Scope note: the attempt ledger stores no card TEXT, so the caller joins ledger attempts to their board titles
 * and passes candidates in. Selection, similarity and formatting live here; the join stays with the caller.
 *
 * Honesty stance: only SUCCESSFUL attempts are ever offered as exemplars, an attempt with no tool calls teaches
 * nothing about tool use and is skipped, and a card with no similar history yields NO messages — an irrelevant
 * example is worse than none, because a small model will imitate it.
 */

export interface ExemplarCandidate {
	readonly attemptId: string;
	/** The card text this attempt worked on (title/objective), supplied by the caller's join. */
	readonly text: string;
	readonly role: string | null;
	readonly succeeded: boolean;
	/** Tool names in call order — the behaviour being demonstrated. */
	readonly toolNames: readonly string[];
}

export interface SelectedExemplar {
	readonly attemptId: string;
	readonly text: string;
	readonly toolNames: readonly string[];
	/** 0..1 token-overlap similarity against the target card. */
	readonly similarity: number;
}

const STOP_WORDS = new Set([
	"the",
	"a",
	"an",
	"and",
	"or",
	"to",
	"of",
	"in",
	"for",
	"on",
	"with",
	"this",
	"that",
	"it",
	"is",
	"are",
	"be",
	"add",
	"fix",
	"use",
]);

/** Content tokens of a card text: lowercased words ≥3 chars, stop-words dropped. */
function tokenize(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
	);
}

/** Jaccard overlap of content tokens — deterministic and dependency-free (no embed path required). */
export function textSimilarity(left: string, right: string): number {
	const a = tokenize(left);
	const b = tokenize(right);
	if (a.size === 0 || b.size === 0) {
		return 0;
	}
	let shared = 0;
	for (const token of a) {
		if (b.has(token)) {
			shared += 1;
		}
	}
	const union = a.size + b.size - shared;
	return union === 0 ? 0 : shared / union;
}

export interface SelectExemplarsInput {
	readonly targetText: string;
	/** The executing role — exemplars only transfer within a role (a reviewer trace misleads a worker). */
	readonly targetRole: string | null;
	readonly candidates: readonly ExemplarCandidate[];
	/** How many exemplars to keep (default 3 — the measured sweet spot; more crowds a small context). */
	readonly limit?: number;
	/** Minimum similarity to qualify (default 0.15) — below this an "example" is just noise. */
	readonly minSimilarity?: number;
}

/**
 * Select the most similar successful exemplars for a card. Filters to the SAME role, successful outcomes and
 * non-empty tool sequences; ranks by similarity; drops anything below the floor. Ties break on attemptId so the
 * selection is deterministic (replayable prompts — §5.AQ).
 */
export function selectLedgerExemplars(input: SelectExemplarsInput): SelectedExemplar[] {
	const limit = Math.max(1, input.limit ?? 3);
	const minSimilarity = input.minSimilarity ?? 0.15;
	return input.candidates
		.filter(
			(candidate) =>
				candidate.succeeded &&
				candidate.toolNames.length > 0 &&
				(input.targetRole === null || candidate.role === input.targetRole),
		)
		.map((candidate) => ({
			attemptId: candidate.attemptId,
			text: candidate.text,
			toolNames: candidate.toolNames,
			similarity: textSimilarity(input.targetText, candidate.text),
		}))
		.filter((exemplar) => exemplar.similarity >= minSimilarity)
		.sort((left, right) =>
			right.similarity === left.similarity
				? left.attemptId.localeCompare(right.attemptId)
				: right.similarity - left.similarity,
		)
		.slice(0, limit);
}

export interface ExemplarMessage {
	readonly role: "user" | "assistant";
	readonly content: string;
}

/**
 * Render the exemplars as real MESSAGE turns (the format finding: messages ≫ concatenated strings). Each becomes
 * a user turn stating the past card and an assistant turn naming the tool sequence that succeeded — the SHAPE to
 * imitate, not an answer to copy. Empty selection ⇒ [] so the prompt is byte-identical when nothing qualifies.
 */
export function renderExemplarMessages(exemplars: readonly SelectedExemplar[]): ExemplarMessage[] {
	if (exemplars.length === 0) {
		return [];
	}
	const messages: ExemplarMessage[] = [];
	for (const exemplar of exemplars) {
		messages.push({
			role: "user",
			content: `Earlier card that was completed successfully: ${exemplar.text}`,
		});
		messages.push({
			role: "assistant",
			content: `I completed it with this tool sequence: ${exemplar.toolNames.join(" → ")}.`,
		});
	}
	messages.push({
		role: "user",
		content:
			"Those are examples of the WORKING SHAPE on this board — the tools and their order, not the answer. Now do the current card.",
	});
	return messages;
}
