import { describe, expect, it } from "vitest";
import {
	classifyPackagePairConflict,
	detectWorkPackageConflicts,
	isCoarseScopePath,
	normalizeScopeGlob,
	planParallelDispatch,
	resolveDispatchWaves,
	validateWorkPackages,
	type WorkPackage,
	worstConflictClass,
} from "../../../src/core/work-package-dispatch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pkg(over: Partial<WorkPackage> & { id: string }): WorkPackage {
	return { writeScope: ["src/core/some-file.ts"], ...over };
}

// ---------------------------------------------------------------------------
// normalizeScopeGlob / isCoarseScopePath
// ---------------------------------------------------------------------------

describe("normalizeScopeGlob", () => {
	it("strips ./ and leading/trailing slashes, backslashes → /, lowercases", () => {
		expect(normalizeScopeGlob("./src/Core/Foo.TS/")).toBe("src/core/foo.ts");
		expect(normalizeScopeGlob("src\\core\\bar.ts")).toBe("src/core/bar.ts");
		expect(normalizeScopeGlob("  /src//core///baz.ts  ")).toBe("src/core/baz.ts");
	});
});

describe("isCoarseScopePath", () => {
	it("flags manifests, lockfiles, repo-root config, and barrel indexes", () => {
		for (const coarse of ["package.json", "src/lib/index.ts", "tsconfig.build.json", "go.mod", "mod.ts"]) {
			expect(isCoarseScopePath(normalizeScopeGlob(coarse))).toBe(true);
		}
	});
	it("treats a normal source path as specific (not coarse)", () => {
		expect(isCoarseScopePath("src/core/work-package-dispatch.ts")).toBe(false);
		expect(isCoarseScopePath("src/components/board.tsx")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// classifyPackagePairConflict
// ---------------------------------------------------------------------------

describe("classifyPackagePairConflict", () => {
	it("GREEN — fully disjoint write scopes", () => {
		const a = pkg({ id: "a", writeScope: ["src/core/a.ts"] });
		const b = pkg({ id: "b", writeScope: ["src/core/b.ts"] });
		const pair = classifyPackagePairConflict(a, b);
		expect(pair.conflictClass).toBe("green");
		expect(pair.sharedSpecificPaths).toEqual([]);
		expect(pair.sharedCoarsePaths).toEqual([]);
		expect(pair.forbiddenViolations).toEqual([]);
	});

	it("RED — a shared SPECIFIC write target", () => {
		const a = pkg({ id: "a", writeScope: ["src/core/shared.ts", "src/core/a.ts"] });
		const b = pkg({ id: "b", writeScope: ["src/core/shared.ts", "src/core/b.ts"] });
		const pair = classifyPackagePairConflict(a, b);
		expect(pair.conflictClass).toBe("red");
		expect(pair.sharedSpecificPaths).toEqual(["src/core/shared.ts"]);
	});

	it("YELLOW — overlap only on a coarse path (a shared manifest / barrel)", () => {
		const a = pkg({ id: "a", writeScope: ["package.json", "src/core/a.ts"] });
		const b = pkg({ id: "b", writeScope: ["package.json", "src/core/b.ts"] });
		const pair = classifyPackagePairConflict(a, b);
		expect(pair.conflictClass).toBe("yellow");
		expect(pair.sharedCoarsePaths).toEqual(["package.json"]);
		expect(pair.sharedSpecificPaths).toEqual([]);
	});

	it("RED beats YELLOW — a shared coarse AND a shared specific path is RED", () => {
		const a = pkg({ id: "a", writeScope: ["package.json", "src/core/shared.ts"] });
		const b = pkg({ id: "b", writeScope: ["package.json", "src/core/shared.ts"] });
		const pair = classifyPackagePairConflict(a, b);
		expect(pair.conflictClass).toBe("red");
		expect(pair.sharedSpecificPaths).toEqual(["src/core/shared.ts"]);
		expect(pair.sharedCoarsePaths).toEqual(["package.json"]);
	});

	it("RED — one package writes into the other's forbidden scope (directory containment)", () => {
		const worker = pkg({ id: "worker", writeScope: ["src/server/runtime-server.ts"] });
		const other = pkg({ id: "other", writeScope: ["src/core/x.ts"], forbiddenScope: ["src/server"] });
		const pair = classifyPackagePairConflict(worker, other);
		expect(pair.conflictClass).toBe("red");
		expect(pair.forbiddenViolations).toHaveLength(1);
		expect(pair.forbiddenViolations[0]).toContain("worker");
		expect(pair.forbiddenViolations[0]).toContain("forbidden");
	});

	it("forbidden containment is prefix-safe: `ab` is NOT inside forbidden `a`", () => {
		const worker = pkg({ id: "worker", writeScope: ["src/ab/thing.ts"] });
		const other = pkg({ id: "other", writeScope: ["src/core/x.ts"], forbiddenScope: ["src/a"] });
		expect(classifyPackagePairConflict(worker, other).conflictClass).toBe("green");
	});

	it("forbidden is checked in BOTH directions", () => {
		const a = pkg({ id: "a", writeScope: ["src/core/a.ts"], forbiddenScope: ["docs"] });
		const b = pkg({ id: "b", writeScope: ["docs/readme.md"] });
		const pair = classifyPackagePairConflict(a, b);
		expect(pair.conflictClass).toBe("red");
		expect(pair.forbiddenViolations[0]).toContain("b writes");
	});

	it("normalizes before comparing — `./src/Foo.ts` and `src/foo.ts` collide", () => {
		const a = pkg({ id: "a", writeScope: ["./src/Foo.ts"] });
		const b = pkg({ id: "b", writeScope: ["src/foo.ts"] });
		expect(classifyPackagePairConflict(a, b).conflictClass).toBe("red");
	});
});

// ---------------------------------------------------------------------------
// detectWorkPackageConflicts
// ---------------------------------------------------------------------------

describe("detectWorkPackageConflicts", () => {
	it("returns only the non-green pairs, each unordered pair once", () => {
		const packages = [
			pkg({ id: "a", writeScope: ["src/core/a.ts", "src/core/shared.ts"] }),
			pkg({ id: "b", writeScope: ["src/core/b.ts", "src/core/shared.ts"] }),
			pkg({ id: "c", writeScope: ["src/core/c.ts"] }),
		];
		const conflicts = detectWorkPackageConflicts(packages);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]?.left).toBe("a");
		expect(conflicts[0]?.right).toBe("b");
		expect(conflicts[0]?.conflictClass).toBe("red");
	});

	it("returns [] for a fully disjoint set", () => {
		const packages = [
			pkg({ id: "a", writeScope: ["src/core/a.ts"] }),
			pkg({ id: "b", writeScope: ["src/core/b.ts"] }),
		];
		expect(detectWorkPackageConflicts(packages)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// worstConflictClass
// ---------------------------------------------------------------------------

describe("worstConflictClass", () => {
	it("green for disjoint, yellow if only coarse overlaps, red if any specific overlap", () => {
		const green = [pkg({ id: "a", writeScope: ["src/a.ts"] }), pkg({ id: "b", writeScope: ["src/b.ts"] })];
		const yellow = [
			pkg({ id: "a", writeScope: ["package.json", "src/a.ts"] }),
			pkg({ id: "b", writeScope: ["package.json", "src/b.ts"] }),
		];
		const red = [pkg({ id: "a", writeScope: ["src/shared.ts"] }), pkg({ id: "b", writeScope: ["src/shared.ts"] })];
		expect(worstConflictClass(green)).toBe("green");
		expect(worstConflictClass(yellow)).toBe("yellow");
		expect(worstConflictClass(red)).toBe("red");
	});
});

// ---------------------------------------------------------------------------
// validateWorkPackages
// ---------------------------------------------------------------------------

describe("validateWorkPackages", () => {
	it("accepts a well-formed set", () => {
		const packages = [
			pkg({ id: "a", writeScope: ["src/core/a.ts"] }),
			pkg({ id: "b", writeScope: ["src/core/b.ts"], dependsOn: ["a"] }),
		];
		expect(validateWorkPackages(packages)).toEqual([]);
	});

	it("flags a duplicate id", () => {
		const packages = [pkg({ id: "a" }), pkg({ id: "a", writeScope: ["src/core/other.ts"] })];
		const errors = validateWorkPackages(packages);
		expect(errors.map((e) => e.kind)).toContain("duplicate_id");
	});

	it("flags an unknown dependency", () => {
		const packages = [pkg({ id: "a", dependsOn: ["ghost"] })];
		const errors = validateWorkPackages(packages);
		expect(errors).toHaveLength(1);
		expect(errors[0]?.kind).toBe("unknown_dependency");
		expect(errors[0]?.packageId).toBe("a");
	});

	it("flags a dependency cycle (once per closing node)", () => {
		const packages = [pkg({ id: "a", dependsOn: ["b"] }), pkg({ id: "b", dependsOn: ["a"] })];
		const errors = validateWorkPackages(packages);
		const cycleErrors = errors.filter((e) => e.kind === "dependency_cycle");
		expect(cycleErrors).toHaveLength(1);
	});

	it("flags an empty write scope", () => {
		const packages = [pkg({ id: "a", writeScope: [] })];
		const errors = validateWorkPackages(packages);
		expect(errors.map((e) => e.kind)).toContain("empty_scope");
	});

	it("flags a `..`-escaping scope glob (write or forbidden)", () => {
		const escapingWrite = validateWorkPackages([pkg({ id: "a", writeScope: ["../outside/x.ts"] })]);
		expect(escapingWrite.map((e) => e.kind)).toContain("escaping_scope");
		const escapingForbidden = validateWorkPackages([
			pkg({ id: "a", writeScope: ["src/a.ts"], forbiddenScope: ["src/../../etc"] }),
		]);
		expect(escapingForbidden.map((e) => e.kind)).toContain("escaping_scope");
	});

	it("collects MULTIPLE violations, never short-circuits", () => {
		const packages = [
			pkg({ id: "dup", writeScope: [] }),
			pkg({ id: "dup", writeScope: ["src/a.ts"], dependsOn: ["ghost"] }),
		];
		const kinds = validateWorkPackages(packages).map((e) => e.kind);
		expect(kinds).toContain("duplicate_id");
		expect(kinds).toContain("empty_scope");
		expect(kinds).toContain("unknown_dependency");
	});

	it("does not report a false cycle for a diamond DAG", () => {
		const packages = [
			pkg({ id: "top", writeScope: ["src/top.ts"] }),
			pkg({ id: "left", writeScope: ["src/left.ts"], dependsOn: ["top"] }),
			pkg({ id: "right", writeScope: ["src/right.ts"], dependsOn: ["top"] }),
			pkg({ id: "bottom", writeScope: ["src/bottom.ts"], dependsOn: ["left", "right"] }),
		];
		expect(validateWorkPackages(packages).filter((e) => e.kind === "dependency_cycle")).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// resolveDispatchWaves
// ---------------------------------------------------------------------------

describe("resolveDispatchWaves", () => {
	it("batches a linear chain into single-package waves in order", () => {
		const packages = [pkg({ id: "c", dependsOn: ["b"] }), pkg({ id: "a" }), pkg({ id: "b", dependsOn: ["a"] })];
		expect(resolveDispatchWaves(packages)).toEqual([["a"], ["b"], ["c"]]);
	});

	it("groups independent packages into one wave, sorted", () => {
		const packages = [pkg({ id: "z" }), pkg({ id: "a" }), pkg({ id: "m" })];
		expect(resolveDispatchWaves(packages)).toEqual([["a", "m", "z"]]);
	});

	it("resolves a diamond into 3 waves", () => {
		const packages = [
			pkg({ id: "top" }),
			pkg({ id: "left", dependsOn: ["top"] }),
			pkg({ id: "right", dependsOn: ["top"] }),
			pkg({ id: "bottom", dependsOn: ["left", "right"] }),
		];
		expect(resolveDispatchWaves(packages)).toEqual([["top"], ["left", "right"], ["bottom"]]);
	});

	it("returns null on a cycle", () => {
		const packages = [pkg({ id: "a", dependsOn: ["b"] }), pkg({ id: "b", dependsOn: ["a"] })];
		expect(resolveDispatchWaves(packages)).toBeNull();
	});

	it("returns null on an unknown dependency", () => {
		expect(resolveDispatchWaves([pkg({ id: "a", dependsOn: ["ghost"] })])).toBeNull();
	});

	it("returns null on duplicate ids", () => {
		expect(resolveDispatchWaves([pkg({ id: "a" }), pkg({ id: "a", writeScope: ["src/b.ts"] })])).toBeNull();
	});

	it("ignores a self-dependency edge (still resolves)", () => {
		expect(resolveDispatchWaves([pkg({ id: "a", dependsOn: ["a"] })])).toEqual([["a"]]);
	});
});

// ---------------------------------------------------------------------------
// planParallelDispatch
// ---------------------------------------------------------------------------

describe("planParallelDispatch", () => {
	it("fans out fully-disjoint packages in one wave, one group", () => {
		const packages = [
			pkg({ id: "a", writeScope: ["src/a.ts"] }),
			pkg({ id: "b", writeScope: ["src/b.ts"] }),
			pkg({ id: "c", writeScope: ["src/c.ts"] }),
		];
		const plan = planParallelDispatch(packages);
		expect(plan.ok).toBe(true);
		expect(plan.waves).toHaveLength(1);
		expect(plan.waves[0]?.groups).toEqual([["a", "b", "c"]]);
	});

	it("splits a conflicting wave into serial groups (RED pair cannot share a group)", () => {
		const packages = [
			pkg({ id: "a", writeScope: ["src/shared.ts", "src/a.ts"] }),
			pkg({ id: "b", writeScope: ["src/shared.ts", "src/b.ts"] }),
			pkg({ id: "c", writeScope: ["src/c.ts"] }),
		];
		const plan = planParallelDispatch(packages);
		expect(plan.ok).toBe(true);
		expect(plan.waves).toHaveLength(1);
		const groups = plan.waves[0]?.groups ?? [];
		// a+c share the first group (disjoint); b conflicts with a → its own group.
		expect(groups).toEqual([["a", "c"], ["b"]]);
	});

	it("separates a YELLOW pair into different groups too (needs a lead insertion point)", () => {
		const packages = [
			pkg({ id: "a", writeScope: ["package.json", "src/a.ts"] }),
			pkg({ id: "b", writeScope: ["package.json", "src/b.ts"] }),
		];
		const groups = planParallelDispatch(packages).waves[0]?.groups ?? [];
		expect(groups).toEqual([["a"], ["b"]]);
	});

	it("respects dependency order across waves", () => {
		const packages = [
			pkg({ id: "base", writeScope: ["src/base.ts"] }),
			pkg({ id: "up1", writeScope: ["src/up1.ts"], dependsOn: ["base"] }),
			pkg({ id: "up2", writeScope: ["src/up2.ts"], dependsOn: ["base"] }),
		];
		const plan = planParallelDispatch(packages);
		expect(plan.waves.map((w) => w.groups)).toEqual([[["base"]], [["up1", "up2"]]]);
	});

	it("fails (ok=false, no waves) on a validation error", () => {
		const plan = planParallelDispatch([pkg({ id: "a", writeScope: [] })]);
		expect(plan.ok).toBe(false);
		expect(plan.waves).toEqual([]);
		expect(plan.errors.map((e) => e.kind)).toContain("empty_scope");
	});

	it("fails on a cycle", () => {
		const plan = planParallelDispatch([pkg({ id: "a", dependsOn: ["b"] }), pkg({ id: "b", dependsOn: ["a"] })]);
		expect(plan.ok).toBe(false);
		expect(plan.errors.some((e) => e.kind === "dependency_cycle")).toBe(true);
	});

	it("handles the empty set as a trivially-ok empty plan", () => {
		const plan = planParallelDispatch([]);
		expect(plan.ok).toBe(true);
		expect(plan.waves).toEqual([]);
	});
});
