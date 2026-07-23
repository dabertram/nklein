import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	resolveTaskResultBranchCommit: vi.fn(async () => "result-commit-abc" as string | null),
	runNKleinAcceptanceGateInSandbox: vi.fn(async (_input: Record<string, unknown>) => ({ accepted: true }) as unknown),
	verifyPropertiesInSandbox: vi.fn(),
}));
vi.mock("../../../src/workspace/task-result-branches", () => ({
	resolveTaskResultBranchCommit: mocks.resolveTaskResultBranchCommit,
}));
vi.mock("../../../src/nklein-agent/nklein-acceptance-gate", () => ({
	runNKleinAcceptanceGateInSandbox: mocks.runNKleinAcceptanceGateInSandbox,
}));
vi.mock("../../../src/nklein-agent/nklein-property-acceptance-verifier", () => ({
	verifyPropertiesInSandbox: mocks.verifyPropertiesInSandbox,
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

	it("blocks a green acceptance when an enabled bound property is falsified", async () => {
		const previous = process.env.NKLEIN_PROPERTY_GATE;
		process.env.NKLEIN_PROPERTY_GATE = "1";
		try {
			mocks.runNKleinAcceptanceGateInSandbox.mockResolvedValueOnce({
				present: true,
				command: "npm test",
				passed: true,
				exitCode: 0,
				output: "examples green",
				durationMs: 10,
				failureCategory: null,
				failureHint: null,
			});
			mocks.verifyPropertiesInSandbox.mockResolvedValueOnce({
				outcome: "fail",
				reason: "idempotence falsified",
				output: "counterexample: x",
				invariantCount: 1,
			});
			const getPropertyBindingModelCaller = vi.fn(async () => vi.fn());
			const result = await createAcceptanceVerifier(deps({ getPropertyBindingModelCaller })).verify(input());
			expect(result).toMatchObject({ present: true, passed: false, failureCategory: "test_failure" });
			expect(result.output).toContain("counterexample: x");
			expect(mocks.verifyPropertiesInSandbox).toHaveBeenCalledWith(
				expect.objectContaining({ resultCommit: "result-commit-abc" }),
			);
		} finally {
			if (previous === undefined) delete process.env.NKLEIN_PROPERTY_GATE;
			else process.env.NKLEIN_PROPERTY_GATE = previous;
		}
	});

	it("never promotes inconclusive primary acceptance with a passing property", async () => {
		const previous = process.env.NKLEIN_PROPERTY_GATE;
		process.env.NKLEIN_PROPERTY_GATE = "1";
		try {
			mocks.runNKleinAcceptanceGateInSandbox.mockResolvedValueOnce({
				present: false,
				command: null,
				passed: null,
				exitCode: null,
				output: "no primary harness",
				durationMs: 1,
				failureCategory: null,
				failureHint: null,
			});
			const result = await createAcceptanceVerifier(
				deps({ getPropertyBindingModelCaller: vi.fn(async () => vi.fn()) }),
			).verify(input());
			expect(result).toMatchObject({ present: false, passed: null });
			expect(mocks.verifyPropertiesInSandbox).not.toHaveBeenCalled();
		} finally {
			if (previous === undefined) delete process.env.NKLEIN_PROPERTY_GATE;
			else process.env.NKLEIN_PROPERTY_GATE = previous;
		}
	});
});
