/**
 * §5.B/§5.O decompose (plan-mode) TOOL-SET restriction — a decompose/plan card's ONLY job is to call `decompose_project`
 * (which creates the child implementation cards); it must not EXECUTE commands or WRITE files (those are the worker
 * cards' job, review-gated). Offering execution/write tools to the planning phase lets a weak model rabbit-hole on
 * shell exploration or edits instead of emitting the decomposition — LIVE-OBSERVED (sweep run 7, 2026-07-08): a 9B
 * decompose made 9 `run_commands` + 3 `read_files` and NEVER called `decompose_project`, so zero cards were produced.
 *
 * This pure restrictor keeps the READ-ONLY discovery tools (find/list/read — a plan legitimately inspects the code) and
 * DISABLES the execution + mutation tools for the planning phase. Pure over the injected policy map (no SDK coupling —
 * generic over `{ enabled, autoApprove }` values), so the caller applies it to the decompose seed's start policies.
 */

/** Tools a decompose/plan card must NOT use — execution + any file mutation. Read-only discovery stays enabled. */
export const PLAN_MODE_DISABLED_TOOLS = ["run_commands", "write_file", "write_files", "editor", "apply_patch"] as const;

export type PlanModeDisabledTool = (typeof PLAN_MODE_DISABLED_TOOLS)[number];

interface ToolPolicyValue {
	enabled?: boolean;
	autoApprove?: boolean;
}

/**
 * Return a COPY of the tool-policy map with the execution + mutation tools DISABLED for the decompose/plan phase, so a
 * planning card can only inspect (read-only) and call `decompose_project`. Idempotent + pure: a tool already
 * absent/disabled is set to a disabled policy; the read-only tools are untouched.
 */
export function restrictToolPoliciesForPlanning<TValue extends ToolPolicyValue>(
	base: Readonly<Record<string, TValue>>,
): Record<string, TValue> {
	const restricted: Record<string, TValue> = { ...base };
	for (const tool of PLAN_MODE_DISABLED_TOOLS) {
		const existing = restricted[tool];
		restricted[tool] = { ...(existing ?? ({} as TValue)), enabled: false, autoApprove: false } as TValue;
	}
	return restricted;
}
