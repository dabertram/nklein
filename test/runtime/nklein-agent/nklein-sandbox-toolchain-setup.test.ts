import { describe, expect, it, vi } from "vitest";
import {
	extractInstallErrorLines,
	INSTALL_ERROR_CHARS_MAX,
	INSTALL_ERROR_LINES_MAX,
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

describe("transient install failures (2026-09-07: E502 from the egress proxy under concurrent installs)", () => {
	it("retries a transiently failed install step once and reports ready when the retry succeeds", async () => {
		const { isTransientInstallFailure, runSandboxToolchainSetup } = await import(
			"../../../src/nklein-agent/nklein-sandbox-toolchain-setup"
		);
		expect(
			isTransientInstallFailure(
				"npm error code E502\nnpm error 502 Bad Gateway - GET https://registry.npmjs.org/zod/-/zod-3.25.76.tgz",
			),
		).toBe(true);
		expect(isTransientInstallFailure("npm error code E403")).toBe(false);
		let installs = 0;
		const report = await runSandboxToolchainSetup({
			rootFileNames: ["package.json", "package-lock.json"],
			timeoutMs: 1_000,
			transientRetryDelayMs: 0,
			runCommand: async ({ command }) => {
				if (command.startsWith("command -v")) return { exitCode: 0, stdout: "/usr/bin/node" };
				installs += 1;
				return installs === 1
					? {
							exitCode: 1,
							stderr: "npm error code E502\nnpm error 502 Bad Gateway - GET https://registry.npmjs.org/x.tgz",
						}
					: { exitCode: 0, stdout: "added 48 packages" };
			},
		});
		expect(installs).toBe(2);
		expect(report.status).toBe("ready");
		expect(report.steps.filter((step) => step.kind === "install")).toHaveLength(2);
	});

	it("does not retry an offline failure", async () => {
		const { runSandboxToolchainSetup } = await import("../../../src/nklein-agent/nklein-sandbox-toolchain-setup");
		let installs = 0;
		const report = await runSandboxToolchainSetup({
			rootFileNames: ["package.json"],
			timeoutMs: 1_000,
			transientRetryDelayMs: 0,
			runCommand: async ({ command }) => {
				if (command.startsWith("command -v")) return { exitCode: 0, stdout: "/usr/bin/node" };
				installs += 1;
				return { exitCode: 1, stderr: "npm error code EAI_AGAIN getaddrinfo EAI_AGAIN registry.npmjs.org" };
			},
		});
		expect(installs).toBe(1);
		expect(report.status).toBe("skipped_offline");
	});
});

describe("extractInstallErrorLines (journal #52: the observation tail ended in npm's EventEmitter warning)", () => {
	const EVENT_EMITTER_NOISE = [
		"(node:29) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 abort listeners added to [AbortSignal]. MaxListeners is 10. Use events.setMaxListeners() to increase limit",
		"(Use `node --trace-warnings ...` to show where the warning was created)",
	];

	it("surfaces the npm ≥10 EAI_AGAIN verdict and drops the log pointer + the warning the tail used to end in", () => {
		const output = [
			"npm error code EAI_AGAIN",
			"npm error syscall getaddrinfo",
			"npm error errno EAI_AGAIN",
			"npm error request to https://registry.npmjs.org/vitest/-/vitest-3.2.4.tgz failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org",
			"npm error A complete log of this run can be found in: /home/task/.npm/_logs/2026-09-07T13_02_11_484Z-debug-0.log",
			...EVENT_EMITTER_NOISE,
		].join("\n");
		// The 400-char tail the prime observation recorded: it ends in the warning, and the code sits above the cut.
		expect(output.slice(-400).endsWith("warning was created)")).toBe(true);
		expect(extractInstallErrorLines(output)).toEqual([
			"npm error code EAI_AGAIN",
			"npm error syscall getaddrinfo",
			"npm error errno EAI_AGAIN",
			"npm error request to https://registry.npmjs.org/vitest/-/vitest-3.2.4.tgz failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org",
		]);
	});

	it("E502 from the registry/proxy (deduped) and the npm ≤9 `npm ERR!` dialect (bare prefixes + indented paths out)", () => {
		expect(
			extractInstallErrorLines(
				[
					"npm error code E502",
					"npm error 502 Bad Gateway - GET https://registry.npmjs.org/zod/-/zod-3.25.76.tgz",
					"npm error 502 Bad Gateway - GET https://registry.npmjs.org/zod/-/zod-3.25.76.tgz",
					"npm error A complete log of this run can be found in: /home/task/.npm/_logs/2026-09-07T14_40_02_913Z-debug-0.log",
				].join("\n"),
			),
		).toEqual([
			"npm error code E502",
			"npm error 502 Bad Gateway - GET https://registry.npmjs.org/zod/-/zod-3.25.76.tgz",
		]);
		expect(
			extractInstallErrorLines(
				[
					"npm ERR! code ENOTFOUND",
					"npm ERR! syscall getaddrinfo",
					"npm ERR! errno ENOTFOUND",
					"npm ERR! network request to https://registry.npmjs.org/typescript failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org",
					"npm ERR! network This is a problem related to network connectivity.",
					"npm ERR! network In most cases you are behind a proxy or have bad network settings.",
					"npm ERR!",
					"npm ERR! A complete log of this run can be found in:",
					"npm ERR!     /root/.npm/_logs/2026-09-07T14_40_02_913Z-debug-0.log",
				].join("\n"),
			),
		).toEqual([
			"npm ERR! code ENOTFOUND",
			"npm ERR! syscall getaddrinfo",
			"npm ERR! errno ENOTFOUND",
			"npm ERR! network request to https://registry.npmjs.org/typescript failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org",
			"npm ERR! network This is a problem related to network connectivity.",
			"npm ERR! network In most cases you are behind a proxy or have bad network settings.",
		]);
	});

	it("ENOSPC (2026-09-06 tmpfs): every nospc line, none of the tar warnings", () => {
		const output = [
			"npm warn tar TAR_ENTRY_ERROR ENOSPC: no space left on device, write",
			"npm warn tar TAR_ENTRY_ERROR ENOSPC: no space left on device, write",
			"npm error code ENOSPC",
			"npm error syscall write",
			"npm error errno -28",
			"npm error nospc ENOSPC: no space left on device, write",
			"npm error nospc There appears to be insufficient space on your system to finish.",
			"npm error nospc Clear up some disk space and try again.",
			"npm error A complete log of this run can be found in: /home/task/.npm/_logs/2026-09-06T21_11_45_002Z-debug-0.log",
		].join("\n");
		expect(extractInstallErrorLines(output)).toEqual([
			"npm error code ENOSPC",
			"npm error syscall write",
			"npm error errno -28",
			"npm error nospc ENOSPC: no space left on device, write",
			"npm error nospc There appears to be insufficient space on your system to finish.",
			"npm error nospc Clear up some disk space and try again.",
		]);
	});

	it("tsc diagnostics (ANSI-coloured too), thrown Error: lines and other package managers — never frames or progress", () => {
		expect(
			extractInstallErrorLines(
				[
					"> dschinn@0.1.0 typecheck",
					"> tsc --noEmit",
					"",
					"src/spine/s54-router.ts(3,21): error TS2307: Cannot find module 'zod' or its corresponding type declarations.",
					"\u001b[96msrc/spine/s54-router.ts\u001b[0m:\u001b[93m9\u001b[0m:\u001b[93m7\u001b[0m - \u001b[91merror\u001b[0m\u001b[90m TS2322: \u001b[0mType 'string' is not assignable to type 'number'.",
					"src/spine/s54-router.ts(3,21): error TS2307: Cannot find module 'zod' or its corresponding type declarations.",
				].join("\n"),
			),
		).toEqual([
			"src/spine/s54-router.ts(3,21): error TS2307: Cannot find module 'zod' or its corresponding type declarations.",
			"src/spine/s54-router.ts:9:7 - error TS2322: Type 'string' is not assignable to type 'number'.",
		]);
		expect(
			extractInstallErrorLines(
				[
					"node:internal/modules/cjs/loader:1228",
					"  throw err;",
					"  ^",
					"",
					"Error: Cannot find module '/work/node_modules/vitest/vitest.mjs'",
					"    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)",
					"    at Module._load (node:internal/modules/cjs/loader:1051:27)",
					"{",
					"  code: 'MODULE_NOT_FOUND',",
					"  requireStack: []",
					"}",
					"TypeError: fetch failed",
				].join("\n"),
			),
		).toEqual(["Error: Cannot find module '/work/node_modules/vitest/vitest.mjs'", "TypeError: fetch failed"]);
		expect(
			extractInstallErrorLines(
				[
					'error An unexpected error occurred: "https://registry.yarnpkg.com/zod/-/zod-3.25.76.tgz: getaddrinfo EAI_AGAIN registry.yarnpkg.com".',
					'info If you think this is a bug, please open a bug report with the information provided in "/work/yarn-error.log".',
					"error[E0433]: failed to resolve: use of undeclared crate or module `serde`",
					"ERROR: Could not find a version that satisfies the requirement zod (from versions: none)",
					"errors found: 3",
					"Updating crates.io index",
				].join("\n"),
			),
		).toEqual([
			'error An unexpected error occurred: "https://registry.yarnpkg.com/zod/-/zod-3.25.76.tgz: getaddrinfo EAI_AGAIN registry.yarnpkg.com".',
			"error[E0433]: failed to resolve: use of undeclared crate or module `serde`",
			"ERROR: Could not find a version that satisfies the requirement zod (from versions: none)",
		]);
	});

	it(`caps at ${INSTALL_ERROR_LINES_MAX} lines / ${INSTALL_ERROR_CHARS_MAX} chars, bounds a runaway line, redacts URL credentials`, () => {
		const many = Array.from({ length: 40 }, (_, index) => `npm error line ${index}`).join("\n");
		expect(extractInstallErrorLines(many)).toHaveLength(INSTALL_ERROR_LINES_MAX);
		const wide = Array.from({ length: 6 }, (_, index) => `npm error ${String(index).repeat(240)}`).join("\n");
		const bounded = extractInstallErrorLines(wide);
		expect(bounded).toHaveLength(4);
		expect(bounded.join("").length).toBeLessThanOrEqual(INSTALL_ERROR_CHARS_MAX);
		const runaway = extractInstallErrorLines(`npm error ${"x".repeat(1_000)}`);
		expect(runaway).toHaveLength(1);
		expect(runaway[0]?.length).toBe(300);
		expect(runaway[0]?.endsWith("…")).toBe(true);
		expect(
			extractInstallErrorLines(
				"npm error 403 Forbidden - GET http://sandbox:s3cret@egress-proxy:3128/registry.npmjs.org/zod",
			),
		).toEqual(["npm error 403 Forbidden - GET http://***@egress-proxy:3128/registry.npmjs.org/zod"]);
	});

	it("returns nothing for a clean install or a docker-exec timeout message (the observation then omits errorLines)", () => {
		expect(
			extractInstallErrorLines("added 48 packages, and audited 49 packages in 3s\n\nfound 0 vulnerabilities"),
		).toEqual([]);
		expect(extractInstallErrorLines("Command timed out after 240000ms")).toEqual([]);
		expect(extractInstallErrorLines("")).toEqual([]);
	});
});
