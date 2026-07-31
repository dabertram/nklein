import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeImportClosure } from "../../src/core/module-import-closure";

/**
 * P25.3 phase 3 — model ACQUISITION is unreachable from the autonomous runtime, proven rather than intended.
 *
 * ── THE RULE ──
 * David, 2026-07-31: *"downloading new models shall never be part of standard !Klein workflows, except for initial
 * or re-triggered setup"*. The backlog turned that into a build order — **structural boundary FIRST**, so that
 * *"an autonomous session downloaded a model" is unreachable rather than merely unusual*.
 *
 * ── WHY A CLOSURE WALK AND NOT A GREP ──
 * A grep for `downloadModel` in the runtime proves nobody calls it TODAY. That was already true before this
 * boundary existed, and it stayed true while the capability sat on the very client object the runtime constructs.
 * Reachability is the property the rule is actually about.
 *
 * ── THE VACUOUS-PASS TRAP THIS FILE IS BUILT AROUND ──
 * Every way of getting edge extraction wrong makes the closure SMALLER, and a smaller closure makes a "not
 * reachable" assertion PASS. So this test is not allowed to assert only the absence: it also pins that the walk
 * resolved every relative import, that it reached a known-deep module through several hops, and that the closure
 * is large. Without those, a walker that returned the empty set would look like a clean bill of health.
 */

const ACQUISITION_MODULE = "src/core/lmstudio-model-acquisition.ts";

/**
 * Where an autonomous session actually begins.
 *
 * `start-task-session.ts` is the tRPC procedure that starts a task session — it is the module that constructed a
 * client carrying `downloadModel` before this boundary existed, so it is the honest entry point for the question
 * "could a running task have reached the download capability?".
 */
const AUTONOMOUS_RUNTIME_ENTRY_POINTS = ["src/trpc/runtime-api/start-task-session.ts"];

function runtimeClosure() {
	const knownFiles = new Set(globSync("src/**/*.{ts,tsx}"));
	return {
		knownFiles,
		...computeImportClosure({
			entryPoints: AUTONOMOUS_RUNTIME_ENTRY_POINTS,
			knownFiles,
			readSource: (file) => {
				try {
					return readFileSync(file, "utf8");
				} catch {
					return null;
				}
			},
		}),
	};
}

describe("model acquisition boundary", () => {
	it("does not reach the acquisition module from the autonomous runtime", () => {
		const { reached, knownFiles } = runtimeClosure();
		// The module must exist, or this assertion is about a filename typo rather than about a boundary.
		expect(knownFiles.has(ACQUISITION_MODULE)).toBe(true);
		expect(reached.has(ACQUISITION_MODULE)).toBe(false);
	});

	it("resolved EVERY relative import — an unresolved one is a missing edge, not a detail", () => {
		const { unresolvedRelative } = runtimeClosure();
		expect(
			unresolvedRelative,
			`unresolved relative imports mean the closure is incomplete, so the boundary assertion above is unsound: ${unresolvedRelative
				.slice(0, 5)
				.map((entry) => `${entry.from} → ${entry.specifier}`)
				.join(", ")}`,
		).toEqual([]);
	});

	it("actually walked the graph — positive controls at one hop and several", () => {
		const { reached } = runtimeClosure();
		// One hop: start-task-session imports the REST client directly.
		expect(reached.has("src/core/lmstudio-rest-model-client.ts")).toBe(true);
		// Several hops: the client imports the load policy, which nothing in the entry point names.
		expect(reached.has("src/core/model-load-policy.ts")).toBe(true);
		// A runtime entry that reached only a handful of files would satisfy every assertion above by accident.
		expect(reached.size).toBeGreaterThan(100);
	});

	it("keeps the download capability off the runtime's model client", () => {
		// The type-level half of the same rule: even a module that legitimately holds a client cannot reach the
		// capability through it. Checked as text because a removed interface member has no runtime trace.
		const client = readFileSync("src/core/lmstudio-rest-model-client.ts", "utf8");
		const runtimeSurface = /export interface LmStudioRestModelClient \{[^}]*\}/u.exec(client)?.[0] ?? "";
		expect(runtimeSurface).not.toBe("");
		expect(runtimeSurface).not.toContain("downloadModel");
	});
});
