import { describe, expect, it } from "vitest";

import type { ChatAgentStep } from "../../../src/chat/chat-agent-loop";
import type { AutonomousControlToolset } from "../../../src/chat/chat-autonomous-control-tools";
import {
	buildAutonomousChatTurnRunner,
	readAutonomousChatPlanProgress,
} from "../../../src/chat/chat-autonomous-wiring";
import type { FocusChain } from "../../../src/core/focus-chain";

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
