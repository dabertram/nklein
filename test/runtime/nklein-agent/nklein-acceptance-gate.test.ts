import { describe, expect, it, vi } from "vitest";
import {
	extractNKleinAcceptanceCommand,
	resolveShellExecution,
	rewriteSandboxAcceptanceCommand,
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

	it("rewrites stale sandbox-root cd prefixes for fresh acceptance sandboxes", () => {
		expect(
			rewriteSandboxAcceptanceCommand(
				"cd /workspaces/dev-habit-product-nklein-complex-decompose && npx tsc --noEmit",
				"/workspaces/habit-product-buildout-1-doc-domain-model::acceptance-7",
			),
		).toBe("npx tsc --noEmit");
		expect(
			rewriteSandboxAcceptanceCommand(
				"cd /workspaces/old-task/packages/api && npm test",
				"/workspaces/task-1::acceptance-7",
			),
		).toBe("cd '/workspaces/task-1::acceptance-7/packages/api' && npm test");
		expect(rewriteSandboxAcceptanceCommand("cd packages/api && npm test", "/workspaces/task-1::acceptance-7")).toBe(
			"cd packages/api && npm test",
		);
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

	it("does NOT hang forever on a stuck pause — proceeds past the 60s cap so the slot is never leaked", async () => {
		// The pre-command pause wait runs AFTER the sandbox slot is acquired; a never-resumed pause used to hold
		// the slot forever (the review-hang deadlock class, 2026-07-10). Past the cap the command runs anyway.
		vi.useFakeTimers();
		try {
			const pauseController = new NKleinPauseController();
			pauseController.setCardPaused("task-stuck", true); // paused and NEVER resumed
			const exec = vi.fn(async () => ({ exitCode: 0, stdout: "ok", stderr: "" }));
			const sandboxManager = {
				assertAvailable: vi.fn(async () => {}),
				prepareWorkspace: vi.fn(async () => ({ workdir: "/sandbox/task-stuck", uid: 70_002 })),
				exec,
				disposeWorkspace: vi.fn(async () => {}),
			} as unknown as AgentSandboxManager;

			const pending = runNKleinAcceptanceGateInSandbox({
				taskId: "task-stuck",
				projectRepoPath: "/repo",
				taskPrompt: "Acceptance check: npm test",
				sandboxManager,
				pauseController,
			});

			// Let prepareWorkspace resolve, then advance PAST the 60s pause cap — the command must run despite the
			// pause never being lifted.
			await vi.advanceTimersByTimeAsync(0);
			expect(exec).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(60_000);
			await expect(pending).resolves.toMatchObject({ present: true, passed: true });
			expect(exec).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("executes stale /workspaces acceptance commands from the fresh sandbox root", async () => {
		const exec = vi.fn(async () => ({
			exitCode: 0,
			stdout: "ok",
			stderr: "",
		}));
		const prepareWorkspace = vi.fn(async (options: { taskId: string }) => ({
			workdir: `/workspaces/${options.taskId}`,
			uid: 70_001,
		}));
		const disposeWorkspace = vi.fn(async () => {});
		const sandboxManager = {
			assertAvailable: vi.fn(async () => {}),
			prepareWorkspace,
			exec,
			disposeWorkspace,
		} as unknown as AgentSandboxManager;

		const result = await runNKleinAcceptanceGateInSandbox({
			taskId: "task-1",
			projectRepoPath: "/repo",
			taskPrompt: "Acceptance check: cd /workspaces/dev-old-task && npx tsc --noEmit",
			sandboxManager,
		});

		const preparedTaskId = (prepareWorkspace.mock.calls as unknown as ReadonlyArray<[{ taskId: string }]>)[0]?.[0]
			?.taskId;
		const shellExecution = resolveShellExecution("npx tsc --noEmit");
		expect(result).toMatchObject({
			present: true,
			command: "cd /workspaces/dev-old-task && npx tsc --noEmit",
			passed: true,
		});
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

	it("F11.2g (NKLEIN_REPO_VERIFY): a green acceptance runs the repo's own lint; a red lint fails the gate with output fed back", async () => {
		process.env.NKLEIN_REPO_VERIFY = "1";
		try {
			const commandsRun: string[] = [];
			const runCommand = vi.fn(async (execution: { command: string }) => {
				commandsRun.push(execution.command);
				if (execution.command === "cat package.json") {
					return { exitCode: 0, stdout: JSON.stringify({ scripts: { lint: "biome check ." } }) };
				}
				if (execution.command === "npm run lint") {
					return { exitCode: 1, stdout: "", stderr: "src/x.ts:1 lint/style/noVar" };
				}
				return { exitCode: 0, stdout: "tests pass", stderr: "" };
			});
			const result = await runNKleinAcceptanceGate({
				taskId: "task-lint",
				workspacePath: "/repo",
				taskPrompt: "Acceptance check: npm test",
				runCommand,
				recordObservation: vi.fn(),
			});
			expect(commandsRun).toEqual(["npm test", "cat package.json", "npm run lint"]);
			expect(result.passed).toBe(false);
			expect(result.failureCategory).toBe("lint_error");
			expect(result.output).toContain("[repo verify: npm run lint] exit 1");
			expect(result.output).toContain("noVar");
			expect(result.failureHint).toContain("npm run lint");

			// Green repo checks keep the gate green with the extra evidence appended.
			const greenRun = vi.fn(async (execution: { command: string }) => {
				if (execution.command === "cat package.json") {
					return { exitCode: 0, stdout: JSON.stringify({ scripts: { lint: "biome check ." } }) };
				}
				return { exitCode: 0, stdout: "ok", stderr: "" };
			});
			const green = await runNKleinAcceptanceGate({
				taskId: "task-lint-green",
				workspacePath: "/repo",
				taskPrompt: "Acceptance check: npm test",
				runCommand: greenRun,
				recordObservation: vi.fn(),
			});
			expect(green.passed).toBe(true);
			expect(green.output).toContain("[repo verify: npm run lint] exit 0");
		} finally {
			delete process.env.NKLEIN_REPO_VERIFY;
		}
	});

	it("F11.2g stays byte-identical with the flag off (no package.json read at all)", async () => {
		const runCommand = vi.fn(async () => ({ exitCode: 0, stdout: "ok", stderr: "" }));
		const result = await runNKleinAcceptanceGate({
			taskId: "task-off",
			workspacePath: "/repo",
			taskPrompt: "Acceptance check: npm test",
			runCommand,
			recordObservation: vi.fn(),
		});
		expect(result.passed).toBe(true);
		expect(runCommand).toHaveBeenCalledTimes(1);
		expect(result.output).not.toContain("repo verify");
	});
});

describe("type-check-first micro-loop (F12.86)", () => {
	const PROMPT = ["Fix the retry cap.", "", "Acceptance check: npm test"].join("\n");
	const PACKAGE_JSON = JSON.stringify({ scripts: { typecheck: "tsc --noEmit", test: "vitest run" } });

	function makeRunner(typeCheckOutput: string | null) {
		return vi.fn(async ({ command }: { command: string }) => {
			if (command.startsWith("cat package.json")) {
				return { exitCode: 0, stdout: PACKAGE_JSON, stderr: "" };
			}
			if (/typecheck|tsc/.test(command)) {
				return typeCheckOutput === null
					? { exitCode: 0, stdout: "", stderr: "" }
					: { exitCode: 2, stdout: typeCheckOutput, stderr: "" };
			}
			return { exitCode: 0, stdout: "tests pass", stderr: "" };
		});
	}

	it("is byte-identical with the flag OFF (no type check runs at all)", async () => {
		const before = process.env.NKLEIN_TYPECHECK_FIRST;
		delete process.env.NKLEIN_TYPECHECK_FIRST;
		try {
			const runCommand = makeRunner("src/a.ts(1,1): error TS1: boom");
			const result = await runNKleinAcceptanceGate({ workspacePath: "/tmp/p", taskPrompt: PROMPT, runCommand });
			expect(result.passed).toBe(true);
			// Only the acceptance command ran — no package.json read, no type check.
			expect(runCommand.mock.calls.every(([call]) => !call.command.includes("typecheck"))).toBe(true);
		} finally {
			if (before !== undefined) {
				process.env.NKLEIN_TYPECHECK_FIRST = before;
			}
		}
	});

	it("bounces with ANCHORED diagnostics before the acceptance command runs", async () => {
		const before = process.env.NKLEIN_TYPECHECK_FIRST;
		process.env.NKLEIN_TYPECHECK_FIRST = "1";
		try {
			const runCommand = makeRunner(
				["src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.", ""].join("\n"),
			);
			const result = await runNKleinAcceptanceGate({
				workspacePath: "/tmp/p",
				taskPrompt: PROMPT,
				runCommand,
				recordObservation: vi.fn(),
			});
			expect(result.passed).toBe(false);
			expect(result.failureCategory).toBe("lint_error");
			expect(result.failureHint).toContain("src/a.ts:12 [TS2322]");
			expect(result.failureHint).toContain("do not run tests yet");
			// The expensive acceptance command must NOT have run — that is the whole point of the cheap gate.
			expect(runCommand.mock.calls.some(([call]) => call.command === "npm test")).toBe(false);
		} finally {
			if (before === undefined) {
				delete process.env.NKLEIN_TYPECHECK_FIRST;
			} else {
				process.env.NKLEIN_TYPECHECK_FIRST = before;
			}
		}
	});

	it("proceeds to the acceptance command when the type check is clean", async () => {
		const before = process.env.NKLEIN_TYPECHECK_FIRST;
		process.env.NKLEIN_TYPECHECK_FIRST = "1";
		try {
			const runCommand = makeRunner(null);
			const result = await runNKleinAcceptanceGate({ workspacePath: "/tmp/p", taskPrompt: PROMPT, runCommand });
			expect(result.passed).toBe(true);
			expect(runCommand.mock.calls.some(([call]) => call.command === "npm test")).toBe(true);
		} finally {
			if (before === undefined) {
				delete process.env.NKLEIN_TYPECHECK_FIRST;
			} else {
				process.env.NKLEIN_TYPECHECK_FIRST = before;
			}
		}
	});
});
