import { type AssembledPrompt, assemblePromptFragments, type PromptFragment } from "../core/prompt-fragment-assembly";

/**
 * The fragment inputs for one session's system-prompt assembly (§5.AQ). A subset of the caller's context — only what
 * determines the assembled TEXT (the warmth-ledger bookkeeping stays with the stateful caller).
 */
export interface SessionSystemPromptInput {
	basePrompt: string;
	/** True when `basePrompt` is the restructured static SDK shell (cwd/date extracted into `sessionEnv`). */
	baseIsStaticShell: boolean;
	planningPrompt?: string | null;
	efficiencyRules: string;
	temporalBlock: string;
	/** The home-agent sidebar append (per-session-kind, task-tier). */
	homeAgentAppend?: string | null;
	/** §5.AF/§5.AA durable retry memory reconstructed from prior failed attempt events for this task. */
	attemptRetryNote?: string | null;
	/** The `<session>` cwd+date trailer extracted from the SDK base — the true suffix (goes LAST). */
	sessionEnv?: string | null;
	/** §5.AE skill-driven fragments; deduped against the fixed keys below, then re-sorted by volatility. */
	skillFragments?: readonly PromptFragment[];
}

/**
 * §5.AQ / §5.U — the PURE core of the session system-prompt assembly, extracted from
 * `InMemoryNKleinTaskSessionService.assembleSessionSystemPrompt` so the byte-stability-critical construction is
 * independently testable. Orders the fixed fragments by churn (static base → config → daily → task-tier), with
 * `session-env` LAST so it is the true suffix: identical-card restarts share every byte up to it, and same-workspace
 * tasks share everything before their cwd/date trailer (byte-stable prompt shells). Skill fragments are appended,
 * deduped against the fixed keys (a skill declaring an already-injected fragment never doubles it), and the assembler
 * re-sorts by volatility so they land in their correct churn bucket regardless of append position.
 */
export function buildSessionSystemPrompt(input: SessionSystemPromptInput): AssembledPrompt {
	const baseFragments: PromptFragment[] = [
		{
			key: "base",
			volatility: input.baseIsStaticShell ? "static" : "task",
			text: input.basePrompt,
			pinned: "head",
		},
		{ key: "efficiency-rules", volatility: "config", text: input.efficiencyRules },
		{ key: "temporal-context", volatility: "daily", text: input.temporalBlock },
		{ key: "planning-workflow", volatility: "task", text: input.planningPrompt ?? "" },
		{ key: "home-agent-append", volatility: "task", text: input.homeAgentAppend ?? "" },
		{ key: "attempt-retry-note", volatility: "task", text: input.attemptRetryNote ?? "" },
		{ key: "session-env", volatility: "task", text: input.sessionEnv ?? "" },
	];
	const fixedKeys = new Set(baseFragments.map((fragment) => fragment.key));
	const extraSkillFragments = (input.skillFragments ?? []).filter((fragment) => !fixedKeys.has(fragment.key));
	return assemblePromptFragments([...baseFragments, ...extraSkillFragments]);
}
