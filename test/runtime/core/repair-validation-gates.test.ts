import { describe, expect, it } from "vitest";
import { aggregateCandidateValidation } from "../../../src/core/repair-kernel";
import {
	type GateCommandResult,
	parseLintFailureCount,
	parseTestFailureCount,
	parseTypecheckFailureCount,
	runValidationGates,
} from "../../../src/core/repair-validation-gates";

const ok: GateCommandResult = { exitCode: 0, stdout: "", stderr: "" };
const fail = (out: string): GateCommandResult => ({ exitCode: 1, stdout: out, stderr: "" });

describe("gate output parsers", () => {
	it("parseTestFailureCount: 0 on clean exit, the explicit count on failure, else 1", () => {
		expect(parseTestFailureCount(ok)).toBe(0);
		expect(parseTestFailureCount(fail("Tests  3 failed | 40 passed"))).toBe(3);
		expect(parseTestFailureCount(fail("something exploded, no count"))).toBe(1);
	});

	it("parseTypecheckFailureCount: counts `error TS####` lines, else 1 on an unparseable failure", () => {
		expect(parseTypecheckFailureCount(ok)).toBe(0);
		expect(parseTypecheckFailureCount(fail("a.ts(1,1): error TS2322: x\nb.ts(2,2): error TS2345: y"))).toBe(2);
		expect(parseTypecheckFailureCount(fail("segfault"))).toBe(1);
	});

	it("parseLintFailureCount: parses `Found N errors`, else 1 on an unparseable failure", () => {
		expect(parseLintFailureCount(ok)).toBe(0);
		expect(parseLintFailureCount(fail("Checked 10 files. Found 4 errors."))).toBe(4);
		expect(parseLintFailureCount(fail("crashed"))).toBe(1);
	});
});

describe("runValidationGates", () => {
	it("runs each configured gate and produces the RawValidationGates the ranker aggregates", async () => {
		const calls: string[] = [];
		const exec = async (command: string): Promise<GateCommandResult> => {
			calls.push(command);
			if (command === "npm run repro") return ok; // bug fixed
			if (command === "npm test") return fail("Tests  2 failed | 5 passed");
			if (command === "tsc --noEmit") return ok;
			if (command === "biome lint") return fail("Found 1 error.");
			return ok;
		};
		const gates = await runValidationGates(
			{
				candidateId: "c1",
				diffSize: 12,
				reproCommand: "npm run repro",
				regressionCommand: "npm test",
				typecheckCommand: "tsc --noEmit",
				lintCommand: "biome lint",
			},
			{ exec },
		);
		expect(gates).toEqual({
			candidateId: "c1",
			reproPassAfter: true,
			regressionFailures: 2,
			typecheckFailures: 0,
			lintFailures: 1,
			diffSize: 12,
		});
		expect(calls).toEqual(["npm run repro", "npm test", "tsc --noEmit", "biome lint"]);

		// End-to-end: the ranker's aggregation consumes it — repro passed, regression + lint broke.
		const validation = aggregateCandidateValidation(gates);
		expect(validation.reproPass).toBe(true);
		expect(validation.regressionPass).toBe(false);
		expect(validation.checksPass).toBe(false); // lint failure
	});

	it("skips omitted gates (no command) as passing/zero, and marks an absent repro as not-yet-proven", async () => {
		const exec = async (): Promise<GateCommandResult> => ok;
		const gates = await runValidationGates({ candidateId: "c2", diffSize: 3 }, { exec });
		expect(gates).toEqual({
			candidateId: "c2",
			reproPassAfter: false, // no repro command ⇒ not proven fixed
			regressionFailures: 0,
			typecheckFailures: 0,
			lintFailures: 0,
			diffSize: 3,
		});
	});

	it("a repro command that still fails after applying the candidate ⇒ reproPassAfter false", async () => {
		const exec = async (): Promise<GateCommandResult> => fail("assertion failed");
		const gates = await runValidationGates(
			{ candidateId: "c3", diffSize: 1, reproCommand: "npm run repro" },
			{ exec },
		);
		expect(gates.reproPassAfter).toBe(false);
	});
});
