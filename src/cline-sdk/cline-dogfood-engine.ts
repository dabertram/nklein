import { readdir, readFile } from "node:fs/promises";
import { basename } from "node:path";
import type {
	SelfObservationEventRecord,
	SelfObservationSeverity,
	SelfObservationSignal,
} from "../telemetry/self-observation-sink";
import { type ClinePlanArtifacts, type ClinePlanTaskGraph, writeClinePlanArtifacts } from "./cline-plan-artifacts";
import {
	evaluateTrustedAutoMerge,
	isTrustedAutoMergeProtectedPath,
	type TrustedAutoMergeDecision,
} from "./cline-trusted-auto-merge";

const DEFAULT_ACCEPTANCE_COMMAND = "npm run typecheck && npm run test:fast";
const MAX_EXAMPLES_PER_CLUSTER = 5;
const MAX_DOGFOOD_TASK_COMPLEXITY = 75;
const MAX_DOGFOOD_TASK_LIKELY_FILES = 3;
const MAX_MESSAGE_KEY_LENGTH = 140;
const SEVERITY_WEIGHT: Record<SelfObservationSeverity, number> = {
	debug: 1,
	info: 2,
	warning: 5,
	error: 10,
};

export interface ClineDogfoodImprovementCandidate {
	id: string;
	title: string;
	prompt: string;
	acceptanceCommand: string;
	score: number;
	occurrences: number;
	severity: SelfObservationSeverity;
	signals: SelfObservationSignal[];
	workspacePath: string | null;
	filesLikelyTouched: string[];
	protectedPaths: string[];
	requiresHumanApproval: boolean;
	trustedAutoMerge: TrustedAutoMergeDecision;
	examples: string[];
}

export interface ClineDogfoodBacklog {
	slug: string;
	title: string;
	generatedAt: number;
	candidates: ClineDogfoodImprovementCandidate[];
	taskGraph: ClinePlanTaskGraph;
}

export interface BuildClineDogfoodBacklogOptions {
	events: SelfObservationEventRecord[];
	slug?: string;
	title?: string;
	now?: () => number;
	maxCandidates?: number;
	acceptanceCommand?: string;
	userSuggestions?: string[];
}

export interface WriteClineDogfoodBacklogOptions extends Omit<BuildClineDogfoodBacklogOptions, "events"> {
	workspacePath: string;
	telemetryRootDir: string;
}

function isSelfObservationSeverity(value: unknown): value is SelfObservationSeverity {
	return value === "debug" || value === "info" || value === "warning" || value === "error";
}

function isSelfObservationSignal(value: unknown): value is SelfObservationSignal {
	return (
		value === "runtime_error" ||
		value === "provider_error" ||
		value === "tool_error" ||
		value === "context_overflow" ||
		value === "verification_failed" ||
		value === "slow_turn" ||
		value === "budget_wall" ||
		value === "repeated_read" ||
		value === "tool_argument_error" ||
		value === "task_abandoned" ||
		value === "task_escalated" ||
		value === "decomposition_rejected" ||
		value === "eval_score" ||
		value === "custom"
	);
}

function parseObservationRecord(value: unknown): SelfObservationEventRecord | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value as Record<string, unknown>;
	if (record.schemaVersion !== 1 || !isSelfObservationSignal(record.signal)) {
		return null;
	}
	if (!isSelfObservationSeverity(record.severity) || typeof record.message !== "string") {
		return null;
	}
	const createdAt = typeof record.createdAt === "number" ? record.createdAt : Date.now();
	return {
		schemaVersion: 1,
		signal: record.signal,
		severity: record.severity,
		message: record.message,
		taskId: typeof record.taskId === "string" ? record.taskId : null,
		runId: typeof record.runId === "string" ? record.runId : null,
		providerId: typeof record.providerId === "string" ? record.providerId : null,
		modelId: typeof record.modelId === "string" ? record.modelId : null,
		workspacePath: typeof record.workspacePath === "string" ? record.workspacePath : null,
		metadata:
			record.metadata && typeof record.metadata === "object"
				? (record.metadata as Record<string, unknown>)
				: undefined,
		createdAt,
	};
}

function normalizeMessageKey(message: string): string {
	return message.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_KEY_LENGTH);
}

function slugify(input: string): string {
	return (
		input
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || "dogfood"
	);
}

function titleForSignal(signal: SelfObservationSignal): string {
	return signal
		.split("_")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function readStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function collectFileHintsFromMetadata(metadata: Record<string, unknown> | undefined): string[] {
	if (!metadata) {
		return [];
	}
	const hints = new Set<string>();
	const visit = (value: unknown, key: string | null): void => {
		if (typeof value === "string") {
			if (key && /^(file|path|relativePath|workspacePath)$/i.test(key)) {
				hints.add(value);
			}
			return;
		}
		for (const item of readStringArray(value)) {
			if (key && /^(files|paths|filesLikelyTouched|changedFiles)$/i.test(key)) {
				hints.add(item);
			}
		}
		if (value && typeof value === "object" && !Array.isArray(value)) {
			for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
				visit(childValue, childKey);
			}
		}
	};
	visit(metadata, null);
	return [...hints].map((hint) => hint.trim()).filter(Boolean);
}

function highestSeverity(events: SelfObservationEventRecord[]): SelfObservationSeverity {
	return events.reduce<SelfObservationSeverity>((highest, event) => {
		return SEVERITY_WEIGHT[event.severity] > SEVERITY_WEIGHT[highest] ? event.severity : highest;
	}, "debug");
}

function buildCandidate(input: {
	index: number;
	key: string;
	events: SelfObservationEventRecord[];
	acceptanceCommand: string;
}): ClineDogfoodImprovementCandidate {
	const severity = highestSeverity(input.events);
	const primary = input.events[0];
	const signals = [...new Set(input.events.map((event) => event.signal))];
	const filesLikelyTouched = [
		...new Set(input.events.flatMap((event) => collectFileHintsFromMetadata(event.metadata))),
	].sort();
	const protectedPaths = filesLikelyTouched.filter(isTrustedAutoMergeProtectedPath);
	const trustedAutoMerge = evaluateTrustedAutoMerge({
		requested: false,
		evalPassed: false,
		testsPassed: false,
		changedFiles: filesLikelyTouched,
		regressionDelta: null,
	});
	const examples = input.events
		.slice(0, MAX_EXAMPLES_PER_CLUSTER)
		.map((event) => `${new Date(event.createdAt).toISOString()} ${event.signal}: ${event.message}`);
	const score = input.events.reduce((total, event) => total + SEVERITY_WEIGHT[event.severity], 0);
	const title = `Dogfood: reduce ${titleForSignal(primary?.signal ?? "custom")}`;
	const prompt = [
		"Investigate and implement a narrowly scoped Kanban self-improvement from recurring local telemetry.",
		"",
		`Cluster key: ${input.key}`,
		`Occurrences: ${input.events.length}`,
		`Highest severity: ${severity}`,
		`Workspace: ${primary?.workspacePath ?? "unknown"}`,
		protectedPaths.length > 0
			? `Protected paths detected: ${protectedPaths.join(", ")}. Do not auto-commit changes touching these paths; leave them for explicit human review.`
			: "Protected paths detected: none.",
		"",
		"Recent examples:",
		...examples.map((example) => `- ${example}`),
		"",
		"Deliver a minimal fix, update or add focused tests, and preserve existing safety guardrails.",
	].join("\n");

	return {
		id: `dogfood-${input.index + 1}`,
		title,
		prompt,
		acceptanceCommand: input.acceptanceCommand,
		score,
		occurrences: input.events.length,
		severity,
		signals,
		workspacePath: primary?.workspacePath ?? null,
		filesLikelyTouched,
		protectedPaths,
		requiresHumanApproval: protectedPaths.length > 0,
		trustedAutoMerge,
		examples,
	};
}

function buildUserSuggestionCandidate(input: {
	index: number;
	suggestion: string;
	acceptanceCommand: string;
}): ClineDogfoodImprovementCandidate {
	const suggestion = input.suggestion.trim();
	const trustedAutoMerge = evaluateTrustedAutoMerge({
		requested: false,
		evalPassed: false,
		testsPassed: false,
		changedFiles: [],
		regressionDelta: null,
	});
	return {
		id: `suggestion-${input.index + 1}`,
		title: "Dogfood: user suggested improvement",
		prompt: [
			"Investigate and implement a narrowly scoped Kanban self-improvement suggested by the user.",
			"",
			"User suggestion:",
			suggestion,
			"",
			"Turn this into a concrete, safe change against the Kanban codebase. Keep the scope tight, add or update focused tests, and preserve existing safety guardrails.",
		].join("\n"),
		acceptanceCommand: input.acceptanceCommand,
		score: 50,
		occurrences: 1,
		severity: "warning",
		signals: ["custom"],
		workspacePath: null,
		filesLikelyTouched: [],
		protectedPaths: [],
		requiresHumanApproval: false,
		trustedAutoMerge,
		examples: [suggestion],
	};
}

export async function readClineDogfoodTelemetry(rootDir: string): Promise<SelfObservationEventRecord[]> {
	const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
	const logFiles = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
		.map((entry) => entry.name)
		.sort();
	const records: SelfObservationEventRecord[] = [];
	for (const logFile of logFiles) {
		const raw = await readFile(`${rootDir}/${logFile}`, "utf8");
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			try {
				const record = parseObservationRecord(JSON.parse(trimmed));
				if (record) {
					records.push(record);
				}
			} catch {}
		}
	}
	return records.sort((left, right) => right.createdAt - left.createdAt);
}

export function buildClineDogfoodBacklog(options: BuildClineDogfoodBacklogOptions): ClineDogfoodBacklog {
	const now = options.now?.() ?? Date.now();
	const slug = slugify(options.slug ?? `dogfood-${new Date(now).toISOString().slice(0, 10)}`);
	const title = options.title ?? "Kanban Dogfood Improvements";
	const acceptanceCommand = options.acceptanceCommand ?? DEFAULT_ACCEPTANCE_COMMAND;
	const clusters = new Map<string, SelfObservationEventRecord[]>();
	for (const event of options.events) {
		const key = `${event.signal}:${event.workspacePath ?? "global"}:${normalizeMessageKey(event.message)}`;
		const existing = clusters.get(key) ?? [];
		existing.push(event);
		clusters.set(key, existing);
	}
	const candidates = [...clusters.entries()]
		.map(([key, events], index) => buildCandidate({ index, key, events, acceptanceCommand }))
		.concat(
			(options.userSuggestions ?? [])
				.map((suggestion) => suggestion.trim())
				.filter((suggestion) => suggestion.length > 0)
				.map((suggestion, index) => buildUserSuggestionCandidate({ index, suggestion, acceptanceCommand })),
		)
		.sort((left, right) => right.score - left.score || right.occurrences - left.occurrences)
		.slice(0, options.maxCandidates ?? 10);
	return {
		slug,
		title,
		generatedAt: now,
		candidates,
		taskGraph: {
			schemaVersion: 1,
			slug,
			title,
			tasks: candidates.map((candidate) => ({
				id: candidate.id,
				title: candidate.title,
				prompt: candidate.prompt,
				dependsOn: [],
				complexity: Math.min(MAX_DOGFOOD_TASK_COMPLEXITY, 30 + candidate.score),
				suggestedRole: candidate.requiresHumanApproval ? "architect" : "worker",
				filesLikelyTouched: candidate.filesLikelyTouched.slice(0, MAX_DOGFOOD_TASK_LIKELY_FILES),
				acceptanceCommand: candidate.acceptanceCommand,
				testFirst: false,
				acceptanceTestPrompt: null,
			})),
		},
	};
}

function formatCandidatePlan(candidate: ClineDogfoodImprovementCandidate): string {
	return [
		`## ${candidate.title}`,
		`- Score: ${candidate.score}`,
		`- Occurrences: ${candidate.occurrences}`,
		`- Severity: ${candidate.severity}`,
		`- Signals: ${candidate.signals.join(", ")}`,
		`- Requires human approval: ${candidate.requiresHumanApproval ? "yes" : "no"}`,
		`- Trusted auto-merge: ${candidate.trustedAutoMerge.allowed ? "eligible" : "blocked"} (${candidate.trustedAutoMerge.reason})`,
	].join("\n");
}

export async function writeClineDogfoodBacklog(options: WriteClineDogfoodBacklogOptions): Promise<ClinePlanArtifacts> {
	const events = await readClineDogfoodTelemetry(options.telemetryRootDir);
	const backlog = buildClineDogfoodBacklog({
		...options,
		events,
	});
	const spec = [
		`# ${backlog.title}`,
		"",
		`Generated at: ${new Date(backlog.generatedAt).toISOString()}`,
		`Telemetry source: ${basename(options.telemetryRootDir)}`,
		"",
		"These proposals come from local self-observation telemetry. They are propose-only and must pass the acceptance gate before completion.",
	].join("\n");
	const plan = [
		`# ${backlog.title}`,
		"",
		...backlog.candidates.map(formatCandidatePlan),
		backlog.candidates.length === 0 ? "No recurring telemetry clusters found." : "",
	].join("\n\n");
	return await writeClinePlanArtifacts({
		workspacePath: options.workspacePath,
		slug: backlog.slug,
		spec,
		plan,
		taskGraph: backlog.taskGraph,
	});
}
