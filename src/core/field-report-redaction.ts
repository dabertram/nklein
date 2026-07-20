/**
 * P16.4 — the Field Report REDACTION engine. PURE core.
 *
 * ⚠️ NOT `redactArgsSummary` in {@link ./outward-action-queue.ts}, which SUMMARIZES tool args for display
 * (truncation, scalar previews). This removes IDENTIFYING CONTENT from text that is about to leave the user's
 * machine. Different job, different failure cost — a summarizer that over-truncates is annoying; a redactor that
 * misses is a disclosure.
 *
 * ── STABLE PLACEHOLDERS, NOT DELETION ──
 * A redactor that deletes destroys the pattern the report exists to convey: "the agent kept re-reading the same
 * file" is only legible if that file is consistently `<PATH_1>`. So each distinct secret maps to a stable
 * placeholder for the life of one report — the SHAPE survives, the content does not.
 *
 * ── WHY THE ACCEPTANCE IS ADVERSARIAL ──
 * Redaction unit-tested on its own happy path is not redaction. Its whole job is to survive inputs its author did
 * not imagine, so the acceptance seeds project names, absolute paths, key-shaped strings, author names and
 * private URLs into realistic fixtures and asserts NONE survive. Anything else tests that the regexes match the
 * examples the regexes were written from.
 *
 * Honesty stance: this returns what it FOUND as well as what it produced. A caller must be able to show the user
 * "these 7 things were redacted", because a user who cannot see what was removed cannot judge whether removal
 * was sufficient — and "trust me, it's clean" is exactly the promise this feature refuses to make.
 */

export type RedactionKind = "abs_path" | "home_path" | "url" | "secret" | "email" | "custom";

export interface RedactionHit {
	readonly kind: RedactionKind;
	readonly placeholder: string;
	/** How many times this value appeared. Surfaced so a user sees WHAT was removed, not just that something was. */
	readonly occurrences: number;
}

export interface RedactionResult {
	readonly text: string;
	readonly hits: readonly RedactionHit[];
	readonly summary: string;
}

export interface RedactionOptions {
	/** Extra literals to remove (project name, author name, machine name) — the caller knows these; the regexes cannot. */
	readonly customTerms?: readonly string[];
}

/** Ordered: longer/more-specific patterns first, so a URL is not half-eaten by the path rule. */
const PATTERNS: readonly { kind: RedactionKind; pattern: RegExp }[] = [
	// Key-shaped strings before anything else — a leaked credential is the worst outcome here.
	{ kind: "secret", pattern: /\b(?:sk|pk|ghp|gho|ghu|ghs|ghr|xoxb|xoxp|AKIA)[-_A-Za-z0-9]{10,}\b/g },
	{ kind: "secret", pattern: /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
	{ kind: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
	{ kind: "url", pattern: /\bhttps?:\/\/[^\s"'<>)]+/g },
	{ kind: "home_path", pattern: /(?:\/Users\/|\/home\/|C:\\\\Users\\\\)[^\s"':,)]+/g },
	{ kind: "abs_path", pattern: /(?<![\w/])\/(?:[\w.-]+\/){2,}[\w.-]+/g },
];

/**
 * Placeholder LABEL for a kind. Several kinds deliberately share a label (`abs_path` and `home_path` are both
 * `PATH`) because the distinction is noise to a reader — but that makes the label, NOT the kind, the correct
 * counter key. Keying by kind produced a COLLISION found by the adversarial test: a home path and an absolute
 * path both became `<PATH_1>`, so two DIFFERENT files read as the same one and a report would have described a
 * pattern that never happened.
 */
function labelFor(kind: RedactionKind): string {
	return kind === "abs_path" || kind === "home_path"
		? "PATH"
		: kind === "url"
			? "URL"
			: kind === "email"
				? "EMAIL"
				: kind === "secret"
					? "SECRET"
					: "TERM";
}

/**
 * Redact identifying content, replacing each distinct value with a STABLE placeholder.
 *
 * Custom terms are applied FIRST and matched case-insensitively: a project or author name is the thing a regex
 * can never infer, and it is also the thing most likely to appear in prose where no pattern would fire.
 */
export function redactForFieldReport(input: string, options: RedactionOptions = {}): RedactionResult {
	let text = input;
	const assigned = new Map<string, { placeholder: string; kind: RedactionKind; occurrences: number }>();
	// Keyed by LABEL, not kind — see labelFor: kinds that share a label must share a counter or their
	// placeholders collide.
	const counters = new Map<string, number>();

	const assign = (value: string, kind: RedactionKind): string => {
		const existing = assigned.get(value);
		if (existing) {
			existing.occurrences += 1;
			return existing.placeholder;
		}
		const label = labelFor(kind);
		const next = (counters.get(label) ?? 0) + 1;
		counters.set(label, next);
		const placeholder = `<${label}_${next}>`;
		assigned.set(value, { placeholder, kind, occurrences: 1 });
		return placeholder;
	};

	for (const term of options.customTerms ?? []) {
		const trimmed = term.trim();
		if (trimmed.length < 3) {
			// A 1-2 char "term" would shred unrelated text; refusing is safer than a mangled report.
			continue;
		}
		const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		text = text.replace(new RegExp(escaped, "gi"), () => assign(trimmed.toLowerCase(), "custom"));
	}

	for (const { kind, pattern } of PATTERNS) {
		text = text.replace(pattern, (match) => assign(match, kind));
	}

	const hits = [...assigned.values()]
		.map((entry) => ({ kind: entry.kind, placeholder: entry.placeholder, occurrences: entry.occurrences }))
		.sort((left, right) => left.placeholder.localeCompare(right.placeholder));

	const summary =
		hits.length === 0
			? "Nothing matched a redaction rule. That is NOT proof the text is clean — pass project/author/machine names as customTerms, since no pattern can infer them."
			: `${hits.length} distinct value(s) redacted across ${hits.reduce((sum, hit) => sum + hit.occurrences, 0)} occurrence(s). Each maps to a STABLE placeholder, so repeated references stay legible as a pattern.`;

	return { text, hits, summary };
}
