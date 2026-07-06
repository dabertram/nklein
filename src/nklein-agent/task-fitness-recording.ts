/**
 * §5.AB write side — derive a fitness record (the model × role × difficulty CELL + the attempt OUTCOME) from a finished
 * task's session summary + its card. Pure + total: the runtime calls this at the task-outcome seam (beside
 * `recordModelPerformanceObservation`) and, when it returns a record, folds it into the store via
 * `recordTaskFitnessOutcome`. Only TERMINAL, model-attributable, non-synthetic sessions produce a record.
 *
 * Difficulty note: `estimateTaskDifficulty` gets the reliably-available card text here; richer inputs (expected file
 * count, acceptance shape, bounce count) are left at their safe defaults, so the tier is a COARSE-but-honest signal —
 * threading the card's full context would sharpen it (a follow-up).
 */
import type { RuntimeBoardCard, RuntimeTaskSessionSummary } from "../core/api-contract";
import type { FitnessKey, FitnessOutcome } from "../core/fitness-table-schema";
import { estimateTaskDifficulty } from "../core/task-difficulty-estimate";
import { buildNKleinModelRegistryKey } from "./nklein-model-registry-key";
import { resolveNKleinTaskRole } from "./nklein-task-session-helpers";

export interface TaskFitnessRecord {
	key: FitnessKey;
	outcome: FitnessOutcome;
}

/**
 * Map a finished session to a fitness cell + outcome, or null when it shouldn't be recorded: a synthetic session
 * (`taskId` contains `::`), a session with no model coordinates, or a non-terminal / unclassifiable state. `awaiting_review`
 * counts as a success (the work reached review); `failed` as a failure; everything else is skipped.
 */
export function deriveTaskFitnessRecord(input: {
	summary: RuntimeTaskSessionSummary;
	card: RuntimeBoardCard | null;
}): TaskFitnessRecord | null {
	const { summary, card } = input;
	if (summary.taskId.includes("::")) {
		return null; // synthetic (::review / ::plan-critique / ::acceptance)
	}
	if (!summary.providerId && !summary.modelId) {
		return null; // no model to attribute the outcome to
	}
	const success = summary.state === "awaiting_review";
	const failure = summary.state === "failed";
	if (!success && !failure) {
		return null; // running / queued / interrupted / idle — not a classifiable terminal outcome
	}

	const modelKey = buildNKleinModelRegistryKey({
		providerId: summary.providerId ?? "",
		// §5.BG: the fitness table + model-behavior STORE are DISPLAY/inert streams — NOT read for routing (routing reads
		// the ledger projection, keyed by the runtime id, which stays runtime until its own coordinated flip). So keying
		// fitness off the STABLE publisher key is self-contained + safe: a renamed LM Studio instance's fitness cells stay
		// MERGED instead of fragmenting. Falls back to the runtime id for cloud / not-loaded / legacy summaries.
		modelId: summary.modelKey ?? summary.modelId ?? "",
		endpoint: summary.endpoint,
	});
	const role = resolveNKleinTaskRole(summary.taskId, card?.generatedFromPlan?.artifactKind === "decomposition");
	const objectiveText = card?.title?.trim() ?? "";
	const difficultyTier = estimateTaskDifficulty({
		objectiveText: objectiveText.length > 0 ? objectiveText : summary.taskId,
		expectedFileCount: 0,
		hasAcceptanceTests: false,
		bounceCount: 0,
	}).tier;

	const wallTimeMs =
		typeof summary.startedAt === "number" &&
		typeof summary.updatedAt === "number" &&
		summary.updatedAt >= summary.startedAt
			? summary.updatedAt - summary.startedAt
			: null;

	return {
		key: { modelKey, role, difficultyTier },
		outcome: { success, wallTimeMs, ...(failure ? { failureMode: "task_failed" } : {}) },
	};
}
