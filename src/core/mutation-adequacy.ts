/**
 * F12.46 — test-adequacy (mutation) gate for agent-written tests (pure core).
 *
 * The reward is only as good as the verifier: line-coverage 80% with mutation-kill 58% is the signature of tests
 * written to satisfy a metric (the biggest reward-hacking loophole an autonomous worker has). When an attempt
 * authors or edits tests, generate LIGHTWEIGHT mutants of the CHANGED implementation lines, re-run the tests per
 * mutant (the effectful half — the sandbox acceptance machinery), and score adequacy = killed/total. A mutant the
 * suite fails to kill is a behavior change the tests cannot see.
 *
 * This module is the pure half: line-targeted mutant GENERATION (classic operator set — comparison flips,
 * boundary shifts, logical/arithmetic swaps, boolean/numeric literal tweaks — applied outside string literals and
 * comments), score computation, and the GATE decision with honest thin-sample handling (no mutants generated ⇒
 * pass-with-note, never a fake fail; the gate only bites when there was something real to measure).
 */

export interface LineMutant {
	/** 1-indexed line the mutant changes. */
	line: number;
	original: string;
	mutated: string;
	operator: string;
}

interface MutationOperator {
	name: string;
	pattern: RegExp;
	replace: (match: string) => string;
}

/** Ordered so longer tokens match before their prefixes (=== before ==, <= before <). */
const MUTATION_OPERATORS: readonly MutationOperator[] = [
	{ name: "eq_flip", pattern: /===/g, replace: () => "!==" },
	{ name: "neq_flip", pattern: /!==/g, replace: () => "===" },
	{ name: "lte_to_lt", pattern: /<=/g, replace: () => "<" },
	{ name: "gte_to_gt", pattern: />=/g, replace: () => ">" },
	{ name: "lt_to_lte", pattern: /<(?![=<])/g, replace: () => "<=" },
	{ name: "gt_to_gte", pattern: /(?<![=>-])>(?!=)/g, replace: () => ">=" },
	{ name: "and_to_or", pattern: /&&/g, replace: () => "||" },
	{ name: "or_to_and", pattern: /\|\|/g, replace: () => "&&" },
	{ name: "plus_to_minus", pattern: /(?<![+])\+(?![+=])/g, replace: () => "-" },
	{ name: "minus_to_plus", pattern: /(?<![-])-(?![-=>])/g, replace: () => "+" },
	{ name: "true_to_false", pattern: /\btrue\b/g, replace: () => "false" },
	{ name: "false_to_true", pattern: /\bfalse\b/g, replace: () => "true" },
	{ name: "off_by_one_up", pattern: /\b(\d+)\b/g, replace: (m) => String(Number(m) + 1) },
];

/** Mask string/template/comment CONTENT with spaces (same length) so operators never fire inside literals. */
function maskNonCode(line: string): string {
	let out = "";
	let state: "code" | "single" | "double" | "template" | "line_comment" = "code";
	for (let i = 0; i < line.length; i += 1) {
		const ch = line[i];
		const prev = i > 0 ? line[i - 1] : "";
		if (state === "code") {
			if (ch === "'") {
				state = "single";
				out += ch;
			} else if (ch === '"') {
				state = "double";
				out += ch;
			} else if (ch === "`") {
				state = "template";
				out += ch;
			} else if (ch === "/" && line[i + 1] === "/") {
				state = "line_comment";
				out += " ";
			} else {
				out += ch;
			}
			continue;
		}
		if (state === "line_comment") {
			out += " ";
			continue;
		}
		const closes =
			(state === "single" && ch === "'" && prev !== "\\") ||
			(state === "double" && ch === '"' && prev !== "\\") ||
			(state === "template" && ch === "`" && prev !== "\\");
		if (closes) {
			state = "code";
			out += ch;
		} else {
			out += " ";
		}
	}
	return out;
}

/**
 * Generate one mutant per (changed line × applicable operator × occurrence-site 0) — first occurrence only per
 * operator per line, which keeps the mutant count bounded (≤ operators × lines) while still probing every changed
 * line. Lines that are blank, comment-only, or import/export-only produce nothing. Pure + deterministic.
 */
export function generateLineMutants(source: string, changedLines: readonly number[]): LineMutant[] {
	const lines = source.split("\n");
	const wanted = new Set(changedLines);
	const mutants: LineMutant[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const lineNo = index + 1;
		if (!wanted.has(lineNo)) {
			continue;
		}
		const original = lines[index];
		const trimmed = original.trim();
		if (
			trimmed.length === 0 ||
			trimmed.startsWith("//") ||
			trimmed.startsWith("*") ||
			/^(import|export)\b/.test(trimmed)
		) {
			continue;
		}
		const masked = maskNonCode(original);
		for (const operator of MUTATION_OPERATORS) {
			operator.pattern.lastIndex = 0;
			const match = operator.pattern.exec(masked);
			if (!match) {
				continue;
			}
			const at = match.index;
			const replacement = operator.replace(match[0]);
			const mutated = original.slice(0, at) + replacement + original.slice(at + match[0].length);
			if (mutated !== original) {
				mutants.push({ line: lineNo, original, mutated, operator: operator.name });
			}
		}
	}
	return mutants;
}

export interface MutationAdequacy {
	totalMutants: number;
	killedMutants: number;
	/** killed/total in [0,1]; null when no mutants ran (nothing measurable). */
	score: number | null;
}

export function computeMutationScore(killed: number, total: number): MutationAdequacy {
	const boundedTotal = Math.max(0, Math.trunc(total));
	const boundedKilled = Math.min(boundedTotal, Math.max(0, Math.trunc(killed)));
	return {
		totalMutants: boundedTotal,
		killedMutants: boundedKilled,
		score: boundedTotal === 0 ? null : boundedKilled / boundedTotal,
	};
}

export interface MutationGateDecision {
	verdict: "adequate" | "inadequate" | "unmeasured";
	reason: string;
}

/**
 * Gate on adequacy, not just "tests pass": below-threshold kill rate on a real sample ⇒ inadequate (the tests
 * cannot see behavior changes in the very lines the attempt touched). No mutants or a sample below minMutants ⇒
 * UNMEASURED (pass-with-note — a thin sample must never fake a fail OR launder itself as proof of adequacy).
 */
export function decideMutationAdequacy(
	adequacy: MutationAdequacy,
	options?: { threshold?: number; minMutants?: number },
): MutationGateDecision {
	const threshold = options?.threshold ?? 0.6;
	const minMutants = options?.minMutants ?? 3;
	if (adequacy.score === null || adequacy.totalMutants < minMutants) {
		return {
			verdict: "unmeasured",
			reason: `only ${adequacy.totalMutants} mutant(s) ran (< ${minMutants}) — adequacy unmeasured, not gated`,
		};
	}
	if (adequacy.score >= threshold) {
		return {
			verdict: "adequate",
			reason: `mutation score ${(adequacy.score * 100).toFixed(0)}% (${adequacy.killedMutants}/${adequacy.totalMutants}) ≥ ${(threshold * 100).toFixed(0)}%`,
		};
	}
	return {
		verdict: "inadequate",
		reason: `mutation score ${(adequacy.score * 100).toFixed(0)}% (${adequacy.killedMutants}/${adequacy.totalMutants}) < ${(threshold * 100).toFixed(0)}% — the tests cannot see behavior changes in the changed lines`,
	};
}
