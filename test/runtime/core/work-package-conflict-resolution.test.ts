import { describe, expect, it } from "vitest";
import {
	type ConflictResolution,
	resolvePackagePairConflict,
	suggestConflictResolutions,
	suggestPairConflictResolution,
} from "../../../src/core/work-package-conflict-resolution";
import {
	classifyPackagePairConflict,
	type PackagePairConflict,
	type WorkPackage,
} from "../../../src/core/work-package-dispatch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pkg(over: Partial<WorkPackage> & { id: string }): WorkPackage {
	return { writeScope: [`src/core/${over.id}.ts`], ...over };
}

/** The ordered strategy list from a resolution. */
function strategiesOf(resolution: ConflictResolution): string[] {
	return resolution.options.map((option) => option.strategy);
}

/** Grab the single option of a given strategy (or undefined). */
function optionOf(resolution: ConflictResolution, strategy: string) {
	return resolution.options.find((option) => option.strategy === strategy);
}

// ---------------------------------------------------------------------------
// Green pairs → nothing to resolve
// ---------------------------------------------------------------------------

describe("suggestPairConflictResolution — green pairs", () => {
	it("returns null for a green (disjoint) pair", () => {
		const a = pkg({ id: "a", writeScope: ["src/core/a.ts"] });
		const b = pkg({ id: "b", writeScope: ["src/core/b.ts"] });
		expect(resolvePackagePairConflict(a, b)).toBeNull();
	});

	it("suggestPairConflictResolution(green conflict) is null even if a green conflict object is passed directly", () => {
		const greenConflict: PackagePairConflict = {
			left: "a",
			right: "b",
			conflictClass: "green",
			sharedSpecificPaths: [],
			sharedCoarsePaths: [],
			forbiddenViolations: [],
		};
		expect(suggestPairConflictResolution(greenConflict)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// RED — shared specific path
// ---------------------------------------------------------------------------

describe("suggestPairConflictResolution — RED shared specific file", () => {
	it("two packages writing the SAME specific file → split_scope then serialize", () => {
		const a = pkg({ id: "a", writeScope: ["src/core/shared.ts"] });
		const b = pkg({ id: "b", writeScope: ["src/core/shared.ts"] });
		const resolution = resolvePackagePairConflict(a, b);
		expect(resolution).not.toBeNull();
		expect(resolution?.conflictClass).toBe("red");
		// Exact same file (no over-broad glob) ⇒ no rescope option, just split + serialize (split leads).
		expect(strategiesOf(resolution as ConflictResolution)).toEqual(["split_scope", "serialize"]);
		expect(resolution?.recommended).toBe("split_scope");
	});

	it("split_scope option carries the shared file path and cites both owners", () => {
		const a = pkg({ id: "alpha", writeScope: ["src/core/shared.ts"] });
		const b = pkg({ id: "beta", writeScope: ["src/core/shared.ts"] });
		const resolution = resolvePackagePairConflict(a, b) as ConflictResolution;
		const split = optionOf(resolution, "split_scope");
		expect(split?.paths).toEqual(["src/core/shared.ts"]);
		expect(split?.rationale).toContain("alpha");
		expect(split?.rationale).toContain("beta");
		expect(split?.rationale).toContain("src/core/shared.ts");
	});

	it("serialize option has empty paths and null narrowPackageId (applies to the whole pair)", () => {
		const a = pkg({ id: "a", writeScope: ["src/core/shared.ts"] });
		const b = pkg({ id: "b", writeScope: ["src/core/shared.ts"] });
		const resolution = resolvePackagePairConflict(a, b) as ConflictResolution;
		const serialize = optionOf(resolution, "serialize");
		expect(serialize?.paths).toEqual([]);
		expect(serialize?.narrowPackageId).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// RED — over-broad directory glob (rescope suggestion)
// ---------------------------------------------------------------------------

describe("suggestPairConflictResolution — RED over-broad glob → rescope leads", () => {
	it("one side declares a containing directory glob → rescope_over_broad leads, names that side", () => {
		// `a` writes the whole dir; `b` writes one specific file inside it. classifyPackagePairConflict treats the shared
		// normalized path — but to get a shared *specific* path both must list it; so give `a` BOTH the dir and the file.
		const a = pkg({ id: "a", writeScope: ["src/core", "src/core/shared.ts"] });
		const b = pkg({ id: "b", writeScope: ["src/core/shared.ts"] });
		const resolution = resolvePackagePairConflict(a, b) as ConflictResolution;
		expect(resolution.recommended).toBe("rescope_over_broad");
		const rescope = optionOf(resolution, "rescope_over_broad");
		expect(rescope?.narrowPackageId).toBe("a");
		expect(rescope?.paths).toEqual(["src/core"]); // the broad glob to narrow, not the file
		// Full order: rescope → split → serialize.
		expect(strategiesOf(resolution)).toEqual(["rescope_over_broad", "split_scope", "serialize"]);
	});

	it("BOTH sides over-broad → a rescope option per side (deterministic left-then-right order)", () => {
		const a = pkg({ id: "a", writeScope: ["src/core", "src/core/shared.ts"] });
		const b = pkg({ id: "b", writeScope: ["src/core", "src/core/shared.ts"] });
		const resolution = resolvePackagePairConflict(a, b) as ConflictResolution;
		const rescopes = resolution.options.filter((o) => o.strategy === "rescope_over_broad");
		expect(rescopes.map((o) => o.narrowPackageId)).toEqual(["a", "b"]);
	});

	it("exact-file match is NOT treated as over-broad (no rescope option)", () => {
		const a = pkg({ id: "a", writeScope: ["src/core/shared.ts"] });
		const b = pkg({ id: "b", writeScope: ["src/core/shared.ts"] });
		const resolution = resolvePackagePairConflict(a, b) as ConflictResolution;
		expect(optionOf(resolution, "rescope_over_broad")).toBeUndefined();
	});

	it("without the WorkPackages, the rescope option is skipped (class-driven options only)", () => {
		// Same over-broad scenario but calling suggestPairConflictResolution with only the conflict object.
		const a = pkg({ id: "a", writeScope: ["src/core", "src/core/shared.ts"] });
		const b = pkg({ id: "b", writeScope: ["src/core/shared.ts"] });
		const conflict = classifyPackagePairConflict(a, b);
		const resolution = suggestPairConflictResolution(conflict) as ConflictResolution;
		expect(strategiesOf(resolution)).toEqual(["split_scope", "serialize"]);
	});
});

// ---------------------------------------------------------------------------
// RED — write into forbidden scope
// ---------------------------------------------------------------------------

describe("suggestPairConflictResolution — RED write-into-forbidden", () => {
	it("a write inside the other's forbidden scope → drop_forbidden_write then serialize", () => {
		const a = pkg({ id: "a", writeScope: ["src/server/runtime-server.ts"] });
		const b = pkg({
			id: "b",
			writeScope: ["src/core/b.ts"],
			forbiddenScope: ["src/server"],
		});
		const resolution = resolvePackagePairConflict(a, b) as ConflictResolution;
		expect(resolution.conflictClass).toBe("red");
		expect(resolution.recommended).toBe("drop_forbidden_write");
		expect(strategiesOf(resolution)).toEqual(["drop_forbidden_write", "serialize"]);
	});

	it("drop_forbidden_write extracts the offending write target path from the violation string", () => {
		const a = pkg({ id: "a", writeScope: ["src/server/runtime-server.ts"] });
		const b = pkg({
			id: "b",
			writeScope: ["src/core/b.ts"],
			forbiddenScope: ["src/server"],
		});
		const resolution = resolvePackagePairConflict(a, b) as ConflictResolution;
		const drop = optionOf(resolution, "drop_forbidden_write");
		// The write target is the normalized "src/server/runtime-server.ts" (first quoted segment of the violation).
		expect(drop?.paths).toEqual(["src/server/runtime-server.ts"]);
		expect(drop?.rationale).toContain("forbidden");
	});

	it("captures a write path containing an embedded quote (not truncated at the quote)", () => {
		// The old /writes "([^"]+)"/ negated-quote class stopped at the embedded quote and reported the
		// truncated "src/server/" in the machine-readable paths array (the rationale stayed correct).
		const a = pkg({ id: "a", writeScope: ['src/server/"weird.ts'] });
		const b = pkg({
			id: "b",
			writeScope: ["src/core/b.ts"],
			forbiddenScope: ["src/server"],
		});
		const resolution = resolvePackagePairConflict(a, b) as ConflictResolution;
		const drop = optionOf(resolution, "drop_forbidden_write");
		expect(drop?.paths).toEqual(['src/server/"weird.ts']);
	});

	it("BOTH a shared specific file AND a forbidden violation → specific options, then forbidden, then serialize", () => {
		const a = pkg({
			id: "a",
			writeScope: ["src/core/shared.ts", "src/server/runtime-server.ts"],
		});
		const b = pkg({
			id: "b",
			writeScope: ["src/core/shared.ts"],
			forbiddenScope: ["src/server"],
		});
		const resolution = resolvePackagePairConflict(a, b) as ConflictResolution;
		// split (specific) → drop_forbidden_write → serialize; recommended is the most surgical (split).
		expect(strategiesOf(resolution)).toEqual(["split_scope", "drop_forbidden_write", "serialize"]);
		expect(resolution.recommended).toBe("split_scope");
	});
});

// ---------------------------------------------------------------------------
// YELLOW — shared coarse / barrel path
// ---------------------------------------------------------------------------

describe("suggestPairConflictResolution — YELLOW shared coarse path", () => {
	it("overlap only on a barrel/manifest → single assign_insertion_point option (no serialize)", () => {
		const a = pkg({ id: "a", writeScope: ["src/core/a.ts", "package.json"] });
		const b = pkg({ id: "b", writeScope: ["src/core/b.ts", "package.json"] });
		const resolution = resolvePackagePairConflict(a, b) as ConflictResolution;
		expect(resolution.conflictClass).toBe("yellow");
		expect(strategiesOf(resolution)).toEqual(["assign_insertion_point"]);
		expect(resolution.recommended).toBe("assign_insertion_point");
	});

	it("assign_insertion_point carries the shared coarse path and cites §5.AK YELLOW", () => {
		const a = pkg({ id: "a", writeScope: ["src/core/a.ts", "src/core/index.ts"] });
		const b = pkg({ id: "b", writeScope: ["src/core/b.ts", "src/core/index.ts"] });
		const resolution = resolvePackagePairConflict(a, b) as ConflictResolution;
		const point = optionOf(resolution, "assign_insertion_point");
		expect(point?.paths).toEqual(["src/core/index.ts"]);
		expect(point?.rationale).toContain("YELLOW");
	});
});

// ---------------------------------------------------------------------------
// Determinism + normalization pass-through
// ---------------------------------------------------------------------------

describe("suggestPairConflictResolution — determinism & normalization", () => {
	it("is input-order independent for the same unordered pair (same strategies + paths)", () => {
		const a = pkg({ id: "a", writeScope: ["src/core/shared.ts"] });
		const b = pkg({ id: "b", writeScope: ["src/core/shared.ts"] });
		const forward = resolvePackagePairConflict(a, b) as ConflictResolution;
		const reversed = resolvePackagePairConflict(b, a) as ConflictResolution;
		expect(strategiesOf(forward)).toEqual(strategiesOf(reversed));
		expect(optionOf(forward, "split_scope")?.paths).toEqual(optionOf(reversed, "split_scope")?.paths);
	});

	it("normalizes messy globs (backslashes / leading ./ / case) before matching the shared path", () => {
		const a = pkg({ id: "a", writeScope: [".\\src\\Core\\Shared.ts"] });
		const b = pkg({ id: "b", writeScope: ["src/core/shared.ts"] });
		const resolution = resolvePackagePairConflict(a, b) as ConflictResolution;
		expect(resolution.conflictClass).toBe("red");
		expect(optionOf(resolution, "split_scope")?.paths).toEqual(["src/core/shared.ts"]);
	});

	it("every non-green pair yields at least one option and a recommended strategy equal to options[0]", () => {
		const a = pkg({ id: "a", writeScope: ["src/core/shared.ts"] });
		const b = pkg({ id: "b", writeScope: ["src/core/shared.ts"] });
		const resolution = resolvePackagePairConflict(a, b) as ConflictResolution;
		expect(resolution.options.length).toBeGreaterThan(0);
		expect(resolution.recommended).toBe(resolution.options[0]?.strategy);
	});
});

// ---------------------------------------------------------------------------
// suggestConflictResolutions — batch over a package set
// ---------------------------------------------------------------------------

describe("suggestConflictResolutions — batch", () => {
	it("empty set → no resolutions", () => {
		expect(suggestConflictResolutions([])).toEqual([]);
	});

	it("all-disjoint set → no resolutions (only non-green pairs are reported)", () => {
		const set = [pkg({ id: "a" }), pkg({ id: "b" }), pkg({ id: "c" })];
		expect(suggestConflictResolutions(set)).toEqual([]);
	});

	it("one Red pair among disjoint others → exactly one resolution for that pair", () => {
		const set = [
			pkg({ id: "a", writeScope: ["src/core/shared.ts"] }),
			pkg({ id: "b", writeScope: ["src/core/shared.ts"] }),
			pkg({ id: "c", writeScope: ["src/core/c.ts"] }),
		];
		const resolutions = suggestConflictResolutions(set);
		expect(resolutions).toHaveLength(1);
		expect(resolutions[0]?.left).toBe("a");
		expect(resolutions[0]?.right).toBe("b");
		expect(resolutions[0]?.conflictClass).toBe("red");
	});

	it("mixed Red + Yellow conflicts → one resolution each, in detector (pair) order", () => {
		const set = [
			pkg({ id: "a", writeScope: ["src/core/shared.ts", "package.json"] }),
			pkg({ id: "b", writeScope: ["src/core/shared.ts"] }), // a↔b: red (shared specific)
			pkg({ id: "c", writeScope: ["package.json", "src/core/c.ts"] }), // a↔c: yellow (shared package.json)
		];
		const resolutions = suggestConflictResolutions(set);
		// Pairs in detector order: (a,b) red, (a,c) yellow, (b,c) green→omitted.
		expect(resolutions.map((r) => [r.left, r.right, r.conflictClass])).toEqual([
			["a", "b", "red"],
			["a", "c", "yellow"],
		]);
	});

	it("threads the packages so a batch resolution still offers rescope_over_broad", () => {
		const set = [
			pkg({ id: "a", writeScope: ["src/core", "src/core/shared.ts"] }),
			pkg({ id: "b", writeScope: ["src/core/shared.ts"] }),
		];
		const resolutions = suggestConflictResolutions(set);
		expect(resolutions[0]?.recommended).toBe("rescope_over_broad");
	});

	it("duplicate ids in the set are de-duplicated for the package lookup (first wins), still total", () => {
		const set = [
			pkg({ id: "a", writeScope: ["src/core", "src/core/shared.ts"] }),
			pkg({ id: "a", writeScope: ["src/core/other.ts"] }), // dup id — first def wins for lookup
			pkg({ id: "b", writeScope: ["src/core/shared.ts"] }),
		];
		// Should not throw; produces resolutions for the conflicting pairs the detector finds.
		expect(() => suggestConflictResolutions(set)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// resolvePackagePairConflict — the diagnose+prescribe convenience
// ---------------------------------------------------------------------------

describe("resolvePackagePairConflict", () => {
	it("equals suggestPairConflictResolution(classify(...), left, right)", () => {
		const a = pkg({ id: "a", writeScope: ["src/core/shared.ts"] });
		const b = pkg({ id: "b", writeScope: ["src/core/shared.ts"] });
		const viaConvenience = resolvePackagePairConflict(a, b);
		const viaExplicit = suggestPairConflictResolution(classifyPackagePairConflict(a, b), a, b);
		expect(viaConvenience).toEqual(viaExplicit);
	});
});
