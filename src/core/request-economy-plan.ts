/**
 * Request-economy planner (todo §5.AQ) — the ONE pure decision that unifies the context-economy substrate so the
 * runtime can wire it at a single seam. Given a task's signals + the active model/runtime facts, it composes:
 *   classifyTaskComplexity → selectSysPromptLevel (how deep a system prompt)
 *   estimateTaskContextNeed → planLoadContextLength (what context to load — the #1 VRAM lever)
 *   recommendSampler + recommendKvCacheQuant (per-request inference levers)
 * into a single {@link RequestEconomyPlan}. Pure + deterministic — no I/O, no model call; the live seams (apply the
 * level to prompt assembly, pass the context to the loader, set the sampler/quant) consume this plan.
 */

import { type KvCacheQuant, recommendKvCacheQuant, recommendSampler, type SamplerProfile } from "./inference-levers";
import { planLoadContextLength } from "./load-context-plan";
import { type SysPromptLevel, type SysPromptMode, selectSysPromptLevel } from "./sysprompt-level";
import { classifyTaskComplexity, type TaskComplexitySignals } from "./task-complexity";
import { estimateTaskContextNeed } from "./task-context-estimate";

export interface RequestEconomyInput {
	/** Signals for the task-complexity classifier (drives the sysprompt level). */
	task: TaskComplexitySignals;
	/** Intent bias for sysprompt-level selection. */
	mode: SysPromptMode;
	/** The model's available / quality-effective context budget (tokens) — caps the sysprompt level. */
	availableContextTokens: number;
	/** Token sizes used to estimate the task's context NEED. */
	systemPromptTokens: number;
	taskPromptTokens: number;
	expectedWorkingTokens: number;
	/** Model context-length facts for the load planner. */
	maxContextLength: number;
	minContextFloor: number;
	/** What kind of work this request is (drives the sampler profile). */
	taskKind: "tool" | "code" | "reasoning" | "creative";
	/** Whether flash attention is enabled (gates KV-cache quantization). */
	flashAttention: boolean;
}

export interface RequestEconomyPlan {
	complexity: ReturnType<typeof classifyTaskComplexity>;
	sysPromptLevel: SysPromptLevel;
	estimatedContextNeed: number;
	loadContextLength: number;
	sampler: SamplerProfile;
	kvCacheQuant: KvCacheQuant;
}

/** Compose the context-economy decisions for one request into a single plan the runtime applies. */
export function planRequestEconomy(input: RequestEconomyInput): RequestEconomyPlan {
	const complexity = classifyTaskComplexity(input.task);
	const sysPromptLevel = selectSysPromptLevel({
		availableContextTokens: input.availableContextTokens,
		taskComplexity: complexity,
		mode: input.mode,
	});
	const estimatedContextNeed = estimateTaskContextNeed({
		systemPromptTokens: input.systemPromptTokens,
		taskPromptTokens: input.taskPromptTokens,
		expectedWorkingTokens: input.expectedWorkingTokens,
	});
	const loadContextLength = planLoadContextLength({
		taskNeededTokens: estimatedContextNeed,
		maxContextLength: input.maxContextLength,
		minContextFloor: input.minContextFloor,
	});
	return {
		complexity,
		sysPromptLevel,
		estimatedContextNeed,
		loadContextLength,
		sampler: recommendSampler(input.taskKind),
		kvCacheQuant: recommendKvCacheQuant({ flashAttention: input.flashAttention }),
	};
}
