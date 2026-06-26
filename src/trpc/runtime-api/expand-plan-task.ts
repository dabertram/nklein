import { TRPCError } from "@trpc/server";
import { inferNKleinPlanSlugForTask } from "../../commands/task.js";
import type { RuntimeExpandNKleinPlanTaskRequest, RuntimeExpandNKleinPlanTaskResponse } from "../../core/api-contract";
import { applyNKleinPlanTaskReplacementArtifacts } from "../../nklein-agent/nklein-decomposition-tool";
import { readNKleinPlanArtifacts } from "../../nklein-agent/nklein-plan-artifacts";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";

/**
 * Handler for the expand-plan-task procedure, extracted from the oversized `runtime-api.ts`
 * (§5.X / architecture recommendation #3). It resolves the plan slug + plan task id (inferring each from the board
 * task when not passed explicitly) and applies the user's replacement subtasks to the plan's task graph. A pure
 * function of (workspaceScope, input) + module-level plan helpers — no deps slice. Behavior/wire contract unchanged.
 */
export async function handleExpandNKleinPlanTask(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeExpandNKleinPlanTaskRequest,
): Promise<RuntimeExpandNKleinPlanTaskResponse> {
	// Resolve slug: use the caller's explicit planSlug, or infer from the board taskId.
	const planSlug =
		input.planSlug?.trim() ||
		(await inferNKleinPlanSlugForTask({
			workspacePath: workspaceScope.workspacePath,
			taskId: input.taskId,
		}));
	if (!planSlug) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Could not infer a plan slug for task "${input.taskId}". Pass planSlug explicitly.`,
		});
	}

	// Resolve planTaskId: use the caller's explicit value, or infer by scanning the plan's task graph.
	// The board taskId is composed as "<slugify(planSlug)>-<slugify(planTaskId)>" so we strip the prefix.
	let planTaskId = input.planTaskId?.trim() || null;
	if (!planTaskId) {
		const artifacts = await readNKleinPlanArtifacts(workspaceScope.workspacePath, planSlug);
		// Find the task whose board ID matches the input taskId (exact or with -N suffix).
		// Board IDs are generated as `${slugify(slug)}-${slugify(planTaskId)}` so strip the slug prefix.
		const slugPrefix = planSlug
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
		for (const task of artifacts.taskGraph.tasks) {
			const taskSlug = task.id
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "");
			const baseId = `${slugPrefix}-${taskSlug}`;
			if (input.taskId === baseId || input.taskId.startsWith(`${baseId}-`)) {
				planTaskId = task.id;
				break;
			}
		}
	}
	if (!planTaskId) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Could not infer a plan task ID for board task "${input.taskId}" in plan "${planSlug}". Pass planTaskId explicitly.`,
		});
	}

	// Map the web-UI items to the full NKleinPlanTask shape expected by the SDK.
	// Fields not provided by the user default to the same values the decomposition tool uses.
	const fullReplacements = input.replacements.map((item) => ({
		id: item.id,
		title: item.title,
		prompt: item.prompt,
		dependsOn: item.dependsOn,
		complexity: item.complexity,
		suggestedRole: null,
		filesLikelyTouched: [],
		acceptanceCommand: item.acceptanceCommand,
		testFirst: false,
		acceptanceTestPrompt: null,
	}));

	const result = await applyNKleinPlanTaskReplacementArtifacts({
		workspacePath: workspaceScope.workspacePath,
		slug: planSlug,
		taskId: planTaskId,
		replacements: fullReplacements,
		description: input.description?.trim() || null,
	});

	return {
		ok: true,
		taskId: input.taskId,
		planSlug,
		planTaskId,
		replacementTaskIds: result.replacementTaskIds,
		entryTaskIds: result.entryTaskIds,
		terminalTaskIds: result.terminalTaskIds,
		taskGraphPath: result.taskGraphPath,
		revisionsPath: result.revisionsPath,
		message: `Expanded plan task "${planTaskId}" into ${result.replacementTaskIds.length} replacement task(s) in plan "${planSlug}".`,
	};
}
