/**
 * Task context-need estimator (todo §5.AQ item G) — the `taskNeededTokens` signal that feeds `planLoadContextLength`
 * (and thus the load `--context-length`). To right-size the loaded context (the #1 VRAM lever) without starving the
 * task, estimate how much context this task will actually consume: the system prompt + the task prompt + the working
 * tokens the agent accumulates (tool outputs, reasoning, conversation turns), with generous slack — agents under-
 * estimate, and an under-sized window forces overflow/compaction (or a reload), which is worse than a little extra KV.
 *
 * Pure + deterministic. The ≥32k floor + the model max are applied downstream by `planLoadContextLength`; this just
 * estimates the raw need.
 */

export interface TaskContextEstimateInput {
	/** Tokens in the (cache-stable) system prompt + tool definitions. */
	systemPromptTokens: number;
	/** Tokens in the task prompt / initial user message. */
	taskPromptTokens: number;
	/** Expected tokens the agent accumulates working the task (tool outputs, reasoning, turns). */
	expectedWorkingTokens: number;
	/** Slack multiplier over the raw sum (default 1.5 — better a little generous than overflow). */
	headroomMultiplier?: number;
}

const DEFAULT_HEADROOM_MULTIPLIER = 1.5;

/** Estimate the context a task will need (raw — the floor/cap are applied by `planLoadContextLength`). */
export function estimateTaskContextNeed(input: TaskContextEstimateInput): number {
	const system = Math.max(0, input.systemPromptTokens);
	const task = Math.max(0, input.taskPromptTokens);
	const working = Math.max(0, input.expectedWorkingTokens);
	const headroom =
		input.headroomMultiplier !== undefined && input.headroomMultiplier > 0
			? input.headroomMultiplier
			: DEFAULT_HEADROOM_MULTIPLIER;
	return Math.ceil((system + task + working) * headroom);
}
