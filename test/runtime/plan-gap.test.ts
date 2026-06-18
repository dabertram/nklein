import { describe, expect, it, vi } from "vitest";
import { recordPlanGap } from "../../src/core/plan-gap";

describe("plan gap telemetry", () => {
	it("records a structured plan-gap observation", () => {
		const recordObservation = vi.fn();

		recordPlanGap({
			workspacePath: "/repo",
			taskId: "task-1",
			kind: "missing_dependency",
			description: "The API client task depends on auth types that were not planned.",
			evidence: "src/auth/types.ts does not exist.",
			recordObservation,
		});

		expect(recordObservation).toHaveBeenCalledWith({
			signal: "plan_gap",
			severity: "warning",
			message:
				'Plan gap reported by task "task-1": The API client task depends on auth types that were not planned.',
			taskId: "task-1",
			workspacePath: "/repo",
			metadata: {
				kind: "missing_dependency",
				description: "The API client task depends on auth types that were not planned.",
				evidence: "src/auth/types.ts does not exist.",
			},
		});
	});
});
