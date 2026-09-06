import { describe, expect, it, vi } from "vitest";
import {
	isDiskFullInstallFailure,
	isOfflineInstallFailure,
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
		// P1.ACCEPT-ORPHAN (2): install steps fail fast in an egress-off sandbox (npm's 5-minute fetch timeout ×
		// retries burned ~280s per card before the ENOTFOUND verdict); probes carry no such env.
		const byCommand = new Map(runCommand.mock.calls.map(([execution]) => [execution.command, execution.env]));
		expect(byCommand.get("command -v npm")).toBeUndefined();
		expect(byCommand.get("npm ci")).toMatchObject({
			npm_config_fetch_retries: "0",
			npm_config_fetch_timeout: "15000",
			npm_config_prefer_offline: "true",
		});
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

describe("offline-install classification (N10 forensics 2026-07-25)", () => {
	it("classifies network-unreachable install failures as skipped_offline and proceeds (never a veto)", async () => {
		const report = await runSandboxToolchainSetup({
			rootFileNames: ["package.json"],
			timeoutMs: 1_000,
			runCommand: async (execution) =>
				execution.command.startsWith("command -v")
					? {
							ok: true,
							stdout: "/usr/local/bin/node",
							stderr: "",
							output: "/usr/local/bin/node",
							error: null,
							exitCode: 0,
						}
					: {
							ok: false,
							stdout: "",
							stderr: "npm error code EAI_AGAIN\nnpm error request to https://registry.npmjs.org failed",
							output: "npm error code EAI_AGAIN\nnpm error request to https://registry.npmjs.org failed",
							error: "exit 1",
							exitCode: 1,
						},
		});
		expect(report.status).toBe("skipped_offline");
		expect(report.reason).toContain("proceeding to the acceptance command");
	});

	it("a REAL install failure (no offline signature) still fails setup", async () => {
		const report = await runSandboxToolchainSetup({
			rootFileNames: ["package.json"],
			timeoutMs: 1_000,
			runCommand: async (execution) =>
				execution.command.startsWith("command -v")
					? { ok: true, stdout: "ok", stderr: "", output: "ok", error: null, exitCode: 0 }
					: {
							ok: false,
							stdout: "",
							stderr: "npm error ERESOLVE unable to resolve dependency tree",
							output: "npm error ERESOLVE unable to resolve dependency tree",
							error: "exit 1",
							exitCode: 1,
						},
		});
		expect(report.status).toBe("failed");
	});

	it("names a disk-full install failure as a sandbox capacity problem (2026-09-06 tmpfs ENOSPC)", async () => {
		const output =
			"npm error code ENOSPC\nnpm error syscall write\nnpm error nospc Invalid response body while trying to fetch https://registry.npmjs.org/esbuild";
		const report = await runSandboxToolchainSetup({
			rootFileNames: ["package.json"],
			timeoutMs: 1_000,
			runCommand: async (execution) =>
				execution.command.startsWith("command -v")
					? { ok: true, stdout: "ok", stderr: "", output: "ok", error: null, exitCode: 0 }
					: { ok: false, stdout: "", stderr: output, output, error: "exit 1", exitCode: 1 },
		});
		expect(report.status).toBe("failed");
		expect(report.reason).toContain("ran out of disk inside the sandbox");
		expect(isDiskFullInstallFailure("npm warn tar TAR_ENTRY_ERROR ENOENT: no such file or directory")).toBe(true);
		expect(isDiskFullInstallFailure("ERESOLVE unable to resolve dependency tree")).toBe(false);
	});

	it("isOfflineInstallFailure keys on the cross-package-manager signatures", () => {
		expect(isOfflineInstallFailure("getaddrinfo EAI_AGAIN registry.npmjs.org")).toBe(true);
		expect(isOfflineInstallFailure("Could not resolve host: static.crates.io")).toBe(true);
		expect(isOfflineInstallFailure("ERESOLVE unable to resolve dependency tree")).toBe(false);
	});
});
