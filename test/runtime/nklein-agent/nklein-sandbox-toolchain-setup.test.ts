import { describe, expect, it, vi } from "vitest";
import {
	runSandboxToolchainSetup,
	type SandboxToolchainSetupExecution,
} from "../../../src/nklein-agent/nklein-sandbox-toolchain-setup";

describe("runSandboxToolchainSetup (F12.84b)", () => {
	it("does nothing for an unrecognized repository", async () => {
		const runCommand = vi.fn();
		const report = await runSandboxToolchainSetup({
			rootFileNames: ["README.md"],
			timeoutMs: 1_000,
			runCommand,
		});
		expect(report.status).toBe("not_applicable");
		expect(runCommand).not.toHaveBeenCalled();
	});

	it("probes every selected runtime before installing in stable order", async () => {
		const runCommand = vi.fn(async (_execution: SandboxToolchainSetupExecution) => ({
			exitCode: 0,
			stdout: "ok",
		}));
		const report = await runSandboxToolchainSetup({
			rootFileNames: ["package.json", "package-lock.json", "go.mod"],
			timeoutMs: 1_000,
			runCommand,
		});
		expect(report.status).toBe("ready");
		expect(runCommand.mock.calls.map(([execution]) => execution.command)).toEqual([
			"command -v npm",
			"command -v go",
			"npm ci",
			"go mod download",
		]);
		expect(report.plan.testSteps).toEqual(["npm run test", "go test ./..."]);
		expect(report.plan.coverageSteps).toEqual([
			"NODE_V8_COVERAGE=.nklein-coverage npm run test",
			"go test -coverprofile=.nklein-coverage.out ./...",
		]);
	});

	it("stops on a missing image runtime before running an install command", async () => {
		const runCommand = vi.fn(async (_execution: SandboxToolchainSetupExecution) => ({
			exitCode: 127,
			stderr: "cargo: not found",
		}));
		const report = await runSandboxToolchainSetup({
			rootFileNames: ["Cargo.toml"],
			timeoutMs: 1_000,
			runCommand,
		});
		expect(report).toMatchObject({ status: "failed", failedCommand: "command -v cargo" });
		expect(report.steps).toHaveLength(1);
	});

	it("stops after the first install failure and preserves its diagnostics", async () => {
		const runCommand = vi
			.fn()
			.mockResolvedValueOnce({ exitCode: 0, stdout: "/usr/local/bin/npm" })
			.mockResolvedValueOnce({ exitCode: 1, stderr: "lockfile mismatch" });
		const report = await runSandboxToolchainSetup({
			rootFileNames: ["package.json", "package-lock.json"],
			timeoutMs: 1_000,
			runCommand,
		});
		expect(report).toMatchObject({ status: "failed", failedCommand: "npm ci" });
		expect(report.steps.at(-1)?.output).toContain("lockfile mismatch");
	});
});
