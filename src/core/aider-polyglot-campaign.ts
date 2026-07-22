import { decideDefaultFlip, type FlipDecision, type PairedOutcome } from "./ab-significance-gate";
import type { AiderPolyglotManifest } from "./aider-polyglot-benchmark";
import { assessPreRegistration, type PreRegistrationAssessment } from "./minimum-detectable-effect";
import type { BenchmarkAttemptStatus } from "./swebench-benchmark";

export type AiderCampaignArm = "plan" | "no_plan";

export interface AiderCampaignAssignment {
	instanceId: string;
	modelId: string;
	modelNameOrPath: string;
}

export interface AiderCampaignConfig {
	schemaVersion: 1;
	campaignId: string;
	repeats: number;
	declaredMdePoints: number;
	assignments: readonly AiderCampaignAssignment[];
}

export interface AiderCampaignAttempt {
	instanceId: string;
	modelId: string;
	modelNameOrPath: string;
	repeat: number;
	arm: AiderCampaignArm;
	runId: string;
	startInPlanMode: boolean;
}

export interface AiderCampaignAttemptResult extends AiderCampaignAttempt {
	status: BenchmarkAttemptStatus;
	workflowOutcome: string | null;
	patchBytes: number | null;
	durationMs: number | null;
}

export interface AiderCampaignSummary {
	schemaVersion: 1;
	campaignId: string;
	plannedAttempts: number;
	completedAttempts: number;
	infrastructureErrors: number;
	pairedOutcomes: number;
	preRegistration: PreRegistrationAssessment;
	decision: FlipDecision;
	results: readonly AiderCampaignAttemptResult[];
}

function parseNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
	return value.trim();
}

/** Validate the pre-registered, fixed-model campaign before the first candidate token is generated. */
export function parseAiderCampaignConfig(value: unknown, manifest: AiderPolyglotManifest): AiderCampaignConfig {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Aider campaign config must be an object.");
	}
	const raw = value as Record<string, unknown>;
	if (raw.schemaVersion !== 1) throw new Error("Aider campaign config must use schemaVersion 1.");
	const campaignId = parseNonEmptyString(raw.campaignId, "campaignId");
	if (!/^[A-Za-z0-9_.-]+$/u.test(campaignId)) {
		throw new Error("campaignId may contain only letters, digits, dot, underscore, or hyphen.");
	}
	if (!Number.isInteger(raw.repeats) || (raw.repeats as number) < 2) {
		throw new Error("repeats must be an integer of at least 2.");
	}
	if (typeof raw.declaredMdePoints !== "number" || raw.declaredMdePoints <= 0 || raw.declaredMdePoints > 100) {
		throw new Error("declaredMdePoints must be in (0, 100].");
	}
	if (!Array.isArray(raw.assignments) || raw.assignments.length === 0) {
		throw new Error("assignments must be a non-empty array.");
	}
	const available = new Set(manifest.tasks.map((task) => task.instanceId));
	const seen = new Set<string>();
	const assignments = raw.assignments.map((entry, index) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			throw new Error(`assignments[${index}] must be an object.`);
		}
		const assignment = entry as Record<string, unknown>;
		const instanceId = parseNonEmptyString(assignment.instanceId, `assignments[${index}].instanceId`);
		if (!available.has(instanceId)) throw new Error(`${instanceId} is not present in the pinned manifest.`);
		if (seen.has(instanceId)) throw new Error(`Duplicate campaign assignment for ${instanceId}.`);
		seen.add(instanceId);
		return {
			instanceId,
			modelId: parseNonEmptyString(assignment.modelId, `assignments[${index}].modelId`),
			modelNameOrPath: parseNonEmptyString(assignment.modelNameOrPath, `assignments[${index}].modelNameOrPath`),
		};
	});
	const config = {
		schemaVersion: 1 as const,
		campaignId,
		repeats: raw.repeats as number,
		declaredMdePoints: raw.declaredMdePoints,
		assignments,
	};
	const preRegistration = assessPreRegistration({
		declaredMdePoints: config.declaredMdePoints,
		design: { taskCount: assignments.length, repeats: config.repeats, paired: true },
	});
	if (preRegistration.verdict !== "adequately_powered") throw new Error(preRegistration.reason);
	return config;
}

/** Plan matched pairs sequentially and alternate pair order to cancel first-arm/cache/thermal bias. */
export function planAiderCampaign(config: AiderCampaignConfig): readonly AiderCampaignAttempt[] {
	const attempts: AiderCampaignAttempt[] = [];
	for (let repeat = 1; repeat <= config.repeats; repeat += 1) {
		for (const [index, assignment] of config.assignments.entries()) {
			const planFirst = (repeat + index) % 2 === 1;
			for (const arm of planFirst ? (["plan", "no_plan"] as const) : (["no_plan", "plan"] as const)) {
				attempts.push({
					...assignment,
					repeat,
					arm,
					runId: `${config.campaignId}-${assignment.instanceId}-r${repeat}-${arm.replace("_", "-")}`,
					startInPlanMode: arm === "plan",
				});
			}
		}
	}
	return attempts;
}

export function summarizeAiderCampaign(
	config: AiderCampaignConfig,
	results: readonly AiderCampaignAttemptResult[],
): AiderCampaignSummary {
	const planned = planAiderCampaign(config);
	const byPair = new Map<string, Partial<Record<AiderCampaignArm, AiderCampaignAttemptResult>>>();
	for (const result of results) {
		const key = `${result.instanceId}\0${result.repeat}`;
		const pair = byPair.get(key) ?? {};
		pair[result.arm] = result;
		byPair.set(key, pair);
	}
	const outcomes: PairedOutcome[] = [];
	for (const pair of byPair.values()) {
		if (!pair.plan || !pair.no_plan || pair.plan.status === "error" || pair.no_plan.status === "error") continue;
		outcomes.push({ a: pair.plan.status === "resolved", b: pair.no_plan.status === "resolved" });
	}
	const preRegistration = assessPreRegistration({
		declaredMdePoints: config.declaredMdePoints,
		design: { taskCount: config.assignments.length, repeats: config.repeats, paired: true },
	});
	return {
		schemaVersion: 1,
		campaignId: config.campaignId,
		plannedAttempts: planned.length,
		completedAttempts: results.length,
		infrastructureErrors: results.filter((result) => result.status === "error").length,
		pairedOutcomes: outcomes.length,
		preRegistration,
		decision: decideDefaultFlip({ pairs: outcomes, minEffect: config.declaredMdePoints / 100 }),
		results: [...results],
	};
}
