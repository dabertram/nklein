import { describe, expect, it } from "vitest";
import {
	acceptanceEvidenceNudge,
	buildAcceptanceCompletionGate,
	extractAcceptanceCommand,
	requiredToolsEvidenceNudge,
} from "../../../src/chat/chat-acceptance-completion";
import { type ChatAgentModelResponse, type ChatAgentStep, runChatAgentLoop } from "../../../src/chat/chat-agent-loop";
import type { ChatPromptMessage } from "../../../src/chat/chat-turn-context";

/**
 * P1.RESPONDERLEADS lead (a), reproduced: a card whose acceptance is ALREADY GREEN at start livelocks.
 *
 * The evidence gate (`buildAcceptanceCompletionGate`) is satisfied only by a `run_command` step that ran the
 * acceptance command to a zero exit IN THIS TURN. A card with nothing left to implement produces no such step: the
 * model correctly says "already done", the gate says "not complete", the loop nudges, and the same thing happens
 * again every iteration until the cap. Live 2026-09-08 the responder counted ~10 such rounds.
 *
 * The nudge was the missing half: it said "you have not completed all the required steps" and never named the one
 * step that would count. These tests pin the nudge naming the command, and pin that a model which acts on the named
 * evidence ends the turn — WITHOUT the gate being weakened. An already-satisfied card now leaves with its acceptance
 * PROVEN rather than assumed, which is the point: the evidence is not waived, it is asked for properly.
 */

const CARD =
	"Add the duration parser tests.\nAcceptance check: npm test\nReport what you changed when the check is green.";

const appendToolExchange = (
	messages: readonly ChatPromptMessage[],
	_response: ChatAgentModelResponse,
	results: readonly { callId: string; content: string }[],
): ChatPromptMessage[] => [
	...messages,
	...results.map((result) => ({ role: "system" as const, content: result.content })),
];

function acceptanceDeps(command: string) {
	const gate = buildAcceptanceCompletionGate(command);
	return {
		assessCompletion: gate,
		describeMissingEvidence: (steps: readonly ChatAgentStep[]) =>
			gate(steps) ? null : acceptanceEvidenceNudge(command),
	};
}

describe("a card whose acceptance is already green at start", () => {
	it("is told WHICH command proves it, instead of a generic 'not done' every round", async () => {
		const command = extractAcceptanceCommand(CARD);
		expect(command).toBe("npm test");

		const nudges: string[] = [];
		const result = await runChatAgentLoop(
			{ messages: [{ role: "user", content: CARD }], maxIterations: 6 },
			{
				// The model has genuinely nothing to do, so it never calls a tool — exactly the live behaviour.
				complete: async () => ({ text: "Everything the card asks for is already present.", toolCalls: [] }),
				executeTool: async () => {
					throw new Error("no tool should run");
				},
				appendToolExchange: (messages, response, results) => {
					for (const result of results) {
						nudges.push(result.content);
					}
					return appendToolExchange(messages, response, results);
				},
				...acceptanceDeps(command as string),
			},
		);

		expect(result.hitIterationLimit).toBe(false);
		// Every nudge names the command and says a claim is not evidence — the fact the old nudge withheld.
		expect(nudges.length).toBeGreaterThan(0);
		for (const nudge of nudges) {
			expect(nudge).toContain("npm test");
			expect(nudge).toContain("not evidence");
		}
	});

	it("ends in ONE more turn once the model runs the named command — the gate is honoured, not weakened", async () => {
		const command = extractAcceptanceCommand(CARD) as string;
		let turn = 0;
		const result = await runChatAgentLoop(
			{ messages: [{ role: "user", content: CARD }], maxIterations: 10 },
			{
				complete: async () => {
					turn += 1;
					// Turn 1: nothing to do, stop. Turn 2 (after the nudge names it): run the acceptance command.
					return turn === 2
						? ({
								text: "",
								toolCalls: [{ id: "c1", name: "run_command", arguments: { command: "npm test" } }],
							} satisfies ChatAgentModelResponse)
						: ({
								text: "Already satisfied — npm test is green.",
								toolCalls: [],
							} satisfies ChatAgentModelResponse);
				},
				executeTool: async (call) => ({
					callId: call.id,
					content: "Command exited with code 0.\n\nTest Suites: 12 passed",
				}),
				appendToolExchange,
				...acceptanceDeps(command),
			},
		);

		// 3 model calls: stop → nudged, run_command, stop (gate now green) → accepted as final. No spin to the cap.
		expect(turn).toBe(3);
		expect(result.hitIterationLimit).toBe(false);
		expect(result.steps.map((step) => step.toolCall.name)).toEqual(["run_command"]);
		expect(result.finalText).toContain("Already satisfied");
	});

	it("names the un-called tools when THAT is the unmet gate", () => {
		expect(requiredToolsEvidenceNudge(["write_file", "run_command"])).toContain("write_file, run_command");
		expect(acceptanceEvidenceNudge("pnpm vitest run")).toContain("`pnpm vitest run`");
	});
});
