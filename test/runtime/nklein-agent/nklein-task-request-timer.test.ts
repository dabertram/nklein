import { describe, expect, it } from "vitest";

import { TaskRequestTimer } from "../../../src/nklein-agent/nklein-task-request-timer";

describe("TaskRequestTimer", () => {
	it("elapsedMs returns the positive delta from markStarted to observedAt", () => {
		const timer = new TaskRequestTimer(() => 1_000);
		timer.markStarted("t1");
		expect(timer.elapsedMs("t1", 1_500)).toBe(500);
	});

	it("elapsedMs returns null for a task that never started", () => {
		const timer = new TaskRequestTimer(() => 0);
		expect(timer.elapsedMs("missing", 1_000)).toBeNull();
	});

	it("elapsedMs returns null for a non-positive delta (zero or clock-skew)", () => {
		const timer = new TaskRequestTimer(() => 2_000);
		timer.markStarted("t1");
		expect(timer.elapsedMs("t1", 2_000)).toBeNull(); // zero delta
		expect(timer.elapsedMs("t1", 1_500)).toBeNull(); // observedAt before start
	});

	it("a later markStarted re-stamps the start", () => {
		let nowValue = 100;
		const timer = new TaskRequestTimer(() => nowValue);
		timer.markStarted("t1");
		expect(timer.elapsedMs("t1", 250)).toBe(150);
		nowValue = 300;
		timer.markStarted("t1");
		expect(timer.elapsedMs("t1", 250)).toBeNull(); // 250 < the new 300 start
		expect(timer.elapsedMs("t1", 500)).toBe(200);
	});

	it("forget drops one task's start, leaving others intact", () => {
		const timer = new TaskRequestTimer(() => 1_000);
		timer.markStarted("t1");
		timer.markStarted("t2");
		timer.forget("t1");
		expect(timer.elapsedMs("t1", 2_000)).toBeNull();
		expect(timer.elapsedMs("t2", 2_000)).toBe(1_000);
	});

	it("clear drops every task's start", () => {
		const timer = new TaskRequestTimer(() => 1_000);
		timer.markStarted("t1");
		timer.markStarted("t2");
		timer.clear();
		expect(timer.elapsedMs("t1", 2_000)).toBeNull();
		expect(timer.elapsedMs("t2", 2_000)).toBeNull();
	});
});
