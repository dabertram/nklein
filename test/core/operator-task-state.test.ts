import { describe, expect, it } from "vitest";
import { buildNeedsYouQueue } from "../../src/core/operator-task-state";

describe("buildNeedsYouQueue (F12.52)", () => {
	it("flattens the inbox into one urgency-ordered queue, one entry per task at its most urgent action", () => {
		const queue = buildNeedsYouQueue({
			unsafeActionAcks: ["t-ack"],
			clarifyingQuestions: ["t-q", "t-ack"],
			heldDeliveries: ["t-del"],
			protectedWrites: [],
			blockedOnSetup: ["t-setup"],
			escalatedToOperator: ["t-esc"],
			total: 5,
		});
		expect(queue.map((entry) => entry.taskId)).toEqual(["t-ack", "t-del", "t-q", "t-esc", "t-setup"]);
		expect(queue[0]?.action).toContain("host action");
		// t-ack appears once, at its most urgent class — not again under clarifying questions.
		expect(queue.filter((entry) => entry.taskId === "t-ack")).toHaveLength(1);
		expect(queue).toHaveLength(5);
	});

	it("returns an empty queue for an empty inbox", () => {
		expect(
			buildNeedsYouQueue({
				unsafeActionAcks: [],
				clarifyingQuestions: [],
				heldDeliveries: [],
				protectedWrites: [],
				blockedOnSetup: [],
				escalatedToOperator: [],
				total: 0,
			}),
		).toEqual([]);
	});
});
