import { describe, expect, it, vi } from "vitest";
import {
	extractNKleinAcceptanceCommand,
	resolveShellExecution,
	runNKleinAcceptanceGate,
	runNKleinAcceptanceGateInSandbox,
} from "../../../src/nklein-agent/nklein-acceptance-gate";
import type { AgentSandboxManager } from "../../../src/nklein-agent/nklein-agent-sandbox";
import { NKleinPauseController } from "../../../src/nklein-agent/nklein-pause-controller";

describe("nklein acceptance gate", () => {
	it("extracts acceptance commands from decomposed task prompts", () => {
		expect(
			extractNKleinAcceptanceCommand(
				[
					"Implement storage.",
					"",
					"Likely files:",
					"- src/storage.ts",
					"",
					"Acceptance check: npm run test -- --runInBand",
				].join("\n"),
			),
		).toBe("npm run test -- --runInBand");
		expect(extractNKleinAcceptanceCommand("No check here")).toBeNull();
	});

	it("returns a skipped result when a task has no acceptance command", async () => {
		const result = await runNKleinAcceptanceGate({
			workspacePath: "/tmp/project",
			taskPrompt: "Implement the thing.",
			runCommand: vi.fn(),
		});

		expect(result).toEqual({
			present: false,
			command: null,
			passed: null,
			exitCode: null,
			output: "",
			durationMs: 0,
			failureCategory: null,
			failureHint: null,
		});
	});

	it("uses a non-login shell for acceptance commands on POSIX", () => {
		if (process.platform === "win32") {
			return;
		}
		expect(resolveShellExecution("npm test")).toEqual({
			binary: "/bin/sh",
			args: ["-c", "npm test"],
		});
	});

	it("runs the extracted command and reports success", async () => {
		const runCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: "ok",
			stderr: "",
		}));

		const result = await runNKleinAcceptanceGate({
			workspacePath: "/tmp/project",
			taskPrompt: "Acceptance check: npm test",
			now: (() => {
				let value = 100;
				return () => {
					value += 25;
					return value;
				};
			})(),
			runCommand,
		});

		expect(runCommand).toHaveBeenCalledWith({
			command: "npm test",
			cwd: "/tmp/project",
			timeoutMs: 300_000,
		});
		expect(result).toMatchObject({
			present: true,
			command: "npm test",
			passed: true,
			exitCode: 0,
			output: "ok",
			durationMs: 25,
		});
	});

	it("handles output larger than the old 2 MB exec buffer", async () => {
		if (process.platform === "win32") {
			return;
		}
		const result = await runNKleinAcceptanceGate({
			workspacePath: process.cwd(),
			taskPrompt: "Acceptance check: node -e \"process.stdout.write('x'.repeat(3 * 1024 * 1024))\"",
			allowHostExecution: true,
		});

		expect(result.passed).toBe(true);
		expect(result.output.length).toBe(3 * 1024 * 1024);
	});

	it("rejects implicit host execution for acceptance commands", async () => {
		await expect(
			runNKleinAcceptanceGate({
				workspacePath: "/tmp/project",
				taskPrompt: "Acceptance check: npm test",
			}),
		).rejects.toThrow("Acceptance gate host execution requires an explicit runCommand");
	});

	it("records failed verification observations", async () => {
		const recordObservation = vi.fn();

		const result = await runNKleinAcceptanceGate({
			taskId: "task-1",
			workspacePath: "/tmp/project",
			taskPrompt: "Acceptance check: npm run typecheck",
			now: () => 500,
			runCommand: async () => ({
				exitCode: 2,
				stdout: "",
				stderr: "Type error",
			}),
			recordObservation,
		});

		expect(result).toMatchObject({
			present: true,
			command: "npm run typecheck",
			passed: false,
			exitCode: 2,
			output: "Type error",
		});
		expect(recordObservation).toHaveBeenCalledWith({
			signal: "verification_failed",
			severity: "error",
			message: "Acceptance gate failed: npm run typecheck",
			taskId: "task-1",
			workspacePath: "/tmp/project",
			metadata: {
				command: "npm run typecheck",
				exitCode: 2,
				outputPreview: "Type error",
			},
			createdAt: 500,
		});
	});

	it("queues sandbox acceptance commands while the task is paused", async () => {
		const pauseController = new NKleinPauseController();
		pauseController.setCardPaused("task-1", true);
		const assertAvailable = vi.fn(async () => {});
		const prepareWorkspace = vi.fn(async () => ({
			workdir: "/sandbox/task-1",
			uid: 70_001,
		}));
		const exec = vi.fn(async () => ({
			exitCode: 0,
			stdout: "ok",
			stderr: "",
		}));
		const disposeWorkspace = vi.fn(async () => {});
		const sandboxManager = {
			assertAvailable,
			prepareWorkspace,
			exec,
			disposeWorkspace,
		} as unknown as AgentSandboxManager;

		const pending = runNKleinAcceptanceGateInSandbox({
			taskId: "task-1",
			projectRepoPath: "/repo",
			taskPrompt: "Acceptance check: npm test",
			sandboxManager,
			pauseController,
			now: (() => {
				let value = 100;
				return () => {
					value += 25;
					return value;
				};
			})(),
		});

		await vi.waitFor(() => {
			expect(prepareWorkspace).toHaveBeenCalledTimes(1);
		});
		// The check's OWN synthetic sandbox session — colliding with the worker's taskId destroyed the live worker
		// workspace (prepareWorkspace rm-rf's + re-clones the workdir keyed by taskId). Each acceptance run also gets a
		// UNIQUE `-<n>` discriminator so two OVERLAPPING acceptance runs on the same base task never share one session
		// (det-bounce race: one run's finally-dispose tore down another's live placement). Bounded slot wait: this
		// auxiliary seam must fail closed instead of queueing forever behind a busy pool.
		const prepareCalls = prepareWorkspace.mock.calls as unknown as ReadonlyArray<[{ taskId: string }]>;
		const preparedTaskId = prepareCalls[0]?.[0]?.taskId ?? "";
		expect(preparedTaskId).toMatch(/^task-1::acceptance-\d+$/);
		expect(prepareWorkspace).toHaveBeenCalledWith({
			taskId: preparedTaskId,
			projectRepoPath: "/repo",
			baseRef: null,
			maxQueueWaitMs: 120_000,
		});
		await Promise.resolve();

		expect(exec).not.toHaveBeenCalled();

		pauseController.setCardPaused("task-1", false);

		await expect(pending).resolves.toMatchObject({
			present: true,
			command: "npm test",
			passed: true,
			output: "ok",
		});
		const shellExecution = resolveShellExecution("npm test");
		expect(assertAvailable).toHaveBeenCalledTimes(1);
		expect(exec).toHaveBeenCalledWith(preparedTaskId, [shellExecution.binary, ...shellExecution.args], {
			timeoutMs: 300_000,
		});
		expect(disposeWorkspace).toHaveBeenCalledWith(preparedTaskId);
	});

	it("gives two concurrent acceptance runs on the same base task DISTINCT sandbox sessions", async () => {
		// ROOT CAUSE of the det-bounce flake: the pre-review acceptance and the #39 re-check both prepared+disposed
		// `<taskId>::acceptance`; when they overlapped, one's finally-dispose tore down the other's live placement and
		// its exec threw "No Docker sandbox workspace is prepared". The unique `-<n>` discriminator keys them apart.
		const preparedIds: string[] = [];
		const makeManager = () =>
			({
				assertAvailable: vi.fn(async () => {}),
				prepareWorkspace: vi.fn(async (options: { taskId: string }) => {
					preparedIds.push(options.taskId);
					return { workdir: `/sandbox/${options.taskId}`, uid: 70_001 };
				}),
				exec: vi.fn(async () => ({ exitCode: 0, stdout: "ok", stderr: "" })),
				disposeWorkspace: vi.fn(async () => {}),
			}) as unknown as AgentSandboxManager;

		const runOne = (manager: AgentSandboxManager) =>
			runNKleinAcceptanceGateInSandbox({
				taskId: "det-bounce-gamma",
				projectRepoPath: "/repo",
				taskPrompt: "Acceptance check: npm test",
				sandboxManager: manager,
			});

		await Promise.all([runOne(makeManager()), runOne(makeManager())]);

		expect(preparedIds).toHaveLength(2);
		expect(preparedIds[0]).not.toBe(preparedIds[1]);
		for (const id of preparedIds) {
			expect(id).toMatch(/^det-bounce-gamma::acceptance-\d+$/);
		}
	});

	it("stamps a fresh discriminator even when handed an already-suffixed acceptance task id", async () => {
		// A re-entrant caller may pass `<taskId>::acceptance` (or `...-7`) back in; we must strip it and stamp a fresh
		// unique one, never reuse the incoming suffix (which would reintroduce the collision it was meant to avoid).
		const prepared: string[] = [];
		const manager = {
			assertAvailable: vi.fn(async () => {}),
			prepareWorkspace: vi.fn(async (options: { taskId: string }) => {
				prepared.push(options.taskId);
				return { workdir: "/sandbox/x", uid: 70_001 };
			}),
			exec: vi.fn(async () => ({ exitCode: 0, stdout: "ok", stderr: "" })),
			disposeWorkspace: vi.fn(async () => {}),
		} as unknown as AgentSandboxManager;

		await runNKleinAcceptanceGateInSandbox({
			taskId: "task-9::acceptance-7",
			projectRepoPath: "/repo",
			taskPrompt: "Acceptance check: npm test",
			sandboxManager: manager,
		});

		expect(prepared).toHaveLength(1);
		expect(prepared[0]).toMatch(/^task-9::acceptance-\d+$/);
		expect(prepared[0]).not.toBe("task-9::acceptance-7");
	});

	it("rejects sandbox acceptance without a bound task id", async () => {
		const sandboxManager = {
			assertAvailable: vi.fn(async () => {}),
		} as unknown as AgentSandboxManager;

		await expect(
			runNKleinAcceptanceGateInSandbox({
				taskId: "",
				projectRepoPath: "/repo",
				taskPrompt: "Acceptance check: npm test",
				sandboxManager,
			}),
		).rejects.toThrow("A task id is required to run the acceptance gate in the agent sandbox.");
		expect(sandboxManager.assertAvailable).not.toHaveBeenCalled();
	});
});
