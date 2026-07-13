import { describe, expect, it } from "vitest";
import { hasCardContract, renderCardContractBrief } from "../../../src/nklein-agent/card-contract-brief";
import { type NKleinPlanTask, nkleinPlanTaskSchema } from "../../../src/nklein-agent/nklein-plan-artifacts";

/** Parse through the schema so defaults (empty arrays) apply — the same shape decomposition produces. */
function task(overrides: Partial<NKleinPlanTask> = {}): NKleinPlanTask {
	return nkleinPlanTaskSchema.parse({ id: "t1", title: "T", prompt: "do it", ...overrides });
}

describe("card contract schema (§5.AK/§5.B enrichment)", () => {
	it("leaves every new contract field absent by default (optional enrichment, backward-compatible)", () => {
		const parsed = task();
		expect(parsed.preconditions).toBeUndefined();
		expect(parsed.inputs).toBeUndefined();
		expect(parsed.expectedOutputs).toBeUndefined();
		expect(parsed.acceptanceChecks).toBeUndefined();
		expect(parsed.nonGoals).toBeUndefined();
		expect(parsed.dependencyOutputsConsumed).toBeUndefined();
		expect(parsed.rollbackOrRepairHints).toBeUndefined();
		expect(parsed.downstreamInvalidationRules).toBeUndefined();
	});

	it("accepts populated contract fields through the schema", () => {
		const parsed = task({ preconditions: ["repo builds"], expectedOutputs: ["a new module"] });
		expect(parsed.preconditions).toEqual(["repo builds"]);
		expect(parsed.expectedOutputs).toEqual(["a new module"]);
	});
});

describe("hasCardContract", () => {
	it("is false for an unpopulated card, true once any field is set", () => {
		expect(hasCardContract(task())).toBe(false);
		expect(hasCardContract(task({ acceptanceChecks: ["lints clean"] }))).toBe(true);
		expect(hasCardContract(task({ preconditions: ["  "] }))).toBe(false); // blank-only ⇒ no real contract
	});
});

describe("renderCardContractBrief", () => {
	it("returns empty string when no contract field is populated (byte-identical to pre-enrichment)", () => {
		expect(renderCardContractBrief(task())).toBe("");
	});

	it("renders populated groups in contract order, cleaning + de-duping items", () => {
		const brief = renderCardContractBrief(
			task({
				preconditions: ["the DB migration ran", "  ", "the DB migration ran"], // blank + dup dropped
				expectedOutputs: ["POST /orders returns 201"],
				nonGoals: ["do not touch auth"],
			}),
		);
		expect(brief).toBe(
			[
				"## Card contract",
				"",
				"**Preconditions:**",
				"- the DB migration ran",
				"",
				"**Expected outputs:**",
				"- POST /orders returns 201",
				"",
				"**Non-goals:**",
				"- do not touch auth",
			].join("\n"),
		);
	});

	it("orders sections what→judged→boundaries→coupling regardless of field order", () => {
		const brief = renderCardContractBrief(
			task({ downstreamInvalidationRules: ["callers of getX must re-check"], inputs: ["the order id"] }),
		);
		// inputs (earlier) precedes downstream-invalidation (later) in the rendered output.
		expect(brief.indexOf("Inputs")).toBeLessThan(brief.indexOf("Downstream invalidation"));
	});

	it("renders the F1.8 work-package bounds (write scope, forbidden paths, interfaces)", () => {
		const brief = renderCardContractBrief(
			task({
				writeScope: ["src/orders/**"],
				forbiddenPaths: ["src/auth/**"],
				interfaces: ["createOrder(input): Order — signature frozen"],
			}),
		);
		expect(brief).toContain("**Write scope (files you may modify):**\n- src/orders/**");
		expect(brief).toContain("**Forbidden paths (do NOT touch):**\n- src/auth/**");
		expect(brief).toContain(
			"**Interfaces to honor (do not break):**\n- createOrder(input): Order — signature frozen",
		);
		expect(hasCardContract(task({ writeScope: ["src/x.ts"] }))).toBe(true);
	});
});
