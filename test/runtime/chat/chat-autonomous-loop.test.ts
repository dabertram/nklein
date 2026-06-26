import { describe, expect, it } from "vitest";

import {
	type AutonomousChatAgentBudget,
	type AutonomousChatPlanProgress,
	type AutonomousChatTurnOutcome,
	runAutonomousChatAgent,
} from "../../../src/chat/chat-autonomous-loop";

const GENEROUS: AutonomousChatAgentBudget = { maxTurns: 10, maxWallTimeMs: 1_000_000, maxNoProgressTurns: 5 };

/** A `runTurn` that replays scripted outcomes by turn index (the last one repeats once exhausted). */
function scriptedTurns(outcomes: AutonomousChatTurnOutcome[]) {
	const calls: number[] = [];
	return {
		calls,
		runTurn: async (input: { goal: string; turnIndex: number }): Promise<AutonomousChatTurnOutcome> => {
			calls.push(input.turnIndex);
			return outcomes[Math.min(input.turnIndex, outcomes.length - 1)] as AutonomousChatTurnOutcome;
		},
	};
}

/** A `readPlanProgress` that replays a scripted sequence (the last value repeats). */
function scriptedProgress(sequence: AutonomousChatPlanProgress[]) {
	let i = 0;
	return async (): Promise<AutonomousChatPlanProgress> => {
		const value = sequence[Math.min(i, sequence.length - 1)] as AutonomousChatPlanProgress;
		i += 1;
		return value;
	};
}

const noProgress: AutonomousChatPlanProgress = { total: 3, done: 0 };
const frozenClock = () => 0;

describe("runAutonomousChatAgent", () => {
	it("completes when a turn reports the goal is done", async () => {
		const { runTurn, calls } = scriptedTurns([
			{ status: "progressed", text: "working", madeToolProgress: true },
			{ status: "goal_complete", text: "all done", madeToolProgress: true },
		]);
		const result = await runAutonomousChatAgent(
			{ goal: "ship it", budget: GENEROUS },
			{ runTurn, readPlanProgress: scriptedProgress([{ total: 2, done: 1 }]), now: frozenClock },
		);
		expect(result.stopReason).toBe("completed");
		expect(result.turns).toBe(2);
		expect(result.finalText).toBe("all done");
		expect(calls).toEqual([0, 1]);
	});

	it("pauses for the user on a clarifying question", async () => {
		const { runTurn } = scriptedTurns([{ status: "needs_user", text: "which database?", madeToolProgress: false }]);
		const result = await runAutonomousChatAgent(
			{ goal: "add persistence", budget: GENEROUS },
			{ runTurn, readPlanProgress: scriptedProgress([noProgress]), now: frozenClock },
		);
		expect(result.stopReason).toBe("paused_needs_user");
		expect(result.turns).toBe(1);
		expect(result.finalText).toBe("which database?");
	});

	it("completes when the focus chain reaches every step done, even without an explicit goal_complete", async () => {
		const { runTurn } = scriptedTurns([{ status: "progressed", text: "step", madeToolProgress: true }]);
		const result = await runAutonomousChatAgent(
			{ goal: "do the plan", budget: GENEROUS },
			{
				runTurn,
				// turn 0 → 1/2 done (continue), turn 1 → 2/2 done (complete).
				readPlanProgress: scriptedProgress([
					{ total: 2, done: 1 },
					{ total: 2, done: 2 },
				]),
				now: frozenClock,
			},
		);
		expect(result.stopReason).toBe("completed");
		expect(result.turns).toBe(2);
		expect(result.planProgress).toEqual({ total: 2, done: 2 });
	});

	it("stops at the turn budget when the goal never finishes", async () => {
		const { runTurn, calls } = scriptedTurns([{ status: "progressed", text: "still going", madeToolProgress: true }]);
		const result = await runAutonomousChatAgent(
			{ goal: "endless", budget: { maxTurns: 3, maxWallTimeMs: 1_000_000, maxNoProgressTurns: 99 } },
			{ runTurn, readPlanProgress: scriptedProgress([noProgress]), now: frozenClock },
		);
		expect(result.stopReason).toBe("budget_turns_exhausted");
		expect(result.turns).toBe(3);
		expect(calls).toEqual([0, 1, 2]);
	});

	it("stops at the wall-time budget before starting another turn", async () => {
		const { runTurn, calls } = scriptedTurns([{ status: "progressed", text: "slow", madeToolProgress: true }]);
		// now() is read once at start, then once per turn's up-front guard: [start 0, turn0 100 (ok), turn1 2000 (trip)].
		const clockValues = [0, 100, 2000];
		let tick = 0;
		const result = await runAutonomousChatAgent(
			{ goal: "slow work", budget: { maxTurns: 10, maxWallTimeMs: 1_000, maxNoProgressTurns: 99 } },
			{
				runTurn,
				readPlanProgress: scriptedProgress([noProgress]),
				now: () => clockValues[Math.min(tick++, clockValues.length - 1)] as number,
			},
		);
		expect(result.stopReason).toBe("budget_wall_time_exhausted");
		expect(result.turns).toBe(1);
		expect(calls).toEqual([0]); // exactly one turn ran before the budget tripped
	});

	it("parks as stalled after consecutive turns make no tool progress", async () => {
		const { runTurn, calls } = scriptedTurns([{ status: "progressed", text: "spinning", madeToolProgress: false }]);
		const result = await runAutonomousChatAgent(
			{ goal: "spin", budget: { maxTurns: 10, maxWallTimeMs: 1_000_000, maxNoProgressTurns: 2 } },
			{ runTurn, readPlanProgress: scriptedProgress([noProgress]), now: frozenClock },
		);
		expect(result.stopReason).toBe("stalled_no_progress");
		expect(result.turns).toBe(2);
		expect(calls).toEqual([0, 1]);
	});

	it("resets the no-progress streak when a later turn does make progress", async () => {
		const { runTurn } = scriptedTurns([
			{ status: "progressed", text: "no tools", madeToolProgress: false },
			{ status: "progressed", text: "used a tool", madeToolProgress: true },
			{ status: "goal_complete", text: "done", madeToolProgress: true },
		]);
		const result = await runAutonomousChatAgent(
			{ goal: "mixed", budget: { maxTurns: 10, maxWallTimeMs: 1_000_000, maxNoProgressTurns: 2 } },
			{ runTurn, readPlanProgress: scriptedProgress([noProgress]), now: frozenClock },
		);
		// streak hits 1 (turn0), resets at turn1 (progress), completes at turn2 — never reaching the limit of 2.
		expect(result.stopReason).toBe("completed");
		expect(result.turns).toBe(3);
	});
});
