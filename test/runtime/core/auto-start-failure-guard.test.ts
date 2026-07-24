import { describe, expect, it } from "vitest";
import {
	AUTO_START_FAILURE_PAUSE_THRESHOLD,
	createAutoStartFailureGuard,
	formatAutoStartPauseMessage,
} from "../../../src/core/auto-start-failure-guard";

describe("auto-start failure guard (campaign forensics 2026-07-24: ~10k identical retries in a day)", () => {
	it("pauses exactly once at the threshold and restarts the climb afterwards (resume implies a fresh chance)", () => {
		const guard = createAutoStartFailureGuard(3);
		expect(guard.recordFailure("w:t")).toEqual({ consecutiveFailures: 1, shouldPause: false });
		expect(guard.recordFailure("w:t")).toEqual({ consecutiveFailures: 2, shouldPause: false });
		expect(guard.recordFailure("w:t")).toEqual({ consecutiveFailures: 3, shouldPause: true });
		// After the pause fired, the counter cleared: a resumed card gets the full threshold again.
		expect(guard.recordFailure("w:t")).toEqual({ consecutiveFailures: 1, shouldPause: false });
	});

	it("a successful/queued start resets the consecutive count (only UNBROKEN failure runs pause)", () => {
		const guard = createAutoStartFailureGuard(3);
		guard.recordFailure("w:t");
		guard.recordFailure("w:t");
		guard.reset("w:t");
		expect(guard.count("w:t")).toBe(0);
		expect(guard.recordFailure("w:t").shouldPause).toBe(false);
	});

	it("keys are independent per card and the default threshold is 5", () => {
		const guard = createAutoStartFailureGuard();
		for (let i = 0; i < AUTO_START_FAILURE_PAUSE_THRESHOLD - 1; i += 1) {
			expect(guard.recordFailure("w:a").shouldPause).toBe(false);
		}
		expect(guard.recordFailure("w:b").shouldPause).toBe(false); // other card untouched
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
