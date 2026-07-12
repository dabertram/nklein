import { describe, expect, it, vi } from "vitest";
import {
	buildDevTestSeedStartPayload,
	type DevTestHarnessDeps,
	type DevTestStateRead,
	runDevTestProject,
} from "../../../src/nklein-agent/nklein-dev-test-harness";
import type { NKleinDevTestProjectScenario } from "../../../src/nklein-agent/nklein-dev-test-project";

const SCENARIO: NKleinDevTestProjectScenario = {
	id: "audio-vst-psytrance",
	title: "Audio VST psytrance synth",
	prompt: "Build a psytrance kick/bass VST.",
	specification: "spec",
	acceptanceCommand: "npm test",
};

function board(columns: Record<string, number>): DevTestStateRead {
	return {
		runtimeReachable: true,
		board: {
			columns: Object.entries(columns).map(([id, count]) => ({
				id,
				cards: Array.from({ length: count }, () => ({})),
			})),
		},
	};
}

function makeDeps(reads: DevTestStateRead[], overrides: Partial<DevTestHarnessDeps> = {}): DevTestHarnessDeps {
	let index = 0;
	return {
		startSeedTask: vi.fn(async () => ({ ok: true })),
		readState: vi.fn(async () => reads[Math.min(index++, reads.length - 1)]),
		sleep: vi.fn(async () => {}),
		now: vi.fn(() => 0),
		...overrides,
	};
}

describe("buildDevTestSeedStartPayload", () => {
	it("produces a UI-equivalent start payload (taskTitle, startInPlanMode, baseRef, agentId)", () => {
		const payload = buildDevTestSeedStartPayload({ scenario: SCENARIO, seedTaskId: "seed-1", baseRef: "main" });
		expect(payload).toEqual({
			taskId: "seed-1",
			prompt: SCENARIO.prompt,
			taskTitle: SCENARIO.title,
			startInPlanMode: true,
			baseRef: "main",
			agentId: "nklein",
		});
	});
});

describe("runDevTestProject", () => {
	it("returns completed when every non-trash card finishes", async () => {
		const deps = makeDeps([board({ in_progress: 2 }), board({ completed: 2, trash: 1 })]);
		const result = await runDevTestProject({ scenario: SCENARIO, seedTaskId: "seed-1", baseRef: "main" }, deps);
		expect(result.classification.outcome).toBe("completed");
		expect(result.started).toBe(true);
	});

	it("classifies an operator-parked card as needs_attention, not stagnant (the live §12 turn-loop park)", async () => {
		// The exact live 2026-07-12 shape: 1 card in planning, its session awaiting_review+attention, nothing active.
		const parked: DevTestStateRead = { ...board({ planning: 1 }), activeSessionCount: 0, attentionCardCount: 1 };
		const deps = makeDeps([parked]);
		const result = await runDevTestProject(
			{ scenario: SCENARIO, seedTaskId: "seed-1", baseRef: "main", stablePollsUntilSettled: 2 },
			deps,
		);
		expect(result.classification.outcome).toBe("needs_attention");
		expect(result.classification.summary).toMatch(/Needs your attention/);
	});

	it("does NOT false-green when a decompose seed completes a beat before its child materializes", async () => {
		// Observed live (2026-07-11): a plan-mode smoke seed reached Completed, and for one poll the board showed
		// completed:1 with nothing else — a beat BEFORE its spawned child card appeared. The child then sat stuck in
		// Review. Breaking on that single transient poll reported a false "completed". The confirm-complete guard must
		// keep polling until the pending child surfaces, then classify the run by its real (blocked) state.
		const reads = [
			board({ in_progress: 1 }), // seed working
			board({ completed: 1 }), // TRANSIENT window: seed done, child not yet on the board
			board({ completed: 1, review: 1 }), // child materialized, stuck in review
		];
		const deps = makeDeps(reads);
		const result = await runDevTestProject(
			{ scenario: SCENARIO, seedTaskId: "seed-1", baseRef: "main", stablePollsUntilSettled: 2 },
			deps,
		);
		expect(result.classification.outcome).not.toBe("completed");
		expect(result.classification.outcome).toBe("blocked_by_review_cards");
		expect(result.finalCounts.review).toBe(1);
	});

	it("reports acceptance_green_workflow_incomplete when settled with cards left and acceptance green", async () => {
		const settled = board({ completed: 8, review: 2, planning: 3 });
		const deps = makeDeps([settled], { runAcceptance: vi.fn(async () => true) });
		const result = await runDevTestProject(
			{ scenario: SCENARIO, seedTaskId: "seed-1", baseRef: "main", stablePollsUntilSettled: 2 },
			deps,
		);
		expect(result.classification.outcome).toBe("acceptance_green_workflow_incomplete");
		expect(result.finalCounts.review).toBe(2);
	});

	it("degrades to runtime_down when the runtime becomes unreachable", async () => {
		const deps = makeDeps([
			board({ in_progress: 2 }),
			{
				runtimeReachable: false,
				board: {
					columns: [
						{ id: "completed", cards: [{}] },
						{ id: "review", cards: [{}] },
					],
				},
			},
		]);
		const result = await runDevTestProject({ scenario: SCENARIO, seedTaskId: "seed-1", baseRef: "main" }, deps);
		expect(result.classification.outcome).toBe("runtime_down");
		expect(result.runtimeReachable).toBe(false);
	});

	it("stops after maxWaitMs even if work never settles", async () => {
		let clock = 0;
		const deps = makeDeps([board({ in_progress: 1 })], {
			now: vi.fn(() => {
				const value = clock;
				clock += 400;
				return value;
			}),
		});
		const result = await runDevTestProject(
			{ scenario: SCENARIO, seedTaskId: "seed-1", baseRef: "main", maxWaitMs: 1000, pollIntervalMs: 1 },
			deps,
		);
		// Loop is bounded; it does not hang and produces a classification.
		expect(result.classification.outcome).not.toBe("completed");
		expect(result.polls).toBeLessThan(10);
	});
});

describe("runDevTestProject — session-activity-aware settle (slow-turn guard, §5.AI)", () => {
	function planningWithActivity(activeSessionCount: number): DevTestStateRead {
		return {
			runtimeReachable: true,
			activeSessionCount,
			board: { columns: [{ id: "planning", cards: [{}] }] },
		};
	}

	it("does NOT settle 'stagnant' while a session is actively processing, even with an unchanged board", async () => {
		// Board stays planning:1 throughout (e.g. a slow decompose turn under Low Power). While the session is active
		// (3 reads) the monitor must NOT accumulate toward settle; only after it goes inactive do unchanged polls count.
		const reads = [
			planningWithActivity(1),
			planningWithActivity(1),
			planningWithActivity(1),
			planningWithActivity(0),
			planningWithActivity(0),
			planningWithActivity(0),
		];
		const deps = makeDeps(reads);
		const result = await runDevTestProject(
			{ scenario: SCENARIO, seedTaskId: "s", baseRef: "main", stablePollsUntilSettled: 2 },
			deps,
		);
		// Did not settle during the 3 active polls; only the unchanged+inactive polls settle it ⇒ at least 5 polls.
		expect(result.polls).toBeGreaterThanOrEqual(5);
		expect(result.classification.outcome).not.toBe("completed");
	});

	it("still settles promptly on an unchanged board when NO session is active", async () => {
		const deps = makeDeps([planningWithActivity(0)]);
		const result = await runDevTestProject(
			{ scenario: SCENARIO, seedTaskId: "s", baseRef: "main", stablePollsUntilSettled: 2 },
			deps,
		);
		expect(result.polls).toBeLessThanOrEqual(3);
	});
});
