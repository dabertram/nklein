import { renderCardContractBrief } from "../card-contract-brief";
import type { NKleinPlanTaskSharedContext } from "../nklein-decomposition-tool";
import { resolveNKleinGuidanceSkillCommand, resolveNKleinGuidanceSkillTopic } from "../nklein-guidance-skills";
import type { NKleinPlanTask } from "../nklein-plan-artifacts";
import { MAX_SHARED_PLAN_DECISIONS_PROMPT_CHARS, MAX_SHARED_PLAN_SPEC_PROMPT_CHARS } from "./plan-task-schemas";

export function truncateSharedContext(value: string, maxChars: number): string {
	const trimmed = value.trim();
	if (trimmed.length <= maxChars) {
		return trimmed;
	}
	return `${trimmed.slice(0, maxChars).trimEnd()}\n[truncated]`;
}

export function formatSharedPlanContext(context: NKleinPlanTaskSharedContext | undefined): string | null {
	const sections: string[] = [];
	if (context?.spec?.trim()) {
		sections.push(`Shared spec:\n${truncateSharedContext(context.spec, MAX_SHARED_PLAN_SPEC_PROMPT_CHARS)}`);
	}
	if (context?.decisionsMarkdown?.trim()) {
		sections.push(
			`Shared decisions:\n${truncateSharedContext(
				context.decisionsMarkdown,
				MAX_SHARED_PLAN_DECISIONS_PROMPT_CHARS,
			)}`,
		);
	}
	if (sections.length === 0) {
		return null;
	}
	return sections.join("\n\n");
}

export function buildTaskPrompt(
	task: NKleinPlanTask,
	sharedContext?: NKleinPlanTaskSharedContext,
	modelFitEvidence?: string | null,
): string {
	const sections = [task.prompt.trim()];
	sections.push(
		"Leaf scope: complete only this card's explicit objective. Treat shared spec and decisions as context, not permission to implement dependent or downstream cards early.",
	);
	sections.push(
		"Execution pace: read only the files needed for this card once, then make the smallest correct edit and run the acceptance check. To change an existing file, prefer the edit_file tool with a small search/replace block over rewriting the whole file. Do not repeatedly re-read unchanged files or write a chat-only plan instead of acting.",
	);
	const guidanceTopic = resolveNKleinGuidanceSkillTopic({
		title: task.title,
		prompt: task.prompt,
		filesLikelyTouched: task.filesLikelyTouched,
	});
	if (guidanceTopic) {
		sections.unshift(`/${resolveNKleinGuidanceSkillCommand(guidanceTopic)}\n\nGuidance topic: ${guidanceTopic}`);
	}
	// §5.AK/§5.B: consume the card's explicit contract node-locally — the worker executes against stated
	// preconditions/inputs/outputs/acceptance/non-goals/coupling instead of re-deriving them. Empty ⇒ nothing added.
	const contractBrief = renderCardContractBrief(task);
	if (contractBrief) {
		sections.push(contractBrief);
	}
	const sharedPlanContext = formatSharedPlanContext(sharedContext);
	if (sharedPlanContext) {
		sections.push(sharedPlanContext);
	}
	if (task.filesLikelyTouched.length > 0) {
		sections.push(["Likely files:", ...task.filesLikelyTouched.map((path) => `- ${path}`)].join("\n"));
	}
	if (task.acceptanceCommand) {
		sections.push(`Acceptance check: ${task.acceptanceCommand}`);
	}
	if (task.testFirst) {
		const testInstructions = ["Test-first: write or update the acceptance test before implementation."];
		if (task.acceptanceTestPrompt?.trim()) {
			testInstructions.push(task.acceptanceTestPrompt.trim());
		}
		sections.push(testInstructions.join("\n"));
	}
	sections.push(`Complexity: ${Math.round(task.complexity)}/100`);
	if (task.knowledgeDebt?.trim()) {
		sections.push(
			`Knowledge debt (what this card may not fully know yet — verify before relying on it): ${task.knowledgeDebt.trim()}`,
		);
	}
	if (task.suggestedRole) {
		sections.push(`Suggested role: ${task.suggestedRole}`);
	}
	if (modelFitEvidence?.trim()) {
		sections.push(`Model fit: ${modelFitEvidence.trim()}`);
	}
	return sections.join("\n\n");
}
