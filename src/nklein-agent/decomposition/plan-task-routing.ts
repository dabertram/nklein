import type { RuntimeTaskNKleinSettings } from "../../core/api-contract";
import { affinityTagsForSkills } from "../../core/model-task-affinity";
import { resolveActiveSkills } from "../../core/skill-resolver";
import type { NKleinPlanTaskGraphPreview, NKleinPlanTaskSharedContext } from "../nklein-decomposition-tool";
import type { NKleinPlanTask, NKleinPlanTaskGraph } from "../nklein-plan-artifacts";
import { type NKleinTaskRoutingCandidate, routeNKleinTask } from "../nklein-task-router";
import {
	estimateNKleinStartDifficulty,
	estimateNKleinStartFitBudgetTokens,
	estimateNKleinStartPromptTokens,
	formatNKleinTaskRoutingBlockMessage,
} from "../nklein-task-start-guard";
import { buildTaskPrompt } from "./plan-task-prompt";
import { validateNKleinPlanTaskGraph } from "./plan-task-validation";

export function selectTaskRoutingCandidate(
	task: NKleinPlanTask,
	taskPrompt: string,
	routingCandidates: readonly NKleinTaskRoutingCandidate[] | undefined,
): NKleinTaskRoutingCandidate | null | undefined {
	if (!routingCandidates || routingCandidates.length === 0) {
		return undefined;
	}
	const promptTokens = estimateNKleinStartPromptTokens({
		prompt: taskPrompt,
		taskTitle: task.title,
	});
	// §5.AE→§5.AB: resolve the card's skills, then project them onto the same affinity tags a fitting model carries, so a
	// code-editing card prefers a `code` model and a planning card a `reasoning` one (best-fit BEFORE smallest-sufficient).
	const taskAffinityTags = affinityTagsForSkills(
		resolveActiveSkills({ role: task.suggestedRole, taskText: `${task.title}\n${taskPrompt}` }).skills.map(
			(skill) => skill.id,
		),
	);
	const largestContextWindow =
		routingCandidates
			.map((candidate) => candidate.entry.contextWindow.effective ?? 0)
			.filter((contextWindow) => contextWindow > 0)
			.sort((left, right) => right - left)[0] ?? null;
	const preferredModelKey = task.suggestedRole
		? (routingCandidates.find((candidate) => candidate.role === task.suggestedRole)?.entry.key ?? null)
		: null;
	const routingDecision = routeNKleinTask({
		difficulty: Math.max(task.complexity, estimateNKleinStartDifficulty(promptTokens)),
		fitBudgetTokens: estimateNKleinStartFitBudgetTokens(promptTokens, largestContextWindow),
		promptTokens,
		outputTokens: 1_000,
		preferredModelKey,
		candidates: routingCandidates,
		taskAffinityTags,
	});
	if (routingDecision.type === "decompose" || routingDecision.type === "escalate") {
		throw new Error(
			`Task ${task.id} failed the model feasibility guard: ${formatNKleinTaskRoutingBlockMessage(routingDecision)}`,
		);
	}
	return routingCandidates.find((candidate) => candidate.entry.key === routingDecision.modelKey) ?? null;
}

export function resolveTaskRoleSettings(
	task: NKleinPlanTask,
	modelRoleSettings: Record<string, RuntimeTaskNKleinSettings> | undefined,
	selectedRole: string | null | undefined,
): RuntimeTaskNKleinSettings | undefined {
	const role = (selectedRole === undefined ? task.suggestedRole : selectedRole)?.trim();
	if (!role || !modelRoleSettings) {
		return undefined;
	}
	const settings = modelRoleSettings[role];
	if (!settings) {
		return undefined;
	}
	return {
		...(settings.providerId ? { providerId: settings.providerId } : {}),
		...(settings.modelId ? { modelId: settings.modelId } : {}),
		...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
		...(settings.contextScope ? { contextScope: settings.contextScope } : {}),
		...(settings.timeoutMode ? { timeoutMode: settings.timeoutMode } : {}),
		...(settings.requestTimeoutMs !== undefined ? { requestTimeoutMs: settings.requestTimeoutMs } : {}),
		...(settings.streamTimeoutMs !== undefined ? { streamTimeoutMs: settings.streamTimeoutMs } : {}),
		...(settings.toolTimeoutMs !== undefined ? { toolTimeoutMs: settings.toolTimeoutMs } : {}),
		...(settings.agentTimeoutMs !== undefined ? { agentTimeoutMs: settings.agentTimeoutMs } : {}),
		...(settings.conversationTimeoutMs !== undefined
			? { conversationTimeoutMs: settings.conversationTimeoutMs }
			: {}),
	};
}

/**
 * The model settings to PIN on a generated card. When the §5.AB router selected a CONCRETE best-fit candidate — e.g. an
 * auto-discovered LOADED model that has NO configured role — pin THAT model (its runtime id + provider) so the card
 * actually RUNS on the selected model instead of only annotating the fit evidence and falling back to the default. The
 * role's NON-model settings (reasoning effort, context scope, timeouts) are layered on top. With no concrete candidate
 * (`undefined` = unvalidated, `null` = the default local model) it falls back to the role-only settings — prior behavior.
 */
export function resolveTaskModelSettings(
	selectedRoutingCandidate: NKleinTaskRoutingCandidate | null | undefined,
	task: NKleinPlanTask,
	modelRoleSettings: Record<string, RuntimeTaskNKleinSettings> | undefined,
	selectedRole: string | null | undefined,
): RuntimeTaskNKleinSettings | undefined {
	const roleSettings = resolveTaskRoleSettings(task, modelRoleSettings, selectedRole);
	if (!selectedRoutingCandidate) {
		return roleSettings; // no concrete model chosen ⇒ keep role-only behavior
	}
	return {
		providerId: selectedRoutingCandidate.entry.providerId,
		modelId: selectedRoutingCandidate.entry.modelId,
		...(roleSettings?.reasoningEffort ? { reasoningEffort: roleSettings.reasoningEffort } : {}),
		...(roleSettings?.contextScope ? { contextScope: roleSettings.contextScope } : {}),
		...(roleSettings?.timeoutMode ? { timeoutMode: roleSettings.timeoutMode } : {}),
		...(roleSettings?.requestTimeoutMs !== undefined ? { requestTimeoutMs: roleSettings.requestTimeoutMs } : {}),
		...(roleSettings?.streamTimeoutMs !== undefined ? { streamTimeoutMs: roleSettings.streamTimeoutMs } : {}),
		...(roleSettings?.toolTimeoutMs !== undefined ? { toolTimeoutMs: roleSettings.toolTimeoutMs } : {}),
		...(roleSettings?.agentTimeoutMs !== undefined ? { agentTimeoutMs: roleSettings.agentTimeoutMs } : {}),
		...(roleSettings?.conversationTimeoutMs !== undefined
			? { conversationTimeoutMs: roleSettings.conversationTimeoutMs }
			: {}),
	};
}

export function formatTaskModelFitEvidence(candidate: NKleinTaskRoutingCandidate | null | undefined): string {
	if (candidate === undefined) {
		return "not validated before card creation; connected-local-model fit is checked when the card starts";
	}
	if (candidate === null) {
		return "validated by !Klein routing guard with the default local model";
	}
	const contextWindow = candidate.entry.contextWindow.effective;
	const contextWindowText =
		typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0
			? `, context ${contextWindow.toLocaleString()}`
			: "";
	const capability = candidate.entry.capability.effectiveScore;
	const capabilityText =
		typeof capability === "number" && Number.isFinite(capability) ? `, capability ${Math.round(capability)}` : "";
	const roleText = candidate.role ? `, role ${candidate.role}` : "";
	return `validated by !Klein routing guard (${candidate.entry.providerId} / ${candidate.entry.modelId}${roleText}${contextWindowText}${capabilityText})`;
}

export function estimateTaskWallTimeMs(
	candidate: NKleinTaskRoutingCandidate | null | undefined,
	promptTokens: number,
): number | null {
	if (!candidate) {
		return null;
	}
	const speed = candidate.entry.speed;
	const prefillMs = speed.prefillTokensPerSecondEwma ? (promptTokens / speed.prefillTokensPerSecondEwma) * 1000 : null;
	const decodeMs = speed.decodeTokensPerSecondEwma ? (1_000 / speed.decodeTokensPerSecondEwma) * 1000 : null;
	if (prefillMs === null && decodeMs === null) {
		return speed.wallTimeMsEwma;
	}
	return Math.round((prefillMs ?? 0) + (decodeMs ?? 0) + (speed.ttftMsEwma ?? 0));
}

function formatEstimateDuration(ms: number | null): string {
	if (ms === null) {
		return "unknown";
	}
	const minutes = Math.max(1, Math.round(ms / 60_000));
	if (minutes < 60) {
		return `~${minutes} min`;
	}
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return remainingMinutes > 0 ? `~${hours}h ${remainingMinutes}m` : `~${hours}h`;
}

function pluralizeCount(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

export function previewNKleinPlanTaskGraph(input: {
	taskGraph: NKleinPlanTaskGraph;
	routingCandidates?: readonly NKleinTaskRoutingCandidate[];
	sharedContext?: NKleinPlanTaskSharedContext;
}): NKleinPlanTaskGraphPreview {
	const taskGraph = validateNKleinPlanTaskGraph({
		taskGraph: input.taskGraph,
		routingCandidates: input.routingCandidates,
	}).taskGraph;
	const tasks = taskGraph.tasks.map((task) => {
		const taskPrompt = buildTaskPrompt(task, input.sharedContext);
		const promptTokens = estimateNKleinStartPromptTokens({
			prompt: taskPrompt,
			taskTitle: task.title,
		});
		const selectedRoutingCandidate = selectTaskRoutingCandidate(task, taskPrompt, input.routingCandidates);
		const modelLabel = selectedRoutingCandidate
			? `${selectedRoutingCandidate.entry.providerId}/${selectedRoutingCandidate.entry.modelId}`
			: "model selected at start";
		return {
			planTaskId: task.id,
			title: task.title,
			modelLabel,
			estimatedWallTimeMs: estimateTaskWallTimeMs(selectedRoutingCandidate, promptTokens),
		};
	});
	const knownEstimates = tasks
		.map((task) => task.estimatedWallTimeMs)
		.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
	const totalEstimatedWallTimeMs =
		knownEstimates.length === tasks.length ? knownEstimates.reduce((total, value) => total + value, 0) : null;
	const previewLines = tasks
		.slice(0, 6)
		.map((task) => `${task.title}: ${formatEstimateDuration(task.estimatedWallTimeMs)} on ${task.modelLabel}`);
	const extraCount = Math.max(0, tasks.length - previewLines.length);
	return {
		taskCount: tasks.length,
		totalEstimatedWallTimeMs,
		tasks,
		summary: [
			`${formatEstimateDuration(totalEstimatedWallTimeMs)} across ${pluralizeCount(tasks.length, "card")}`,
			...previewLines,
			...(extraCount > 0 ? [`+${extraCount} more ${extraCount === 1 ? "card" : "cards"}`] : []),
		].join("\n"),
	};
}
