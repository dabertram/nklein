import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../../src/nklein-agent/sdk-agent-types";
import {
	decideTaskReanchorForRequest,
	firstUserGoalText,
	PAYLOAD_REANCHOR_TOKENS,
	TASK_REANCHOR_MESSAGE_KIND,
} from "../../../src/nklein-agent/task-reanchor-before-model";

/** Minimal AgentMessage factory for a user/assistant message with string text content. */
function msg(role: AgentMessage["role"], text: string, metadata?: Record<string, unknown>): AgentMessage {
	return {
		id: `${role}-${Math.random().toString(36).slice(2)}`,
		role,
		content: [{ type: "text", text }],
		createdAt: 0,
		...(metadata ? { metadata } : {}),
	};
}

const GOAL = "Ship the widget export feature end to end";
const baseMessages: AgentMessage[] = [
	msg("user", GOAL),
	msg("assistant", "on it"),
	msg("user", "now the current step"),
];

describe("firstUserGoalText", () => {
	it("returns the FIRST user message text (the immutable goal), not the last", () => {
		expect(firstUserGoalText(baseMessages)).toBe(GOAL);
	});

	it("skips injected rail messages (those carrying a metadata.kind) and finds the real goal", () => {
		const withRail: AgentMessage[] = [
			msg("user", "[!Klein repo map]", { kind: "kanban_repo_map_rail" }),
			msg("user", GOAL),
		];
		expect(firstUserGoalText(withRail)).toBe(GOAL);
	});

	it("reads array text-part content (space-joined) and trims the ends", () => {
		const m: AgentMessage = {
			id: "u1",
			role: "user",
			content: [
				{ type: "text", text: "  build" },
				{ type: "text", text: "the thing  " },
			],
			createdAt: 0,
		};
		expect(firstUserGoalText([m])).toBe("build the thing");
	});

	it("returns empty string when there is no user-authored message", () => {
		expect(firstUserGoalText([msg("assistant", "hello")])).toBe("");
		expect(firstUserGoalText([])).toBe("");
	});
});

describe("decideTaskReanchorForRequest", () => {
	it("is a no-op on turn 0 (never re-anchors on the first turn)", () => {
		const result = decideTaskReanchorForRequest({
			messages: baseMessages,
			turnCount: 0,
			lastReanchorTurn: null,
			everyNTurns: 3,
		});
		expect(result.appended).toBe(false);
		expect(result.messages).toBe(baseMessages); // same reference — byte-identical
		expect(result.block).toBeNull();
		expect(result.nextLastReanchorTurn).toBeNull();
	});

	it("is a no-op on an off-cadence turn (gap < everyNTurns since last re-anchor)", () => {
		// last re-anchored at turn 3, everyNTurns 5 → turn 6 (gap 3) must NOT fire.
		const result = decideTaskReanchorForRequest({
			messages: baseMessages,
			turnCount: 6,
			lastReanchorTurn: 3,
			everyNTurns: 5,
		});
		expect(result.appended).toBe(false);
		expect(result.messages).toBe(baseMessages);
		expect(result.nextLastReanchorTurn).toBe(3); // unchanged
	});

	it("appends a <reanchor> block carrying the immutable GOAL at the cadence turn", () => {
		// everyNTurns 3, never re-anchored → turn 3 (gap 3) fires.
		const result = decideTaskReanchorForRequest({
			messages: baseMessages,
			turnCount: 3,
			lastReanchorTurn: null,
			everyNTurns: 3,
		});
		expect(result.appended).toBe(true);
		expect(result.block).toContain("<reanchor>");
		expect(result.block).toContain(`GOAL: ${GOAL}`);
		// It appends at the END (strong end-zone) and does not mutate the input.
		expect(result.messages).not.toBe(baseMessages);
		expect(result.messages).toHaveLength(baseMessages.length + 1);
		const appendedMessage = result.messages[result.messages.length - 1];
		expect(appendedMessage.role).toBe("user");
		expect(appendedMessage.metadata?.kind).toBe(TASK_REANCHOR_MESSAGE_KIND);
		const text = (appendedMessage.content[0] as { text: string }).text;
		expect(text).toBe(result.block);
	});

	it("advances nextLastReanchorTurn to the current turn when it fires", () => {
		const result = decideTaskReanchorForRequest({
			messages: baseMessages,
			turnCount: 12,
			lastReanchorTurn: 6,
			everyNTurns: 6,
		});
		expect(result.appended).toBe(true);
		expect(result.nextLastReanchorTurn).toBe(12);
	});

	it("re-anchors from the immutable FIRST goal even as the current step drifts across turns", () => {
		const driftedMessages: AgentMessage[] = [
			msg("user", GOAL),
			msg("assistant", "step 1 done"),
			msg("user", "some wildly off-topic sub-step"),
		];
		const result = decideTaskReanchorForRequest({
			messages: driftedMessages,
			turnCount: 4,
			lastReanchorTurn: null,
			everyNTurns: 4,
		});
		expect(result.appended).toBe(true);
		expect(result.block).toContain(`GOAL: ${GOAL}`);
		expect(result.block).not.toContain("off-topic sub-step");
	});

	it("echoes an optional currentStep and cardTitle into the block when provided", () => {
		const result = decideTaskReanchorForRequest({
			messages: baseMessages,
			turnCount: 3,
			lastReanchorTurn: null,
			everyNTurns: 3,
			currentStep: "wire the export button",
			cardTitle: "Widget export",
		});
		expect(result.appended).toBe(true);
		expect(result.block).toContain("CURRENT STEP: wire the export button");
		expect(result.block).toContain("CARD: Widget export");
	});

	it("is a no-op when the cadence gate fires but there is no goal to anchor to", () => {
		const noGoal: AgentMessage[] = [msg("assistant", "no user message here")];
		const result = decideTaskReanchorForRequest({
			messages: noGoal,
			turnCount: 5,
			lastReanchorTurn: null,
			everyNTurns: 3,
		});
		expect(result.appended).toBe(false);
		expect(result.messages).toBe(noGoal);
		expect(result.block).toBeNull();
	});
});

describe("P18.2 payload-triggered re-anchoring", () => {
	const messages = [
		{
			id: "1",
			role: "user" as const,
			content: [{ type: "text" as const, text: "Fix the login 500" }],
			createdAt: 1,
		},
		{ id: "2", role: "assistant" as const, content: [{ type: "text" as const, text: "ok" }], createdAt: 2 },
	];

	it("fires on a large payload even when the cadence says no", () => {
		// Lost in the Middle: a buried document scores ~ the closed-book baseline. On a 6-turn cadence, five of
		// every six large-payload turns would bury the goal with no restatement.
		const result = decideTaskReanchorForRequest({
			messages,
			turnCount: 1,
			lastReanchorTurn: 1,
			everyNTurns: 6,
			payloadTokensThisTurn: PAYLOAD_REANCHOR_TOKENS,
		});
		expect(result.appended).toBe(true);
		expect(result.block).toContain("GOAL:");
	});

	it("does NOT fire on a small payload — cadence still governs the ordinary turn", () => {
		const result = decideTaskReanchorForRequest({
			messages,
			turnCount: 1,
			lastReanchorTurn: 1,
			everyNTurns: 6,
			payloadTokensThisTurn: 10,
		});
		expect(result.appended).toBe(false);
	});

	it("never fires on turn 0 — there is no goal to re-anchor to yet", () => {
		const result = decideTaskReanchorForRequest({
			messages,
			turnCount: 0,
			lastReanchorTurn: null,
			everyNTurns: 6,
			payloadTokensThisTurn: PAYLOAD_REANCHOR_TOKENS * 10,
		});
		expect(result.appended).toBe(false);
	});

	it("is byte-identical to cadence-only behaviour when payload is absent", () => {
		const withField = decideTaskReanchorForRequest({
			messages,
			turnCount: 6,
			lastReanchorTurn: 0,
			everyNTurns: 6,
			payloadTokensThisTurn: 0,
		});
		const without = decideTaskReanchorForRequest({
			messages,
			turnCount: 6,
			lastReanchorTurn: 0,
			everyNTurns: 6,
		});
		expect(withField.appended).toBe(without.appended);
		expect(withField.block).toBe(without.block);
	});
});
