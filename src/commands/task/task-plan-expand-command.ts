import { applyNKleinPlanTaskReplacementArtifacts } from "../../nklein-agent/nklein-decomposition-tool";
import { type NKleinPlanTask, nkleinPlanTaskSchema } from "../../nklein-agent/nklein-plan-artifacts";
import { resolveWorkspaceRepoPath } from "./task-runtime-workspace.js";

/**
 * The "expand a saved plan task" CLI command (§5.U-extracted from task.ts): replace a single plan task with a set of
 * finer-grained replacement tasks (parsed + schema-validated from JSON), re-applying the plan's task-graph + revision
 * artifacts. Leaf command — no dependency on the other task command implementations.
 */

type JsonRecord = Record<string, unknown>;

function parseReplacementTasksJson(value: string): NKleinPlanTask[] {
	const parsed: unknown = JSON.parse(value);
	return nkleinPlanTaskSchema.array().parse(parsed);
}

export async function expandSavedPlanTaskCommand(input: {
	cwd: string;
	projectPath?: string;
	planSlug: string;
	taskId: string;
	replacementsJson: string;
	description?: string;
	evidence?: string;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd, {
		autoCreateIfMissing: false,
	});
	const replacements = parseReplacementTasksJson(input.replacementsJson);
	const result = await applyNKleinPlanTaskReplacementArtifacts({
		workspacePath: workspaceRepoPath,
		slug: input.planSlug,
		taskId: input.taskId,
		replacements,
		description: input.description,
		evidence: input.evidence,
	});
	return {
		ok: true,
		workspacePath: workspaceRepoPath,
		planSlug: input.planSlug,
		taskId: input.taskId,
		taskGraphPath: result.taskGraphPath,
		revisionsPath: result.revisionsPath,
		replacementTaskIds: result.replacementTaskIds,
		entryTaskIds: result.entryTaskIds,
		terminalTaskIds: result.terminalTaskIds,
		taskCount: result.taskGraph.tasks.length,
	};
}
