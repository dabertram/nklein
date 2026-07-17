import type { AgentTool } from "./sdk-agent-types";

/**
 * F12.96 predict-then-execute: the `predict_output` tool lets a worker state — BEFORE the acceptance check runs —
 * exactly what output it expects. The acceptance seam then compares the prediction against REAL execution
 * (`assessPredictedExecution`): a divergence means the model's mental trace of its own code is wrong, which is a
 * categorically different bug signal than a test failure. A TOOL (not prose parsing) is the robust capture per the
 * project's weak-model philosophy — structured, and recoverable by the narrated-tool-call salvage when a model
 * narrates it as text.
 */

export interface PredictedOutputRecord {
	readonly predicted: string;
	readonly recordedAt: number;
}

/** Session-scoped prediction registry the service reads at the acceptance seam. */
const predictionByTaskId = new Map<string, PredictedOutputRecord>();

export function getPredictedOutput(taskId: string): PredictedOutputRecord | null {
	return predictionByTaskId.get(taskId) ?? null;
}

export function forgetPredictedOutput(taskId: string): void {
	predictionByTaskId.delete(taskId);
}

export function createPredictOutputTool(taskId: string): AgentTool[] {
	return [
		{
			name: "predict_output",
			description:
				"State the EXACT output you expect the task's acceptance command to produce, BEFORE running it. A mismatch between your prediction and the real run localizes bugs your mental trace missed. Call once, just before finishing implementation.",
			inputSchema: {
				type: "object",
				properties: {
					predicted: {
						type: "string",
						description:
							"The exact expected output (or its meaningful trailing portion) of the acceptance command.",
					},
				},
				required: ["predicted"],
				additionalProperties: false,
			},
			async execute(input) {
				const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
				const predicted = typeof record.predicted === "string" ? record.predicted : "";
				if (predicted.trim().length === 0) {
					return { ok: false, error: "predicted must be a non-empty string." };
				}
				predictionByTaskId.set(taskId, { predicted, recordedAt: Date.now() });
				return {
					ok: true,
					note: "Prediction recorded. Now run/finish the acceptance flow — the real output will be compared against it.",
				};
			},
		},
	];
}
