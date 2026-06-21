import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { lockedFileSystem } from "../fs/locked-file-system";

export interface EvidenceBundleTaskTranscript {
	taskId: string;
	title?: string | null;
	messages: readonly unknown[];
}

export interface EvidenceBundleMetric {
	label: string;
	value: string | number | boolean | null;
}

export interface EvidenceBundleEvalResult {
	status: "passed" | "failed" | "skipped";
	command?: string | null;
	exitCode?: number | null;
	capabilityScore?: number | null;
	output?: string | null;
}

export interface EvidenceBundleInput {
	scenario: string;
	startedAt?: number;
	finishedAt?: number;
	outcome: "passed" | "failed" | "interrupted" | "unknown";
	summary?: string | null;
	models?: readonly string[];
	metrics?: readonly EvidenceBundleMetric[];
	transcripts?: readonly EvidenceBundleTaskTranscript[];
	diffPatch?: string | null;
	telemetryEvents?: readonly unknown[];
	configSnapshot?: unknown;
	evalResult?: EvidenceBundleEvalResult | null;
	rootDir?: string;
	now?: () => number;
}

export interface EvidenceBundleResult {
	bundlePath: string;
	summaryPath: string;
	files: {
		summary: string;
		telemetry: string;
		configSnapshot: string;
		evalResult: string;
		diffPatch: string | null;
		transcripts: readonly string[];
	};
}

function getDefaultDevRunsParent(): string {
	return join(homedir(), ".nklein", "nklein", "dev-runs");
}

function slugifyScenario(input: string): string {
	const slug = input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "scenario";
}

function formatTimestampForPath(timestamp: number): string {
	return new Date(timestamp).toISOString().replace(/[:.]/g, "-");
}

function formatTimestampForSummary(timestamp: number | null | undefined): string {
	if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) {
		return "unknown";
	}
	return new Date(timestamp).toISOString();
}

function stringifyJsonLine(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

function stringifyJsonFile(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function renderList(items: readonly string[]): string {
	if (items.length === 0) {
		return "- none\n";
	}
	return `${items.map((item) => `- ${item}`).join("\n")}\n`;
}

function renderMetrics(metrics: readonly EvidenceBundleMetric[]): string {
	if (metrics.length === 0) {
		return "- none\n";
	}
	return `${metrics.map((metric) => `- ${metric.label}: ${metric.value ?? "unknown"}`).join("\n")}\n`;
}

function renderSummary(
	input: Required<Pick<EvidenceBundleInput, "scenario" | "outcome">> & EvidenceBundleInput,
): string {
	const startedAt = input.startedAt ?? null;
	const finishedAt = input.finishedAt ?? null;
	const transcriptCount = input.transcripts?.length ?? 0;
	return [
		`# ${input.scenario}`,
		"",
		`- Outcome: ${input.outcome}`,
		`- Started: ${formatTimestampForSummary(startedAt)}`,
		`- Finished: ${formatTimestampForSummary(finishedAt)}`,
		`- Transcripts: ${transcriptCount}`,
		"",
		"## Models",
		renderList(input.models ?? []),
		"## Metrics",
		renderMetrics(input.metrics ?? []),
		"## Notes",
		input.summary?.trim() || "No summary provided.",
		"",
	].join("\n");
}

function normalizeTranscriptFileName(taskId: string, index: number): string {
	const slug = slugifyScenario(taskId);
	return `${String(index + 1).padStart(2, "0")}-${slug}.json`;
}

export function resolveEvidenceBundleRoot(rootDir?: string): string {
	return rootDir ?? getDefaultDevRunsParent();
}

export async function createEvidenceBundle(input: EvidenceBundleInput): Promise<EvidenceBundleResult> {
	const now = input.now ?? Date.now;
	const startedAt = input.startedAt ?? now();
	const rootDir = resolveEvidenceBundleRoot(input.rootDir);
	const bundlePath = join(rootDir, `${slugifyScenario(input.scenario)}-${formatTimestampForPath(startedAt)}`);
	const summaryPath = join(bundlePath, "summary.md");
	const telemetryPath = join(bundlePath, "telemetry.jsonl");
	const configSnapshotPath = join(bundlePath, "config-snapshot.json");
	const evalPath = join(bundlePath, "eval.json");
	const diffPath = input.diffPatch?.trim() ? join(bundlePath, "diff.patch") : null;
	const transcriptDir = join(bundlePath, "transcript");
	const transcripts = input.transcripts ?? [];

	await mkdir(transcriptDir, { recursive: true });
	await lockedFileSystem.writeTextFileAtomic(summaryPath, renderSummary({ ...input, startedAt }), { lock: null });
	await lockedFileSystem.writeTextFileAtomic(
		telemetryPath,
		(input.telemetryEvents ?? []).map(stringifyJsonLine).join(""),
		{ lock: null },
	);
	await lockedFileSystem.writeTextFileAtomic(configSnapshotPath, stringifyJsonFile(input.configSnapshot ?? {}), {
		lock: null,
	});
	await lockedFileSystem.writeTextFileAtomic(evalPath, stringifyJsonFile(input.evalResult ?? { status: "skipped" }), {
		lock: null,
	});
	if (diffPath) {
		await lockedFileSystem.writeTextFileAtomic(
			diffPath,
			input.diffPatch?.trimEnd() ? `${input.diffPatch.trimEnd()}\n` : "",
			{
				lock: null,
			},
		);
	}

	const transcriptPaths: string[] = [];
	for (const [index, transcript] of transcripts.entries()) {
		const path = join(transcriptDir, normalizeTranscriptFileName(transcript.taskId, index));
		await lockedFileSystem.writeTextFileAtomic(
			path,
			stringifyJsonFile({
				taskId: transcript.taskId,
				title: transcript.title ?? null,
				messages: transcript.messages,
			}),
			{ lock: null },
		);
		transcriptPaths.push(path);
	}

	return {
		bundlePath,
		summaryPath,
		files: {
			summary: summaryPath,
			telemetry: telemetryPath,
			configSnapshot: configSnapshotPath,
			evalResult: evalPath,
			diffPatch: diffPath,
			transcripts: transcriptPaths,
		},
	};
}
