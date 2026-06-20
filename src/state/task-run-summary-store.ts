import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";

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
