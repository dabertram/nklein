import { z } from "zod";
import { recordSelfObservation } from "../telemetry/self-observation-sink";

export const planGapKindSchema = z.enum([
	"missing_decision",
	"contradictory_requirement",
	"missing_dependency",
	"scope_too_large",
	"integration_needed",
	"other",
]);
export type PlanGapKind = z.infer<typeof planGapKindSchema>;

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
