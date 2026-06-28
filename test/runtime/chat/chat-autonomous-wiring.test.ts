import { describe, expect, it } from "vitest";

import type { ChatAgentStep } from "../../../src/chat/chat-agent-loop";
import type { AutonomousControlToolset } from "../../../src/chat/chat-autonomous-control-tools";
import type { AutonomousChatAgentBudget } from "../../../src/chat/chat-autonomous-loop";
import {
	buildAutonomousChatTurnRunner,
	readAutonomousChatPlanProgress,
	runAutonomousChatSession,
} from "../../../src/chat/chat-autonomous-wiring";
import type { ChatAgentToolDeps } from "../../../src/chat/chat-service";
import type { FocusChain } from "../../../src/core/focus-chain";

const STUB_TOOL_DEPS: ChatAgentToolDeps = {
	model: async () => ({ text: "", toolCalls: [] }),
	executeTool: async (call) => ({ callId: call.id, content: "" }),
	appendToolExchange: (messages) => [...messages],
};
const BUDGET: AutonomousChatAgentBudget = { maxTurns: 5, maxWallTimeMs: 1_000_000, maxNoProgressTurns: 3 };

function step(name: string): ChatAgentStep {
	return { toolCall: { id: `c-${name}`, name, arguments: {} }, result: { callId: `c-${name}`, content: "ok" } };
}

describe("readAutonomousChatPlanProgress", () => {
	it("counts done + skipped steps as resolved so it matches the focus chain's own completion", async () => {
		const chain: FocusChain = {
			steps: [
				{ text: "a", status: "done" },
				{ text: "b", status: "skipped" },
				{ text: "c", status: "pending" },
				{ text: "d", status: "in_progress" },
			],
			updatedAt: 0,
		};
		const progress = await readAutonomousChatPlanProgress("s1", { readFocusChain: async () => chain });
		expect(progress).toEqual({ total: 4, done: 2 });
	});

	it("returns an empty plan when there is no focus chain yet", async () => {
		const progress = await readAutonomousChatPlanProgress("s1", { readFocusChain: async () => null });
		expect(progress).toEqual({ total: 0, done: 0 });
	});
});

describe("buildAutonomousChatTurnRunner", () => {
	it("issues a plan-then-execute directive on turn 0 and a continue directive afterwards", async () => {
		const directives: string[] = [];
		const runTurn = buildAutonomousChatTurnRunner({
			runTurnWithControls: async ({ goalDirective }) => {
				directives.push(goalDirective);
				return { loopResult: { finalText: "ok", steps: [step("update_focus_chain")] } };
			},
		});
		await runTurn({ goal: "build X", turnIndex: 0 });
		await runTurn({ goal: "build X", turnIndex: 1 });
		expect(directives[0]).toContain("First lay out your plan");
		expect(directives[0]).toContain("build X");
		expect(directives[1]).toContain("Continue working autonomously");
	});

	it("interprets a control-tool completion fired during the turn as goal_complete", async () => {
		const runTurn = buildAutonomousChatTurnRunner({
			runTurnWithControls: async ({ controls }: { controls: AutonomousControlToolset }) => {
				// Simulate the agent calling declare_goal_complete during the turn (the tool mutates the shared signals).
				const done = controls.tools.find((tool) => tool.name === "declare_goal_complete");
				await done?.run({ summary: "Finished." });
				return {
					loopResult: { finalText: "wrapping up", steps: [step("apply_patch"), step("declare_goal_complete")] },
				};
			},
		});
		const outcome = await runTurn({ goal: "build X", turnIndex: 2 });
		expect(outcome.status).toBe("goal_complete");
		expect(outcome.text).toBe("Finished.");
		expect(outcome.madeToolProgress).toBe(true); // apply_patch is a non-control step
	});

	it("interprets no control signal as progressed", async () => {
		const runTurn = buildAutonomousChatTurnRunner({
			runTurnWithControls: async () => ({
				loopResult: { finalText: "did a thing", steps: [step("run_command")] },
			}),
		});
		const outcome = await runTurn({ goal: "build X", turnIndex: 1 });
		expect(outcome.status).toBe("progressed");
		expect(outcome.text).toBe("did a thing");
		expect(outcome.madeToolProgress).toBe(true);
	});
});

describe("runAutonomousChatSession", () => {
	it("pauses for the user when no workspace / loaded model is available, without running a turn", async () => {
		let turnsRun = 0;
		const result = await runAutonomousChatSession("build X", {
			assembleTurnDeps: async () => null,
			runAgentTurn: async () => {
				turnsRun += 1;
				return { finalText: "", steps: [] };
			},
			readPlanProgress: async () => ({ total: 0, done: 0 }),
			budget: BUDGET,
		});
		expect(result.stopReason).toBe("paused_needs_user");
		expect(result.finalText).toMatch(/no active workspace or loaded local model/);
		expect(turnsRun).toBe(0);
	});

	it("completes when the agent fires declare_goal_complete during a turn", async () => {
		const result = await runAutonomousChatSession("build X", {
			// The live executor runs the control tool when the model calls it; simulate that by firing it off the
			// merged tool set the assembly receives (it sets this turn's shared signals).
			assembleTurnDeps: async (extra) => {
				await extra.tools.find((tool) => tool.name === "declare_goal_complete")?.run({ summary: "Shipped." });
				return STUB_TOOL_DEPS;
			},
			runAgentTurn: async () => ({ finalText: "wrapping up", steps: [step("apply_patch")] }),
			// Plan complete (1/1) so the §5.AA evidence-gate accepts the declared completion directly.
			readPlanProgress: async () => ({ total: 1, done: 1 }),
			budget: BUDGET,
		});
		expect(result.stopReason).toBe("completed");
		expect(result.finalText).toBe("Shipped.");
		expect(result.turns).toBe(1);
	});

	it("drives multiple turns and stops when the focus chain reaches all-done", async () => {
		let progressCalls = 0;
		const result = await runAutonomousChatSession("build X", {
			assembleTurnDeps: async () => STUB_TOOL_DEPS,
			runAgentTurn: async () => ({ finalText: "step done", steps: [step("apply_patch")] }),
			readPlanProgress: async () => {
				progressCalls += 1;
				return progressCalls >= 2 ? { total: 2, done: 2 } : { total: 2, done: 1 };
			},
			budget: BUDGET,
		});
		expect(result.stopReason).toBe("completed");
		expect(result.turns).toBe(2);
		expect(result.planProgress).toEqual({ total: 2, done: 2 });
	});
});
