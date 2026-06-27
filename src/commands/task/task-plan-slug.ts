import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readNKleinPlanArtifacts } from "../../nklein-agent/nklein-plan-artifacts";
import { slugifyPlanTaskId } from "./task-command-parsers.js";

/**
 * Infer which saved plan a board task came from (§5.U-extracted from task.ts): a decomposition seeds card ids as
 * `<plan-slug>-<plan-task-id>[-N]`, so scan the workspace's plan artifacts for the slug whose task graph contains a
 * matching task. Returns the slug only on an unambiguous match (a single exact match, else a single fuzzy match);
 * `null` when there is no match or it is ambiguous.
 */

function matchesPlanBoardTaskId(input: { taskId: string; planSlug: string; planTaskId: string }): {
	matches: boolean;
	exact: boolean;
} {
	const baseTaskId = `${slugifyPlanTaskId(input.planSlug)}-${slugifyPlanTaskId(input.planTaskId)}`;
	if (input.taskId === baseTaskId) {
		return { matches: true, exact: true };
	}
	if (!input.taskId.startsWith(`${baseTaskId}-`)) {
		return { matches: false, exact: false };
	}
	return {
		matches: /^\d+$/.test(input.taskId.slice(baseTaskId.length + 1)),
		exact: false,
	};
}

export async function inferNKleinPlanSlugForTask(input: {
	workspacePath: string;
	taskId: string;
}): Promise<string | null> {
	const plansRoot = join(input.workspacePath, ".nklein", "nklein", "plans");
	const entries = await readdir(plansRoot, { withFileTypes: true }).catch(() => []);
	const matches: { slug: string; exact: boolean }[] = [];
	for (const entry of entries
		.filter((candidate) => candidate.isDirectory())
		.sort((left, right) => left.name.localeCompare(right.name))) {
		const artifacts = await readNKleinPlanArtifacts(input.workspacePath, entry.name).catch(() => null);
		if (!artifacts) {
			continue;
		}
		for (const task of artifacts.taskGraph.tasks) {
			const match = matchesPlanBoardTaskId({
				taskId: input.taskId,
				planSlug: artifacts.taskGraph.slug,
				planTaskId: task.id,
			});
			if (match.matches) {
				matches.push({ slug: artifacts.taskGraph.slug, exact: match.exact });
			}
		}
	}
	const exactMatches = matches.filter((match) => match.exact);
	if (exactMatches.length === 1) {
		return exactMatches[0].slug;
	}
	if (exactMatches.length > 1) {
		return null;
	}
	return matches.length === 1 ? matches[0].slug : null;
}
