import { describe, expect, it } from "vitest";
import { shouldRunTerminalRetrySweep } from "../../../src/server/terminal-retry-sweep-policy";

const DEBOUNCE = 5_000;

describe("shouldRunTerminalRetrySweep", () => {
	it("skips a sweep still inside the debounce window (storm guard)", () => {
		expect(
			shouldRunTerminalRetrySweep({ now: 1_000, lastSweepAt: 0, debounceMs: DEBOUNCE, redrivePending: false }),
		).toBe(false);
	});

	it("runs once the debounce window has elapsed", () => {
		expect(
			shouldRunTerminalRetrySweep({ now: 5_000, lastSweepAt: 0, debounceMs: DEBOUNCE, redrivePending: false }),
		).toBe(true); // exactly at the boundary counts as elapsed
		expect(
			shouldRunTerminalRetrySweep({ now: 9_999, lastSweepAt: 0, debounceMs: DEBOUNCE, redrivePending: false }),
		).toBe(true);
	});

	it("★ a pending dead-card redrive BYPASSES the debounce (must not be swallowed by a neighbor's window)", () => {
		// Even 1ms after the last sweep — well inside the window — a pending redrive still runs, so the one-shot rescue
		// of a stranded dead card can never be lost to a neighboring terminal's debounce.
		expect(shouldRunTerminalRetrySweep({ now: 1, lastSweepAt: 0, debounceMs: DEBOUNCE, redrivePending: true })).toBe(
			true,
		);
	});

	it("runs on the first-ever sweep (lastSweepAt 0, no redrive)", () => {
		expect(
			shouldRunTerminalRetrySweep({ now: DEBOUNCE, lastSweepAt: 0, debounceMs: DEBOUNCE, redrivePending: false }),
		).toBe(true);
	});
});

describe("shouldRunTerminalRetrySweep — trailing timer (#26, live-found 2026-07-10)", () => {
	it("lets the one-shot deferred-retry timer bypass the debounce window", () => {
		expect(
			shouldRunTerminalRetrySweep({
				now: 1_000,
				lastSweepAt: 999,
				debounceMs: 5_000,
				redrivePending: false,
				timerFired: true,
			}),
		).toBe(true);
	});

	it("keeps debouncing ordinary sweeps when the timer flag is absent", () => {
		expect(
			shouldRunTerminalRetrySweep({ now: 1_000, lastSweepAt: 999, debounceMs: 5_000, redrivePending: false }),
		).toBe(false);
	});
});
