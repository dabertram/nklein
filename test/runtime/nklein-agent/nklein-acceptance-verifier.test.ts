import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	resolveTaskResultBranchCommit: vi.fn(async () => "result-commit-abc" as string | null),
	runNKleinAcceptanceGateInSandbox: vi.fn(async (_input: Record<string, unknown>) => ({ accepted: true }) as unknown),
}));
vi.mock("../../../src/workspace/task-result-branches", () => ({
	resolveTaskResultBranchCommit: mocks.resolveTaskResultBranchCommit,
}));
vi.mock("../../../src/nklein-agent/nklein-acceptance-gate", () => ({
	runNKleinAcceptanceGateInSandbox: mocks.runNKleinAcceptanceGateInSandbox,
}));

import {
	type AcceptanceVerifierDeps,
	createAcceptanceVerifier,
} from "../../../src/nklein-agent/nklein-acceptance-verifier";

const sandbox = { id: "sbx" } as never;
const pause = { markTaskParked: vi.fn() } as never;

function deps(over: Partial<AcceptanceVerifierDeps> = {}): AcceptanceVerifierDeps {
	return {
		getAgentSandboxManager: () => sandbox,
		getPauseController: () => pause,
		...over,
	};
}

const input = (over: Record<string, unknown> = {}) => ({
	taskId: "t1",
	projectRepoPath: "/repo",
	baseRef: "main",
	taskPrompt: "do it",
	...over,
});

const gateCall = () => mocks.runNKleinAcceptanceGateInSandbox.mock.calls.at(-1)?.[0] as Record<string, unknown>;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.resolveTaskResultBranchCommit.mockResolvedValue("result-commit-abc");
});

describe("createAcceptanceVerifier", () => {
	it("throws when no sandbox manager is configured (never runs the gate)", async () => {
		await expect(
			createAcceptanceVerifier(deps({ getAgentSandboxManager: () => null })).verify(input()),
		).rejects.toThrow("requires the configured agent sandbox manager");
		expect(mocks.runNKleinAcceptanceGateInSandbox).not.toHaveBeenCalled();
	});

	it("runs the gate against the DELIVERED tree (result-branch commit) + the sandbox + pause controller", async () => {
		await createAcceptanceVerifier(deps()).verify(input());
		expect(mocks.resolveTaskResultBranchCommit).toHaveBeenCalledWith({ repoPath: "/repo", taskId: "t1" });
		expect(gateCall()).toMatchObject({
			baseRef: "result-commit-abc",
			sandboxManager: sandbox,
			pauseController: pause,
		});
	});

	it("uses resultBranchTaskId (the ::spec branch) for commit resolution when provided", async () => {
		await createAcceptanceVerifier(deps()).verify(input({ resultBranchTaskId: "t1::spec" }));
		expect(mocks.resolveTaskResultBranchCommit).toHaveBeenCalledWith({ repoPath: "/repo", taskId: "t1::spec" });
	});

	it("falls back to the base ref when useBaseTree is set (never resolves a result commit)", async () => {
		await createAcceptanceVerifier(deps()).verify(input({ useBaseTree: true }));
		expect(mocks.resolveTaskResultBranchCommit).not.toHaveBeenCalled();
		expect(gateCall().baseRef).toBe("main");
	});

	it("falls back to the base ref when the result-commit resolution fails", async () => {
		mocks.resolveTaskResultBranchCommit.mockRejectedValueOnce(new Error("no branch"));
		await createAcceptanceVerifier(deps()).verify(input());
		expect(gateCall().baseRef).toBe("main");
	});
});
