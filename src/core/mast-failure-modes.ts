/**
 * F12.39 MAST failure-mode tagging over the attempt ledger — PURE core.
 *
 * MAST (2503.13657) showed that multi-agent failures cluster into a small taxonomy, and that ORCHESTRATION fixes
 * beat bigger models (role specs +9.4%, objective verification +15.6%) — but only if you know WHICH mode dominates.
 * This core classifies each FAILED ledger attempt into the subset of MAST modes the recorded evidence can honestly
 * support, and rolls the distribution up per model so the operator reads "fix specs vs coordination vs
 * verification" straight off the ledger.
 *
 * Honesty contract: every tag names its EVIDENCE (an outcome kind / tool-call shape actually recorded). Modes the
 * attempt grain cannot witness are never claimed — `ignored-input` needs conversation-level evidence, so it is
 * absent by design; infra failures (timeout/abort-with-work) are bucketed `environment`, not forced into a
 * cognitive mode; anything else is `unclassified`, counted and shown, never hidden.
 */

import type { AgentAttemptEvent } from "./agent-attempt-ledger";

export type MastFailureMode =
	| "disobey_spec"
	| "disobey_role"
	| "lost_history"
	| "premature_termination"
	| "incomplete_verification"
	| "environment"
	| "unclassified";

export interface MastTag {
	readonly mode: MastFailureMode;
	/** The recorded evidence that justifies the tag — rendered verbatim to the operator. */
	readonly evidence: string;
}

/** Tool names that count as running verification (tests/acceptance/linters) inside an attempt. */
const VERIFY_TOOL_PATTERN = /run_command|execute_command|bash|terminal|verify|test/i;
/** Tool names that count as producing work (writes/edits). */
const WRITE_TOOL_PATTERN = /write|edit|apply_patch|replace/i;

/** The narrow attempt slice the classifier reads (structural, so tests need no full ledger events). */
export type MastAttemptSlice = Pick<AgentAttemptEvent, "outcome" | "qualityOk" | "salvage"> & {
	readonly toolCalls: ReadonlyArray<{ readonly name: string }>;
};

/** Classify one FAILED attempt (callers filter out successes). Deterministic; one primary tag per attempt. */
export function classifyMastFailureMode(attempt: MastAttemptSlice): MastTag {
	const toolNames = attempt.toolCalls.map((call) => call.name);
	const wrote = toolNames.some((name) => WRITE_TOOL_PATTERN.test(name));
	const verified = toolNames.some((name) => VERIFY_TOOL_PATTERN.test(name));
	switch (attempt.outcome) {
		case "loop":
			return {
				mode: "lost_history",
				evidence: "outcome=loop — the model re-did the same step; it lost track of its own progress.",
			};
		case "narrated":
			return {
				mode: "disobey_role",
				evidence: "outcome=narrated — described tool calls in prose instead of ACTING as the executing role.",
			};
		case "malformed":
			return {
				mode: "disobey_spec",
				evidence: "outcome=malformed — the output violated the required tool/format contract.",
			};
		case "no_tool_call":
			return {
				mode: "premature_termination",
				evidence: "outcome=no_tool_call — the turn ended with zero tool work toward the task.",
			};
		case "timeout":
			return {
				mode: "environment",
				evidence: "outcome=timeout — wall-clock/infra, not a witnessed cognitive failure.",
			};
		case "aborted":
			return attempt.toolCalls.length === 0
				? {
						mode: "premature_termination",
						evidence: "outcome=aborted with zero tool calls — ended before any work.",
					}
				: {
						mode: "environment",
						evidence: "outcome=aborted mid-work — externally stopped, not a witnessed cognitive failure.",
					};
		default: {
			if (attempt.qualityOk === false) {
				return {
					mode: "disobey_spec",
					evidence: "qualityOk=false — the delivered output failed the objective quality screen.",
				};
			}
			if (wrote && !verified) {
				return {
					mode: "incomplete_verification",
					evidence: "wrote changes but ran no test/verify tool before finishing.",
				};
			}
			return {
				mode: "unclassified",
				evidence: `outcome=${attempt.outcome} — no recorded evidence pins a MAST mode; counted, not guessed.`,
			};
		}
	}
}

export interface MastModelDistribution {
	readonly modelId: string;
	readonly failedAttempts: number;
	readonly byMode: Readonly<Record<MastFailureMode, number>>;
	/** The dominant witnessed mode (environment/unclassified excluded); null when nothing cognitive was witnessed. */
	readonly dominantMode: MastFailureMode | null;
}

const ALL_MODES: readonly MastFailureMode[] = [
	"disobey_spec",
	"disobey_role",
	"lost_history",
	"premature_termination",
	"incomplete_verification",
	"environment",
	"unclassified",
];

/** Roll failed attempts up per model. Successes are ignored here — this is the FAILURE diagnostic. */
export function rollupMastDistribution(
	attempts: ReadonlyArray<MastAttemptSlice & { readonly modelId: string }>,
): MastModelDistribution[] {
	const byModel = new Map<string, Map<MastFailureMode, number>>();
	for (const attempt of attempts) {
		if (attempt.outcome === "success") {
			continue;
		}
		const tag = classifyMastFailureMode(attempt);
		const counts = byModel.get(attempt.modelId) ?? new Map<MastFailureMode, number>();
		counts.set(tag.mode, (counts.get(tag.mode) ?? 0) + 1);
		byModel.set(attempt.modelId, counts);
	}
	return [...byModel.entries()]
		.map(([modelId, counts]) => {
			const byMode = Object.fromEntries(ALL_MODES.map((mode) => [mode, counts.get(mode) ?? 0])) as Record<
				MastFailureMode,
				number
			>;
			const witnessed = ALL_MODES.filter(
				(mode) => mode !== "environment" && mode !== "unclassified" && byMode[mode] > 0,
			).sort((left, right) => byMode[right] - byMode[left] || left.localeCompare(right));
			return {
				modelId,
				failedAttempts: [...counts.values()].reduce((sum, count) => sum + count, 0),
				byMode,
				dominantMode: witnessed[0] ?? null,
			};
		})
		.sort((left, right) => right.failedAttempts - left.failedAttempts || left.modelId.localeCompare(right.modelId));
}

/** The MAST paper's remedy hint for a dominant mode — what to fix FIRST, straight off the taxonomy's lesson. */
export function mastRemedyHint(mode: MastFailureMode): string {
	switch (mode) {
		case "disobey_spec":
			return "Tighten the task/format spec in the prompt (role specs were worth +9.4% in MAST).";
		case "disobey_role":
			return "Reinforce the acting role + tool-use contract (narration recovery / role preamble).";
		case "lost_history":
			return "Strengthen progress anchoring (focus-chain re-anchor, loop guards, compaction hygiene).";
		case "premature_termination":
			return "Demand a tool-action first step and gate empty turns (turn-loop guard).";
		case "incomplete_verification":
			return "Enforce verification-first delivery (objective verification was worth +15.6% in MAST).";
		case "environment":
			return "Infra, not cognition: check endpoint capacity, timeouts, and operator aborts.";
		case "unclassified":
			return "Evidence too thin — consider richer outcome recording before drawing conclusions.";
	}
}
