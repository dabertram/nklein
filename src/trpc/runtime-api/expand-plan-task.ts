import { TRPCError } from "@trpc/server";
import { inferNKleinPlanSlugForTask } from "../../commands/task/task-plan-slug.js";
import type { RuntimeExpandNKleinPlanTaskRequest, RuntimeExpandNKleinPlanTaskResponse } from "../../core/api-contract";
import { slugifyTaskId } from "../../nklein-agent/decomposition/plan-task-input-parse";
import { applyNKleinPlanTaskReplacementArtifacts } from "../../nklein-agent/nklein-decomposition-tool";
import { readNKleinPlanArtifacts } from "../../nklein-agent/nklein-plan-artifacts";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";

/**
 * Resolve a BOARD task id back to its plan-internal task id. Board ids are `<slugify(planSlug)>-<slugify(planTaskId)>`
 * with an optional NUMERIC dedupe suffix (`-2`, `-3`, …) — never arbitrary text.
 *
 * Audit 2026-08-12: the previous inline loop broke on the FIRST `startsWith(`${baseId}-`)` hit, so plan task
 * "storage" wrongly claimed the board id of plan task "storage-migration" (whichever iterated first won). Two passes
 * fix the precedence, mirroring `matchesPlanBoardTaskId` (src/commands/task/task-plan-slug.ts): an EXACT baseId match
 * beats everything; otherwise a prefix match counts ONLY when the remainder after `${baseId}-` is all digits. More
 * than one surviving match (possible because slugification is lossy — "storage migration" and "storage-migration"
 * collide) is AMBIGUOUS and throws rather than guessing. No match returns null (the caller owns that error).
 */
export function resolvePlanTaskIdFromBoardTaskId(
	taskGraphTasks: ReadonlyArray<{ id: string }>,
	planSlug: string,
	boardTaskId: string,
): string | null {
	const slugPrefix = slugifyTaskId(planSlug);
	const exactMatches: string[] = [];
	const dedupeSuffixMatches: string[] = [];
	for (const task of taskGraphTasks) {
		const baseId = `${slugPrefix}-${slugifyTaskId(task.id)}`;
		if (boardTaskId === baseId) {
			exactMatches.push(task.id);
			continue;
		}
		if (boardTaskId.startsWith(`${baseId}-`) && /^\d+$/.test(boardTaskId.slice(baseId.length + 1))) {
			dedupeSuffixMatches.push(task.id);
		}
	}
	const matches = exactMatches.length > 0 ? exactMatches : dedupeSuffixMatches;
	if (matches.length > 1) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message:
				`Board task "${boardTaskId}" matches ${matches.length} plan tasks in plan "${planSlug}" ` +
				`(${matches.join(", ")}). Pass planTaskId explicitly.`,
		});
	}
	return matches[0] ?? null;
}

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

	// Resolve planTaskId: use the caller's explicit value, or infer by scanning the plan's task graph
	// (exact-first, digits-only dedupe suffix, ambiguity throws — see resolvePlanTaskIdFromBoardTaskId).
	let planTaskId = input.planTaskId?.trim() || null;
	if (!planTaskId) {
		const artifacts = await readNKleinPlanArtifacts(workspaceScope.workspacePath, planSlug);
		planTaskId = resolvePlanTaskIdFromBoardTaskId(artifacts.taskGraph.tasks, planSlug, input.taskId);
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
