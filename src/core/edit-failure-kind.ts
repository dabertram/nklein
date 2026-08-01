/**
 * WHICH KIND of edit failure was that? PURE core — P21.1 step 2.
 *
 * ── WHY THE COARSE RATE IS NOT ENOUGH ──
 * `edit-reliability.ts` (step 1) computes an error fraction per model from the ledger's `is_error` flag. That
 * measures "this model struggles to edit". Aider's published result is about something narrower and far more
 * actionable: **Qwen2.5-Coder-32B scores 16.4% with `whole` format against 8.0% with `diff` — a 2× swing from edit
 * FORMAT alone**, on exactly this project's target model class. Routing a weak model to whole-file edits needs the
 * format signal specifically, and `is_error` cannot supply it: it lumps a model that could not reproduce a search
 * block together with one blocked by the secret scanner.
 *
 * ── ONLY ONE OF THE SEVEN BLOCK SITES IS A FORMAT FAILURE ──
 * `nklein-edit-file-tool` refuses an edit in seven places. Six are GUARDS or environment — path containment,
 * realpath escape, unreadable file, size backstop, secret detection, post-edit syntax breakage — and say nothing
 * about the model's edit-format skill; a secret-scanner block is arguably the model doing its job on the edit and
 * failing policy. Exactly one, *"edit block N did not match"*, means the model failed to reproduce context
 * verbatim, which IS the diff-vs-whole-file skill. Counting all seven as "edit errors" is the granularity problem
 * P21.1 names, and it biases the metric by whichever guard happens to fire most.
 *
 * ── WHY MESSAGE TEXT, AND WHY THAT IS SAFE HERE ──
 * The SDK tool-result boundary carries `is_error` plus a content string; there is no typed error channel to widen
 * without changing that contract. But these strings are OUR OWN, thrown from ONE file behind a stable
 * `Blocked edit_file: ` prefix — not third-party output being screen-scraped. The risk is drift, and a ratchet test
 * covers it: it reads the tool's source, finds every block site, and fails if any classifies as `unknown`. A new
 * guard therefore breaks the test rather than silently landing in whichever bucket happens to match.
 *
 * `unknown` is never folded into a real kind. An unrecognised failure counted as `context_mismatch` would inflate
 * precisely the number this exists to measure.
 */

export type EditFailureKind =
	/**
	 * The model's search block did not match the file. THE edit-format signal: the model failed to reproduce
	 * existing content verbatim, which is what whole-file editing removes the need for.
	 */
	| "context_mismatch"
	/** The target file could not be read — environment, not edit skill. */
	| "file_unreadable"
	/** Path containment or realpath escape — a security guard. */
	| "path_guard"
	/** A secret was detected in the edited content. */
	| "secret_guard"
	/** The edit would exceed a size backstop. */
	| "size_guard"
	/** The edit would leave the file syntactically broken (F12.63). */
	| "syntax_guard"
	/** Recognised as an edit failure, but not as any known kind. NEVER counted as a format failure. */
	| "unknown";

/** Kinds that reflect the MODEL's edit-format skill. Only one qualifies, and that is the point. */
const FORMAT_SKILL_KINDS: ReadonlySet<EditFailureKind> = new Set<EditFailureKind>(["context_mismatch"]);

export function isEditFormatSkillFailure(kind: EditFailureKind): boolean {
	return FORMAT_SKILL_KINDS.has(kind);
}

/**
 * Ordered most-specific first. `syntax_guard` precedes `size_guard` because both begin "the edit would", and
 * `path_guard` precedes `file_unreadable` because an escaping path is a guard rather than a missing file.
 */
const PATTERNS: readonly { readonly kind: EditFailureKind; readonly test: RegExp }[] = [
	{ kind: "context_mismatch", test: /edit block\s+\d+\s+did not match/iu },
	{ kind: "syntax_guard", test: /the edit would break/iu },
	{ kind: "size_guard", test: /would grow .* exceeding|exceeding the .*-line|byte ceiling/iu },
	{ kind: "secret_guard", test: /potential .* detected/iu },
	{ kind: "path_guard", test: /escapes the workspace|outside the workspace|non-empty path within the workspace/iu },
	{ kind: "file_unreadable", test: /could not be read/iu },
];

/**
 * Classify one refusal message.
 *
 * Accepts the message with or without the `Blocked edit_file: ` prefix, because the ledger stores the tool result's
 * content and callers should not have to know whether the prefix survived the round trip.
 */
export function classifyEditFailure(message: string | null | undefined): EditFailureKind {
	if (typeof message !== "string" || message.trim().length === 0) {
		return "unknown";
	}
	return PATTERNS.find((pattern) => pattern.test.test(message))?.kind ?? "unknown";
}

export interface EditFailureBreakdown {
	readonly byKind: Readonly<Record<EditFailureKind, number>>;
	readonly total: number;
	/** Failures attributable to edit-FORMAT skill — the numerator P21.1 actually wants. */
	readonly formatSkillFailures: number;
	readonly summary: string;
}

/** Tally classified failures, keeping `unknown` visible rather than absorbing it into the nearest kind. */
export function summarizeEditFailures(messages: readonly (string | null | undefined)[]): EditFailureBreakdown {
	const byKind: Record<EditFailureKind, number> = {
		context_mismatch: 0,
		file_unreadable: 0,
		path_guard: 0,
		secret_guard: 0,
		size_guard: 0,
		syntax_guard: 0,
		unknown: 0,
	};
	for (const message of messages) {
		byKind[classifyEditFailure(message)] += 1;
	}
	const formatSkillFailures = byKind.context_mismatch;
	return {
		byKind,
		total: messages.length,
		formatSkillFailures,
		summary:
			messages.length === 0
				? "no edit failures observed — this says nothing about a model's edit-format skill"
				: `${messages.length} edit failure(s): ${formatSkillFailures} attributable to edit FORMAT (context mismatch); ` +
					`the rest are guards or environment and must not be read as format failures` +
					(byKind.unknown > 0 ? ` — ${byKind.unknown} UNCLASSIFIED (the ratchet should have caught this)` : ""),
	};
}
