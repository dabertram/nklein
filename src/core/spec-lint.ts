/**
 * F12.9 pre-decompose spec linter — PURE core.
 *
 * Spec-first flows report ~an order of magnitude fewer regenerate-from-scratch cycles because gaps get caught BEFORE
 * code-gen. This linter runs over a task/project spec text before decomposition and surfaces the four cheap,
 * high-yield gap classes: no acceptance check, unmeasurable success criteria, undefined shorthand terms, and naive
 * must/must-not contradictions. Findings are CLARIFICATION PROMPTS (composes with the §5.S clarification cores), not
 * blockers — a linter that over-blocks gets turned off. Pure + deterministic over the text.
 */

export type SpecLintKind = "missing_acceptance" | "unmeasurable_criterion" | "undefined_term" | "contradiction";

export interface SpecLintFinding {
	readonly kind: SpecLintKind;
	readonly detail: string;
	/** A ready-to-ask clarifying question (one-at-a-time discipline is the caller's). */
	readonly question: string;
}

const ACCEPTANCE_HINT =
	/acceptance|verify|test(s| command| suite)?\s*(:|pass)|npm (test|run)|pytest|cargo test|go test|make (test|check)/i;
const VAGUE_QUALITY =
	/\b(fast|quick|performant|user-friendly|intuitive|robust|scalable|clean|nice|better|improved|efficient|seamless|modern)\b/gi;
const MEASURABLE_NEARBY = /\d|ms\b|second|minute|%|percent|threshold|budget|limit|under|below|above|at least|at most/i;

/** Naive contradiction pairs: a "must/should X" and a "must not/never X" over the same trailing object. */
function findContradictions(lines: readonly string[]): SpecLintFinding[] {
	const must = new Map<string, string>();
	const mustNot = new Map<string, string>();
	for (const line of lines) {
		const negative = line.match(/\b(?:must not|never|shall not|should not|don'?t)\s+([a-z][a-z\s-]{2,40})/i);
		if (negative?.[1]) {
			mustNot.set(normalizeAction(negative[1]), line.trim());
			continue;
		}
		const positive = line.match(/\b(?:must|shall|should|always)\s+([a-z][a-z\s-]{2,40})/i);
		if (positive?.[1]) {
			must.set(normalizeAction(positive[1]), line.trim());
		}
	}
	const findings: SpecLintFinding[] = [];
	for (const [action, positiveLine] of must) {
		const negativeLine = mustNot.get(action);
		if (negativeLine) {
			findings.push({
				kind: "contradiction",
				detail: `"${positiveLine}" vs "${negativeLine}"`,
				question: `The spec both requires and forbids "${action}" — which one holds, and under what condition?`,
			});
		}
	}
	return findings;
}

function normalizeAction(action: string): string {
	return action.trim().toLowerCase().replace(/\s+/g, " ").split(" ").slice(0, 4).join(" ");
}

/**
 * Lint a spec before decomposition. Zero findings = decompose-ready; each finding carries the clarifying question
 * to ask. Deterministic order: acceptance gap first (highest yield), then contradictions, then unmeasurables, then
 * undefined terms.
 */
export function lintSpecForDecompose(spec: string): SpecLintFinding[] {
	const findings: SpecLintFinding[] = [];
	const lines = spec.split("\n");

	if (!ACCEPTANCE_HINT.test(spec)) {
		findings.push({
			kind: "missing_acceptance",
			detail: "No acceptance command or verifiable check found in the spec.",
			question:
				"What command or observable check proves this is done (e.g. a test command, an exact expected output)?",
		});
	}

	findings.push(...findContradictions(lines));

	for (const line of lines) {
		const vagueMatches = line.match(VAGUE_QUALITY);
		if (vagueMatches && !MEASURABLE_NEARBY.test(line)) {
			findings.push({
				kind: "unmeasurable_criterion",
				detail: `"${line.trim()}" uses ${vagueMatches.map((word) => `"${word}"`).join(", ")} without a measurable bound.`,
				question: `"${vagueMatches[0]}" — what measurable threshold makes this pass or fail?`,
			});
		}
	}

	// Undefined shorthand: an ALL-CAPS acronym (3+ letters) used without any parenthesized or "X means/=" definition.
	const acronyms = new Set(spec.match(/\b[A-Z]{3,}\b/g) ?? []);
	for (const acronym of acronyms) {
		const defined = new RegExp(`${acronym}\\s*[(=]|\\(${acronym}\\)|${acronym}\\s+(means|is|stands for)`, "i").test(
			spec,
		);
		if (
			!defined &&
			!["THE", "AND", "NOT", "API", "CLI", "URL", "SQL", "TODO", "JSON", "HTML", "CSS"].includes(acronym)
		) {
			findings.push({
				kind: "undefined_term",
				detail: `"${acronym}" is used but never defined in the spec.`,
				question: `What does "${acronym}" refer to here?`,
			});
		}
	}

	return findings;
}
