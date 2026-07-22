import { describe, expect, it } from "vitest";
import { ModelTurnAdmissionWaitQueue } from "../../../src/core/model-turn-admission-wait-queue";

describe("ModelTurnAdmissionWaitQueue", () => {
	it("reserves a freed resource for its oldest waiter", () => {
		const queue = new ModelTurnAdmissionWaitQueue();
		queue.enqueue("first::review", "host:local");
		queue.enqueue("second-worker", "host:local");

		expect(queue.reservedFor(["host:local"])).toBe("first::review");
		queue.remove("first::review");
		expect(queue.reservedFor(["host:local"])).toBe("second-worker");
	});

	it("does not serialize independent hosts and preserves position across repeated polls", () => {
		const queue = new ModelTurnAdmissionWaitQueue();
		queue.enqueue("m5-review", "host:local");
		queue.enqueue("m4-worker", "host:m4");
		queue.enqueue("m5-review", "host:local");
		queue.enqueue("m5-worker", "host:local");

		expect(queue.reservedFor(["host:m4"])).toBe("m4-worker");
		expect(queue.reservedFor(["host:local"])).toBe("m5-review");
	});

	it("moves a rerouted task to the end of its new resource queue", () => {
		const queue = new ModelTurnAdmissionWaitQueue();
		queue.enqueue("rerouted", "host:legion");
		queue.enqueue("already-m4", "host:m4");
		queue.enqueue("rerouted", "host:m4");

		expect(queue.resourceFor("rerouted")).toBe("host:m4");
		expect(queue.reservedFor(["host:legion"])).toBeNull();
		expect(queue.reservedFor(["host:m4"])).toBe("already-m4");
	});
});
