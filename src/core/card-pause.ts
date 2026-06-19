import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { NKLEIN_RUNTIME_HOME_DIR_NAME } from "../config/runtime-path-constants";
import { lockedFileSystem } from "../fs/locked-file-system";

const PAUSED_TASKS_FILENAME = "paused-tasks.json";

const pausedTaskIdsSchema = z.array(z.string().min(1)).default([]);

export function getPausedTasksPath(workspacePath: string): string {
	return join(workspacePath, NKLEIN_RUNTIME_HOME_DIR_NAME, PAUSED_TASKS_FILENAME);
}

export async function readPausedTasks(workspacePath: string): Promise<Set<string>> {
	try {
		const parsed = pausedTaskIdsSchema.parse(JSON.parse(await readFile(getPausedTasksPath(workspacePath), "utf8")));
		return new Set(parsed.map((taskId) => taskId.trim()).filter((taskId) => taskId.length > 0));
	} catch {
		return new Set();
	}
}

export async function setCardPaused(input: {
	workspacePath: string;
	taskId: string;
	paused: boolean;
}): Promise<Set<string>> {
	const taskId = input.taskId.trim();
	if (!taskId) {
		throw new Error("Task ID cannot be empty.");
	}
	const pausedTaskIds = await readPausedTasks(input.workspacePath);
	if (input.paused) {
		pausedTaskIds.add(taskId);
	} else {
		pausedTaskIds.delete(taskId);
	}
	const path = getPausedTasksPath(input.workspacePath);
	await mkdir(dirname(path), { recursive: true });
	await lockedFileSystem.writeJsonFileAtomic(path, [...pausedTaskIds].sort(), { lock: null });
	return pausedTaskIds;
}
