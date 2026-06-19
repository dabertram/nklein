import { describe, expect, it, vi } from "vitest";
import {
	extractClineAcceptanceCommand,
	resolveShellExecution,
	runClineAcceptanceGate,
	runClineAcceptanceGateInSandbox,
} from "../../../src/cline-sdk/cline-acceptance-gate";
import type { AgentSandboxManager } from "../../../src/cline-sdk/cline-agent-sandbox";
import { ClinePauseController } from "../../../src/cline-sdk/cline-pause-controller";

describe("cline acceptance gate", () => {
	it("extracts acceptance commands from decomposed task prompts", () => {
		expect(
			extractClineAcceptanceCommand(
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
		expect(extractClineAcceptanceCommand("No check here")).toBeNull();
	});

	it("returns a skipped result when a task has no acceptance command", async () => {
		const result = await runClineAcceptanceGate({
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

		const result = await runClineAcceptanceGate({
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
		const result = await runClineAcceptanceGate({
			workspacePath: process.cwd(),
			taskPrompt: "Acceptance check: node -e \"process.stdout.write('x'.repeat(3 * 1024 * 1024))\"",
			allowHostExecution: true,
		});

		expect(result.passed).toBe(true);
		expect(result.output.length).toBe(3 * 1024 * 1024);
	});

	it("rejects implicit host execution for acceptance commands", async () => {
		await expect(
			runClineAcceptanceGate({
				workspacePath: "/tmp/project",
				taskPrompt: "Acceptance check: npm test",
			}),
		).rejects.toThrow("Acceptance gate host execution requires an explicit runCommand");
	});

	it("records failed verification observations", async () => {
		const recordObservation = vi.fn();

		const result = await runClineAcceptanceGate({
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
		const pauseController = new ClinePauseController();
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

		const pending = runClineAcceptanceGateInSandbox({
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
			expect(prepareWorkspace).toHaveBeenCalledWith({
				taskId: "task-1",
				projectRepoPath: "/repo",
				baseRef: null,
			});
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
		expect(exec).toHaveBeenCalledWith("task-1", [shellExecution.binary, ...shellExecution.args], {
			timeoutMs: 300_000,
		});
		expect(disposeWorkspace).toHaveBeenCalledWith("task-1");
	});

	it("rejects sandbox acceptance without a bound task id", async () => {
		const sandboxManager = {
			assertAvailable: vi.fn(async () => {}),
		} as unknown as AgentSandboxManager;

		await expect(
			runClineAcceptanceGateInSandbox({
				taskId: "",
				projectRepoPath: "/repo",
				taskPrompt: "Acceptance check: npm test",
				sandboxManager,
			}),
		).rejects.toThrow("A task id is required to run the acceptance gate in the agent sandbox.");
		expect(sandboxManager.assertAvailable).not.toHaveBeenCalled();
	});
});
