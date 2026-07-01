import { describe, expect, it } from "vitest";
import {
	type CardExecutionState,
	type CardMessageIntent,
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
