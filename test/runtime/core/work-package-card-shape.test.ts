import { describe, expect, it } from "vitest";
import {
	classifyPlanHotFiles,
	deriveTaskWriteScope,
	findWorkPackageBoundaryViolations,
	formatHotFileWarnings,
	planTaskToWorkPackage,
	populateWorkPackageShape,
} from "../../../src/core/work-package-card-shape";

/**
 * F1.8 — work-package shape by construction: writeScope derivation (explicit wins, else filesLikelyTouched),
 * hot-file classification (yellow = every touching pair dependency-ordered, red = any unordered pair), and the
 * WorkPackage projection F1.9 dispatch consumes.
 */

describe("deriveTaskWriteScope", () => {
	it("prefers an explicit writeScope, falls back to filesLikelyTouched, and cleans messy lists", () => {
		expect(deriveTaskWriteScope({ id: "a", writeScope: ["src/a.ts"], filesLikelyTouched: ["src/b.ts"] })).toEqual([
			"src/a.ts",
		]);
		expect(deriveTaskWriteScope({ id: "a", filesLikelyTouched: [" src/b.ts ", "src/b.ts", ""] })).toEqual([
			"src/b.ts",
		]);
		expect(deriveTaskWriteScope({ id: "a" })).toEqual([]);
	});
});

describe("classifyPlanHotFiles", () => {
	it("classifies an ordered overlap yellow (transitively too) and an unordered one red; single owners unlisted", () => {
		const hotFiles = classifyPlanHotFiles([
			{ id: "a", filesLikelyTouched: ["src/shared.ts", "src/a-only.ts"] },
			{ id: "b", dependsOn: ["a"], filesLikelyTouched: ["src/shared.ts"] },
			// c depends on b depends on a — a↔c overlap on chain.ts is ordered only TRANSITIVELY.
			{ id: "c", dependsOn: ["b"], filesLikelyTouched: ["src/chain.ts"] },
			{ id: "d", filesLikelyTouched: ["src/chain.ts", "src/racy.ts"] },
			{ id: "e", filesLikelyTouched: ["src/racy.ts"] },
		]);
		const byPath = new Map(hotFiles.map((hotFile) => [hotFile.path, hotFile]));
		expect(byPath.get("src/shared.ts")).toMatchObject({ classification: "yellow", taskIds: ["a", "b"] });
		// c and d are unordered ⇒ red, regardless of the chain above c.
		expect(byPath.get("src/chain.ts")?.classification).toBe("red");
		expect(byPath.get("src/racy.ts")).toMatchObject({ classification: "red", taskIds: ["d", "e"] });
		expect(byPath.has("src/a-only.ts")).toBe(false);
	});

	it("a transitively ordered pair is yellow", () => {
		const hotFiles = classifyPlanHotFiles([
			{ id: "a", filesLikelyTouched: ["src/x.ts"] },
			{ id: "b", dependsOn: ["a"] },
			{ id: "c", dependsOn: ["b"], filesLikelyTouched: ["src/x.ts"] },
		]);
		expect(hotFiles).toEqual([{ path: "src/x.ts", taskIds: ["a", "c"], classification: "yellow" }]);
	});
});

describe("populateWorkPackageShape + projection", () => {
	it("fills writeScope by construction, keeps scope-less tasks unbounded, and reports hot files", () => {
		const { tasks, hotFiles } = populateWorkPackageShape([
			{ id: "a", filesLikelyTouched: ["src/x.ts"], extra: "carried" },
			{ id: "b", filesLikelyTouched: ["src/x.ts"] },
			{ id: "c" },
		] as Array<{ id: string; filesLikelyTouched?: string[]; writeScope?: string[]; extra?: string }>);
		expect(tasks[0]).toMatchObject({ writeScope: ["src/x.ts"], extra: "carried" });
		expect(tasks[2]?.writeScope).toBeUndefined();
		expect(hotFiles).toEqual([{ path: "src/x.ts", taskIds: ["a", "b"], classification: "red" }]);
	});

	it("projects a shaped task to the dispatch WorkPackage (forbidden + dependsOn only when present)", () => {
		expect(
			planTaskToWorkPackage({
				id: "a",
				writeScope: ["src/a/**"],
				forbiddenPaths: ["docs/**"],
				dependsOn: ["root"],
			}),
		).toEqual({ id: "a", writeScope: ["src/a/**"], forbiddenScope: ["docs/**"], dependsOn: ["root"] });
		expect(planTaskToWorkPackage({ id: "b", filesLikelyTouched: ["src/b.ts"] })).toEqual({
			id: "b",
			writeScope: ["src/b.ts"],
		});
	});

	it("F1.9b: flags forbidden and out-of-scope changed files, exempts coarse paths, skips unbounded cards", () => {
		const task = {
			id: "orders",
			writeScope: ["src/orders/**"],
			forbiddenPaths: ["src/auth/**"],
		};
		const violations = findWorkPackageBoundaryViolations(task, [
			"src/orders/api.ts", // in scope — clean
			"src/auth/session.ts", // forbidden — most severe, reported once
			"src/payments/checkout.ts", // outside scope
			"package.json", // coarse — a dependency add is legitimate, exempt from out-of-scope
		]);
		expect(violations).toEqual([
			{
				path: "src/auth/session.ts",
				kind: "forbidden_write",
				message: expect.stringContaining("forbidden paths"),
			},
			{
				path: "src/payments/checkout.ts",
				kind: "out_of_scope_write",
				message: expect.stringContaining("outside this card's declared write scope"),
			},
		]);
		// Legacy unbounded card: nothing to enforce.
		expect(findWorkPackageBoundaryViolations({ id: "legacy" }, ["anything/at/all.ts"])).toEqual([]);
		// filesLikelyTouched is the fallback scope basis.
		expect(
			findWorkPackageBoundaryViolations({ id: "f", filesLikelyTouched: ["src/f.ts"] }, ["src/g.ts"])[0]?.kind,
		).toBe("out_of_scope_write");
	});

	it("formats warnings for RED hot files only", () => {
		const warnings = formatHotFileWarnings([
			{ path: "src/x.ts", taskIds: ["a", "b"], classification: "red" },
			{ path: "src/y.ts", taskIds: ["a", "b"], classification: "yellow" },
		]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('"src/x.ts"');
		expect(warnings[0]).toContain("dependsOn");
	});
});
