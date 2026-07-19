/**
 * F12.14 minimal-scaffold baseline + inverse-scaling discipline — PURE core.
 *
 * mini-swe-agent (~100 lines, bash-only, NO native tool-calling) scores >74% on SWE-bench Verified. The lesson is
 * uncomfortable for a scaffolding-heavy system like !Klein and worth stating plainly: scaffolding should scale
 * INVERSELY with model strength, and every scaffold feature should stay opt-in until a bottleneck is empirically
 * shown. Rich tool surfaces help a model that can drive them and actively drown one that cannot — a model failing
 * structured tool calls does not need MORE tools, it needs fewer.
 *
 * This core picks between the standard scaffold and a MINIMAL fenced-bash profile, and it does so from OBSERVED
 * behaviour (this model's tool-call failure rate on this board) rather than from a guess about model strength.
 *
 * Honesty stance: the minimal profile is a FALLBACK, never a silent default. It is selected only on evidence the
 * standard scaffold is failing for this model, and the reason always names that evidence.
 */

export type ScaffoldProfile = "standard" | "minimal";

export interface MinimalScaffoldDefinition {
	/** The only tools the minimal profile offers — one general escape hatch, driven by fenced commands. */
	readonly tools: readonly string[];
	/** Whether native structured tool-calling is used at all (the thing weak models fail). */
	readonly nativeToolCalling: boolean;
	/** Contract text describing how the model acts in this profile. */
	readonly contract: string;
}

/** The mini-swe-agent shape: one command tool, no native tool-calling, everything through fenced bash. */
export const MINIMAL_SCAFFOLD: MinimalScaffoldDefinition = {
	tools: ["run_command"],
	nativeToolCalling: false,
	contract: [
		"Work only through shell commands. Emit exactly ONE command per turn inside a fenced block:",
		"```bash",
		"<the command>",
		"```",
		"Read files with `cat`/`sed`, search with `grep`, and edit by writing the whole file with a heredoc.",
		"Do not describe what you would do — emit the command. After each result, emit the next command or say DONE.",
	].join("\n"),
};

export interface ScaffoldSelectionInput {
	/** Structured tool calls this model ATTEMPTED on this board (any outcome). */
	readonly toolCallAttempts: number;
	/** How many of those were rejected/malformed (schema failures, unparseable calls). */
	readonly toolCallFailures: number;
	/** Consecutive sessions where the model produced NO tool call at all (the classic weak-model stall). */
	readonly consecutiveNoToolCallSessions?: number;
	/** Operator override — an explicit choice always wins over the heuristic. */
	readonly forcedProfile?: ScaffoldProfile | null;
}

export interface ScaffoldSelection {
	readonly profile: ScaffoldProfile;
	readonly reason: string;
}

/** Below this many attempts there is not enough evidence to judge a model's tool-calling. */
const MIN_ATTEMPTS_TO_JUDGE = 8;
/** Failure rate above which the rich tool surface is demonstrably not working for this model. */
const FAILURE_RATE_CEILING = 0.5;
/** This many consecutive no-tool-call sessions is a stall, not noise. */
const NO_TOOL_CALL_STALL = 2;

/**
 * Choose the scaffold profile. Returns `standard` unless the evidence says the rich surface is failing THIS
 * model — thin evidence always keeps the standard profile, because switching on noise would make behaviour
 * unpredictable for no measured gain.
 */
export function selectScaffoldProfile(input: ScaffoldSelectionInput): ScaffoldSelection {
	if (input.forcedProfile) {
		return { profile: input.forcedProfile, reason: `operator forced the ${input.forcedProfile} scaffold` };
	}
	const stalls = input.consecutiveNoToolCallSessions ?? 0;
	if (stalls >= NO_TOOL_CALL_STALL) {
		return {
			profile: "minimal",
			reason: `${stalls} consecutive sessions produced no tool call — a model that cannot drive the tool surface needs FEWER tools, not more`,
		};
	}
	if (input.toolCallAttempts < MIN_ATTEMPTS_TO_JUDGE) {
		return {
			profile: "standard",
			reason: `only ${input.toolCallAttempts} tool-call attempt(s) — too little evidence to abandon the standard scaffold`,
		};
	}
	const failureRate = input.toolCallFailures / input.toolCallAttempts;
	if (failureRate > FAILURE_RATE_CEILING) {
		return {
			profile: "minimal",
			reason: `${Math.round(failureRate * 100)}% of ${input.toolCallAttempts} tool calls failed — the rich surface is not working for this model`,
		};
	}
	return {
		profile: "standard",
		reason: `${Math.round(failureRate * 100)}% tool-call failure rate over ${input.toolCallAttempts} attempts — the standard scaffold is working`,
	};
}
