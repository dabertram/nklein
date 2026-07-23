import { beforeEach, describe, expect, it, vi } from "vitest";

const git = vi.hoisted(() => ({
	resolveTaskResultBranchCommit: vi.fn(async () => "result-commit" as string | null),
	getTaskResultBranchDiff: vi.fn(async () => "+export const clamp = (n: number) => Math.min(n, 10)" as string | null),
}));
vi.mock("../../../src/workspace/task-result-branches", () => git);

import type { AgentSandboxManager } from "../../../src/nklein-agent/nklein-agent-sandbox";
import { verifyPropertiesInSandbox } from "../../../src/nklein-agent/nklein-property-acceptance-verifier";

describe("verifyPropertiesInSandbox", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		git.resolveTaskResultBranchCommit.mockResolvedValue("result-commit");
		git.getTaskResultBranchDiff.mockResolvedValue("+export const clamp = (n: number) => Math.min(n, 10)");
	});

	it("reports unavailable without claiming success when the spec has no invariant", async () => {
		const manager = { assertAvailable: vi.fn() } as unknown as AgentSandboxManager;
		const result = await verifyPropertiesInSandbox({
			taskId: "task",
			projectRepoPath: "/repo",
			baseRef: "base",
			taskPrompt: "Add a button.",
			sandboxManager: manager,
			bindProperties: vi.fn(),
		});
		expect(result).toMatchObject({ outcome: "unavailable", invariantCount: 0 });
		expect(manager.assertAvailable).not.toHaveBeenCalled();
	});

	it("keeps a binder decline unavailable before allocating a browser/test result", async () => {
		// Missing result commit is checked before sandbox allocation; it must never fall back to the base tree.
		git.resolveTaskResultBranchCommit.mockResolvedValueOnce(null);
		const manager = { assertAvailable: vi.fn() } as unknown as AgentSandboxManager;
		const result = await verifyPropertiesInSandbox({
			taskId: "missing",
			projectRepoPath: "/definitely/not/a/repo",
			baseRef: "base",
			taskPrompt: "The result must always be non-negative.",
			sandboxManager: manager,
			bindProperties: vi.fn(),
		});
		expect(result.outcome).toBe("unavailable");
		expect(result.reason).toContain("exact delivered commit");
		expect(manager.assertAvailable).not.toHaveBeenCalled();
	});

	it("executes a bound property against the exact result commit and tears the workspace down", async () => {
		const disposeWorkspace = vi.fn(async () => {});
		const manager = {
			assertAvailable: vi.fn(async () => {}),
			prepareWorkspace: vi.fn(async () => ({ workdir: "/workspaces/task" })),
			listSandboxRootFileNames: vi.fn(async () => ["package.json", "package-lock.json"]),
			exec: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
			runTool: vi.fn(async () =>
				JSON.stringify({ status: "fail", reason: "property falsified", output: "counterexample: 11" }),
			),
			disposeWorkspace,
		} as unknown as AgentSandboxManager;
		const bindProperties = vi.fn(async () => ({
			status: "bound" as const,
			testCode: "bound test",
			rationale: "clamp is exported",
		}));
		const result = await verifyPropertiesInSandbox({
			taskId: "task",
			projectRepoPath: "/repo",
			baseRef: "base",
			resultCommit: "result-commit",
			taskPrompt: "The result must always be at most 10.",
			sandboxManager: manager,
			bindProperties,
		});
		expect(result).toMatchObject({ outcome: "fail", reason: "property falsified", invariantCount: 1 });
		expect(manager.prepareWorkspace).toHaveBeenCalledWith(expect.objectContaining({ baseRef: "result-commit" }));
		expect(manager.runTool).toHaveBeenCalledWith(
			expect.stringContaining("::property-"),
			"propertyCheck",
			expect.objectContaining({ testCode: "bound test" }),
		);
		expect(disposeWorkspace).toHaveBeenCalledOnce();
	});

	it("does not allocate a sandbox when the independent binder declines", async () => {
		const manager = { assertAvailable: vi.fn() } as unknown as AgentSandboxManager;
		const result = await verifyPropertiesInSandbox({
			taskId: "task",
			projectRepoPath: "/repo",
			baseRef: "base",
			resultCommit: "result-commit",
			taskPrompt: "The result must always be at most 10.",
			sandboxManager: manager,
			bindProperties: vi.fn(async () => ({
				status: "unavailable" as const,
				testCode: "" as const,
				rationale: "the public subject is ambiguous",
			})),
		});
		expect(result).toMatchObject({ outcome: "unavailable", reason: "the public subject is ambiguous" });
		expect(manager.assertAvailable).not.toHaveBeenCalled();
	});
});
