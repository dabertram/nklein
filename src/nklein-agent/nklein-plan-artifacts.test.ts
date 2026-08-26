import { describe, expect, it } from "vitest";
import { nkleinPlanTaskSchema } from "./nklein-plan-artifacts";

// dschinn run-4 (`.real-runs/20260821-031637`) friction: `knowledgeDebt` is a scalar note surrounded by eight
// list-like sibling fields, so architect models (qwen3.8) emit it as a string[] and the tool rejected the whole
// add_task. The schema now accepts the natural list shape and folds it into the string the card carries.

const base = { id: "domain-model", title: "Define the domain model", prompt: "Build the typed domain model." };

describe("nkleinPlanTaskSchema — knowledgeDebt array tolerance", () => {
	it("accepts knowledgeDebt as a list of strings and folds it into a newline-joined string", () => {
		const parsed = nkleinPlanTaskSchema.parse({
			...base,
			knowledgeDebt: ["Trust-tier taxonomy is unresolved", "Data-residency classes need confirming"],
		});
		expect(parsed.knowledgeDebt).toBe("Trust-tier taxonomy is unresolved\nData-residency classes need confirming");
	});

	it("still accepts a scalar string unchanged", () => {
		const parsed = nkleinPlanTaskSchema.parse({ ...base, knowledgeDebt: "Taint level taxonomy; default 5 levels." });
		expect(parsed.knowledgeDebt).toBe("Taint level taxonomy; default 5 levels.");
	});

	it("drops blank entries and collapses an empty list to null", () => {
		const parsed = nkleinPlanTaskSchema.parse({ ...base, knowledgeDebt: ["  ", ""] });
		expect(parsed.knowledgeDebt).toBeNull();
	});

	it("leaves an omitted field absent (backward compatible)", () => {
		const parsed = nkleinPlanTaskSchema.parse(base);
		expect(parsed.knowledgeDebt).toBeUndefined();
	});
});
