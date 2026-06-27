import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
	parseQueuedTaskStarts,
	type QueuedRuntimeTaskStart,
	serializeQueuedTaskStarts,
} from "./runtime-task-start-queue";

/**
 * The thin file-I/O half of the §5.AF durable queued-start store: persist the queue as a single JSONL snapshot so a
 * runtime restart can reload + replay pending starts instead of dropping them. The caller (runtime-server) owns the
 * path (under the runtime home) and the *when* — load on boot, save after each enqueue/drain. Best-effort, mirroring
 * the ledger store: a persistence failure must never break the queue (which is still correct in memory).
 */

/** Load the persisted queue snapshot — empty if the file is missing or unreadable. Invalid lines are skipped on parse. */
export async function loadQueuedTaskStartsFromDisk(path: string): Promise<QueuedRuntimeTaskStart[]> {
	try {
		return parseQueuedTaskStarts(await readFile(path, "utf8"));
	} catch {
		return [];
	}
}

/** Persist the whole queue snapshot (overwrite). Best-effort — a write failure never throws. */
export async function saveQueuedTaskStartsToDisk(
	path: string,
	entries: readonly QueuedRuntimeTaskStart[],
): Promise<void> {
	try {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, serializeQueuedTaskStarts(entries), "utf8");
	} catch {
		// Best-effort durability — a persistence failure must never break the queue.
	}
}
