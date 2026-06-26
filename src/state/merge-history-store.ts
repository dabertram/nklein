import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type { TaskWorktreeAutoMergeResult } from "../workspace/task-worktree-auto-merge";
import { parseValidatedJsonl } from "./jsonl-store";

/**
 * Durable board-level merge-status history (todo §5.G). Each dependency-ordered auto-merge of a reviewed task's
 * result branch appends one JSONL record per workspace (a hash of the workspace path), so the board can surface a
 * "what merged / what was skipped / what conflicted, and when" history that previously lived only in the CLI /
 * integration-card output. Best-effort durability — a write failure never breaks the merge flow.
 */

export interface MergeHistoryRecord {
	schemaVersion: 1;
	recordedAt: number;
	workspacePath: string | null;
	/** The task whose newly-reviewed result branch triggered this dependency-ordered merge pass. */
	taskId: string;
	ok: boolean;
	mergedTaskIds: string[];
	skippedTaskIds: string[];
	/** Paths that conflicted (when the pass stopped on a conflict); empty otherwise. */
	conflictedPaths: string[];
	/** Human-readable blocked/conflict reason when the pass did not fully succeed; null on clean success. */
	reason: string | null;
}

export const mergeHistoryRecordSchema = z.object({
	schemaVersion: z.literal(1),
	recordedAt: z.number(),
	workspacePath: z.string().nullable(),
	taskId: z.string(),
	ok: z.boolean(),
	mergedTaskIds: z.array(z.string()),
	skippedTaskIds: z.array(z.string()),
	conflictedPaths: z.array(z.string()),
	reason: z.string().nullable(),
}) satisfies z.ZodType<MergeHistoryRecord>;

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "merge-history");

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

/** Project an auto-merge result into a durable history record. */
export function buildMergeHistoryRecord(input: {
	workspacePath: string | null;
	taskId: string;
	result: TaskWorktreeAutoMergeResult;
	recordedAt?: number;
}): MergeHistoryRecord {
	const { result } = input;
	const reason = result.ok ? null : (result.blocked?.reason ?? result.conflict?.message ?? "Merge did not complete.");
	return {
		schemaVersion: 1,
		recordedAt: input.recordedAt ?? Date.now(),
		workspacePath: input.workspacePath,
		taskId: input.taskId,
		ok: result.ok,
		mergedTaskIds: [...result.mergedTaskIds],
		skippedTaskIds: [...result.skippedTaskIds],
		conflictedPaths: result.conflict ? [...result.conflict.conflictedPaths] : [],
		reason,
	};
}

export async function recordMergeHistory(
	input: { workspacePath: string | null; taskId: string; result: TaskWorktreeAutoMergeResult; recordedAt?: number },
	options?: { rootDir?: string },
): Promise<void> {
	const record = buildMergeHistoryRecord(input);
	const logPath = resolveLogPath(record.workspacePath, options?.rootDir);
	try {
		await mkdir(resolveRootDir(options?.rootDir), { recursive: true });
		await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");
	} catch {
		// Best-effort durability only; a merge-history write must never break the merge flow.
	}
}

export interface ReadMergeHistoryOptions {
	workspacePath: string | null;
	rootDir?: string;
	limit?: number;
}

export async function readMergeHistory(options: ReadMergeHistoryOptions): Promise<MergeHistoryRecord[]> {
	const logPath = resolveLogPath(options.workspacePath, options.rootDir);
	let raw: string;
	try {
		raw = await readFile(logPath, "utf8");
	} catch {
		return [];
	}
	const records = parseValidatedJsonl(raw, mergeHistoryRecordSchema, "merge-history-store");
	records.sort((left, right) => right.recordedAt - left.recordedAt);
	return typeof options.limit === "number" ? records.slice(0, Math.max(0, options.limit)) : records;
}
