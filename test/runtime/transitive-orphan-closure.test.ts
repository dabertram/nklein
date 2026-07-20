import { describe, expect, it } from "vitest";
import {
	type ClosureInput,
	computeTransitiveOrphanClosure,
	type ReferenceSite,
} from "../../src/core/transitive-orphan-closure";

function sites(map: Record<string, ReferenceSite[]>): ClosureInput["referenceSites"] {
	return new Map(Object.entries(map));
}

describe("computeTransitiveOrphanClosure", () => {
	it("reproduces the REAL case: a symbol consumed only by a dead module is not wired", () => {
		// retry-policy::planNextAttempt <- adaptive-attempt-loop.ts <- (nothing).
		// The one-level scan called planNextAttempt wired; it reaches no live path.
		const result = computeTransitiveOrphanClosure({
			symbols: [
				{ module: "retry-policy.ts", name: "planNextAttempt" },
				{ module: "adaptive-attempt-loop.ts", name: "runAdaptiveAttemptLoop" },
			],
			referenceSites: sites({
				"retry-policy.ts::planNextAttempt": [
					{ file: "src/core/adaptive-attempt-loop.ts", line: "const plan = planNextAttempt({" },
				],
			}),
		});
		expect(result.deadModules).toContain("adaptive-attempt-loop.ts");
		expect(result.orphanKeys.has("retry-policy.ts::planNextAttempt")).toBe(true);
		expect(result.newlyOrphanedByClosure).toEqual(["retry-policy.ts::planNextAttempt"]);
		expect(result.summary).toContain("consumed only by dead code");
	});

	it("CASCADES through a chain — a single extra pass would not be enough", () => {
		// c <- b <- a <- (nothing). Killing a orphans b, which kills b, which orphans c.
		const result = computeTransitiveOrphanClosure({
			symbols: [
				{ module: "c.ts", name: "cFn" },
				{ module: "b.ts", name: "bFn" },
				{ module: "a.ts", name: "aFn" },
			],
			referenceSites: sites({
				"c.ts::cFn": [{ file: "src/core/b.ts", line: "cFn()" }],
				"b.ts::bFn": [{ file: "src/core/a.ts", line: "bFn()" }],
			}),
		});
		expect([...result.deadModules].sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
		expect(result.passes).toBeGreaterThan(1);
	});

	it("keeps a symbol wired when ANY live consumer remains", () => {
		const result = computeTransitiveOrphanClosure({
			symbols: [
				{ module: "shared.ts", name: "useful" },
				{ module: "dead.ts", name: "deadFn" },
			],
			referenceSites: sites({
				"shared.ts::useful": [
					{ file: "src/core/dead.ts", line: "useful()" },
					{ file: "src/commands/live.ts", line: "useful()" },
				],
			}),
		});
		expect(result.orphanKeys.has("shared.ts::useful")).toBe(false);
		expect(result.deadModules).toEqual(["dead.ts"]);
	});

	it("treats references from OUTSIDE the core dir as live — the conservative direction", () => {
		// Guessing the other way would report a genuinely-wired core as orphaned, which invites someone to delete
		// working code. Under-reporting only leaves an orphan hidden longer.
		const result = computeTransitiveOrphanClosure({
			symbols: [{ module: "used.ts", name: "fn" }],
			referenceSites: sites({ "used.ts::fn": [{ file: "src/nklein-agent/runtime.ts", line: "fn()" }] }),
		});
		expect(result.orphanKeys.size).toBe(0);
	});

	it("does not treat a nested path under core as a core module", () => {
		// src/core/sub/x.ts is not a judgeable module here; its reference counts as live rather than being
		// mis-attributed to a module named "sub/x.ts".
		const result = computeTransitiveOrphanClosure({
			symbols: [{ module: "used.ts", name: "fn" }],
			referenceSites: sites({ "used.ts::fn": [{ file: "src/core/sub/x.ts", line: "fn()" }] }),
		});
		expect(result.orphanKeys.size).toBe(0);
	});

	it("DOCUMENTS THE LIMIT: a cycle of dead modules keeps itself alive", () => {
		// a and b import each other and nothing else imports either. Both are unreachable, and this algorithm
		// CANNOT SEE THAT — reference counting never detects cycles; only mark-and-sweep from roots does.
		// Asserted as the limitation it is rather than quietly hidden: a reader who assumes this finds all dead
		// code would be wrong, and the failure would be silent.
		const result = computeTransitiveOrphanClosure({
			symbols: [
				{ module: "a.ts", name: "aFn" },
				{ module: "b.ts", name: "bFn" },
			],
			referenceSites: sites({
				"a.ts::aFn": [{ file: "src/core/b.ts", line: "aFn()" }],
				"b.ts::bFn": [{ file: "src/core/a.ts", line: "bFn()" }],
			}),
		});
		expect(result.deadModules).toEqual([]);
		expect(result.orphanKeys.size).toBe(0);
		// It must at least TERMINATE on the cycle rather than spinning.
		expect(result.passes).toBe(1);
	});

	it("reports nothing new when every wired symbol is wired to something live", () => {
		const result = computeTransitiveOrphanClosure({
			symbols: [{ module: "x.ts", name: "fn" }],
			referenceSites: sites({ "x.ts::fn": [{ file: "src/commands/y.ts", line: "fn()" }] }),
		});
		expect(result.newlyOrphanedByClosure).toEqual([]);
		expect(result.summary).toContain("wired to something live");
	});

	it("handles an empty input without throwing", () => {
		const result = computeTransitiveOrphanClosure({ symbols: [], referenceSites: new Map() });
		expect(result.orphanKeys.size).toBe(0);
		expect(result.passes).toBe(1);
	});
});
