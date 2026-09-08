import { describe, expect, it } from "vitest";
import {
	describeRefusedRevival,
	EMPTY_SESSION_RETIREMENT_LEDGER,
	findRetiredSession,
	type RetiredSession,
	retireSession,
	reviveSession,
} from "../../../src/core/session-retirement";

const COMPLETED: RetiredSession = {
	taskId: "mutation-duration-schedule-kill-m3",
	reason: "terminal_lane_card",
	detail: "card sits in completed",
	at: 1_000,
};

describe("session retirement", () => {
	it("keeps the FIRST reason when a session is retired twice", () => {
		const once = retireSession(EMPTY_SESSION_RETIREMENT_LEDGER, COMPLETED);
		const twice = retireSession(once, { ...COMPLETED, reason: "card_absent_from_board", detail: "gone", at: 2_000 });
		expect(findRetiredSession(twice, COMPLETED.taskId)).toEqual(COMPLETED);
	});

	it("is cleared only by a deliberate start, and clearing an unretired task is a no-op", () => {
		const retired = retireSession(EMPTY_SESSION_RETIREMENT_LEDGER, COMPLETED);
		expect(findRetiredSession(retired, COMPLETED.taskId)).not.toBeNull();

		const revived = reviveSession(retired, COMPLETED.taskId);
		expect(findRetiredSession(revived, COMPLETED.taskId)).toBeNull();
		// The original ledger is untouched — these are values, not mutations.
		expect(findRetiredSession(retired, COMPLETED.taskId)).not.toBeNull();
		expect([...reviveSession(revived, "never-retired")]).toEqual([]);
	});

	it("does not retire a task just because another one was", () => {
		const retired = retireSession(EMPTY_SESSION_RETIREMENT_LEDGER, COMPLETED);
		expect(findRetiredSession(retired, "mutation-duration-schedule-kill-m4")).toBeNull();
		// A derived session is its own id: retiring the parent does not silently retire the review.
		expect(findRetiredSession(retired, `${COMPLETED.taskId}::review`)).toBeNull();
	});

	it("explains a refused revival in terms of the loop it prevents", () => {
		const message = describeRefusedRevival(COMPLETED);
		expect(message).toContain(COMPLETED.taskId);
		expect(message).toContain("completed");
		expect(message).toContain("stop/restart loop");
	});
});
