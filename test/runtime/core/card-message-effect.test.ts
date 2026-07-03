import { describe, expect, it } from "vitest";
import {
	type CardExecutionState,
	type CardMessageIntent,
	classifyCardMessageIntent,
	resolveCardMessageEffect,
} from "../../../src/core/card-message-effect";

const effect = (cardState: CardExecutionState, intent: CardMessageIntent, questionNeedsConsult = false) =>
	resolveCardMessageEffect({ cardState, intent, questionNeedsConsult });

describe("resolveCardMessageEffect — the invariant: a BLOCKED card is never started", () => {
	const states: CardExecutionState[] = ["running", "ready", "blocked", "done"];
	const intents: CardMessageIntent[] = ["guidance", "steer", "question", "answer"];

	it("NEVER returns startsWork/request_start for a blocked card, under any intent", () => {
		for (const intent of intents) {
			const v = effect("blocked", intent);
			expect(v.startsWork).toBe(false);
			expect(v.effect).not.toBe("request_start");
		}
	});

	it("only `request_start` (a READY steer) ever sets startsWork", () => {
		for (const state of states) {
			for (const intent of intents) {
				const v = effect(state, intent);
				expect(v.startsWork).toBe(v.effect === "request_start");
			}
		}
	});
});

describe("resolveCardMessageEffect — by state × intent", () => {
	it("answer → always deliver_live (continues the session that asked)", () => {
		for (const state of ["running", "ready", "blocked", "done"] as CardExecutionState[]) {
			expect(effect(state, "answer").effect).toBe("deliver_live");
		}
	});

	it("running → deliver_live for guidance/steer/question", () => {
		expect(effect("running", "guidance").effect).toBe("deliver_live");
		expect(effect("running", "steer").effect).toBe("deliver_live");
		expect(effect("running", "question").effect).toBe("deliver_live");
	});

	it("ready → queue guidance, request_start on steer", () => {
		expect(effect("ready", "guidance").effect).toBe("queue_mailbox");
		const steer = effect("ready", "steer");
		expect(steer.effect).toBe("request_start");
		expect(steer.startsWork).toBe(true);
	});

	it("blocked → queue guidance, suggest_unblock on steer", () => {
		expect(effect("blocked", "guidance").effect).toBe("queue_mailbox");
		expect(effect("blocked", "steer").effect).toBe("suggest_unblock");
	});

	it("done → append_followup for guidance/steer", () => {
		expect(effect("done", "guidance").effect).toBe("append_followup");
		expect(effect("done", "steer").effect).toBe("append_followup");
	});

	it("question → state answer by default, consult only when substantive (local-first frugality)", () => {
		expect(effect("ready", "question", false).effect).toBe("answer_from_state");
		expect(effect("blocked", "question", false).effect).toBe("answer_from_state");
		expect(effect("done", "question", false).effect).toBe("answer_from_state");
		expect(effect("blocked", "question", true).effect).toBe("consult_response");
	});
});

describe("classifyCardMessageIntent (the light deterministic classifier)", () => {
	it("reads a clear leading go as steer, interrogatives as question, everything else as guidance", () => {
		expect(classifyCardMessageIntent("go ahead")).toBe("steer");
		expect(classifyCardMessageIntent("Start it.")).toBe("steer");
		expect(classifyCardMessageIntent("proceed with the plan")).toBe("steer");
		expect(classifyCardMessageIntent("what is the status?")).toBe("question");
		expect(classifyCardMessageIntent("is this done")).toBe("question");
		expect(classifyCardMessageIntent("any update on the parser")).toBe("question");
		expect(classifyCardMessageIntent("prefer zod for the schema")).toBe("guidance");
		// Ambiguity falls to guidance — steer can start a READY card, so it must be a CLEAR leading go.
		expect(classifyCardMessageIntent("we should go with option B")).toBe("guidance");
		expect(classifyCardMessageIntent("the goal is to start small")).toBe("guidance");
	});
});
