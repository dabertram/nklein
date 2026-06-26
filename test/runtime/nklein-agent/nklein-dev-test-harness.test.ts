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
