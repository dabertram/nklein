import { decideDefaultFlip, type FlipDecision, type PairedOutcome } from "./ab-significance-gate";
import type { AiderPolyglotManifest } from "./aider-polyglot-benchmark";
import { assessPreRegistration, type PreRegistrationAssessment } from "./minimum-detectable-effect";
import { type RuntimeBuildIdentity, runtimeBuildIdentitySchema } from "./runtime-build-identity";
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

export interface AiderCampaignHarnessBaseline {
	schemaVersion: 1;
	runnerGitCommit: string;
	runtimeBuildIdentity: RuntimeBuildIdentity;
	runner: "scripts/run-aider-campaign.mts";
	createdAt: string;
}

export type AiderRegressionInstanceStatus = "resolved" | "unresolved" | "quarantined" | "infrastructure";

export interface AiderRegressionAttemptEvidence {
	repeat: number;
	status: BenchmarkAttemptStatus;
}

export interface AiderRegressionSnapshotRow {
	instanceId: string;
	status: AiderRegressionInstanceStatus;
	attempts: readonly AiderRegressionAttemptEvidence[];
}

export interface AiderRegressionSnapshot {
	schemaVersion: 1;
	campaignId: string;
	arm: AiderCampaignArm;
	repeats: number;
	rows: readonly AiderRegressionSnapshotRow[];
}

export interface AiderRegressionGateResult {
	outcome: "pass" | "fail" | "inconclusive";
	baselineCampaignId: string;
	currentCampaignId: string;
	arm: AiderCampaignArm;
	baselineResolved: number;
	regressions: readonly string[];
	inconclusive: readonly string[];
	reason: string;
}

function parseNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
	return value.trim();
}

/** Parse the immutable code identity written before a campaign creates its first workspace. */
export function parseAiderCampaignHarnessBaseline(value: unknown): AiderCampaignHarnessBaseline {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Aider campaign harness baseline must be an object.");
	}
	const raw = value as Record<string, unknown>;
	if (raw.schemaVersion !== 1) throw new Error("Aider campaign harness baseline must use schemaVersion 1.");
	const runnerGitCommit = parseNonEmptyString(raw.runnerGitCommit, "runnerGitCommit");
	if (!/^[0-9a-f]{40}$/u.test(runnerGitCommit)) {
		throw new Error("runnerGitCommit must be a full lowercase Git SHA-1.");
	}
	const runtimeBuildIdentity = runtimeBuildIdentitySchema.parse(raw.runtimeBuildIdentity);
	if (raw.runner !== "scripts/run-aider-campaign.mts") {
		throw new Error("Aider campaign harness baseline names an unexpected runner.");
	}
	const createdAt = parseNonEmptyString(raw.createdAt, "createdAt");
	if (!Number.isFinite(Date.parse(createdAt))) throw new Error("createdAt must be an ISO timestamp.");
	return { schemaVersion: 1, runnerGitCommit, runtimeBuildIdentity, runner: raw.runner, createdAt };
}

/** Refuse evidence unless runner and the already-running runtime are the same clean source commit. */
export function assertAiderCampaignCodeIdentity(
	runnerGitCommit: string,
	runtimeBuildIdentity: RuntimeBuildIdentity,
): void {
	if (runtimeBuildIdentity.gitCommit === null || runtimeBuildIdentity.gitDirty === null) {
		throw new Error("Runtime build identity is unavailable; launch the benchmark runtime from a Git checkout.");
	}
	if (runtimeBuildIdentity.gitDirty) {
		throw new Error("Runtime started from a dirty worktree; restart it from the campaign runner's clean commit.");
	}
	if (runtimeBuildIdentity.gitCommit !== runnerGitCommit) {
		throw new Error(
			`Runtime commit ${runtimeBuildIdentity.gitCommit} differs from runner commit ${runnerGitCommit}; restart the runtime.`,
		);
	}
}

/** Refuse to resume evidence under different orchestration or runtime code. */
export function assertAiderCampaignHarnessCommit(
	baseline: AiderCampaignHarnessBaseline,
	currentRunnerCommit: string,
	currentRuntimeIdentity: RuntimeBuildIdentity,
): void {
	assertAiderCampaignCodeIdentity(currentRunnerCommit, currentRuntimeIdentity);
	if (baseline.runnerGitCommit !== currentRunnerCommit) {
		throw new Error(
			`Campaign harness commit changed from ${baseline.runnerGitCommit} to ${currentRunnerCommit}; use a new campaign id/output root.`,
		);
	}
	if (
		baseline.runtimeBuildIdentity.gitCommit !== currentRuntimeIdentity.gitCommit ||
		baseline.runtimeBuildIdentity.gitDirty !== currentRuntimeIdentity.gitDirty ||
		baseline.runtimeBuildIdentity.capturedAt !== currentRuntimeIdentity.capturedAt
	) {
		throw new Error(
			"Runtime process identity changed after campaign execution began; use a new campaign id/output root.",
		);
	}
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

/** Select the first complete matched pair as a preflight gate before a long immutable campaign is resumed in full. */
export function selectAiderCampaignPilotAttempts(
	attempts: readonly AiderCampaignAttempt[],
): readonly AiderCampaignAttempt[] {
	const first = attempts[0];
	if (!first) throw new Error("Aider campaign pilot requires at least one planned attempt.");
	const pair = attempts.filter(
		(attempt) => attempt.instanceId === first.instanceId && attempt.repeat === first.repeat,
	);
	if (pair.length !== 2 || new Set(pair.map((attempt) => attempt.arm)).size !== 2) {
		throw new Error("Aider campaign pilot could not identify one complete matched plan/no-plan pair.");
	}
	return pair;
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

/**
 * Collapse repeated candidate attempts into the stable per-instance status a nightly delta gate needs.
 * Mixed model outcomes are quarantined; missing/error attempts remain infrastructure-inconclusive and never become a
 * false product regression.
 */
export function buildAiderRegressionSnapshot(
	config: AiderCampaignConfig,
	results: readonly AiderCampaignAttemptResult[],
	arm: AiderCampaignArm,
): AiderRegressionSnapshot {
	const rows = config.assignments.map(({ instanceId }) => {
		const attempts: AiderRegressionAttemptEvidence[] = results
			.filter((result) => result.instanceId === instanceId && result.arm === arm)
			.sort((left, right) => left.repeat - right.repeat)
			.map(({ repeat, status }) => ({ repeat, status }));
		return { instanceId, status: classifyAiderRegressionAttempts(attempts, config.repeats), attempts };
	});
	return { schemaVersion: 1, campaignId: config.campaignId, arm, repeats: config.repeats, rows };
}

function classifyAiderRegressionAttempts(
	attempts: readonly AiderRegressionAttemptEvidence[],
	repeats: number,
): AiderRegressionInstanceStatus {
	const repeatNumbers = new Set(attempts.map((attempt) => attempt.repeat));
	if (
		attempts.length !== repeats ||
		repeatNumbers.size !== repeats ||
		attempts.some((attempt) => attempt.repeat < 1 || attempt.repeat > repeats || attempt.status === "error")
	) {
		return "infrastructure";
	}
	const stable = new Set(attempts.map((attempt) => attempt.status));
	if (stable.size !== 1) return "quarantined";
	const status = attempts[0]?.status;
	return status === "resolved" || status === "unresolved" ? status : "infrastructure";
}

export function parseAiderRegressionSnapshot(value: unknown): AiderRegressionSnapshot {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Aider regression snapshot must be an object.");
	}
	const raw = value as Record<string, unknown>;
	if (raw.schemaVersion !== 1) throw new Error("Aider regression snapshot must use schemaVersion 1.");
	const campaignId = parseNonEmptyString(raw.campaignId, "campaignId");
	if (raw.arm !== "plan" && raw.arm !== "no_plan") throw new Error("Aider regression snapshot arm is invalid.");
	if (!Number.isInteger(raw.repeats) || (raw.repeats as number) < 2) {
		throw new Error("Aider regression snapshot repeats must be at least 2.");
	}
	if (!Array.isArray(raw.rows) || raw.rows.length === 0) throw new Error("Aider regression snapshot rows are empty.");
	const seen = new Set<string>();
	const validStatuses = new Set<AiderRegressionInstanceStatus>([
		"resolved",
		"unresolved",
		"quarantined",
		"infrastructure",
	]);
	const validAttemptStatuses = new Set<BenchmarkAttemptStatus>(["resolved", "unresolved", "error"]);
	const rows = raw.rows.map((entry, index) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			throw new Error(`rows[${index}] must be an object.`);
		}
		const row = entry as Record<string, unknown>;
		const instanceId = parseNonEmptyString(row.instanceId, `rows[${index}].instanceId`);
		if (seen.has(instanceId)) throw new Error(`Duplicate regression row for ${instanceId}.`);
		seen.add(instanceId);
		if (!validStatuses.has(row.status as AiderRegressionInstanceStatus)) {
			throw new Error(`rows[${index}].status is invalid.`);
		}
		if (!Array.isArray(row.attempts)) throw new Error(`rows[${index}].attempts is invalid.`);
		const attempts = row.attempts.map((attempt, attemptIndex) => {
			if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) {
				throw new Error(`rows[${index}].attempts[${attemptIndex}] must be an object.`);
			}
			const evidence = attempt as Record<string, unknown>;
			if (!Number.isInteger(evidence.repeat) || (evidence.repeat as number) < 1) {
				throw new Error(`rows[${index}].attempts[${attemptIndex}].repeat is invalid.`);
			}
			if (!validAttemptStatuses.has(evidence.status as BenchmarkAttemptStatus)) {
				throw new Error(`rows[${index}].attempts[${attemptIndex}].status is invalid.`);
			}
			return { repeat: evidence.repeat as number, status: evidence.status as BenchmarkAttemptStatus };
		});
		const classified = classifyAiderRegressionAttempts(attempts, raw.repeats as number);
		if (classified !== row.status) {
			throw new Error(`rows[${index}].status does not match its repeat evidence.`);
		}
		return {
			instanceId,
			status: row.status as AiderRegressionInstanceStatus,
			attempts,
		};
	});
	return { schemaVersion: 1, campaignId, arm: raw.arm, repeats: raw.repeats as number, rows };
}

/** Only a stable resolved→stable unresolved change fails. Missing, errored, or unstable evidence is inconclusive. */
export function evaluateAiderRegressionGate(
	baseline: AiderRegressionSnapshot,
	current: AiderRegressionSnapshot,
): AiderRegressionGateResult {
	if (baseline.arm !== current.arm) throw new Error("Aider regression snapshots must use the same arm.");
	if (baseline.repeats !== current.repeats) {
		throw new Error("Aider regression snapshots must use the same repeat count.");
	}
	const currentById = new Map(current.rows.map((row) => [row.instanceId, row]));
	const baselineResolvedRows = baseline.rows.filter((row) => row.status === "resolved");
	const regressions: string[] = [];
	const inconclusive: string[] = [];
	for (const baselineRow of baselineResolvedRows) {
		const currentRow = currentById.get(baselineRow.instanceId);
		if (currentRow?.status === "unresolved") regressions.push(baselineRow.instanceId);
		else if (!currentRow || currentRow.status === "quarantined" || currentRow.status === "infrastructure") {
			inconclusive.push(baselineRow.instanceId);
		}
	}
	const outcome =
		regressions.length > 0
			? "fail"
			: baselineResolvedRows.length === 0 || inconclusive.length > 0
				? "inconclusive"
				: "pass";
	const reason =
		outcome === "fail"
			? `${regressions.length} stable resolved instance(s) regressed to stable unresolved.`
			: outcome === "inconclusive"
				? baselineResolvedRows.length === 0
					? "Baseline has no stable resolved instances; there is no regression gradient."
					: `${inconclusive.length} baseline-resolved instance(s) lack stable current product evidence.`
				: `${baselineResolvedRows.length} baseline-resolved instance(s) remain resolved.`;
	return {
		outcome,
		baselineCampaignId: baseline.campaignId,
		currentCampaignId: current.campaignId,
		arm: baseline.arm,
		baselineResolved: baselineResolvedRows.length,
		regressions,
		inconclusive,
		reason,
	};
}

export interface AiderDeltaLaneReport {
	/** idle = no fresh campaign to grade; failed = a regression verdict OR a lane-config error (fail-closed). */
	outcome: "idle" | "passed" | "failed";
	reason: string;
	gates: readonly AiderRegressionGateResult[];
}

/**
 * F11.3g nightly delta lane, PURE: grade the newest BANKED campaign against the pinned single-host baseline.
 * The lane never runs GPU work — campaigns are operator/rig-launched; the nightly only reads their receipts.
 * With the armk7 zero-floor baseline every graded run is `inconclusive` ("no regression gradient") and the
 * lane PASSES on it — the resolved→unresolved fail rule arms itself the first time an arm banks a resolve.
 * A same-arm evaluation error (arm/repeats drift between snapshot pairs) FAILS the lane rather than idling:
 * a measurement that cannot run is a defect to fix, not an absence to shrug at.
 */
export function summarizeAiderDeltaLane(input: {
	baselines: readonly AiderRegressionSnapshot[];
	current: { campaignId: string; snapshots: readonly AiderRegressionSnapshot[] } | null;
}): AiderDeltaLaneReport {
	if (input.baselines.length === 0) {
		return { outcome: "failed", reason: "No pinned baseline snapshots were readable.", gates: [] };
	}
	if (input.current === null) {
		return {
			outcome: "idle",
			reason: `No campaign banked since baseline ${input.baselines[0]?.campaignId ?? "?"} — nothing to grade.`,
			gates: [],
		};
	}
	const currentByArm = new Map(input.current.snapshots.map((snapshot) => [snapshot.arm, snapshot]));
	const gates: AiderRegressionGateResult[] = [];
	const problems: string[] = [];
	for (const baseline of input.baselines) {
		const current = currentByArm.get(baseline.arm);
		if (!current) {
			problems.push(`arm ${baseline.arm}: campaign ${input.current.campaignId} banked no snapshot`);
			continue;
		}
		try {
			gates.push(evaluateAiderRegressionGate(baseline, current));
		} catch (error) {
			problems.push(`arm ${baseline.arm}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const failedGates = gates.filter((gate) => gate.outcome === "fail");
	if (failedGates.length > 0 || problems.length > 0) {
		return {
			outcome: "failed",
			reason: [
				...failedGates.map((gate) => `arm ${gate.arm}: ${gate.reason}`),
				...problems.map((problem) => `lane-config: ${problem}`),
			].join(" · "),
			gates,
		};
	}
	return {
		outcome: "passed",
		reason: gates
			.map((gate) => `arm ${gate.arm} vs ${gate.currentCampaignId}: ${gate.outcome} — ${gate.reason}`)
			.join(" · "),
		gates,
	};
}
