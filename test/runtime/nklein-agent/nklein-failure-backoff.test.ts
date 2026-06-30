import { describe, expect, it } from "vitest";

import {
	computeNKleinFailureBackoff,
	NKLEIN_FAILURE_BACKOFF_PARK_THRESHOLD,
	NKLEIN_LOCAL_MODEL_UNAVAILABLE_PARK_THRESHOLD,
} from "../../../src/nklein-agent/nklein-failure-backoff";

describe("computeNKleinFailureBackoff", () => {
	it("starts a fresh count for a first failure (no prior state)", () => {
		const d = computeNKleinFailureBackoff({
			context: "start",
			errorMessage: "boom",
			previousFailure: undefined,
			localModelUnavailable: false,
		});
		expect(d).toMatchObject({
			fingerprint: "start:boom",
			consecutiveFailures: 1,
			alreadyParked: false,
			shouldPark: false,
			nextState: { fingerprint: "start:boom", count: 1, parked: false },
		});
	});

	it("increments the count when the SAME error repeats, and resets on a different error", () => {
		const first = computeNKleinFailureBackoff({
			context: "send",
			errorMessage: "boom",
			previousFailure: undefined,
			localModelUnavailable: false,
		});
		const second = computeNKleinFailureBackoff({
			context: "send",
			errorMessage: "boom",
			previousFailure: first.nextState,
			localModelUnavailable: false,
		});
		expect(second.consecutiveFailures).toBe(2);
		const different = computeNKleinFailureBackoff({
			context: "send",
			errorMessage: "other",
			previousFailure: second.nextState,
			localModelUnavailable: false,
		});
		expect(different.consecutiveFailures).toBe(1);
		expect(different.fingerprint).toBe("send:other");
	});

	it(`parks once the count reaches the default threshold (${NKLEIN_FAILURE_BACKOFF_PARK_THRESHOLD})`, () => {
		let state = undefined as undefined | ReturnType<typeof computeNKleinFailureBackoff>["nextState"];
		let last: ReturnType<typeof computeNKleinFailureBackoff> | null = null;
		for (let i = 0; i < NKLEIN_FAILURE_BACKOFF_PARK_THRESHOLD; i++) {
			last = computeNKleinFailureBackoff({
				context: "start",
				errorMessage: "same",
				previousFailure: state,
				localModelUnavailable: false,
			});
			state = last.nextState;
		}
		expect(last?.consecutiveFailures).toBe(NKLEIN_FAILURE_BACKOFF_PARK_THRESHOLD);
		expect(last?.shouldPark).toBe(true);
		expect(last?.nextState.parked).toBe(true);
	});

	it(`parks SOONER for a local-model-unavailable failure (threshold ${NKLEIN_LOCAL_MODEL_UNAVAILABLE_PARK_THRESHOLD})`, () => {
		const first = computeNKleinFailureBackoff({
			context: "send",
			errorMessage: "model gone",
			previousFailure: undefined,
			localModelUnavailable: true,
		});
		expect(first.shouldPark).toBe(false);
		const second = computeNKleinFailureBackoff({
			context: "send",
			errorMessage: "model gone",
			previousFailure: first.nextState,
			localModelUnavailable: true,
		});
		expect(second.consecutiveFailures).toBe(NKLEIN_LOCAL_MODEL_UNAVAILABLE_PARK_THRESHOLD);
		expect(second.shouldPark).toBe(true);
	});

	it("reports alreadyParked when the same error recurs after it parked", () => {
		const parkedState = { fingerprint: "start:fatal", count: 3, parked: true };
		const d = computeNKleinFailureBackoff({
			context: "start",
			errorMessage: "fatal",
			previousFailure: parkedState,
			localModelUnavailable: false,
		});
		expect(d.alreadyParked).toBe(true);
	});
});
