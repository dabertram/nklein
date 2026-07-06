import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	fetchLoadedModelIdsCached: vi.fn(async (_baseUrl: string) => ["mirror-m"] as string[]),
	applyTaskPatchToResultBranch: vi.fn(async (_input: Record<string, unknown>) => ({
		branchName: "spec/t1",
		headCommit: "abc",
	})),
	recordSelfObservation: vi.fn(),
}));
vi.mock("../../../src/core/lmstudio-loaded-models", () => ({
	fetchLoadedModelIdsCached: mocks.fetchLoadedModelIdsCached,
}));
vi.mock("../../../src/workspace/task-result-branches", () => ({
	applyTaskPatchToResultBranch: mocks.applyTaskPatchToResultBranch,
}));
vi.mock("../../../src/telemetry/self-observation-sink", () => ({ recordSelfObservation: mocks.recordSelfObservation }));
vi.mock("../../../src/nklein-agent/nklein-agent-sandbox", () => ({
	createAgentSandboxToolExecutors: vi.fn(() => ({})),
}));
vi.mock("../../../src/nklein-agent/nklein-agent-sandbox-extra-tools", () => ({
	createAgentSandboxExtraTools: vi.fn(() => ({})),
}));

import {
	createSpeculativeMirrorRunner,
	type SpeculativeMirrorRunnerDeps,
} from "../../../src/nklein-agent/nklein-speculative-mirror-runner";

function sandboxManager() {
	return {
		assertAvailable: vi.fn(async () => {}),
		prepareWorkspace: vi.fn(async () => ({ workdir: "/wd" })),
		disposeWorkspace: vi.fn(async () => {}),
		captureWorkspacePatch: vi.fn(async () => "PATCH"),
	};
}

function deps(over: Partial<SpeculativeMirrorRunnerDeps> = {}): SpeculativeMirrorRunnerDeps {
	return {
		getAgentSandboxManager: () => sandboxManager() as never,
		getTaskEntry: () => ({ summary: { state: "running" } }) as never,
		getLaunchConfig: () => ({ providerId: "lmstudio", modelId: "worker-m", baseUrl: "http://x/v1" }) as never,
		getPauseController: () => ({}) as never,
		setSandbox: vi.fn(),
		setResultBranch: vi.fn(),
		startRuntimeSession: vi.fn(async () => ({ result: {} })),
		cancelTaskTurn: vi.fn(async () => {}),
		clearTaskSessions: vi.fn(async () => {}),
		forgetSyntheticState: vi.fn(),
		...over,
	};
}

const input = {
	taskId: "t1",
	projectRepoPath: "/repo",
	baseRef: "main",
	prompt: "do",
	mirror: { providerId: "lmstudio", modelId: "mirror-m" },
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.fetchLoadedModelIdsCached.mockResolvedValue(["mirror-m"]);
});

describe("createSpeculativeMirrorRunner", () => {
	it("skips (false) when there is no sandbox manager", async () => {
		expect(
			await createSpeculativeMirrorRunner(deps({ getAgentSandboxManager: () => null })).runSpeculativeMirrorSession(
				input,
			),
		).toBe(false);
	});

	it("skips when the primary task is no longer running", async () => {
		const d = deps({ getTaskEntry: () => ({ summary: { state: "awaiting_review" } }) as never });
		expect(await createSpeculativeMirrorRunner(d).runSpeculativeMirrorSession(input)).toBe(false);
	});

	it("skips + records when the mirror model is no longer resident (never auto-loads)", async () => {
		mocks.fetchLoadedModelIdsCached.mockResolvedValueOnce(["some-other-model"]);
		const d = deps();
		expect(await createSpeculativeMirrorRunner(d).runSpeculativeMirrorSession(input)).toBe(false);
		expect(mocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ category: "speculative_mirror_residency_skip" }),
			}),
		);
	});

	it("cancelSpeculativeMirror flags the spec and aborts its turn; a subsequent run is skipped", async () => {
		const d = deps();
		const runner = createSpeculativeMirrorRunner(d);
		await runner.cancelSpeculativeMirror("t1");
		expect(d.cancelTaskTurn).toHaveBeenCalledWith("t1::spec");
		expect(await runner.runSpeculativeMirrorSession(input)).toBe(false); // canceled flag short-circuits
	});

	it("captures the candidate branch on a settled turn, and always tears down", async () => {
		const mgr = sandboxManager();
		const d = deps({ getAgentSandboxManager: () => mgr as never });
		const result = await createSpeculativeMirrorRunner(d).runSpeculativeMirrorSession(input);
		expect(result).toBe(true);
		expect(mgr.captureWorkspacePatch).toHaveBeenCalledWith("t1::spec", { baseRef: "main" });
		expect(mocks.applyTaskPatchToResultBranch).toHaveBeenCalled();
		expect(d.setResultBranch).toHaveBeenCalledWith("t1::spec", expect.objectContaining({ branchName: "spec/t1" }));
		// teardown
		expect(d.clearTaskSessions).toHaveBeenCalledWith("t1::spec");
		expect(mgr.disposeWorkspace).toHaveBeenCalledWith("t1::spec");
		expect(d.forgetSyntheticState).toHaveBeenCalledWith("t1::spec");
	});
});
