import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPausedTasksPath, readPausedTasks, setCardPaused } from "../../src/core/card-pause";

describe("card pause persistence", () => {
	const workspacePaths: string[] = [];

	afterEach(async () => {
		await Promise.all(workspacePaths.map((workspacePath) => rm(workspacePath, { recursive: true, force: true })));
		workspacePaths.length = 0;
	});

	async function createWorkspace(): Promise<string> {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-card-pause-"));
		workspacePaths.push(workspacePath);
		return workspacePath;
	}

	it("stores trimmed paused task ids in the nklein runtime directory", async () => {
		const workspacePath = await createWorkspace();

		await expect(readPausedTasks(workspacePath)).resolves.toEqual(new Set());
		expect(getPausedTasksPath(workspacePath)).toBe(join(workspacePath, ".nklein", "nklein", "paused-tasks.json"));

		const pausedAfterFirstTask = await setCardPaused({
			workspacePath,
			taskId: " task-b ",
			paused: true,
		});
		const pausedAfterSecondTask = await setCardPaused({
			workspacePath,
			taskId: "task-a",
			paused: true,
		});

		expect(pausedAfterFirstTask).toEqual(new Set(["task-b"]));
		expect(pausedAfterSecondTask).toEqual(new Set(["task-a", "task-b"]));
		await expect(readPausedTasks(workspacePath)).resolves.toEqual(new Set(["task-a", "task-b"]));
		const rawPausedTasks = await readFile(getPausedTasksPath(workspacePath), "utf8");
		expect(JSON.parse(rawPausedTasks)).toEqual(["task-a", "task-b"]);
	});

	it("removes a task from the persisted pause list", async () => {
		const workspacePath = await createWorkspace();

		await setCardPaused({ workspacePath, taskId: "task-a", paused: true });
		await setCardPaused({ workspacePath, taskId: "task-b", paused: true });
		const nextPausedTasks = await setCardPaused({ workspacePath, taskId: "task-a", paused: false });

		expect(nextPausedTasks).toEqual(new Set(["task-b"]));
		await expect(readPausedTasks(workspacePath)).resolves.toEqual(new Set(["task-b"]));
	});

	it("rejects empty task ids", async () => {
		const workspacePath = await createWorkspace();

		await expect(setCardPaused({ workspacePath, taskId: "   ", paused: true })).rejects.toThrow(
			"Task ID cannot be empty.",
		);
	});
});
