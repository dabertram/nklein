import { describe, expect, it, vi } from "vitest";
import type { AgentSandboxExecResult } from "../../../src/nklein-agent/nklein-agent-sandbox";
import {
	DEFAULT_WORKER_TOOLCHAIN_PRIME_TIMEOUT_MS,
	describePrimeFailure,
	primeSandboxToolchain,
	WORKER_TOOLCHAIN_PRIME_ENV,
} from "../../../src/nklein-agent/nklein-sandbox-toolchain-prime";

function fakeManager(
	rootFileNames: string[],
	exec: (argv: readonly string[]) => Promise<AgentSandboxExecResult>,
): { manager: Parameters<typeof primeSandboxToolchain>[0]["manager"]; calls: string[][] } {
	const calls: string[][] = [];
	return {
		calls,
		manager: {
			listSandboxRootFileNames: async () => rootFileNames,
			exec: async (_taskId: string, argv: readonly string[]) => {
				calls.push([...argv]);
				return await exec(argv);
			},
		},
	};
}

describe("primeSandboxToolchain (worker sandbox dependency install before the first model turn)", () => {
	it("runs the node toolchain plan through the docker-exec seam and reports ready", async () => {
		const { manager, calls } = fakeManager(["package.json", "package-lock.json", "src"], async () => ({
			exitCode: 0,
			stdout: "added 48 packages",
			stderr: "",
		}));
		const record = vi.fn();
		const report = await primeSandboxToolchain({ manager, taskId: "t1", recordObservation: record, env: {} });
		expect(report?.status).toBe("ready");
		expect(report?.steps.some((step) => step.kind === "install" && /npm/u.test(step.command))).toBe(true);
		// Every command goes through `sh -c` (env additions via /usr/bin/env) — never host execution.
		expect(calls.every((argv) => argv.includes("sh") && argv.includes("-c"))).toBe(true);
		expect(record).toHaveBeenCalledTimes(1);
		expect(record.mock.calls[0]?.[0]?.metadata).toMatchObject({
			category: "sandbox_toolchain_prime",
			status: "ready",
		});
		expect(DEFAULT_WORKER_TOOLCHAIN_PRIME_TIMEOUT_MS).toBeGreaterThan(30_000);
	});

	it("is a no-op for a workspace without a recognised toolchain and when disabled by env", async () => {
		const record = vi.fn();
		const plain = fakeManager(["README.md"], async () => ({ exitCode: 0, stdout: "", stderr: "" }));
		const report = await primeSandboxToolchain({
			manager: plain.manager,
			taskId: "t2",
			recordObservation: record,
			env: {},
		});
		expect(report?.status).toBe("not_applicable");
		expect(record).not.toHaveBeenCalled();
		const node = fakeManager(["package.json"], async () => ({ exitCode: 0, stdout: "", stderr: "" }));
		expect(
			await primeSandboxToolchain({
				manager: node.manager,
				taskId: "t3",
				recordObservation: record,
				env: { [WORKER_TOOLCHAIN_PRIME_ENV]: "0" },
			}),
		).toBeNull();
		expect(node.calls).toEqual([]);
	});

	it("a thrown docker exec (timeout) becomes a failed step and one warning observation — never a thrown start", async () => {
		const { manager } = fakeManager(["package.json"], async (argv) => {
			if (argv.join(" ").includes("npm")) {
				throw new Error("Command timed out after 240000ms");
			}
			return { exitCode: 0, stdout: "/usr/bin/node", stderr: "" };
		});
		const record = vi.fn();
		const report = await primeSandboxToolchain({ manager, taskId: "t4", recordObservation: record, env: {} });
		expect(report?.status).toBe("failed");
		expect(record).toHaveBeenCalledTimes(1);
		const observation = record.mock.calls[0]?.[0];
		expect(observation?.severity).toBe("warning");
		expect(String(observation?.message)).toContain("failed before the first model turn");
		expect(report ? describePrimeFailure(report) : "").toMatch(/priming budget|failed/u);
	});
});
