import { describe, expect, it } from "vitest";
import type { WorkPackage } from "../../../src/core/work-package-dispatch";
import {
	admitReadyPackages,
	assessMergeReadiness,
	type GateResult,
	type MergeReadinessInvariant,
	type MergeReadinessPack,
	REQUIRED_MERGE_READINESS_INVARIANTS,
} from "../../../src/core/work-package-merge-readiness";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pkg(over: Partial<WorkPackage> & { id: string }): WorkPackage {
	return { writeScope: [`src/core/${over.id}.ts`], ...over };
}

/** All required invariants asserted — the "clean" invariant list. */
const ALL_INVARIANTS: readonly MergeReadinessInvariant[] = REQUIRED_MERGE_READINESS_INVARIANTS;

/** One green gate, the common minimal evidence. */
const GREEN_GATES: readonly GateResult[] = [
	{ name: "typecheck", status: "pass" },
	{ name: "biome", status: "pass" },
	{ name: "test:fast", status: "pass" },
];

/** A pack that PASSES every check for a package writing only its own single file. */
function cleanPack(id: string, over: Partial<MergeReadinessPack> = {}): MergeReadinessPack {
	return {
		packageId: id,
		changedFiles: [`src/core/${id}.ts`],
		gateResults: GREEN_GATES,
		assertedInvariants: ALL_INVARIANTS,
		...over,
	};
}

function kinds(assessment: ReturnType<typeof assessMergeReadiness>): string[] {
	return assessment.findings.map((f) => f.kind);
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("assessMergeReadiness — admit", () => {
	it("a fully-clean pack admits with no findings", () => {
		const assessment = assessMergeReadiness(pkg({ id: "a" }), cleanPack("a"));
		expect(assessment.verdict).toBe("admit");
		expect(assessment.findings).toEqual([]);
		expect(assessment.blockingFindings).toEqual([]);
		expect(assessment.missingInvariants).toEqual([]);
		expect(assessment.packageId).toBe("a");
	});

	it("multiple changed files all inside a directory write scope admit", () => {
		const contract = pkg({ id: "a", writeScope: ["src/core", "test/runtime/core"] });
		const pack = cleanPack("a", {
			changedFiles: ["src/core/a.ts", "src/core/a-helper.ts", "test/runtime/core/a.test.ts"],
		});
		expect(assessMergeReadiness(contract, pack).verdict).toBe("admit");
	});

	it("a directory glob with a /** tail contains its files", () => {
		const contract = pkg({ id: "a", writeScope: ["src/core/**"] });
		const pack = cleanPack("a", { changedFiles: ["src/core/deep/nested/x.ts"] });
		expect(assessMergeReadiness(contract, pack).verdict).toBe("admit");
	});

	it("exact-file write scope admits the exact file", () => {
		const contract = pkg({ id: "a", writeScope: ["src/core/a.ts"] });
		expect(assessMergeReadiness(contract, cleanPack("a")).verdict).toBe("admit");
	});

	it("normalizes ./ and backslashes and leading slash on changed paths and scope", () => {
		const contract = pkg({ id: "a", writeScope: ["./src/core/a.ts"] });
		const pack = cleanPack("a", { changedFiles: ["src\\core\\a.ts"] });
		expect(assessMergeReadiness(contract, pack).verdict).toBe("admit");
	});
});

// ---------------------------------------------------------------------------
// Out-of-scope writes (blocking)
// ---------------------------------------------------------------------------

describe("assessMergeReadiness — out-of-scope writes", () => {
	it("a changed file outside the write scope blocks", () => {
		const contract = pkg({ id: "a", writeScope: ["src/core/a.ts"] });
		const pack = cleanPack("a", { changedFiles: ["src/core/a.ts", "src/server/runtime-server.ts"] });
		const assessment = assessMergeReadiness(contract, pack);
		expect(assessment.verdict).toBe("block");
		expect(assessment.blockingFindings.map((f) => f.subject)).toEqual(["src/server/runtime-server.ts"]);
		expect(kinds(assessment)).toContain("out_of_scope_write");
	});

	it("prefix-collision path (ab vs a) is NOT considered in-scope", () => {
		// `src/coreX/...` must not be treated as inside `src/core`.
		const contract = pkg({ id: "a", writeScope: ["src/core"] });
		const pack = cleanPack("a", { changedFiles: ["src/coreX/a.ts"] });
		expect(assessMergeReadiness(contract, pack).verdict).toBe("block");
	});

	it("reports one out_of_scope finding per offending file, sorted by subject", () => {
		const contract = pkg({ id: "a", writeScope: ["src/core/a.ts"] });
		const pack = cleanPack("a", {
			changedFiles: ["src/z/z.ts", "src/core/a.ts", "src/m/m.ts"],
		});
		const assessment = assessMergeReadiness(contract, pack);
		const outOfScope = assessment.findings.filter((f) => f.kind === "out_of_scope_write").map((f) => f.subject);
		expect(outOfScope).toEqual(["src/m/m.ts", "src/z/z.ts"]);
	});

	it("empty-string changed paths are ignored (not flagged)", () => {
		const pack = cleanPack("a", { changedFiles: ["src/core/a.ts", "   ", ""] });
		expect(assessMergeReadiness(pkg({ id: "a" }), pack).verdict).toBe("admit");
	});
});

// ---------------------------------------------------------------------------
// Forbidden writes (blocking, takes precedence over out-of-scope)
// ---------------------------------------------------------------------------

describe("assessMergeReadiness — forbidden writes", () => {
	it("a changed file inside the forbidden scope blocks", () => {
		const contract = pkg({
			id: "a",
			writeScope: ["src/core"],
			forbiddenScope: ["src/core/locked.ts"],
		});
		const pack = cleanPack("a", { changedFiles: ["src/core/a.ts", "src/core/locked.ts"] });
		const assessment = assessMergeReadiness(contract, pack);
		expect(assessment.verdict).toBe("block");
		expect(kinds(assessment)).toContain("forbidden_write");
		expect(assessment.blockingFindings.some((f) => f.subject === "src/core/locked.ts")).toBe(true);
	});

	it("forbidden takes precedence over out-of-scope for the same path (one finding, forbidden)", () => {
		// The path is both outside writeScope AND inside forbiddenScope — should report forbidden only.
		const contract = pkg({
			id: "a",
			writeScope: ["src/core/a.ts"],
			forbiddenScope: ["src/server"],
		});
		const pack = cleanPack("a", { changedFiles: ["src/server/x.ts"] });
		const assessment = assessMergeReadiness(contract, pack);
		const forbidden = assessment.findings.filter((f) => f.kind === "forbidden_write");
		const outOfScope = assessment.findings.filter((f) => f.kind === "out_of_scope_write");
		expect(forbidden).toHaveLength(1);
		expect(outOfScope).toHaveLength(0);
	});

	it("a forbidden directory glob contains nested files", () => {
		const contract = pkg({
			id: "a",
			writeScope: ["src"],
			forbiddenScope: ["src/nklein-agent"],
		});
		const pack = cleanPack("a", { changedFiles: ["src/nklein-agent/nklein-session-runtime.ts"] });
		expect(assessMergeReadiness(contract, pack).verdict).toBe("block");
	});
});

// ---------------------------------------------------------------------------
// Protected-test paths (blocking unless approved)
// ---------------------------------------------------------------------------

describe("assessMergeReadiness — protected-test paths", () => {
	it("an unapproved protected-test change blocks", () => {
		const contract = pkg({ id: "a", writeScope: ["src/core", "test/protected"] });
		const pack = cleanPack("a", { changedFiles: ["test/protected/protected-tests.json"] });
		const assessment = assessMergeReadiness(contract, pack);
		expect(assessment.verdict).toBe("block");
		expect(kinds(assessment)).toContain("protected_write_unapproved");
	});

	it("a protected-test change under test/protected/** blocks without approval", () => {
		const contract = pkg({ id: "a", writeScope: ["test/protected"] });
		const pack = cleanPack("a", { changedFiles: ["test/protected/some-suite.test.ts"] });
		expect(assessMergeReadiness(contract, pack).verdict).toBe("block");
	});

	it("vitest.protected.config.ts is a protected file and blocks without approval", () => {
		const contract = pkg({ id: "a", writeScope: ["."] });
		const pack = cleanPack("a", { changedFiles: ["vitest.protected.config.ts"] });
		const assessment = assessMergeReadiness(contract, pack);
		expect(assessment.verdict).toBe("block");
		expect(kinds(assessment)).toContain("protected_write_unapproved");
	});

	it("an APPROVED protected-test change admits with a warning (not a block)", () => {
		const contract = pkg({ id: "a", writeScope: ["test/protected"] });
		const pack = cleanPack("a", {
			changedFiles: ["test/protected/some-suite.test.ts"],
			protectedTestApprovalGranted: true,
		});
		const assessment = assessMergeReadiness(contract, pack);
		expect(assessment.verdict).toBe("admit_with_warnings");
		expect(assessment.blockingFindings).toEqual([]);
		expect(kinds(assessment)).toContain("protected_write_approved");
	});

	it("a protected path is judged protected even when it is also inside the write scope", () => {
		// Being in-scope does not exempt a protected path from the human gate.
		const contract = pkg({ id: "a", writeScope: ["test"] });
		const pack = cleanPack("a", { changedFiles: ["test/protected/x.test.ts"] });
		expect(assessMergeReadiness(contract, pack).verdict).toBe("block");
	});
});

// ---------------------------------------------------------------------------
// Gate results (blocking on fail/error/missing; warning on skipped)
// ---------------------------------------------------------------------------

describe("assessMergeReadiness — gate results", () => {
	it("a failed gate blocks", () => {
		const pack = cleanPack("a", {
			gateResults: [
				{ name: "typecheck", status: "pass" },
				{ name: "test:fast", status: "fail", detail: "2 failing" },
			],
		});
		const assessment = assessMergeReadiness(pkg({ id: "a" }), pack);
		expect(assessment.verdict).toBe("block");
		const gateFinding = assessment.findings.find((f) => f.kind === "gate_not_passed");
		expect(gateFinding?.subject).toBe("test:fast");
		expect(gateFinding?.blocking).toBe(true);
		expect(gateFinding?.message).toContain("2 failing");
	});

	it("an errored gate blocks", () => {
		const pack = cleanPack("a", { gateResults: [{ name: "biome", status: "error" }] });
		expect(assessMergeReadiness(pkg({ id: "a" }), pack).verdict).toBe("block");
	});

	it("no gate results at all blocks (no evidence)", () => {
		const pack = cleanPack("a", { gateResults: [] });
		const assessment = assessMergeReadiness(pkg({ id: "a" }), pack);
		expect(assessment.verdict).toBe("block");
		expect(kinds(assessment)).toContain("missing_gate_results");
	});

	it("a skipped gate is a warning, not a block", () => {
		const pack = cleanPack("a", {
			gateResults: [
				{ name: "typecheck", status: "pass" },
				{ name: "web:build", status: "skipped" },
			],
		});
		const assessment = assessMergeReadiness(pkg({ id: "a" }), pack);
		expect(assessment.verdict).toBe("admit_with_warnings");
		expect(assessment.blockingFindings).toEqual([]);
		const skipped = assessment.findings.find((f) => f.kind === "gate_not_passed");
		expect(skipped?.blocking).toBe(false);
		expect(skipped?.message).toContain("coverage gap");
	});
});

// ---------------------------------------------------------------------------
// Invariants (blocking when a required one is not asserted)
// ---------------------------------------------------------------------------

describe("assessMergeReadiness — invariants", () => {
	it("a missing required invariant blocks and is listed in missingInvariants", () => {
		const pack = cleanPack("a", {
			assertedInvariants: ["local_only", "docker_isolation", "no_host_path_leak", "min_context_floor"],
		});
		const assessment = assessMergeReadiness(pkg({ id: "a" }), pack);
		expect(assessment.verdict).toBe("block");
		expect(assessment.missingInvariants).toEqual(["protected_untouched"]);
		expect(kinds(assessment)).toContain("invariant_not_asserted");
	});

	it("no asserted invariants → all required listed as missing, in the required order", () => {
		const pack = cleanPack("a", { assertedInvariants: [] });
		const assessment = assessMergeReadiness(pkg({ id: "a" }), pack);
		expect(assessment.missingInvariants).toEqual(REQUIRED_MERGE_READINESS_INVARIANTS);
		expect(assessment.blockingFindings.filter((f) => f.kind === "invariant_not_asserted")).toHaveLength(
			REQUIRED_MERGE_READINESS_INVARIANTS.length,
		);
	});

	it("extra (unknown) asserted invariants do not matter as long as all required are present", () => {
		const pack = cleanPack("a", {
			assertedInvariants: [...ALL_INVARIANTS, "some_future_invariant" as MergeReadinessInvariant],
		});
		expect(assessMergeReadiness(pkg({ id: "a" }), pack).verdict).toBe("admit");
	});
});

// ---------------------------------------------------------------------------
// Package-id mismatch + no-changed-files
// ---------------------------------------------------------------------------

describe("assessMergeReadiness — id mismatch + empty diff", () => {
	it("a pack reporting on a different package id blocks", () => {
		const assessment = assessMergeReadiness(pkg({ id: "a" }), cleanPack("b"));
		expect(assessment.verdict).toBe("block");
		expect(kinds(assessment)).toContain("package_id_mismatch");
		// packageId of the assessment is the CONTRACT's id.
		expect(assessment.packageId).toBe("a");
	});

	it("a pack with no changed files is a warning (suspicious, not a violation)", () => {
		const pack = cleanPack("a", { changedFiles: [] });
		const assessment = assessMergeReadiness(pkg({ id: "a" }), pack);
		expect(assessment.verdict).toBe("admit_with_warnings");
		expect(kinds(assessment)).toContain("no_changed_files");
		expect(assessment.blockingFindings).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Finding ordering + all-findings-collected (never short-circuits)
// ---------------------------------------------------------------------------

describe("assessMergeReadiness — collects all findings, blocking first", () => {
	it("reports every distinct problem at once", () => {
		const contract = pkg({
			id: "a",
			writeScope: ["src/core/a.ts"],
			forbiddenScope: ["src/core/locked.ts"],
		});
		const pack: MergeReadinessPack = {
			packageId: "wrong",
			changedFiles: ["src/core/locked.ts", "src/elsewhere/x.ts"],
			gateResults: [{ name: "test:fast", status: "fail" }],
			assertedInvariants: [],
		};
		const assessment = assessMergeReadiness(contract, pack);
		expect(assessment.verdict).toBe("block");
		const ks = new Set(kinds(assessment));
		expect(ks.has("package_id_mismatch")).toBe(true);
		expect(ks.has("forbidden_write")).toBe(true);
		expect(ks.has("out_of_scope_write")).toBe(true);
		expect(ks.has("gate_not_passed")).toBe(true);
		expect(ks.has("invariant_not_asserted")).toBe(true);
	});

	it("blocking findings sort before non-blocking findings", () => {
		// An out-of-scope (blocking) write + an approved protected change (warning) + a skipped gate (warning).
		const contract = pkg({ id: "a", writeScope: ["src/core/a.ts", "test/protected"] });
		const pack = cleanPack("a", {
			changedFiles: ["src/core/a.ts", "src/other/x.ts", "test/protected/p.test.ts"],
			protectedTestApprovalGranted: true,
			gateResults: [
				{ name: "typecheck", status: "pass" },
				{ name: "web:build", status: "skipped" },
			],
		});
		const assessment = assessMergeReadiness(contract, pack);
		const firstNonBlockingIdx = assessment.findings.findIndex((f) => !f.blocking);
		const lastBlockingIdx = assessment.findings.map((f) => f.blocking).lastIndexOf(true);
		expect(lastBlockingIdx).toBeLessThan(firstNonBlockingIdx);
	});

	it("is total on a wholly malformed pack (does not throw)", () => {
		const contract = pkg({ id: "a" });
		const pack: MergeReadinessPack = {
			packageId: "a",
			changedFiles: ["../escapes/x.ts", ""],
			gateResults: [],
			assertedInvariants: [],
		};
		expect(() => assessMergeReadiness(contract, pack)).not.toThrow();
		expect(assessMergeReadiness(contract, pack).verdict).toBe("block");
	});
});

// ---------------------------------------------------------------------------
// admitReadyPackages — batch gate
// ---------------------------------------------------------------------------

describe("admitReadyPackages — batch", () => {
	it("splits admissible from blocked and threads assessments", () => {
		const packages = [pkg({ id: "a" }), pkg({ id: "b" }), pkg({ id: "c" })];
		const packs = [
			cleanPack("a"),
			cleanPack("b", { changedFiles: ["src/server/x.ts"] }), // out of scope → blocked
			cleanPack("c", { gateResults: [{ name: "t", status: "skipped" }] }), // warning → admissible
		];
		const result = admitReadyPackages(packages, packs);
		expect([...result.admissible].sort()).toEqual(["a", "c"]);
		expect(result.blocked).toEqual(["b"]);
		expect(result.unmatched).toEqual([]);
		expect(result.assessments).toHaveLength(3);
	});

	it("a pack with no matching contract is unmatched and blocked", () => {
		const result = admitReadyPackages([pkg({ id: "a" })], [cleanPack("a"), cleanPack("ghost")]);
		expect(result.admissible).toEqual(["a"]);
		expect(result.unmatched).toEqual(["ghost"]);
		expect(result.blocked).toEqual(["ghost"]);
		// The unmatched pack produced no assessment (no contract to assess against).
		expect(result.assessments).toHaveLength(1);
	});

	it("empty inputs → empty result", () => {
		const result = admitReadyPackages([], []);
		expect(result.admissible).toEqual([]);
		expect(result.blocked).toEqual([]);
		expect(result.unmatched).toEqual([]);
		expect(result.assessments).toEqual([]);
	});

	it("duplicate contract ids: first contract wins for the match", () => {
		const packages = [
			pkg({ id: "a", writeScope: ["src/core/a.ts"] }),
			pkg({ id: "a", writeScope: ["src/anything"] }),
		];
		// The pack writes only src/core/a.ts → admissible under the FIRST contract, would be out-of-scope under the second.
		const result = admitReadyPackages(packages, [cleanPack("a")]);
		expect(result.admissible).toEqual(["a"]);
		expect(result.blocked).toEqual([]);
	});
});
