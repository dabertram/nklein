import { describe, expect, it } from "vitest";
import { richerCardSpecSchema, richerCardToWorkPackage } from "../../../src/core/richer-card-schema";
import { classifyPackagePairConflict } from "../../../src/core/work-package-dispatch";

describe("richerCardSpecSchema", () => {
	it("parses a full card spec with all four field groups", () => {
		const spec = richerCardSpecSchema.parse({
			id: "card-1",
			objective: "Add the widget",
			writeScope: ["src/widget/**"],
			forbiddenPaths: ["docs/**", "src/legacy/**"],
			interfaces: [{ name: "computeWidget", kind: "function", frozen: true }],
			acceptance: { checks: ["returns 42"], command: "npm test -- widget", nonGoals: ["do not touch styling"] },
			dependsOn: ["card-0"],
		});
		expect(spec.writeScope).toEqual(["src/widget/**"]);
		expect(spec.interfaces[0]?.name).toBe("computeWidget");
		expect(spec.acceptance.command).toBe("npm test -- widget");
	});

	it("applies defaults for a minimal spec", () => {
		const spec = richerCardSpecSchema.parse({ id: "c", objective: "o" });
		expect(spec).toMatchObject({
			writeScope: [],
			forbiddenPaths: [],
			interfaces: [],
			acceptance: { checks: [], command: null, nonGoals: [] },
			dependsOn: [],
		});
	});

	it("defaults an interface's kind + frozen", () => {
		const spec = richerCardSpecSchema.parse({ id: "c", objective: "o", interfaces: [{ name: "Foo" }] });
		expect(spec.interfaces[0]).toEqual({ name: "Foo", kind: "function", frozen: true });
	});
});

describe("richerCardToWorkPackage", () => {
	it("projects the dispatch bounds (write-scope + forbidden + deps) for the overlap classifier", () => {
		const spec = richerCardSpecSchema.parse({
			id: "a",
			objective: "o",
			writeScope: ["src/a/**"],
			forbiddenPaths: ["src/b/**"],
			dependsOn: ["z"],
		});
		expect(richerCardToWorkPackage(spec)).toEqual({
			id: "a",
			writeScope: ["src/a/**"],
			forbiddenScope: ["src/b/**"],
			dependsOn: ["z"],
		});
	});

	it("the projection composes with the real overlap classifier (two disjoint cards ⇒ green)", () => {
		const a = richerCardToWorkPackage(
			richerCardSpecSchema.parse({ id: "a", objective: "o", writeScope: ["src/a/**"] }),
		);
		const b = richerCardToWorkPackage(
			richerCardSpecSchema.parse({ id: "b", objective: "o", writeScope: ["src/b/**"] }),
		);
		expect(classifyPackagePairConflict(a, b).conflictClass).toBe("green");
	});

	it("omits empty forbidden/deps (a minimal WorkPackage)", () => {
		const spec = richerCardSpecSchema.parse({ id: "a", objective: "o", writeScope: ["src/a/**"] });
		expect(richerCardToWorkPackage(spec)).toEqual({ id: "a", writeScope: ["src/a/**"] });
	});
});
