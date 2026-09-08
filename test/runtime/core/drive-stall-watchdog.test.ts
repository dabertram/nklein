import { describe, expect, it } from "vitest";
import {
	EMPTY_DRIVE_STALL_STATE,
	fingerprintDriveLanes,
	observeDriveProgress,
} from "../../../src/core/drive-stall-watchdog";

const MIN = 60_000;

function lane(
	over: Partial<{ label: string; cardCount: number; messageCount: number; sessions: [string, string][] }> = {},
) {
	return {
		label: over.label ?? "38_tests",
		cardCount: over.cardCount ?? 7,
		messageCount: over.messageCount ?? 120,
		sessionStates: over.sessions ?? ([["s1", "running"]] as [string, string][]),
	};
}

describe("drive stall watchdog", () => {
	it("reports the silence measured from when movement STOPPED, not from the previous tick", () => {
		let state = { ...EMPTY_DRIVE_STALL_STATE, unchangedSince: 0 };
		const still = fingerprintDriveLanes([lane()]);

		let decision = observeDriveProgress(state, { at: 0, fingerprint: still }, 15 * MIN);
		state = decision.state;
		expect(decision.stalled).toBe(false);

		// Three quiet ticks: each one is only 5 minutes after the last, but the silence is 15 minutes long.
		for (const at of [5 * MIN, 10 * MIN, 15 * MIN]) {
			decision = observeDriveProgress(state, { at, fingerprint: still }, 15 * MIN);
			state = decision.state;
		}
		expect(decision.silentMs).toBe(15 * MIN);
		expect(decision.stalled).toBe(true);
	});

	it("resets the clock on ANY observable movement — a single new message is progress", () => {
		let state = { ...EMPTY_DRIVE_STALL_STATE, unchangedSince: 0 };
		state = observeDriveProgress(state, { at: 0, fingerprint: fingerprintDriveLanes([lane()]) }, 10 * MIN).state;
		state = observeDriveProgress(
			state,
			{ at: 9 * MIN, fingerprint: fingerprintDriveLanes([lane()]) },
			10 * MIN,
		).state;

		const moved = observeDriveProgress(
			state,
			{ at: 9 * MIN, fingerprint: fingerprintDriveLanes([lane({ messageCount: 121 })]) },
			10 * MIN,
		);
		expect(moved.stalled).toBe(false);
		expect(moved.silentMs).toBe(0);

		// And the new baseline is the moment it moved, so the next stall is measured from there.
		const later = observeDriveProgress(
			moved.state,
			{ at: 18 * MIN, fingerprint: fingerprintDriveLanes([lane({ messageCount: 121 })]) },
			10 * MIN,
		);
		expect(later.silentMs).toBe(9 * MIN);
		expect(later.stalled).toBe(false);
	});

	it("counts a session-state change as movement even when nothing else moves", () => {
		const before = fingerprintDriveLanes([lane({ sessions: [["s1", "running"]] })]);
		const after = fingerprintDriveLanes([lane({ sessions: [["s1", "awaiting_review"]] })]);
		expect(after).not.toBe(before);

		const state = observeDriveProgress(
			{ ...EMPTY_DRIVE_STALL_STATE, unchangedSince: 0 },
			{ at: 0, fingerprint: before },
			MIN,
		).state;
		expect(observeDriveProgress(state, { at: 5 * MIN, fingerprint: after }, MIN).stalled).toBe(false);
	});

	it("is stable against lane and session ordering — a reshuffled poll is not progress", () => {
		const a = fingerprintDriveLanes([
			lane({
				label: "b",
				sessions: [
					["s2", "idle"],
					["s1", "running"],
				],
			}),
			lane({ label: "a" }),
		]);
		const b = fingerprintDriveLanes([
			lane({ label: "a" }),
			lane({
				label: "b",
				sessions: [
					["s1", "running"],
					["s2", "idle"],
				],
			}),
		]);
		expect(a).toBe(b);
	});

	it("treats a non-positive threshold as 'do not bound the silence', never as an instant stall", () => {
		const still = fingerprintDriveLanes([lane()]);
		const state = observeDriveProgress(
			{ ...EMPTY_DRIVE_STALL_STATE, unchangedSince: 0 },
			{ at: 0, fingerprint: still },
			0,
		).state;
		const decision = observeDriveProgress(state, { at: 10 * MIN, fingerprint: still }, 0);
		expect(decision.silentMs).toBe(10 * MIN);
		expect(decision.stalled).toBe(false);
	});
});
