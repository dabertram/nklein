import { type AgentTransitionEvent, buildTransitionEvent } from "./agent-attempt-ledger.js";
import { hashToolResultContent } from "./tool-result-record.js";

/**
 * F1.17 (§5.AF) — replay POLICIES over the F1.16 per-tool idempotency substrate: what a replayed/resumed run does
 * when it reaches a tool call that already executed. Four policies, decided PER TOOL:
 *
 *  - `reuse`      — return the RECORDED result without executing (the at-most-once default: a side effect must
 *                   never repeat; the recorded payload from the persisted transcript IS the result).
 *  - `simulate`   — return a FIXTURE result (the simulator contract: dev-test fixtures supply the same
 *                   {@link RecordedToolExecution} shape the transcript recorder produces — one contract, two sources).
 *  - `skip`       — do not execute and return a marker result (side effects that must not repeat and whose output
 *                   is irrelevant downstream — e.g. a notification).
 *  - `reconfirm`  — execute LIVE and COMPARE the fresh result's hash to the recorded one (drift detection:
 *                   "fixture vs live" — the §5.AF reconfirm mode).
 *
 * A call with NO record always executes live (`execute_first_time`) regardless of policy — a policy governs
 * replays, never first executions. Every decision is persistable as a ledger `transition` event
 * ({@link buildReplayDecisionEvent}) so replay behavior is part of the same evidence stream everything else uses.
 * Pure + total: no I/O, no clock; the executor wiring injects the live runner and the fixture source.
 */

export type ToolReplayPolicy = "reuse" | "simulate" | "skip" | "reconfirm";

/** Sensible per-tool defaults: mutating tools must never re-fire; unknown tools fail safe to `reuse`. */
export const DEFAULT_TOOL_REPLAY_POLICIES: Readonly<Record<string, ToolReplayPolicy>> = {
	// Side-effectful — never repeat:
	run_commands: "reuse",
	write_file: "reuse",
	write_files: "reuse",
	edit_file: "reuse",
	editor: "reuse",
	apply_patch: "reuse",
	decompose_project: "reuse",
	add_task: "reuse",
	add_dependency: "reuse",
	begin_implementation: "reuse",
	submit_review: "reuse",
	// Read-only — cheap to re-verify against the recording:
	read_files: "reconfirm",
	read_large_file: "reconfirm",
	list_files: "reconfirm",
	find_files: "reconfirm",
	search_codebase: "reconfirm",
};

/** Resolve the effective policy for a tool: explicit config > per-tool default > `reuse` (fail-safe). */
export function resolveToolReplayPolicy(
	toolName: string,
	config?: Readonly<Record<string, ToolReplayPolicy>> | null,
): ToolReplayPolicy {
	return config?.[toolName] ?? DEFAULT_TOOL_REPLAY_POLICIES[toolName] ?? "reuse";
}

/** One recorded (or fixture-supplied) execution of a logical tool call — the shared replay/simulator contract. */
export interface RecordedToolExecution {
	toolName: string;
	inputFingerprint: string | null;
	occurrence: number;
	/** The full recorded result payload (from the persisted transcript, or a simulator fixture). */
	content: unknown;
	/** Canonical content hash (always recomputable from `content`; recorded on the attempt event). */
	resultHash: string;
	isError: boolean;
}

export type ToolReplayAction =
	| { action: "execute_first_time" }
	| { action: "reuse"; recorded: RecordedToolExecution }
	| { action: "simulate" }
	| { action: "skip"; marker: string }
	| { action: "execute_and_compare"; recorded: RecordedToolExecution };

/**
 * Decide what a replayed run does at one tool call. `recorded` is the matching execution for THIS occurrence
 * (null = never ran ⇒ live first execution). Pure.
 */
export function decideToolReplayAction(input: {
	policy: ToolReplayPolicy;
	recorded: RecordedToolExecution | null;
}): ToolReplayAction {
	if (input.recorded === null) {
		return { action: "execute_first_time" };
	}
	switch (input.policy) {
		case "reuse":
			return { action: "reuse", recorded: input.recorded };
		case "simulate":
			return { action: "simulate" };
		case "skip":
			return {
				action: "skip",
				marker: `Replay: ${input.recorded.toolName} already executed (side effect not repeated; recorded outcome ${
					input.recorded.isError ? "error" : "success"
				}).`,
			};
		case "reconfirm":
			return { action: "execute_and_compare", recorded: input.recorded };
	}
}

/** The outcome of a reconfirm comparison: did the live re-execution reproduce the recorded result? */
export function compareReconfirmResult(
	recorded: RecordedToolExecution,
	liveContent: unknown,
): { matched: boolean; liveHash: string } {
	const liveHash = hashToolResultContent(liveContent);
	return { matched: liveHash === recorded.resultHash, liveHash };
}

/**
 * Persist one replay decision into the shared evidence stream as a `transition` event:
 * `replay → replay_<action>`, reason `<toolName>#<occurrence>`, controllerDecision `policy=<p>[,matched=<bool>]`.
 */
export function buildReplayDecisionEvent(input: {
	workflowId: string;
	taskId: string;
	workspacePathHash: string;
	toolName: string;
	occurrence: number;
	action: ToolReplayAction["action"];
	policy: ToolReplayPolicy;
	/** reconfirm only: whether the live re-execution matched the recording. */
	matched?: boolean;
	recordedAt?: number;
}): AgentTransitionEvent {
	return buildTransitionEvent({
		workflowId: input.workflowId,
		taskId: input.taskId,
		workspacePathHash: input.workspacePathHash,
		from: "replay",
		to: `replay_${input.action}`,
		reason: `${input.toolName}#${input.occurrence}`,
		controllerDecision: `policy=${input.policy}${input.matched === undefined ? "" : `,matched=${input.matched}`}`,
		...(input.recordedAt !== undefined ? { recordedAt: input.recordedAt } : {}),
	});
}
