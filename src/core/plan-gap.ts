import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { type PlanGapKind, planGapKindSchema } from "./plan-gap-kind";

// Re-export so existing importers of `plan-gap` keep working (the schema/type now live in the browser-safe module).
export { type PlanGapKind, planGapKindSchema };

export interface RecordPlanGapInput {
	workspacePath: string;
	taskId: string;
	kind: PlanGapKind;
	description: string;
	evidence?: string | null;
	recordObservation?: typeof recordSelfObservation;
}

export function recordPlanGap(input: RecordPlanGapInput): void {
	(input.recordObservation ?? recordSelfObservation)({
		signal: "plan_gap",
		severity: "warning",
		message: `Plan gap reported by task "${input.taskId}": ${input.description}`,
		taskId: input.taskId,
		workspacePath: input.workspacePath,
		metadata: {
			kind: input.kind,
			description: input.description,
			evidence: input.evidence?.trim() || null,
		},
	});
}
