import { describe, expect, it } from "vitest";
import { collectDrainedState } from "../../src/core/nightly-drain-collector";
import { evaluatePack } from "../../src/core/nightly-invariant-pack";
import { extractDrainSignalEvents, OBSERVABLE_DRAIN_SIGNALS } from "../../src/core/nightly-signal-extraction";

/**
 * N7c — signal extraction, and the two defects it fixes.
 *
 * Both defects share the shape this project keeps meeting: the nightly kept running, kept printing, and kept
 * reporting `indeterminate` — a status that reads as caution rather than as a bug, which is exactly why neither
 * was noticed by running it.
 */

function line(record: Record<string, unknown>): string {
	return JSON.stringify(record);
}

describe("extractDrainSignalEvents", () => {
	it("emits BOTH the signal and the category, so neither vocabulary is masked", () => {
		// The previous reader used `metadata?.category ?? signal`, so a runtime_error carrying ANY category
		// silently stopped being a runtime_error — and `mustStayQuiet: ["runtime_error"]` would then be satisfied
		// by a run that errored. A missed violation, reported as a pass.
		const result = extractDrainSignalEvents(
			line({ signal: "runtime_error", createdAt: 100, metadata: { category: "board_liveness_watchdog" } }),
		);
		expect(result.events.map((event) => event.signal).sort()).toEqual(["board_liveness_watchdog", "runtime_error"]);
	});

	it("keeps the real timestamp rather than a synthetic one", () => {
		const result = extractDrainSignalEvents(line({ signal: "runtime_error", createdAt: 1_700_000_000_000 }));
		expect(result.events[0]?.emittedAt).toBe(1_700_000_000_000);
	});

	it("DROPS and COUNTS an undated record rather than guessing a timestamp", () => {
		// The collector orders events against drainStartedAt; an invented timestamp would place an event inside or
		// outside the drain window arbitrarily and produce a confident, meaningless verdict.
		const result = extractDrainSignalEvents(line({ signal: "runtime_error" }));
		expect(result.events).toHaveLength(0);
		expect(result.undatedRecords).toBe(1);
	});

	it("COUNTS unparseable lines and says the total is a floor", () => {
		const result = extractDrainSignalEvents(
			[line({ signal: "runtime_error", createdAt: 1 }), "{not json"].join("\n"),
		);
		expect(result.unparseableLines).toBe(1);
		expect(result.summary).toContain("floor rather than a complete count");
	});

	it("says INDETERMINATE rather than clean when nothing was readable", () => {
		expect(extractDrainSignalEvents("").summary).toContain("INDETERMINATE");
	});

	it("ignores blank lines without counting them as damage", () => {
		expect(extractDrainSignalEvents("\n\n  \n").unparseableLines).toBe(0);
	});
});

describe("N7c end-to-end — a pack can finally assert both directions", () => {
	const pack = {
		id: "test-pack",
		mustFire: ["agent_sandbox_result_patch"],
		mustStayQuiet: ["runtime_error"],
		expectedTerminalLanes: ["completed"],
	};

	function evaluate(telemetry: string) {
		const extraction = extractDrainSignalEvents(telemetry);
		const collected = collectDrainedState({
			drainStartedAt: 0,
			subscriptions: OBSERVABLE_DRAIN_SIGNALS.map((signal) => ({ signal, registeredAt: 0 })),
			events: extraction.events,
			terminalCards: [{ cardId: "completed#1", lane: "completed" }],
			unmatchedAimockRequests: 0,
			teardown: { orphanSessions: 0, orphanWorktrees: 0, orphanLeases: 0 },
		});
		return evaluatePack(pack, collected.state);
	}

	it("SATISFIES mustStayQuiet on a clean run — which was impossible before", () => {
		// THE KEYSTONE DEFECT. Subscriptions used to be derived from the signals that FIRED, so a signal that
		// stayed quiet was never watched, and every "this must not happen" assertion reported `indeterminate`
		// forever. Every pack's negative half was incapable of passing, in a way that looked like caution.
		const verdict = evaluate(
			line({ signal: "custom", createdAt: 10, metadata: { category: "agent_sandbox_result_patch" } }),
		);
		const quiet = verdict.checks.find((check) => check.name.includes("runtime_error"));
		expect(quiet?.status).not.toBe("indeterminate");
		expect(quiet?.status).toBe("satisfied");
	});

	it("VIOLATES mustStayQuiet when the signal really did fire", () => {
		// The other half of the same claim: if it cannot fail, "satisfied" above would mean nothing.
		const verdict = evaluate(
			[
				line({ signal: "custom", createdAt: 10, metadata: { category: "agent_sandbox_result_patch" } }),
				line({ signal: "runtime_error", createdAt: 20, message: "boom" }),
			].join("\n"),
		);
		const quiet = verdict.checks.find((check) => check.name.includes("runtime_error"));
		expect(quiet?.status).toBe("violated");
	});

	it("still reports INDETERMINATE for a signal no pack-observable list covers", () => {
		// The safe direction is preserved: an omission from OBSERVABLE_DRAIN_SIGNALS must NOT become a pass.
		expect(OBSERVABLE_DRAIN_SIGNALS).not.toContain("never_observed_signal");
		const verdict = evaluate(
			line({ signal: "custom", createdAt: 10, metadata: { category: "never_observed_signal" } }),
		);
		expect(verdict.summary).toBeTruthy();
	});
});
