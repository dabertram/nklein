/**
 * Trajectory-quality projection (F12.42 mount) — project the F12.42 process signals off the PERSISTED agent ledger and
 * score each attempt. The attempt event already carries the ordered `toolCalls` (each with a `name`), `retriesBefore`, and
 * a terminal `outcome`, so the Ideal/Solid/Lucky scorer can run over real history with no new recording seam.
 *
 * Two of the four signals are EXACT from the ledger (steps-before-first-edit from the ordered calls; retry count from
 * `retriesBefore`; pass/fail from `outcome === "success"`). The other two are HONEST APPROXIMATIONS because the ledger does
 * not store patch SIZE: opening-patch intensity is proxied by how many edits are crammed into the first third of the
 * trajectory, and validation-effort share by the fraction of calls that are validation actions (with `run_command` treated
 * as validation, its dominant use in the acceptance loop). Pure — the caller supplies the ledger events.
 */

import type { AgentLedgerEvent } from "./agent-attempt-ledger";
import {
	scoreTrajectoryQuality,
	summarizeTrajectoryQuality,
	type TrajectoryQualityScore,
	type TrajectoryQualitySummary,
	type TrajectorySignals,
} from "./trajectory-quality-score";

export type ToolAction = "edit" | "validation" | "read" | "other";

// Whole-TOKEN keyword sets (the name is split on non-alphanumerics). Token matching avoids substring false positives —
// "review" must not read as "view", "read_files" must still match "read" despite the underscore.
const EDIT_TOKENS = new Set([
	"write",
	"edit",
	"edits",
	"patch",
	"apply",
	"replace",
	"str",
	"create",
	"delete",
	"insert",
	"mkdir",
	"rename",
	"move",
]);
const VALIDATION_TOKENS = new Set([
	"test",
	"tests",
	"lint",
	"typecheck",
	"tsc",
	"compile",
	"build",
	"check",
	"verify",
	"command",
	"exec",
	"shell",
	"pytest",
]);
const READ_TOKENS = new Set([
	"read",
	"reads",
	"list",
	"ls",
	"grep",
	"search",
	"find",
	"repo",
	"map",
	"glob",
	"cat",
	"view",
	"explore",
	"open",
]);

/**
 * Classify a tool call by its name into an edit / validation / read / other action, matching whole tokens (split on
 * non-alphanumerics) so a substring like "view" in "submit_review" never misfires. Priority: edit → validation → read →
 * other (a "check" token in an edit-and-check tool must not shadow the edit). `run_command` is treated as validation — the
 * acceptance/test loop is its dominant use — which the projection documents as an approximation.
 */
export function classifyToolAction(name: string): ToolAction {
	const tokens = name
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	if (tokens.some((t) => EDIT_TOKENS.has(t))) {
		return "edit";
	}
	if (tokens.some((t) => VALIDATION_TOKENS.has(t))) {
		return "validation";
	}
	if (tokens.some((t) => READ_TOKENS.has(t))) {
		return "read";
	}
	return "other";
}

/** The subset of an "attempt" ledger event this projection needs. */
export interface AttemptTrajectoryInput {
	readonly toolCalls: readonly { readonly name: string }[];
	readonly retriesBefore: number;
	readonly outcome: string;
}

/**
 * Project the F12.42 trajectory signals from one attempt's ledger record. Steps-before-first-edit, retry count and pass/fail
 * are exact; opening-patch intensity (edits in the first third / total edits) and validation share are ledger-available
 * proxies. An attempt that never edited gets `stepsBeforeFirstEdit = totalSteps` (all investigation, no leap).
 */
export function projectTrajectorySignals(attempt: AttemptTrajectoryInput): TrajectorySignals {
	const actions = attempt.toolCalls.map((c) => classifyToolAction(c.name));
	const totalSteps = actions.length;
	const editIndexes = actions.map((a, i) => (a === "edit" ? i : -1)).filter((i) => i >= 0);
	const totalEdits = editIndexes.length;
	const validationCount = actions.filter((a) => a === "validation").length;

	const stepsBeforeFirstEdit = totalEdits > 0 ? (editIndexes[0] ?? 0) : totalSteps;
	const firstThird = Math.max(1, Math.ceil(totalSteps / 3));
	const editsInFirstThird = editIndexes.filter((i) => i < firstThird).length;
	const openingPatchIntensity = totalEdits > 0 ? editsInFirstThird / totalEdits : 0;
	const validationEffortShare = totalSteps > 0 ? validationCount / totalSteps : 0;

	return {
		passed: attempt.outcome === "success",
		stepsBeforeFirstEdit,
		openingPatchIntensity,
		validationEffortShare,
		retryCount: Math.max(0, attempt.retriesBefore),
		totalSteps,
	};
}

export interface ModelTrajectoryQuality {
	readonly modelId: string;
	readonly summary: TrajectoryQualitySummary;
}

export interface LedgerTrajectoryQuality {
	readonly overall: TrajectoryQualitySummary;
	/** Per-model rollups, most attempts first. */
	readonly perModel: readonly ModelTrajectoryQuality[];
	/** Every scored attempt (for a detailed drill-down). */
	readonly scores: readonly (TrajectoryQualityScore & { readonly modelId: string })[];
}

/**
 * Score every attempt in the ledger and roll the results up overall and per model. The per-model `luckyWinRate` is the
 * headline: a model with a strong resolve rate but many lucky (brittle) wins is over-credited by pass/fail alone.
 */
export function summarizeTrajectoryQualityFromLedger(events: readonly AgentLedgerEvent[]): LedgerTrajectoryQuality {
	const scores: (TrajectoryQualityScore & { modelId: string })[] = [];
	const byModel = new Map<string, TrajectoryQualityScore[]>();

	for (const event of events) {
		if (event.kind !== "attempt") {
			continue;
		}
		const signals = projectTrajectorySignals(event);
		const score = scoreTrajectoryQuality(signals);
		scores.push({ ...score, modelId: event.modelId });
		const bucket = byModel.get(event.modelId);
		if (bucket) {
			bucket.push(score);
		} else {
			byModel.set(event.modelId, [score]);
		}
	}

	const perModel = [...byModel.entries()]
		.map(([modelId, modelScores]) => ({ modelId, summary: summarizeTrajectoryQuality(modelScores) }))
		.sort((a, b) => b.summary.total - a.summary.total);

	return { overall: summarizeTrajectoryQuality(scores), perModel, scores };
}
