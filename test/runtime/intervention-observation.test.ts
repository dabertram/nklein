import { describe, expect, it } from "vitest";
import {
	extractInterventionEvents,
	INSTRUMENTED_SEVERITIES,
	INTERVENTION_CATEGORY,
} from "../../src/core/intervention-observation";

const line = (record: Record<string, unknown>) => JSON.stringify(record);
const intervention = (severity: string, taskId = "c1", extra: Record<string, unknown> = {}) =>
	line({
		createdAt: 100,
		taskId,
		metadata: { category: INTERVENTION_CATEGORY, interventionSeverity: severity, ...extra },
	});

describe("extractInterventionEvents", () => {
	it("extracts a recorded intervention with its severity", () => {
		const result = extractInterventionEvents(intervention("nudge"));
		expect(result.events).toEqual([{ taskId: "c1", severity: "nudge", humanSeconds: null, at: 100 }]);
	});

	it("ignores telemetry that is not an intervention", () => {
		expect(
			extractInterventionEvents(line({ createdAt: 1, taskId: "c1", metadata: { category: "card_lane_change" } }))
				.events,
		).toHaveLength(0);
	});

	it("SKIPS a record with an unknown severity rather than defaulting it", () => {
		// Defaulting would invent the classification the taxonomy exists to record, and a wrong severity moves a
		// number the go/no-go decision reads — worse than a missing event.
		expect(extractInterventionEvents(intervention("catastrophe")).events).toHaveLength(0);
	});

	it("keeps humanSeconds null unless it was MEASURED", () => {
		expect(extractInterventionEvents(intervention("nudge")).events[0]?.humanSeconds).toBeNull();
		expect(extractInterventionEvents(intervention("nudge", "c1", { humanSeconds: 42 })).events[0]?.humanSeconds).toBe(
			42,
		);
	});

	it("reports complete coverage only after every severity has an explicit product gesture", () => {
		const result = extractInterventionEvents("");
		expect(result.uninstrumentedSeverities).toEqual([]);
		expect(result.coverageNote).toBe("All four severities have an emission site.");
	});

	it("only lists a severity as instrumented once an emission site exists", () => {
		// Ratchet: adding a severity here without an emitter turns "not measured" into a confident zero.
		expect(INSTRUMENTED_SEVERITIES).toEqual(["nudge", "correction", "takeover", "abort"]);
	});

	it("counts unparseable lines instead of silently dropping them", () => {
		expect(extractInterventionEvents(["{bad", intervention("nudge")].join("\n")).unparseableLines).toBe(1);
	});
});
