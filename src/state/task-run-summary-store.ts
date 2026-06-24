import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type { RuntimeModelPerformanceRole } from "../core/api-contract";
import type { FocusChainSummary } from "../core/focus-chain";

/**
 * Durable terminal task-run summaries (follow-up-6 §3.6, §4.2).
 *
 * Live session state in `sessions.json` is reset to `{}` when the runtime stops, so after a shutdown the
 * board could still show Review/Planning cards with no record of *why* their last run ended — provider/model,
 * exit/review reason, last activity, token usage, patch-capture status, or the timeout reason and its source.
 * This store appends one JSONL record per terminal transition to a runtime-home file (which survives runtime
 * restarts, unlike `sessions.json`), keyed by a hash of the workspace path, so the last-run outcome remains
 * inspectable after the runtime is gone.
 */

export type TaskRunTerminalState = "awaiting_review" | "failed" | "interrupted";

/** Where the bounded turn/stream/tool timeout that ended a run came from. */
export type TaskRunTimeoutSource = "global_config" | "role_override" | "autonomous_default" | null;

export interface TaskRunSummaryRecord {
	schemaVersion: 1;
	taskId: string;
	workspacePath: string | null;
	state: TaskRunTerminalState;
	reviewReason: string | null;
	providerId: string | null;
	modelId: string | null;
	endpoint: string | null;
	lastActivity: string | null;
	warningMessage: string | null;
	exitCode: number | null;
	startedAt: number | null;
	endedAt: number;
	promptTokens: number | null;
	completionTokens: number | null;
	totalTokens: number | null;
	timeoutReason: string | null;
	timeoutSource: TaskRunTimeoutSource;
	/** Coarse agent role of the run (todo §5.C), for by-role timeout breakdowns. Absent on pre-§5.C records. */
	role?: RuntimeModelPerformanceRole;
	/** Dev-test scenario id (todo §5.C), for by-scenario timeout breakdowns during sweeps; null for ordinary runs. */
	scenario?: string | null;
	/** Snapshot of the agent's focus-chain progress at run end (todo §5.N), if it drafted one; absent otherwise. */
	focusChain?: FocusChainSummary | null;
	patchCaptureStatus: string | null;
}

export interface RecordTaskRunSummaryInput extends Omit<TaskRunSummaryRecord, "schemaVersion" | "endedAt"> {
	endedAt?: number;
}

export interface ReadTaskRunSummariesOptions {
	rootDir?: string;
	workspacePath: string | null;
	taskId?: string | null;
	limit?: number;
}

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "task-runs");

function resolveRootDir(rootDir?: string): string {
	return rootDir ?? DEFAULT_ROOT;
}

function workspaceFileName(workspacePath: string | null): string {
	const key = workspacePath?.trim() || "unknown";
	return `${createHash("sha256").update(key).digest("hex").slice(0, 16)}.jsonl`;
}

function resolveLogPath(workspacePath: string | null, rootDir?: string): string {
	return join(resolveRootDir(rootDir), workspaceFileName(workspacePath));
}

export async function recordTaskRunSummary(
	input: RecordTaskRunSummaryInput,
	options?: { rootDir?: string },
): Promise<void> {
	const record: TaskRunSummaryRecord = {
		schemaVersion: 1,
		endedAt: input.endedAt ?? Date.now(),
		...input,
	};
	const logPath = resolveLogPath(record.workspacePath, options?.rootDir);
	try {
		await mkdir(resolveRootDir(options?.rootDir), { recursive: true });
		await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");
	} catch {
		// Best-effort durability only; a run summary write must never break the session loop.
	}
}

/**
 * Aggregated view of the runs that ended on a bounded turn/stream/tool timeout, grouped by model and the
 * provenance of the timeout that fired (global config vs role override vs autonomous default), with the
 * terminal outcome each timeout produced. Grouped by model, the provenance of the timeout that fired, **and the
 * coarse agent role** (todo §5.C), so "which model/timeout-source/role combinations keep timing out, and what
 * happens when they do" is answerable from the durable run log. (Finer per-task role attribution still lives in
 * the model-performance stats; this is the role breakdown for timeout outcomes specifically.)
 */
export interface TimeoutOutcomeAggregate {
	key: string;
	providerId: string | null;
	modelId: string | null;
	timeoutSource: TaskRunTimeoutSource;
	/** Coarse agent role of the runs in this group (todo §5.C); `"unknown"` for pre-§5.C records. */
	role: RuntimeModelPerformanceRole;
	/** Dev-test scenario id of the runs in this group (todo §5.C); `null` for ordinary (non-dev-test) runs. */
	scenario: string | null;
	timeoutRuns: number;
	awaitingReviewRuns: number;
	failedRuns: number;
	interruptedRuns: number;
	lastEndedAt: number;
}

export function summarizeTimeoutOutcomes(records: readonly TaskRunSummaryRecord[]): TimeoutOutcomeAggregate[] {
	const groups = new Map<string, TimeoutOutcomeAggregate>();
	for (const record of records) {
		// Only runs whose terminal transition carried a timeout reason were timeout-triggered.
		if (!record.timeoutReason) {
			continue;
		}
		const role: RuntimeModelPerformanceRole = record.role ?? "unknown";
		const scenario = record.scenario ?? null;
		const key = [
			record.providerId ?? "unknown_provider",
			record.modelId ?? "unknown_model",
			record.timeoutSource ?? "unknown_source",
			role,
			scenario ?? "no_scenario",
		].join("\0");
		const existing = groups.get(key) ?? {
			key,
			providerId: record.providerId,
			modelId: record.modelId,
			timeoutSource: record.timeoutSource,
			role,
			scenario,
			timeoutRuns: 0,
			awaitingReviewRuns: 0,
			failedRuns: 0,
			interruptedRuns: 0,
			lastEndedAt: 0,
		};
		existing.timeoutRuns += 1;
		if (record.state === "awaiting_review") {
			existing.awaitingReviewRuns += 1;
		} else if (record.state === "failed") {
			existing.failedRuns += 1;
		} else if (record.state === "interrupted") {
			existing.interruptedRuns += 1;
		}
		existing.lastEndedAt = Math.max(existing.lastEndedAt, record.endedAt);
		groups.set(key, existing);
	}
	return [...groups.values()].sort(
		(left, right) => right.timeoutRuns - left.timeoutRuns || right.lastEndedAt - left.lastEndedAt,
	);
}

export async function readTaskRunSummaries(options: ReadTaskRunSummariesOptions): Promise<TaskRunSummaryRecord[]> {
	const logPath = resolveLogPath(options.workspacePath, options.rootDir);
	let raw: string;
	try {
		raw = await readFile(logPath, "utf8");
	} catch {
		return [];
	}
	const records: TaskRunSummaryRecord[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed) as TaskRunSummaryRecord;
			if (options.taskId && parsed.taskId !== options.taskId) {
				continue;
			}
			records.push(parsed);
		} catch {
			// Skip malformed lines rather than failing the whole read.
		}
	}
	records.sort((a, b) => b.endedAt - a.endedAt);
	return typeof options.limit === "number" ? records.slice(0, Math.max(0, options.limit)) : records;
}
