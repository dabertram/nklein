import { decideSelfCompaction } from "../core/self-compaction-rubric";
import type { AgentTool } from "./sdk-agent-types";

/**
 * F12.6 model-callable self-compaction: the `request_compaction` tool lets the agent say "this is a safe moment to
 * forget" (a sub-task resolved, the trajectory converged) instead of waiting for the budget threshold. The rubric
 * (`decideSelfCompaction`) disposes — an unsafe request (mid-derivation, stuck) HOLDS with the reason returned to the
 * model, so a weak model can't compact away its own load-bearing state. A `fire` verdict records a per-task request
 * the service consults at the next turn boundary (mirrors the predict_output registry pattern); the automatic budget
 * fallback stays untouched for models that never call this.
 */

export interface CompactionRequestRecord {
	readonly reason: string;
	readonly requestedAt: number;
}

const compactionRequestByTaskId = new Map<string, CompactionRequestRecord>();

export function getCompactionRequest(taskId: string): CompactionRequestRecord | null {
	return compactionRequestByTaskId.get(taskId) ?? null;
}

export function forgetCompactionRequest(taskId: string): void {
	compactionRequestByTaskId.delete(taskId);
}

export function createRequestCompactionTool(
	taskId: string,
	options: { getOccupancyFraction?: () => number | null } = {},
): AgentTool[] {
	return [
		{
			name: "request_compaction",
			description:
				"Ask for context compaction at a SAFE moment — right after a sub-task/milestone resolves and its working detail became dead weight. Do NOT call mid-derivation or while stuck; the rubric will hold and tell you why.",
			inputSchema: {
				type: "object",
				properties: {
					subTaskResolved: {
						type: "boolean",
						description: "A sub-task/milestone just resolved and its scaffolding is no longer needed.",
					},
					midDerivation: {
						type: "boolean",
						description: "You are mid-derivation/mid-edit and earlier steps are still load-bearing.",
					},
					stuck: {
						type: "boolean",
						description: "You are stuck or looping (compaction would destroy recovery evidence).",
					},
				},
				required: ["subTaskResolved"],
				additionalProperties: false,
			},
			async execute(input) {
				const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
				const verdict = decideSelfCompaction({
					subTaskResolved: record.subTaskResolved === true,
					midDerivation: record.midDerivation === true,
					stuck: record.stuck === true,
					occupancyFraction: options.getOccupancyFraction?.() ?? null,
				});
				if (verdict.action === "fire") {
					compactionRequestByTaskId.set(taskId, { reason: verdict.reason, requestedAt: Date.now() });
					return {
						ok: true,
						action: "fire",
						note: `${verdict.reason} Compaction is queued for the next turn boundary — continue working.`,
					};
				}
				return { ok: true, action: "hold", note: verdict.reason };
			},
		},
	];
}
