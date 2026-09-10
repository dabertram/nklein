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
	chooseMergeNudgePrompt,
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

	it("live 2026-09-05: the seed carries the conflict hunks read from the sandbox tree", async () => {
		const marked = "a\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> sha\nz\n";
		const exec = execRouter({ cat: ok(marked) });
		const d = deps({ getAgentSandboxManager: () => manager(exec) as never });
		await createMergeResolutionRunner(d).runMergeResolutionSession(input);
		const { buildMergeResolutionSeedPrompt } = await import("../../../src/nklein-agent/nklein-merge-resolution-tool");
		const seedInput = (buildMergeResolutionSeedPrompt as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
			conflictDigest?: { text: string; omittedPaths: string[] };
		};
		expect(seedInput.conflictDigest?.text).toContain("### a.txt — 1 conflict");
		expect(seedInput.conflictDigest?.text).toContain("<<<<<<< HEAD");
		expect(seedInput.conflictDigest?.omittedPaths).toEqual([]);
	});

	it("live 2026-09-05: a first turn still exploring at half the budget is cancelled and hurried to write", async () => {
		let releaseTurn: (() => void) | null = null;
		const cancelTaskTurn = vi.fn(async () => {
			releaseTurn?.();
		});
		const sendTaskSessionInput = vi.fn(async (_taskId: string, _prompt: string) => {});
		const d = deps({
			cancelTaskTurn,
			sendTaskSessionInput,
			// The first turn never ends on its own — it only settles when the runner cancels it.
			startRuntimeSession: vi.fn(
				() =>
					new Promise((resolve) => {
						releaseTurn = () => resolve({ result: {} } as never);
					}),
			) as unknown as MergeResolutionRunnerDeps["startRuntimeSession"],
		});
		const started = Date.now();
		await createMergeResolutionRunner(d).runMergeResolutionSession({ ...input, timeoutMs: 2_000 });
		expect(cancelTaskTurn).toHaveBeenCalledWith("t1::merge");
		expect(Date.now() - started).toBeGreaterThanOrEqual(900); // ~half of the 2s budget, not the full deadline
		expect(sendTaskSessionInput.mock.calls[0]?.[1]).toContain("half of your merge budget");
	});

	it("live 2026-09-05: a merge model that differs from the worker's does not inherit the worker's context window", async () => {
		const d = deps({
			getLaunchConfig: () => ({ providerId: "lmstudio", modelId: "worker-m", contextWindow: 80_000 }) as never,
			pickEscalationModel: async () => ({ providerId: "lmstudio", modelId: "critic-m" }),
		});
		await createMergeResolutionRunner(d).runMergeResolutionSession(input);
		const launch = (d.startRuntimeSession as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.launchConfig;
		expect(launch).toMatchObject({ modelId: "critic-m", contextWindow: null });
		const same = deps({
			getLaunchConfig: () => ({ providerId: "lmstudio", modelId: "worker-m", contextWindow: 80_000 }) as never,
			pickEscalationModel: async () => null,
		});
		await createMergeResolutionRunner(same).runMergeResolutionSession(input);
		const sameLaunch = (same.startRuntimeSession as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.launchConfig;
		expect(sameLaunch).toMatchObject({ modelId: "worker-m", contextWindow: 80_000 });
	});

	it("live 2026-09-05: a round that ends without a verdict but with every file marker-free is salvaged as resolved", async () => {
		const d = deps({
			// The turn ends without ever calling submit_merge_resolution.
			startRuntimeSession: vi.fn(async () => ({
				result: {},
			})) as unknown as MergeResolutionRunnerDeps["startRuntimeSession"],
		});
		const result = await createMergeResolutionRunner(d).runMergeResolutionSession(input);
		expect(result).toEqual({ outcome: "resolved", resolvedFiles: [{ path: "a.txt", content: "resolved content" }] });
		const { recordSelfObservation } = await import("../../../src/telemetry/self-observation-sink");
		const categories = (recordSelfObservation as ReturnType<typeof vi.fn>).mock.calls.map(
			([event]) => (event as { metadata?: { category?: string } }).metadata?.category,
		);
		expect(categories).toContain("merge_resolution_salvaged");
	});

	it("live 2026-09-05: partial progress persists across rounds and is pre-applied into the next sandbox", async () => {
		const { mkdtempSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const { readFile } = await import("node:fs/promises");
		const repo = mkdtempSync(join(tmpdir(), "nklein-merge-progress-"));
		const twoFiles = { ...input, projectRepoPath: repo, conflictedPaths: ["a.txt", "b.txt"] };
		// Round 1: a.txt is clean, b.txt still carries markers; no verdict.
		const exec1 = vi.fn(async (_taskId: string, args: string[]): Promise<ExecResult> => {
			const cmd = args.join(" ");
			if (cmd.includes("merge --no-ff")) return { exitCode: 1, stdout: "", stderr: "CONFLICT" };
			if (cmd.includes("diff --name-only --diff-filter=U")) return ok("a.txt\0b.txt\0");
			if (args[0] === "wc") return ok("100 x");
			if (args[0] === "grep" && args[1] === "-Iq") return ok();
			if (args[0] === "grep" && args[1] === "-l")
				return args.at(-1) === "b.txt" ? ok("b.txt") : { exitCode: 1, stdout: "", stderr: "" };
			if (args[0] === "test" && args[1] === "-L") return { exitCode: 1, stdout: "", stderr: "" };
			if (args[0] === "cat")
				return ok(args.at(-1) === "a.txt" ? "merged a" : "<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> sha\n");
			return ok();
		});
		const d1 = deps({
			getAgentSandboxManager: () => manager(exec1) as never,
			startRuntimeSession: vi.fn(async () => ({
				result: {},
			})) as unknown as MergeResolutionRunnerDeps["startRuntimeSession"],
		});
		expect(await createMergeResolutionRunner(d1).runMergeResolutionSession(twoFiles)).toBeNull();
		const progress = JSON.parse(
			await readFile(join(repo, ".nklein", "nklein", "merge-progress", "t1.json"), "utf8"),
		) as { resultCommit: string; files: { path: string; content: string }[] };
		expect(progress.resultCommit).toBe("sha");
		expect(progress.files).toEqual([{ path: "a.txt", content: "merged a" }]);
		// Round 2: the persisted a.txt is written into the fresh sandbox before the agent starts, and the seed says so.
		const exec2 = vi.fn(
			async (_taskId: string, args: string[], options?: { stdin?: string }): Promise<ExecResult> => {
				const cmd = args.join(" ");
				if (cmd.includes("merge --no-ff")) return { exitCode: 1, stdout: "", stderr: "CONFLICT" };
				if (cmd.includes("diff --name-only --diff-filter=U")) return ok("a.txt\0b.txt\0");
				if (args[0] === "wc") return ok("100 x");
				if (args[0] === "grep" && args[1] === "-Iq") return ok();
				if (args[0] === "sh" && options?.stdin === "merged a") return ok();
				if (args[0] === "grep" && args[1] === "-l")
					return args.at(-1) === "b.txt" ? ok("b.txt") : { exitCode: 1, stdout: "", stderr: "" };
				if (args[0] === "test" && args[1] === "-L") return { exitCode: 1, stdout: "", stderr: "" };
				if (args[0] === "cat")
					return ok(args.at(-1) === "a.txt" ? "merged a" : "<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> sha\n");
				return ok();
			},
		);
		const d2 = deps({ getAgentSandboxManager: () => manager(exec2 as never) as never });
		await createMergeResolutionRunner(d2).runMergeResolutionSession(twoFiles);
		expect(
			exec2.mock.calls.some(
				([, args, options]) => args[0] === "sh" && args.at(-1) === "a.txt" && options?.stdin === "merged a",
			),
		).toBe(true);
		const { buildMergeResolutionSeedPrompt } = await import("../../../src/nklein-agent/nklein-merge-resolution-tool");
		const seedInput = (buildMergeResolutionSeedPrompt as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
			alreadyResolvedPaths?: string[];
		};
		expect(seedInput.alreadyResolvedPaths).toEqual(["a.txt"]);
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

/**
 * Live 2026-09-10: the whole-suite run failed here while the same test passed in isolation, twice.
 *
 * The nudge loop re-derived "are we past half the budget?" from the clock, while the hurry timer that had just
 * cancelled the turn already knew the answer. From a 2-second budget upward the two name the same instant — the
 * timer fires at `max(1s, timeoutMs/2)`, the loop tested `elapsed >= timeoutMs/2` — so a timer firing a fraction
 * of a millisecond early, which Node permits and a loaded machine encourages, sent the generic "you ended without
 * submitting" nudge to the one turn that most needed redirecting to writing. The flake was the defect showing
 * itself, not noise.
 */
describe("chooseMergeNudgePrompt", () => {
	const budget = { timeoutMs: 2_000, alreadyHurried: false };

	it("hurries on the recorded cancel even when the clock has not caught up", () => {
		const chosen = chooseMergeNudgePrompt({ ...budget, hurryCancelled: true, elapsedMs: 999 });
		expect(chosen.prompt).toContain("half of your merge budget");
		expect(chosen.hurrying).toBe(true);
	});

	it("still hurries on elapsed time alone, for a runner given no cancel dep to fire", () => {
		expect(chooseMergeNudgePrompt({ ...budget, hurryCancelled: false, elapsedMs: 1_000 }).prompt).toContain(
			"half of your merge budget",
		);
	});

	it("gives the plain nudge early in the budget with nothing cancelled", () => {
		const chosen = chooseMergeNudgePrompt({ ...budget, hurryCancelled: false, elapsedMs: 999 });
		expect(chosen.prompt).toContain("You ended your turn without calling");
		expect(chosen.hurrying).toBe(false);
	});

	it("says the hurry-up once — a second one wastes a turn repeating what the model already ignored", () => {
		const chosen = chooseMergeNudgePrompt({
			...budget,
			hurryCancelled: true,
			elapsedMs: 1_500,
			alreadyHurried: true,
		});
		expect(chosen.prompt).toContain("You ended your turn without calling");
		// Still reports the state truthfully; only the prompt choice changes.
		expect(chosen.hurrying).toBe(true);
	});
});
