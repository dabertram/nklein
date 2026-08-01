import { describe, expect, it } from "vitest";
import { runDevMechanismDecisionCommand, toGateRecord } from "../../../src/commands/dev-mechanism-decision-command";

/**
 * P15.3's caller. `mechanism-decision-report` shipped with P15.2 and nothing ever invoked it, so the campaign had
 * no input at all. This is that invocation for the one mechanism with a real counterfactual stream.
 */

async function run(options: Parameters<typeof runDevMechanismDecisionCommand>[0]): Promise<string> {
	const originalWrite = process.stdout.write.bind(process.stdout);
	let out = "";
	process.stdout.write = ((chunk: string) => {
		out += chunk;
		return true;
	}) as typeof process.stdout.write;
	try {
		await runDevMechanismDecisionCommand(options);
		return out;
	} finally {
		process.stdout.write = originalWrite;
	}
}

const observation = (wouldDrop: number, taskId: string) => ({
	taskId,
	metadata: { offered: 20, wouldKeep: 20 - wouldDrop, wouldDrop },
});
const completed = (taskId: string, detail: string) => ({
	kind: "scheduler",
	event: "completed",
	taskId,
	detail,
});

describe("toGateRecord", () => {
	it("lifts the counted fields out of the metadata bag", () => {
		expect(toGateRecord(observation(3, "t1"))).toEqual({ taskId: "t1", offered: 20, wouldKeep: 17, wouldDrop: 3 });
	});

	it("yields nulls for a non-numeric metadata value rather than coercing it", () => {
		// A coerced string would become a plausible-looking count. The join treats a null `wouldDrop` as MALFORMED
		// and excludes it, which is the outcome that cannot silently skew the disagreement rate.
		expect(toGateRecord({ metadata: { wouldDrop: "3" } }).wouldDrop).toBeNull();
	});
});

describe("runDevMechanismDecisionCommand", () => {
	it("reports insufficient_data below the floor and says that is BY DESIGN", () => {
		return run({
			readObservations: async () => [observation(5, "t1")],
			readLedger: async () => [completed("t1", "succeeded")] as never,
		}).then((out) => {
			expect(out).toMatch(/VERDICT: insufficient_data/u);
			expect(out).toMatch(/DESIGNED answer below the evidence floor/u);
		});
	});

	it("names the data gap when nothing joins, so evaluable:0 is not read as a no-op gate", async () => {
		const out = await run({
			readObservations: async () => [observation(5, "t1")],
			readLedger: async () => [] as never,
		});
		expect(out).toMatch(/data gap, NOT evidence the gate is a no-op/u);
	});

	it("does not count transient_retry as an outcome", async () => {
		const out = await run({
			readObservations: async () => [observation(5, "t1")],
			readLedger: async () => [completed("t1", "transient_retry")] as never,
		});
		expect(out).toMatch(/1 without a joinable outcome/u);
	});

	it("says plainly that zero observations prove nothing", async () => {
		const out = await run({ readObservations: async () => [], readLedger: async () => [] as never });
		expect(out).toMatch(/says nothing about whether the gate should enforce/u);
	});

	it("emits machine-readable JSON carrying the saturation flag", async () => {
		const out = await run({
			json: true,
			readObservations: async () => [observation(5, "t1")],
			readLedger: async () => [completed("t1", "failed")] as never,
		});
		const parsed = JSON.parse(out) as { readSaturated: boolean; decision: { verdict: string } };
		expect(parsed.readSaturated).toBe(false);
		expect(parsed.decision.verdict).toBe("insufficient_data");
	});

	it("WARNS when the read saturates — a truncated sample must not license a flip", async () => {
		// The reader hard-caps at 500. A verdict computed on a full window looks identical to one computed on all
		// the data, and this verdict's only job is to license flipping a default.
		const out = await run({
			readObservations: async () => Array.from({ length: 500 }, (_, index) => observation(index % 2, `t${index}`)),
			readLedger: async () =>
				Array.from({ length: 500 }, (_, index) => completed(`t${index}`, "succeeded")) as never,
		});
		expect(out).toMatch(/READ SATURATED at 500/u);
		expect(out).toMatch(/must not be used to flip a default/u);
	});
});
