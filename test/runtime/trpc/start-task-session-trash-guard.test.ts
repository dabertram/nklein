import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadWorkspaceState, saveWorkspaceState } from "../../../src/state/workspace-state";
import { handleStartTaskSession, type StartTaskSessionDeps } from "../../../src/trpc/runtime-api/start-task-session";

/**
 * Trash is terminal (live 2026-09-08).
 *
 * Abandoning the stalled `42_analysis_unchecked_error_audit` run moved all seven cards to trash, and the runtime
 * started two of them again within a minute on brand-new sessions, which then queued on the rig's single shared
 * endpoint. The board read "abandoned" while the endpoint read "busy".
 *
 * Individual sweeps already skip trash, but a start can be entered from a redrive, the durable controller, a
 * watchdog or a chat send, and one path missing the check is enough — so the invariant lives at the chokepoint
 * every start funnels through. `resumeFromTrash` remains the explicit operator escape.
 */
describe("handleStartTaskSession — a trashed card is abandoned, not started", () => {
	async function workspaceWithTrashedCard(taskId: string): Promise<string> {
		const workspacePath = mkdtempSync(join(tmpdir(), "nklein-trash-guard-"));
		// A workspace is a git repo. Strip the repository-scoping env or an outer `git` hook's GIT_DIR/GIT_INDEX_FILE
		// hijacks this init and it silently initialises somewhere else (the 2026-09-08 all-day "intermittent" bug).
		const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_OBJECT_DIRECTORY, ...cleanEnv } = process.env;
		execFileSync("git", ["init", "--quiet"], { cwd: workspacePath, env: cleanEnv });
		const state = await loadWorkspaceState(workspacePath);
		const trash = state.board.columns.find((column) => column.id === "trash");
		expect(trash, "a fresh board must have a trash column").toBeDefined();
		(trash as { cards: unknown[] }).cards.push({
			id: taskId,
			title: "abandoned card",
			description: "",
			prompt: "do the thing",
			startInPlanMode: false,
			baseRef: "main",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await saveWorkspaceState(workspacePath, { board: state.board } as never);
		return workspacePath;
	}

	it("refuses the start with task_trashed, without touching the runtime", async () => {
		const workspacePath = await workspaceWithTrashedCard("task-trashed");
		let configLoads = 0;
		const deps = {
			loadScopedRuntimeConfig: async () => {
				configLoads += 1;
				return {} as never;
			},
		} as unknown as StartTaskSessionDeps;

		const response = await handleStartTaskSession(
			{ workspaceId: "ws-trash", workspacePath } as never,
			{ taskId: "task-trashed", baseRef: "main", prompt: "go" },
			deps,
		);
		expect(response).toMatchObject({ ok: false, errorCode: "task_trashed" });
		expect(response.error).toContain("trash");
		// The refusal happens BEFORE any runtime work: nothing was loaded, nothing was started.
		expect(configLoads).toBe(0);
	});

	it("still starts a card that is not in the trash", async () => {
		const workspacePath = await workspaceWithTrashedCard("task-trashed");
		let configLoads = 0;
		const deps = {
			loadScopedRuntimeConfig: async () => {
				configLoads += 1;
				throw new Error("stop here — the guard let the start through, which is what this asserts");
			},
		} as unknown as StartTaskSessionDeps;

		const response = await handleStartTaskSession(
			{ workspaceId: "ws-trash", workspacePath } as never,
			{ taskId: "some-other-card", baseRef: "main", prompt: "go" },
			deps,
		);
		expect(configLoads).toBe(1);
		expect(response.errorCode).not.toBe("task_trashed");
	});

	it("honours resumeFromTrash, so an operator can still restore a card by hand", async () => {
		const workspacePath = await workspaceWithTrashedCard("task-trashed");
		let configLoads = 0;
		const deps = {
			broadcastTaskChatCleared: () => undefined,
			loadScopedRuntimeConfig: async () => {
				configLoads += 1;
				throw new Error("stop here — the guard let the resume through, which is what this asserts");
			},
		} as unknown as StartTaskSessionDeps;

		const response = await handleStartTaskSession(
			{ workspaceId: "ws-trash", workspacePath } as never,
			{ taskId: "task-trashed", baseRef: "main", prompt: "go", resumeFromTrash: true },
			deps,
		);
		expect(configLoads).toBe(1);
		expect(response.errorCode).not.toBe("task_trashed");
	});
});
