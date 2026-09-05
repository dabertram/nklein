import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/telemetry/self-observation-sink", () => ({ recordSelfObservation: vi.fn() }));
vi.mock("../../../src/core/lmstudio-loaded-model-descriptors", () => ({
	// Restart-durability fallback (2026-09-04): unit tests must not leak to a live gateway — empty by default;
	// individual tests override via the mocked module.
	fetchLoadedModelDescriptors: vi.fn(async () => []),
	pickReviewFallbackDescriptor: vi.fn((loaded: unknown[]) => (loaded.length > 0 ? loaded[0] : null)),
}));
vi.mock("../../../src/nklein-agent/nklein-agent-sandbox", () => ({
	createAgentSandboxToolExecutors: vi.fn(() => ({})),
}));
vi.mock("../../../src/nklein-agent/nklein-agent-sandbox-extra-tools", () => ({
	createAgentSandboxExtraTools: vi.fn(() => ({})),
}));
vi.mock("../../../src/nklein-agent/nklein-merge-resolution-tool", () => ({
	buildMergeResolutionSeedPrompt: vi.fn(() => "seed"),
}));

import {
	createMergeResolutionRunner,
	type MergeResolutionRunnerDeps,
} from "../../../src/nklein-agent/nklein-merge-resolution-runner";

type ExecResult = { exitCode: number | null; stdout: string; stderr: string };
const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "" });

/** Route a sandbox `exec` by the command tokens. Overrides replace a specific step's result. */
function execRouter(over: Record<string, ExecResult> = {}) {
	return vi.fn(async (_taskId: string, args: string[]): Promise<ExecResult> => {
		const cmd = args.join(" ");
		if (cmd.includes("merge --no-ff")) return over.merge ?? { exitCode: 1, stdout: "", stderr: "CONFLICT" };
		if (cmd.includes("diff --name-only --diff-filter=U")) return over.diff ?? ok("a.txt\0");
		if (args[0] === "wc") return over.wc ?? ok("100 a.txt");
		if (args[0] === "grep" && args[1] === "-Iq") return over.textProbe ?? ok(); // text
		if (args[0] === "grep" && args[1] === "-l") return over.markerScan ?? { exitCode: 1, stdout: "", stderr: "" }; // no markers
		if (cmd.includes("rev-parse -q --verify MERGE_HEAD")) return over.mergeHead ?? ok("sha");
		if (cmd.includes("commit -am")) return over.commit ?? ok();
		if (args[0] === "test" && args[1] === "-L") return over.symlink ?? { exitCode: 1, stdout: "", stderr: "" }; // not symlink
		if (args[0] === "cat") return over.cat ?? ok("resolved content");
		return ok();
	});
}

function manager(exec = execRouter()) {
	return {
		assertAvailable: vi.fn(async () => {}),
		prepareWorkspace: vi.fn(async () => ({ workdir: "/wd" })),
		disposeWorkspace: vi.fn(async () => {}),
		exec,
	};
}

function deps(over: Partial<MergeResolutionRunnerDeps> = {}): MergeResolutionRunnerDeps {
	return {
		getAgentSandboxManager: () => manager() as never,
		getLaunchConfig: () => ({ providerId: "lmstudio", modelId: "worker-m" }) as never,
		pickEscalationModel: async () => ({ providerId: "lmstudio", modelId: "critic-m" }),
		getPauseController: () => ({}) as never,
		setSandbox: vi.fn(),
		// The model turn delivers its verdict through the onMergeResolutionSubmitted callback.
		startRuntimeSession: vi.fn(async (input) => {
			input.onMergeResolutionSubmitted?.({ outcome: "resolved" } as never);
			return { result: {} };
		}),
		sendTaskSessionInput: vi.fn(async () => {}),
		clearTaskSessions: vi.fn(async () => {}),
		forgetSyntheticState: vi.fn(),
		...over,
	};
}

const input = {
	taskId: "t1",
	projectRepoPath: "/repo",
	mainRef: "main",
	resultCommit: "sha",
	conflictedPaths: ["a.txt"],
};

beforeEach(() => vi.clearAllMocks());

describe("createMergeResolutionRunner", () => {
	it("returns null with no sandbox manager", async () => {
		expect(
			await createMergeResolutionRunner(deps({ getAgentSandboxManager: () => null })).runMergeResolutionSession(
				input,
			),
		).toBeNull();
	});

	it("live 2026-09-05: the reproduction merge pins a git identity and a failed merge reports its exit + stderr", async () => {
		// The sandbox's fresh HOME has no .gitconfig: `merge --no-ff` died on "unable to auto-detect email
		// address" (exit 128, zero unmerged paths) and the check read it as "diverged from the host conflict".
		const exec = execRouter({
			merge: { exitCode: 128, stdout: "", stderr: "fatal: unable to auto-detect email address (got 'u@host')" },
			diff: ok(""),
		});
		const mgr = manager(exec);
		const d = deps({ getAgentSandboxManager: () => mgr as never });
		expect(await createMergeResolutionRunner(d).runMergeResolutionSession(input)).toBeNull();
		const mergeCall = exec.mock.calls.find(([, args]) => args.join(" ").includes("merge --no-ff"));
		expect(mergeCall?.[1]).toEqual(
			expect.arrayContaining([
				"-c",
				"user.name=nklein-merge-resolution",
				"user.email=merge-resolution@nklein.local",
			]),
		);
		const { recordSelfObservation } = await import("../../../src/telemetry/self-observation-sink");
		const messages = (recordSelfObservation as ReturnType<typeof vi.fn>).mock.calls.map(
			([event]) => (event as { message: string }).message,
		);
		expect(
			messages.some((message) => message.includes("git merge exit 128") && message.includes("auto-detect")),
		).toBe(true);
	});

	it("returns null when no model resolves ANYWHERE (preference disabled, no loaded fallback)", async () => {
		process.env.NKLEIN_MERGE_FALLBACK_MODEL = ""; // explicit empty = no preferred model
		try {
			const d = deps({ pickEscalationModel: async () => null, getLaunchConfig: () => null });
			expect(await createMergeResolutionRunner(d).runMergeResolutionSession(input)).toBeNull();
		} finally {
			delete process.env.NKLEIN_MERGE_FALLBACK_MODEL;
		}
	});

	it("falls back to the first LOADED model when the launch config is gone (post-restart merge conflicts)", async () => {
		const { fetchLoadedModelDescriptors } = await import("../../../src/core/lmstudio-loaded-model-descriptors");
		(fetchLoadedModelDescriptors as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
			{ runtimeId: "loaded-model-1", modelKey: "loaded-model-1", isEmbedding: false },
		]);
		const mgr = manager(execRouter({ merge: ok() })); // clean reproduction — no model turn needed
		const d = deps({
			pickEscalationModel: async () => null,
			getLaunchConfig: () => null,
			getAgentSandboxManager: () => mgr as never,
		});
		expect(await createMergeResolutionRunner(d).runMergeResolutionSession(input)).toEqual({ outcome: "clean" });
	});

	it("returns {clean} without a model turn when the sandbox merge reproduction is conflict-free", async () => {
		const mgr = manager(execRouter({ merge: ok() })); // exit 0 = clean
		const d = deps({ getAgentSandboxManager: () => mgr as never });
		expect(await createMergeResolutionRunner(d).runMergeResolutionSession(input)).toEqual({ outcome: "clean" });
		expect(d.startRuntimeSession).not.toHaveBeenCalled();
	});

	it("fail-safes to null when the sandbox conflict set diverges from the host's", async () => {
		const mgr = manager(execRouter({ diff: ok("other.txt\0") })); // sandbox conflicts != host [a.txt]
		const d = deps({ getAgentSandboxManager: () => mgr as never });
		expect(await createMergeResolutionRunner(d).runMergeResolutionSession(input)).toBeNull();
		expect(d.startRuntimeSession).not.toHaveBeenCalled();
	});

	it("resolves end-to-end: reproduce → verify → turn → marker-scan clean → commit → capture", async () => {
		const mgr = manager();
		const d = deps({ getAgentSandboxManager: () => mgr as never });
		const result = await createMergeResolutionRunner(d).runMergeResolutionSession(input);
		expect(result).toEqual({ outcome: "resolved", resolvedFiles: [{ path: "a.txt", content: "resolved content" }] });
		expect(d.forgetSyntheticState).toHaveBeenCalledWith("t1::merge"); // teardown
	});

	it("fail-safes to null when conflict markers remain after the agent claims resolved", async () => {
		const mgr = manager(execRouter({ markerScan: { exitCode: 0, stdout: "a.txt", stderr: "" } })); // markers found
		const d = deps({ getAgentSandboxManager: () => mgr as never });
		expect(await createMergeResolutionRunner(d).runMergeResolutionSession(input)).toBeNull();
	});

	it("returns cannot_resolve when a conflicted file is over the byte cap", async () => {
		const mgr = manager(execRouter({ wc: ok(`${2 * 1024 * 1024} a.txt`) }));
		const d = deps({ getAgentSandboxManager: () => mgr as never });
		const result = await createMergeResolutionRunner(d).runMergeResolutionSession(input);
		expect(result).toMatchObject({ outcome: "cannot_resolve" });
	});

	it("fail-safes to null when a conflicted path is a symlink in the sandbox", async () => {
		const mgr = manager(execRouter({ symlink: ok() })); // test -L exit 0 = symlink
		const d = deps({ getAgentSandboxManager: () => mgr as never });
		expect(await createMergeResolutionRunner(d).runMergeResolutionSession(input)).toBeNull();
	});
});
