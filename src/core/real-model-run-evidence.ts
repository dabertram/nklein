export interface RealModelToolExecutionEvidence {
	sessionId: string;
	agent: string | null;
	modelId: string | null;
	toolUseId: string;
	toolName: string;
	input: unknown;
	toolUseMessageId: string | null;
	toolUseAt: number | null;
	status: "completed" | "pending" | "orphan_result";
	resultMessageId: string | null;
	resultAt: number | null;
	isError: boolean | null;
	result: unknown;
}

export interface RealModelToolEvidenceSummary {
	sessions: number;
	toolUses: number;
	completedResults: number;
	successfulResults: number;
	errorResults: number;
	pendingToolUses: number;
	orphanResults: number;
}

export type RealModelRuntimeSignalKind =
	| "dependency_coherence_rejection"
	| "model_capacity_wait"
	| "context_floor_refusal"
	| "sandbox_conflict"
	| "runtime_failure";

export interface RealModelRuntimeSignal {
	lineNumber: number;
	kind: RealModelRuntimeSignalKind;
	line: string;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Pair every persisted SDK `tool_use` with its exact `tool_result`. Pending calls and orphaned results stay visible:
 * either can be the strongest evidence in a stalled real-model run and must never disappear from aggregation.
 */
export function extractRealModelToolEvidence(document: unknown): RealModelToolExecutionEvidence[] {
	const root = asRecord(document);
	if (!root || !Array.isArray(root.messages)) {
		throw new Error("Session transcript must be an object with a messages array.");
	}

	const sessionId = asString(root.sessionId) ?? "unknown-session";
	const agent = asString(root.agent);
	const executions: RealModelToolExecutionEvidence[] = [];
	const pendingByUseId = new Map<string, number>();

	for (const rawMessage of root.messages) {
		const message = asRecord(rawMessage);
		if (!message || !Array.isArray(message.content)) {
			continue;
		}
		const messageId = asString(message.id);
		const messageAt = asNumber(message.ts);
		const modelInfo = asRecord(message.modelInfo);
		const modelId = modelInfo ? asString(modelInfo.id) : null;

		for (const rawBlock of message.content) {
			const block = asRecord(rawBlock);
			if (!block) {
				continue;
			}
			if (block.type === "tool_use") {
				const toolUseId = asString(block.id);
				const toolName = asString(block.name);
				if (!toolUseId || !toolName) {
					continue;
				}
				pendingByUseId.set(toolUseId, executions.length);
				executions.push({
					sessionId,
					agent,
					modelId,
					toolUseId,
					toolName,
					input: block.input ?? null,
					toolUseMessageId: messageId,
					toolUseAt: messageAt,
					status: "pending",
					resultMessageId: null,
					resultAt: null,
					isError: null,
					result: null,
				});
				continue;
			}
			if (block.type !== "tool_result") {
				continue;
			}
			const toolUseId = asString(block.tool_use_id);
			if (!toolUseId) {
				continue;
			}
			const pendingIndex = pendingByUseId.get(toolUseId);
			if (pendingIndex === undefined) {
				executions.push({
					sessionId,
					agent,
					modelId,
					toolUseId,
					toolName: asString(block.name) ?? "unknown_tool",
					input: null,
					toolUseMessageId: null,
					toolUseAt: null,
					status: "orphan_result",
					resultMessageId: messageId,
					resultAt: messageAt,
					isError: block.is_error === true,
					result: block.content ?? null,
				});
				continue;
			}

			pendingByUseId.delete(toolUseId);
			const pending = executions[pendingIndex];
			if (!pending) {
				continue;
			}
			pending.status = "completed";
			pending.resultMessageId = messageId;
			pending.resultAt = messageAt;
			pending.isError = block.is_error === true;
			pending.result = block.content ?? null;
		}
	}

	return executions;
}

export function summarizeRealModelToolEvidence(
	sessionExecutions: readonly (readonly RealModelToolExecutionEvidence[])[],
): RealModelToolEvidenceSummary {
	const executions = sessionExecutions.flat();
	const completed = executions.filter((execution) => execution.status === "completed");
	return {
		sessions: sessionExecutions.length,
		toolUses: executions.filter((execution) => execution.status !== "orphan_result").length,
		completedResults: completed.length,
		successfulResults: completed.filter((execution) => execution.isError === false).length,
		errorResults: completed.filter((execution) => execution.isError === true).length,
		pendingToolUses: executions.filter((execution) => execution.status === "pending").length,
		orphanResults: executions.filter((execution) => execution.status === "orphan_result").length,
	};
}

export function isCardTransitionLedgerEvent(value: unknown): value is JsonRecord {
	return asRecord(value)?.kind === "transition";
}

export function extractRealModelRuntimeSignals(log: string): RealModelRuntimeSignal[] {
	const signals: RealModelRuntimeSignal[] = [];
	for (const [index, line] of log.split(/\r?\n/u).entries()) {
		let kind: RealModelRuntimeSignalKind | null = null;
		if (/dependency-coherence validation/iu.test(line)) {
			kind = "dependency_coherence_rejection";
		} else if (/waiting for capacity|concurrent-session cap/iu.test(line)) {
			kind = "model_capacity_wait";
		} else if (/before this model can be activated|context_floor_unmet/iu.test(line)) {
			kind = "context_floor_refusal";
		} else if (/already in use by container/iu.test(line)) {
			kind = "sandbox_conflict";
		} else if (/uncaught|unhandled|\bfatal\b/iu.test(line)) {
			kind = "runtime_failure";
		}
		if (kind) {
			signals.push({ lineNumber: index + 1, kind, line });
		}
	}
	return signals;
}
