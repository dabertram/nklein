import { describe, expect, it, vi } from "vitest";
import {
	extractClineAcceptanceCommand,
	resolveShellExecution,
	runClineAcceptanceGate,
} from "../../../src/cline-sdk/cline-acceptance-gate";

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
		});

		expect(result.passed).toBe(true);
		expect(result.output.length).toBe(3 * 1024 * 1024);
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
});
