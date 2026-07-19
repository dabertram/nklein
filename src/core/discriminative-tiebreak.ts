/**
 * F12.95 agentic discriminative-test tie-breaker — PURE core.
 *
 * The hard best-of-N case F12.94 leaves open: every candidate PASSES the given tests, yet they disagree about
 * behaviour, so the supplied tests cannot separate them. Rather than picking by vibe (or by an LLM judge reading
 * diffs), ask a local model to synthesize inputs that EXPOSE the disagreement, run them against every candidate,
 * and vote by agreement — sometimes beating ground-truth tests (+10–15% Best@k, Scaling Agentic Verifier).
 *
 * This core owns the decision, the prompt, the parsing, and the vote. Executing the synthesized inputs is the
 * caller's sandbox work.
 *
 * Honesty stance: a tie-break only happens when there is genuine disagreement to resolve, and an inconclusive
 * vote says so instead of inventing a winner — an arbitrary pick dressed up as a verdict is worse than an
 * honest "these are indistinguishable, escalate".
 */

export interface CandidateOutputs {
	readonly candidateId: string;
	/** Output signature per probe input, index-aligned with the probes that produced them. */
	readonly outputs: readonly string[];
}

export interface TiebreakNeed {
	readonly needed: boolean;
	readonly reason: string;
}

/**
 * Decide whether a discriminative tie-break is warranted: ≥2 candidates that all passed, whose EXISTING output
 * signatures are identical (the supplied tests cannot tell them apart) — that is precisely when new inputs are
 * worth synthesizing. Differing signatures need no tie-break: F12.94's clustering already separates those.
 */
export function needsDiscriminativeTiebreak(input: {
	readonly passingCandidateIds: readonly string[];
	readonly existingSignatures: readonly string[];
}): TiebreakNeed {
	if (input.passingCandidateIds.length < 2) {
		return { needed: false, reason: "fewer than 2 passing candidates — nothing to separate" };
	}
	const distinct = new Set(input.existingSignatures);
	if (distinct.size > 1) {
		return {
			needed: false,
			reason: "candidates already differ on the existing tests — cluster/arbitrate rather than synthesize inputs",
		};
	}
	return {
		needed: true,
		reason: `${input.passingCandidateIds.length} candidates all pass and look identical on the given tests — synthesize inputs that expose the difference`,
	};
}

export interface DiscriminativePromptInput {
	readonly taskObjective: string;
	/** Compact per-candidate descriptions (diff summaries), already bounded by the caller. */
	readonly candidateSummaries: readonly { readonly candidateId: string; readonly summary: string }[];
	/** How many probe inputs to request (kept small — each one costs a sandbox run per candidate). */
	readonly probeCount?: number;
}

const DEFAULT_PROBE_COUNT = 3;

/**
 * Build the probe-synthesis prompt. It asks ONLY for inputs — never for a verdict on which candidate is right,
 * because the whole point is to let EXECUTION decide rather than the model's opinion of the diffs.
 */
export function buildDiscriminativeProbePrompt(input: DiscriminativePromptInput): string {
	const probeCount = Math.max(1, input.probeCount ?? DEFAULT_PROBE_COUNT);
	return [
		"Two or more implementations all pass the existing tests but may behave differently. Your job is to find inputs that would REVEAL a difference.",
		"",
		"## The objective both implementations claim to satisfy",
		input.taskObjective.trim() || "(no objective recorded)",
		"",
		"## The candidate implementations",
		...input.candidateSummaries.map((candidate) => `### ${candidate.candidateId}\n${candidate.summary.trim()}`),
		"",
		"## What to produce",
		`Propose exactly ${probeCount} concrete INPUTS most likely to make these implementations disagree — edge cases, boundaries, empty/'0'/negative values, unusual ordering, or error paths.`,
		"Output one input per line as `PROBE: <the exact input>`. Nothing else.",
		"Do NOT say which implementation is correct and do NOT predict outputs — the sandbox will run these and the results decide.",
	].join("\n");
}

const PROBE_LINE = /^\s*(?:[-*]\s*)?PROBE\s*:\s*(.+?)\s*$/i;

/** Parse the synthesized probes, de-duplicated and capped. An unparseable reply yields [] (no probes, no guess). */
export function parseDiscriminativeProbes(text: string, maxProbes = DEFAULT_PROBE_COUNT): string[] {
	const probes: string[] = [];
	const seen = new Set<string>();
	for (const line of text.split("\n")) {
		const match = PROBE_LINE.exec(line);
		const probe = match?.[1];
		if (!probe || seen.has(probe)) {
			continue;
		}
		seen.add(probe);
		probes.push(probe);
		if (probes.length >= Math.max(1, maxProbes)) {
			break;
		}
	}
	return probes;
}

export interface TiebreakVerdict {
	/** The winning candidate id, or null when the probes could not separate them. */
	readonly winnerId: string | null;
	/** Candidate ids sharing the winning behaviour (the majority cluster). */
	readonly agreeingIds: readonly string[];
	readonly conclusive: boolean;
	readonly reason: string;
}

/**
 * Vote by agreement over the probe outputs: group candidates by their full output signature and take the
 * largest group, whose lowest-id member is the representative winner. A tie between equally-sized groups, or a
 * run where every candidate still looks identical, is reported as INCONCLUSIVE — the caller escalates rather
 * than pretending the probes decided something.
 */
export function voteDiscriminativeTiebreak(results: readonly CandidateOutputs[]): TiebreakVerdict {
	if (results.length === 0) {
		return { winnerId: null, agreeingIds: [], conclusive: false, reason: "no candidate results to compare" };
	}
	const bySignature = new Map<string, string[]>();
	for (const result of results) {
		const signature = JSON.stringify(result.outputs);
		bySignature.set(signature, [...(bySignature.get(signature) ?? []), result.candidateId]);
	}
	if (bySignature.size === 1) {
		return {
			winnerId: null,
			agreeingIds: results.map((result) => result.candidateId),
			conclusive: false,
			reason: "every candidate produced identical outputs on the probes — still indistinguishable, escalate",
		};
	}
	const groups = [...bySignature.values()].sort((left, right) => right.length - left.length);
	const largest = groups[0] ?? [];
	const runnerUp = groups[1] ?? [];
	if (largest.length === runnerUp.length) {
		return {
			winnerId: null,
			agreeingIds: largest,
			conclusive: false,
			reason: `no majority — ${largest.length} vs ${runnerUp.length} split across behaviours, escalate rather than guess`,
		};
	}
	const agreeingIds = [...largest].sort();
	return {
		winnerId: agreeingIds[0] ?? null,
		agreeingIds,
		conclusive: true,
		reason: `${largest.length} of ${results.length} candidates agree on the probe outputs — majority behaviour wins`,
	};
}
