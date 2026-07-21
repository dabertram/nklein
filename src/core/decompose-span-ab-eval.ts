import { lexicalScore } from "../nklein-agent/nklein-lexical-score";
import { decideDefaultFlip, wilsonInterval } from "./ab-significance-gate";

/** One code span available to the F11.2d pushed-span/pull-on-demand comparison. */
export interface DecomposeSpanCandidate {
	readonly path: string;
	readonly symbol: string;
	readonly snippet: string;
}

export interface DecomposeSpanTarget {
	readonly path: string;
	readonly symbol: string;
}

export type DecomposeLocalizationResponse =
	| { readonly kind: "final"; readonly path: string; readonly symbol: string }
	| { readonly kind: "pull"; readonly symbol: string };

export interface DecomposeSpanPairedResult {
	readonly model: string;
	readonly taskId: string;
	readonly pullPassed: boolean;
	readonly pushPassed: boolean;
}

function normalizePath(path: string): string {
	return path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

function candidateText(candidate: DecomposeSpanCandidate): string {
	return `${candidate.path}\n${candidate.symbol}\n${candidate.snippet}`;
}

/**
 * The candidate arm must not receive an oracle span. It receives the top-1 result from the same deliberately simple
 * lexical policy production can run without another model call. Stable tie-breaking keeps reruns comparable.
 */
export function selectPushedSpan(
	task: string,
	candidates: readonly DecomposeSpanCandidate[],
): DecomposeSpanCandidate | null {
	return (
		[...candidates]
			.map((candidate) => ({ candidate, score: lexicalScore(candidateText(candidate), task) }))
			.sort(
				(left, right) =>
					right.score - left.score ||
					left.candidate.path.localeCompare(right.candidate.path) ||
					left.candidate.symbol.localeCompare(right.candidate.symbol),
			)[0]?.candidate ?? null
	);
}

function parseFlatObject(text: string): Record<string, unknown> | null {
	const withoutThink = text.replace(/<think>[\s\S]*?<\/think>/gi, " ").trim();
	const attempts = [withoutThink, ...Array.from(withoutThink.matchAll(/\{[^{}]*\}/g), (match) => match[0])];
	for (const attempt of attempts) {
		try {
			const parsed = JSON.parse(attempt) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			// Models sometimes wrap the flat JSON object in prose or a Markdown fence; try the next extracted object.
		}
	}
	return null;
}

/** Parse the intentionally flat response protocol used by the live paired harness. */
export function parseDecomposeLocalizationResponse(text: string): DecomposeLocalizationResponse | null {
	const parsed = parseFlatObject(text);
	if (!parsed) {
		return null;
	}
	if (parsed.action === "pull" && typeof parsed.symbol === "string") {
		return { kind: "pull", symbol: parsed.symbol.trim() };
	}
	if (parsed.action === "final" && typeof parsed.path === "string" && typeof parsed.symbol === "string") {
		return { kind: "final", path: normalizePath(parsed.path), symbol: parsed.symbol.trim() };
	}
	if (typeof parsed.path === "string" && typeof parsed.symbol === "string") {
		return { kind: "final", path: normalizePath(parsed.path), symbol: parsed.symbol.trim() };
	}
	if (typeof parsed.pullSymbol === "string") {
		return { kind: "pull", symbol: parsed.pullSymbol.trim() };
	}
	return null;
}

export function localizationMatchesTarget(
	response: DecomposeLocalizationResponse | null,
	target: DecomposeSpanTarget,
): boolean {
	return (
		response?.kind === "final" &&
		normalizePath(response.path) === normalizePath(target.path) &&
		response.symbol === target.symbol
	);
}

export function summarizeDecomposeSpanAb(
	results: readonly DecomposeSpanPairedResult[],
	options: { readonly alpha?: number; readonly minEffect?: number } = {},
) {
	const pairs = results.map((result) => ({ a: result.pullPassed, b: result.pushPassed }));
	const pullSuccesses = results.filter((result) => result.pullPassed).length;
	const pushSuccesses = results.filter((result) => result.pushPassed).length;
	return {
		pairCount: results.length,
		pullInterval: wilsonInterval(pullSuccesses, results.length),
		pushInterval: wilsonInterval(pushSuccesses, results.length),
		decision: decideDefaultFlip({
			pairs,
			alpha: options.alpha,
			minEffect: options.minEffect ?? 0.05,
		}),
	};
}
