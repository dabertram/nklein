import { beforeEach, describe, expect, it, vi } from "vitest";
import { createArchitectRunner } from "../../../src/nklein-agent/nklein-architect-runner";

/**
 * Coverage for a module the extended coverage audit found unexercised (2026-08-08).
 *
 * The bounded `::architect` session: one read-only pass that solves the card in prose and hands back an
 * implementation brief, so a weak model never splits its attention between solving and edit-format conformance.
 *
 * Its headline contract is a NEGATIVE one — "every degraded path resolves to null so the worker ALWAYS starts;
 * a failed architect phase costs one bounded session, never the card." A happy-path test cannot see any of
 * that, and the failure it guards against is the expensive direction: a card that never runs because an
 * optional enhancement threw. So each degradation is pinned separately, and each asserts null rather than the
 * weaker "it did not throw".
 *
 * The second concentration is the two things that must NOT leak: the recursion guard (an `::architect` session
 * spawning another architect is unbounded fan-out) and the model pin (`NKLEIN_ARCHITECT_MODEL` retargets the
 * architect only — the editor must keep the card's routed model, so the worker's launch config must come back
 * untouched).
 */
const WORKER_LAUNCH = { providerId: "lmstudio", modelId: "worker-model", contextWindow: 131_072 };

function harnessThatRuns(onBrief?: (submit: (brief: string) => void) => void, turns: unknown[] = []) {
	return {
		runBracketed: vi.fn(async (_config: unknown, body: (ctx: Record<string, unknown>) => Promise<unknown>) =>
			body({
				workspace: { workdir: "/sandbox/work" },
				deadlineMs: Date.now() + 60_000,
				runBoundedTurn: vi.fn(async (turn: unknown) => {
					turns.push(await turn);
				}),
			}),
		),
		onBrief,
	};
}

function makeDeps(over: Record<string, unknown> = {}) {
	const startRuntimeSession = vi.fn(async (input: { onArchitectBriefSubmitted?: (brief: string) => void }) => {
		input.onArchitectBriefSubmitted?.("THE BRIEF");
		return {};
	});
	return {
		getAgentSandboxManager: vi.fn(() => ({ id: "sandbox" })),
		getLaunchConfig: vi.fn(() => ({ ...WORKER_LAUNCH })),
		getPauseController: vi.fn(() => ({})),
		getHarness: vi.fn(() => harnessThatRuns()),
		startRuntimeSession,
		sendTaskSessionInput: vi.fn(async () => undefined),
		defaultTimeoutMs: 60_000,
		maxNudges: 2,
		...over,
		// biome-ignore lint/suspicious/noExplicitAny: the runner's dep surface is wide and fully injected.
	} as any;
}

let stderr: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	vi.clearAllMocks();
	delete process.env.NKLEIN_ARCHITECT_MODEL;
	stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
});

describe("every degraded path returns null so the worker still starts", () => {
	const run = (deps: unknown) =>
		// biome-ignore lint/suspicious/noExplicitAny: see makeDeps.
		createArchitectRunner(deps as any).runArchitectPhase({
			taskId: "t1",
			projectRepoPath: "/repo",
			baseRef: "main",
			taskPrompt: "do the thing",
		});

	it("returns null when there is no sandbox manager", async () => {
		const deps = makeDeps({ getAgentSandboxManager: vi.fn(() => null) });

		expect(await run(deps)).toBeNull();
		expect(deps.startRuntimeSession).not.toHaveBeenCalled();
	});

	it("returns null when the card has no launch config at all", async () => {
		const deps = makeDeps({ getLaunchConfig: vi.fn(() => null) });

		expect(await run(deps)).toBeNull();
		expect(deps.startRuntimeSession).not.toHaveBeenCalled();
	});

	it("returns null when the launch config is missing a provider or a model", async () => {
		// Half a launch config would start a session against an unresolved target; the two fields are checked
		// separately because either alone is enough to make the session meaningless.
		for (const partial of [{ modelId: "m" }, { providerId: "p" }]) {
			const deps = makeDeps({ getLaunchConfig: vi.fn(() => partial) });
			expect(await run(deps), JSON.stringify(partial)).toBeNull();
		}
	});

	it("returns null — not a rejection — when the bracketed run THROWS", async () => {
		// The expensive direction. An architect phase that rejects would propagate into card start, so an optional
		// enhancement failing would cost the card itself.
		const deps = makeDeps({
			getHarness: vi.fn(() => ({
				runBracketed: vi.fn(async () => {
					throw new Error("sandbox exploded");
				}),
			})),
		});

		await expect(run(deps)).resolves.toBeNull();
	});

	it("returns null when the session never submits a brief", async () => {
		// Submission is tool-only. A session that answers in prose instead of calling the tool yields nothing, and
		// the worker proceeds solo exactly as it did before the feature existed.
		const deps = makeDeps({ startRuntimeSession: vi.fn(async () => ({})) });

		expect(await run(deps)).toBeNull();
	});

	it("says WHY it skipped, on stderr", async () => {
		// A silent skip is indistinguishable from the feature being off; the operator needs to know which.
		await run(makeDeps({ getAgentSandboxManager: vi.fn(() => null) }));

		expect(stderr.mock.calls.map((call: unknown[]) => String(call[0])).join("")).toMatch(/no sandbox manager/);
	});
});

describe("the recursion guard", () => {
	const runFor = async (taskId: string) => {
		const deps = makeDeps();
		const result = await createArchitectRunner(deps).runArchitectPhase({
			taskId,
			projectRepoPath: "/repo",
			baseRef: "main",
			taskPrompt: "p",
		});
		return { result, deps };
	};

	it("refuses to spawn an architect for a DERIVED session", async () => {
		// An `::architect` session spawning another architect is unbounded fan-out, and each level costs a real
		// bounded model session. The guard is checked before anything else runs.
		const { result, deps } = await runFor("t1::architect");

		expect(result).toBeNull();
		expect(deps.getAgentSandboxManager).not.toHaveBeenCalled();
	});

	it("refuses for a review session too", async () => {
		expect((await runFor("t1::review")).result).toBeNull();
	});

	it("runs for an ordinary card", async () => {
		expect((await runFor("t1")).result).toBe("THE BRIEF");
	});
});

describe("which model the architect runs on", () => {
	const run = async (deps: unknown) =>
		// biome-ignore lint/suspicious/noExplicitAny: see makeDeps.
		await createArchitectRunner(deps as any).runArchitectPhase({
			taskId: "t1",
			projectRepoPath: "/repo",
			baseRef: "main",
			taskPrompt: "p",
		});

	it("inherits the worker's model when nothing pins it", async () => {
		const deps = makeDeps();
		await run(deps);

		expect(deps.startRuntimeSession.mock.calls[0]?.[0].launchConfig).toMatchObject({ modelId: "worker-model" });
	});

	it("uses NKLEIN_ARCHITECT_MODEL when it is set", async () => {
		process.env.NKLEIN_ARCHITECT_MODEL = "  fast-reasoner  ";
		const deps = makeDeps();
		await run(deps);

		expect(deps.startRuntimeSession.mock.calls[0]?.[0].launchConfig).toMatchObject({ modelId: "fast-reasoner" });
	});

	it("does NOT mutate the worker's launch config", async () => {
		// The editor must keep the card's routed model. A runner that assigned into the config it was handed,
		// rather than spreading it, would silently retarget the worker as a side effect of an optional phase —
		// and the returned brief would look exactly the same.
		process.env.NKLEIN_ARCHITECT_MODEL = "fast-reasoner";
		const workerLaunch = { ...WORKER_LAUNCH };
		await run(makeDeps({ getLaunchConfig: vi.fn(() => workerLaunch) }));

		expect(workerLaunch.modelId).toBe("worker-model");
	});

	it("treats a blank pin as unset", async () => {
		process.env.NKLEIN_ARCHITECT_MODEL = "   ";
		const deps = makeDeps();
		await run(deps);

		expect(deps.startRuntimeSession.mock.calls[0]?.[0].launchConfig).toMatchObject({ modelId: "worker-model" });
	});
});

describe("how the session is started", () => {
	const run = async (deps: unknown) =>
		// biome-ignore lint/suspicious/noExplicitAny: see makeDeps.
		await createArchitectRunner(deps as any).runArchitectPhase({
			taskId: "t1",
			projectRepoPath: "/repo",
			baseRef: "main",
			taskPrompt: "solve this",
		});

	it("runs under its own ::architect id, not the card's", async () => {
		// Sharing the card's id would let the architect's session state overwrite the worker's.
		const deps = makeDeps();
		await run(deps);

		expect(deps.startRuntimeSession.mock.calls[0]?.[0].taskId).toBe("t1::architect");
	});

	it("asks for a MINIMAL context scope — the fresh window is the point", async () => {
		// Inheriting the worker's accumulated context would defeat the whole reason for a separate phase.
		const deps = makeDeps();
		await run(deps);

		expect(deps.startRuntimeSession.mock.calls[0]?.[0].contextScope).toBe("minimal");
	});

	it("works in the sandbox workspace while rooting the workspace at the real repo", async () => {
		const deps = makeDeps();
		await run(deps);

		const started = deps.startRuntimeSession.mock.calls[0]?.[0];
		expect(started.cwd).toBe("/sandbox/work");
		expect(started.workspaceRoot).toBe("/repo");
	});

	it("carries the card's prompt into the seed", async () => {
		const deps = makeDeps();
		await run(deps);

		expect(String(deps.startRuntimeSession.mock.calls[0]?.[0].prompt)).toContain("solve this");
	});
});

describe("nudging", () => {
	const runWith = async (deps: unknown) =>
		// biome-ignore lint/suspicious/noExplicitAny: see makeDeps.
		await createArchitectRunner(deps as any).runArchitectPhase({
			taskId: "t1",
			projectRepoPath: "/repo",
			baseRef: "main",
			taskPrompt: "p",
		});

	it("does not nudge a session that already submitted", async () => {
		// A nudge after the brief arrived spends a model turn to ask for something already in hand.
		const deps = makeDeps();
		await runWith(deps);

		expect(deps.sendTaskSessionInput).not.toHaveBeenCalled();
	});

	it("nudges at most maxNudges times, then gives up with null", async () => {
		// The bound is what keeps a failed phase to ONE bounded session rather than an open-ended retry loop.
		const deps = makeDeps({ startRuntimeSession: vi.fn(async () => ({})), maxNudges: 3 });

		expect(await runWith(deps)).toBeNull();
		expect(deps.sendTaskSessionInput).toHaveBeenCalledTimes(3);
	});

	it("never nudges when maxNudges is zero", async () => {
		const deps = makeDeps({ startRuntimeSession: vi.fn(async () => ({})), maxNudges: 0 });

		expect(await runWith(deps)).toBeNull();
		expect(deps.sendTaskSessionInput).not.toHaveBeenCalled();
	});

	it("asks for the TOOL, not for prose", async () => {
		// The submission channel is structured; a nudge that invited a prose answer would produce a reply the
		// runner cannot read, and the phase would still yield null.
		const deps = makeDeps({ startRuntimeSession: vi.fn(async () => ({})) });
		await runWith(deps);

		const nudge = String(deps.sendTaskSessionInput.mock.calls[0]?.[1]);
		expect(nudge).toMatch(/submit_implementation_brief/);
		expect(nudge).toMatch(/Do not reply in prose/i);
	});

	it("stops nudging once the deadline has passed", async () => {
		// The deadline is the other half of the bound: nudges must not outlive the bracketed window even if the
		// count would allow more.
		const deps = makeDeps({
			startRuntimeSession: vi.fn(async () => ({})),
			maxNudges: 5,
			getHarness: vi.fn(() => ({
				runBracketed: vi.fn(async (_config: unknown, body: (ctx: Record<string, unknown>) => Promise<unknown>) =>
					body({
						workspace: { workdir: "/sandbox/work" },
						deadlineMs: Date.now() - 1,
						runBoundedTurn: vi.fn(async (turn: unknown) => {
							await turn;
						}),
					}),
				),
			})),
		});

		expect(await runWith(deps)).toBeNull();
		expect(deps.sendTaskSessionInput).not.toHaveBeenCalled();
	});
});
