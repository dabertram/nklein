/**
 * F4.37 companion — VERDICT-session TOOL-SET restriction (the second half of the judge-session diet).
 *
 * Live wire measurement (2026-07-18, tee capture on the qwable rig): a review session's serialized `tools` block was
 * **32,200 chars (~8k tokens) across 26 tools** — larger than the ~19.8KB worker system prompt the judge prompt diet
 * removed. `decompose_project` alone is 8KB of schema. Offering the full worker toolset to a judge buries
 * `submit_review` among 25 irrelevant schemas and re-poisons the small-model context the diet just cleaned: after the
 * diet, all four fleet reviewers STILL ended every turn with no tool call (nudges exhausted, "no submission").
 *
 * A judge's job is to INSPECT (read-only) and VERDICT (the submission tool). It must not decompose, write, edit, or
 * promote. Narrowing to the inspection + verdict set cuts the tools block to ~12.9KB (39%) and removes every
 * mutation-shaped distractor. This applies to the VERDICT-ONLY kinds (`review`, `plan-critique`) — NOT `merge`:
 * a merge-resolution session must EDIT files to resolve conflict markers, so it keeps its editing tools.
 *
 * Pure over the injected policy map (same contract as `restrictToolPoliciesForPlanning` — generic over
 * `{ enabled, autoApprove }`), applied by the session service alongside `applyJudgeSessionPromptDiet`.
 */

/** Session kinds whose ONLY valid terminal action is a verdict tool call — review + plan-critique, NOT merge. */
export const VERDICT_ONLY_SESSION_KINDS: ReadonlySet<string> = new Set(["review", "plan-critique", "architect-brief"]);

/**
 * Tools a verdict-only session must NOT see: decomposition/board mutation, file mutation, execution-adjacent
 * distractors, and worker-lifecycle tools. Read-only discovery/inspection + `run_commands` (a reviewer legitimately
 * runs the tests) + the submission tools stay enabled.
 */
export const VERDICT_SESSION_DISABLED_TOOLS = [
	"decompose_project",
	"expand_task",
	"add_task",
	"add_dependency",
	"write_file",
	"write_files",
	"editor",
	"apply_patch",
	"edit_file",
	"predict_output",
	"begin_implementation",
	"update_focus_chain",
	"promote_card",
	"skills",
] as const;

export type VerdictSessionDisabledTool = (typeof VERDICT_SESSION_DISABLED_TOOLS)[number];

interface ToolPolicyValue {
	enabled?: boolean;
	autoApprove?: boolean;
}

/**
 * Return a COPY of the tool-policy map with every mutation/decomposition tool DISABLED for a verdict-only session, so
 * the judge can only inspect and submit. Idempotent + pure; tools not named are untouched.
 */
export function restrictToolPoliciesForVerdictSession<TValue extends ToolPolicyValue>(
	base: Readonly<Record<string, TValue>>,
): Record<string, TValue> {
	const restricted: Record<string, TValue> = { ...base };
	for (const tool of VERDICT_SESSION_DISABLED_TOOLS) {
		const existing = restricted[tool];
		restricted[tool] = { ...(existing ?? ({} as TValue)), enabled: false, autoApprove: false } as TValue;
	}
	return restricted;
}

/**
 * Filter a TOOL LIST by a policy map at the OFFER layer. The vendored SDK's policy filter applies only to
 * extension-REGISTERED tools; config-declared tools (!Klein's extraTools) merge UNFILTERED into the model request,
 * so `enabled:false` gated execution but the schema still reached the model — measured live 2026-07-18: judge
 * sessions kept the full 23-tool 28KB block after the policy restriction. Applying the same `enabled !== false`
 * semantics here (absent policy = enabled; a "*" wildcard policy is honored like the SDK) makes a disabled tool
 * actually DISAPPEAR from the offer for both the §5.B planning restriction and the verdict-session narrowing.
 */
export function filterToolsByPolicyEnabled<TTool extends { name: string }>(
	tools: readonly TTool[],
	policies: Readonly<Record<string, { enabled?: boolean }>> | undefined,
): TTool[] {
	if (!policies) {
		return [...tools];
	}
	const globalPolicy = policies["*"] ?? {};
	return tools.filter((tool) => ({ ...globalPolicy, ...(policies[tool.name] ?? {}) }).enabled !== false);
}
