import { withAutonomousNKleinTimeoutSettings } from "../core/autonomous-timeout-defaults";
import type { RuntimeBoardData } from "../core/board-api-contract";
import type { RuntimeModelRoles, RuntimeTaskNKleinSettings } from "../core/runtime-config-api-contract";

/**
 * Pure dev-test board fixtures extracted from projects-api: the deterministic seed task id and the
 * single-card decomposition board that a `dev test-project` run starts from. No I/O, so both are
 * behavior-preserving relative to their inline definitions.
 */

/** Deterministic, path-safe seed task id for a dev-test scenario: `dev-<slug>-decompose` (blank → `dev-test-decompose`). */
export function buildDevTestTaskId(scenarioId: string): string {
	const normalizedScenarioId = scenarioId
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `dev-${normalizedScenarioId || "test"}-decompose`;
}

/**
 * Build the seed board for a dev-test decomposition run: a single NKlein plan-mode card in Backlog
 * (the rest of the columns empty, no dependencies). The card's NKlein settings come from the
 * architect role when configured, else the first role carrying a provider/model, wrapped in the
 * autonomous timeout defaults.
 */
export function createDevTestBoard(input: {
	taskId: string;
	title: string;
	prompt: string;
	acceptanceCommand: string;
	modelRoles?: RuntimeModelRoles;
	/** OS power-mode multiplier for the autonomous timeout defaults (≥1; Low Power ≈ 2). Defaults to 1 (no scaling). */
	powerMultiplier?: number;
	now: number;
}): RuntimeBoardData {
	const architectSettings = input.modelRoles?.architect;
	const firstRoleSettings = Object.values(input.modelRoles ?? {}).find(
		(settings): settings is RuntimeTaskNKleinSettings => Boolean(settings.providerId || settings.modelId),
	);
	const nkleinSettings = withAutonomousNKleinTimeoutSettings(architectSettings ?? firstRoleSettings, {
		powerMultiplier: input.powerMultiplier,
	});
	const card = {
		id: input.taskId,
		title: `Decompose ${input.title}`,
		prompt: input.prompt.trim(),
		startInPlanMode: true,
		autoReviewEnabled: true,
		agentId: "nklein" as const,
		nkleinSettings,
		baseRef: "main",
		createdAt: input.now,
		updatedAt: input.now,
	};
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [card] },
			{ id: "planning", title: "Planning", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "completed", title: "Completed", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}
