import { describe, expect, it } from "vitest";
import {
	AUTO_START_FAILURE_MIN_SPAN_MS,
	AUTO_START_FAILURE_PAUSE_THRESHOLD,
	createAutoStartFailureGuard,
	formatAutoStartPauseMessage,
} from "../../../src/core/auto-start-failure-guard";

/**
 * Campaign forensics 2026-07-24 (~10k identical retries in a day) established the count threshold; the N15 soak
 * round-6 freeze (2026-08-05) established the TIME floor — sweep triggers cluster, so five failures inside one
 * poisoned residency window were ONE bad moment sampled five times, and 28 healthy cards got paused. The pause
 * now requires both: an unbroken failure run AND a minimum wall-clock span from the climb's first failure.
 */
function guardWithClock(threshold: number, minSpanMs: number) {
	let at = 0;
	const guard = createAutoStartFailureGuard(threshold, minSpanMs, () => at);
	return { guard, advance: (ms: number) => (at += ms) };
}

describe("auto-start failure guard", () => {
	it("pauses exactly once when the count crosses WITH the span satisfied, and restarts the climb afterwards", () => {
		const { guard, advance } = guardWithClock(3, 1_000);
		expect(guard.recordFailure("w:t")).toEqual({ consecutiveFailures: 1, shouldPause: false });
		advance(600);
		expect(guard.recordFailure("w:t")).toEqual({ consecutiveFailures: 2, shouldPause: false });
		advance(600); // span now 1.2s ≥ 1s at the third failure
		expect(guard.recordFailure("w:t")).toEqual({ consecutiveFailures: 3, shouldPause: true });
		// After the pause fired, the counter cleared: a resumed card gets the full threshold again.
		expect(guard.recordFailure("w:t")).toEqual({ consecutiveFailures: 1, shouldPause: false });
	});

	it("a BURST crossing the count inside the span is one incident: no pause until the condition survives the floor", () => {
		const { guard, advance } = guardWithClock(3, 60_000);
		// N15 round-6 shape: ~9 attempts within seconds against a transiently-poisoned residency view.
		for (let attempt = 0; attempt < 9; attempt += 1) {
			expect(guard.recordFailure("w:t").shouldPause).toBe(false);
			advance(500);
		}
		expect(guard.count("w:t")).toBe(9);
		// The condition persists past the floor ⇒ the next failure pauses (count long since satisfied).
		advance(60_000);
		expect(guard.recordFailure("w:t")).toEqual({ consecutiveFailures: 10, shouldPause: true });
	});

	it("a successful/queued start resets the climb — burst + recovery leaves no residue", () => {
		const { guard, advance } = guardWithClock(3, 60_000);
		for (let attempt = 0; attempt < 5; attempt += 1) {
			guard.recordFailure("w:t");
		}
		guard.reset("w:t"); // the next start was accepted — the poisoned window ended
		expect(guard.count("w:t")).toBe(0);
		advance(120_000);
		// A later single failure starts a FRESH climb (fresh firstFailureAt): no pause from stale history.
		expect(guard.recordFailure("w:t")).toEqual({ consecutiveFailures: 1, shouldPause: false });
	});

	it("keys are independent per card; defaults are 5 failures over ≥60s", () => {
		expect(AUTO_START_FAILURE_PAUSE_THRESHOLD).toBe(5);
		expect(AUTO_START_FAILURE_MIN_SPAN_MS).toBe(60_000);
		const { guard, advance } = guardWithClock(2, 1_000);
		guard.recordFailure("w:a");
		advance(2_000);
		expect(guard.recordFailure("w:b").shouldPause).toBe(false); // b's own climb only just began
		expect(guard.recordFailure("w:a").shouldPause).toBe(true);
	});

	it("the hold message names the count, the cause, and the RESUME remedy", () => {
		const message = formatAutoStartPauseMessage({
			taskId: "card-9",
			consecutiveFailures: 5,
			lastErrorCode: "agent_sandbox_unavailable",
			lastError: "docker daemon unreachable",
		});
		expect(message).toContain("card-9");
		expect(message).toContain("5 consecutive auto-start failures");
		expect(message).toContain("agent_sandbox_unavailable: docker daemon unreachable");
		expect(message).toContain("RESUME the card");
	});
});
