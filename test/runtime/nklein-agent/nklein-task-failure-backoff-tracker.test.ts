import { describe, expect, it } from "vitest";
import type { NKleinTaskFailureBackoffState } from "../../../src/nklein-agent/nklein-failure-backoff";
import { TaskFailureBackoffTracker } from "../../../src/nklein-agent/nklein-task-failure-backoff-tracker";

const state = (fingerprint: string, count: number, parked = false): NKleinTaskFailureBackoffState => ({
	fingerprint,
	count,
	parked,
});

describe("TaskFailureBackoffTracker", () => {
	it("getPrevious is undefined until a state is recorded, then returns it", () => {
		const tracker = new TaskFailureBackoffTracker();
		expect(tracker.getPrevious("t1")).toBeUndefined();
		const s = state("err-a", 1);
		tracker.record("t1", s);
		expect(tracker.getPrevious("t1")).toEqual(s);
	});

	it("record overwrites the prior state (the running backoff advances)", () => {
		const tracker = new TaskFailureBackoffTracker();
		tracker.record("t1", state("err-a", 1));
		tracker.record("t1", state("err-a", 2, true));
		expect(tracker.getPrevious("t1")).toEqual({ fingerprint: "err-a", count: 2, parked: true });
	});

	it("keeps per-task backoff state independent", () => {
		const tracker = new TaskFailureBackoffTracker();
		tracker.record("t1", state("err-a", 3));
		tracker.record("t2", state("err-b", 1));
		expect(tracker.getPrevious("t1")?.count).toBe(3);
		expect(tracker.getPrevious("t2")?.fingerprint).toBe("err-b");
	});

	it("forget clears one task's state, leaving others intact", () => {
		const tracker = new TaskFailureBackoffTracker();
		tracker.record("t1", state("err-a", 2));
		tracker.record("t2", state("err-b", 1));
		tracker.forget("t1");
		expect(tracker.getPrevious("t1")).toBeUndefined();
		expect(tracker.getPrevious("t2")).toEqual(state("err-b", 1));
	});

	it("forget of an unknown task is a harmless no-op", () => {
		const tracker = new TaskFailureBackoffTracker();
		expect(() => tracker.forget("never")).not.toThrow();
	});
});
