import { RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS, type RuntimeTaskImage } from "../core/api-contract";
import type { SelfObservationEventInput } from "../telemetry/self-observation-sink";
import { CONTEXT_BUDGET_SEND_RESERVE_TOKENS, planContextBudget } from "./nklein-context-budget-plan";
import { TaskContextWindowStore } from "./nklein-task-context-window-store";
import type { NKleinSdkPersistedMessage } from "./sdk-runtime-boundary.js";

/**
 * Service touchpoints the context-budget controller needs. State reads (model id, quality budget) are lookups,
 * kept as narrow accessor deps so the controller stays decoupled from the service's Map fields; `recordObservation`
 * is the model-attributed self-observation sink (the service's `recordObservationWithModel`).
 */
export interface ContextBudgetControllerDeps {
	getModelIdForTask(taskId: string): string | null;
	getQualityBudget(modelId: string): number | null;
	recordObservation(event: SelfObservationEventInput & { taskId: string }): void;
}

export interface ContextBudgetController {
	resolveContextWindowForTask(taskId: string, launchContextWindow?: number | null): number | null;
	resolveKnownContextWindowForTask(taskId: string, launchContextWindow?: number | null): number;
	prepareMessagesForKnownContextWindow(input: {
		taskId: string;
		messages?: NKleinSdkPersistedMessage[] | null;
		prompt: string;
		images?: RuntimeTaskImage[];
		contextWindow: number;
	}): NKleinSdkPersistedMessage[] | undefined;
	forget(taskId: string): void;
	clear(): void;
}

/**
 * Owns per-task context-window resolution (advertised → learned-quality-derated → normalized) and the pre-send
 * context-budget guard (plan/compact/block a prompt before provider dispatch). Extracted verbatim from
 * InMemoryNKleinTaskSessionService — the controller OWNS the `TaskContextWindowStore`; the entangled compaction
 * ORCHESTRATION (`maybeCompactBeforeContextOverflow`, which reads the persisted session + triggers a restart) stays
 * in the service and delegates its pure step to `prepareMessagesForKnownContextWindow`.
 */
export function createContextBudgetController(deps: ContextBudgetControllerDeps): ContextBudgetController {
	const contextWindowStore = new TaskContextWindowStore();

	const normalizeEffectiveContextWindow = (contextWindow: number): number => Math.trunc(contextWindow);

	const resolveContextWindowForTask = (taskId: string, launchContextWindow?: number | null): number | null => {
		if (typeof launchContextWindow === "number" && Number.isFinite(launchContextWindow) && launchContextWindow > 0) {
			const normalized = normalizeEffectiveContextWindow(launchContextWindow);
			contextWindowStore.set(taskId, normalized);
			return normalized;
		}
		return contextWindowStore.get(taskId);
	};

	const resolveKnownContextWindowForTask = (taskId: string, launchContextWindow?: number | null): number => {
		const contextWindow =
			resolveContextWindowForTask(taskId, launchContextWindow) ?? RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS;
		// W2.3a: cap by the LEARNED quality-effective budget for this task's model when the ledger has observed a
		// quality knee below the advertised window (never below the 32k floor — the budget itself enforces it).
		const modelId = deps.getModelIdForTask(taskId);
		const qualityBudget = modelId ? deps.getQualityBudget(modelId) : null;
		const derated = qualityBudget !== null ? Math.min(contextWindow, qualityBudget) : contextWindow;
		return normalizeEffectiveContextWindow(derated);
	};

	const recordContextBudgetGuard = (input: {
		taskId: string;
		action: "compacted" | "blocked";
		contextWindow: number;
		originalProjectedTokens: number;
		projectedTokens: number;
		originalHistoryTokens: number;
		compactedHistoryTokens: number;
		nextPromptTokens: number;
	}): void => {
		deps.recordObservation({
			signal: "context_overflow",
			severity: input.action === "blocked" ? "error" : "warning",
			message:
				input.action === "blocked"
					? `Pre-send context guard blocked an oversized prompt before provider dispatch (~${input.projectedTokens.toLocaleString()} projected tokens for ${input.contextWindow.toLocaleString()} available).`
					: `Pre-send context guard compacted history before provider dispatch (~${input.originalProjectedTokens.toLocaleString()} → ~${input.projectedTokens.toLocaleString()} projected tokens).`,
			taskId: input.taskId,
			metadata: {
				action: input.action,
				contextWindow: input.contextWindow,
				originalProjectedTokens: input.originalProjectedTokens,
				projectedTokens: input.projectedTokens,
				originalHistoryTokens: input.originalHistoryTokens,
				compactedHistoryTokens: input.compactedHistoryTokens,
				nextPromptTokens: input.nextPromptTokens,
				sendReserveTokens: CONTEXT_BUDGET_SEND_RESERVE_TOKENS,
				effectiveContextWindow: input.contextWindow,
			},
		});
	};

	const prepareMessagesForKnownContextWindow = (input: {
		taskId: string;
		messages?: NKleinSdkPersistedMessage[] | null;
		prompt: string;
		images?: RuntimeTaskImage[];
		contextWindow: number;
	}): NKleinSdkPersistedMessage[] | undefined => {
		const plan = planContextBudget({
			messages: input.messages,
			prompt: input.prompt,
			images: input.images,
			contextWindow: input.contextWindow,
		});
		if (plan.outcome === "blocked") {
			recordContextBudgetGuard({
				taskId: input.taskId,
				action: "blocked",
				contextWindow: input.contextWindow,
				originalProjectedTokens: plan.originalProjectedTokens,
				projectedTokens: plan.projectedTokens,
				originalHistoryTokens: plan.originalHistoryTokens,
				compactedHistoryTokens: plan.compactedHistoryTokens,
				nextPromptTokens: plan.nextPromptTokens,
			});
			if (plan.promptAloneOverflows) {
				throw new Error(
					`Your message (~${plan.nextPromptTokens.toLocaleString()} tokens) is larger than this model's ~${input.contextWindow.toLocaleString()} token working budget after reserving ${CONTEXT_BUDGET_SEND_RESERVE_TOKENS.toLocaleString()} tokens for the response. Shorten the message, ask !Klein to summarize pasted content first, or pick a larger-window local model.`,
				);
			}
			throw new Error(
				`Context would overflow the known ${input.contextWindow.toLocaleString()} token window after !Klein compaction (~${plan.projectedTokens.toLocaleString()} projected tokens). Old read_files tool output was omitted; clear or summarize the task history before sending more input.`,
			);
		}
		if (plan.outcome === "compacted") {
			recordContextBudgetGuard({
				taskId: input.taskId,
				action: "compacted",
				contextWindow: input.contextWindow,
				originalProjectedTokens: plan.originalProjectedTokens,
				projectedTokens: plan.projectedTokens,
				originalHistoryTokens: plan.originalHistoryTokens,
				compactedHistoryTokens: plan.compactedHistoryTokens,
				nextPromptTokens: plan.nextPromptTokens,
			});
		}
		return plan.compactedMessages.length > 0 ? plan.compactedMessages : undefined;
	};

	return {
		resolveContextWindowForTask,
		resolveKnownContextWindowForTask,
		prepareMessagesForKnownContextWindow,
		forget: (taskId) => contextWindowStore.forget(taskId),
		clear: () => contextWindowStore.clear(),
	};
}
