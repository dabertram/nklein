import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planGapKindSchema } from "../../../src/core/plan-gap-kind";

/**
 * Coverage for a module the P20.3b ablation sweep found had NO exercising test (2026-08-08).
 *
 * The enum itself is trivial. The reason this module EXISTS is not: it was split out of `plan-gap.ts` purely so
 * the browser-bundled contract can reference the kind WITHOUT dragging in the telemetry chain
 * (`recordSelfObservation` → `self-observation-sink` → `node:path`/`fs`/`os`/`crypto`), which breaks the web-ui
 * build. **That constraint is invisible to any test of the enum's values** — a future edit adding one Node import
 * here would keep every value assertion green and break the browser build instead, which is exactly the kind of
 * failure that surfaces far from its cause.
 *
 * So the load-bearing test below is the IMPORT RATCHET, not the enum.
 */
describe("planGapKindSchema", () => {
	it("accepts every declared kind and rejects anything else", () => {
		for (const kind of [
			"missing_decision",
			"contradictory_requirement",
			"missing_dependency",
			"scope_too_large",
			"integration_needed",
			"other",
		]) {
			expect(planGapKindSchema.parse(kind)).toBe(kind);
		}
		expect(planGapKindSchema.safeParse("not_a_kind").success).toBe(false);
		expect(planGapKindSchema.safeParse("").success).toBe(false);
		expect(planGapKindSchema.safeParse(undefined).success).toBe(false);
	});

	it("keeps `other` available — the escape hatch a closed enum needs", () => {
		// Without it, a gap that fits no named kind has nowhere to go and gets mislabelled as the nearest one,
		// which quietly corrupts every count built on this enum.
		expect(planGapKindSchema.safeParse("other").success).toBe(true);
	});
});

describe("browser-safety ratchet", () => {
	it("imports NOTHING from node: — the whole reason this module was split out", () => {
		// A source-level check because the property is about what the module DRAGS IN, which no runtime assertion
		// on the enum can observe. If this ever fails, the fix is to keep the Node-dependent code in `plan-gap.ts`
		// rather than to relax the ratchet: the web-ui bundle is the thing being protected.
		const source = readFileSync("src/core/plan-gap-kind.ts", "utf8");
		const nodeImports = [...source.matchAll(/from\s+["']node:([\w/]+)["']/gu)].map((match) => match[1]);
		expect(
			nodeImports,
			`plan-gap-kind.ts must stay browser-safe; it now imports node:${nodeImports.join(", node:")}`,
		).toEqual([]);
	});

	it("imports nothing but zod at all, so no transitive Node dependency can creep in", () => {
		// The stronger form: a bare `node:` check passes if someone imports a LOCAL module that itself pulls in
		// `node:fs`. Pinning the entire import list is what actually holds the boundary.
		const source = readFileSync("src/core/plan-gap-kind.ts", "utf8");
		const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
		expect(imports).toEqual(["zod"]);
	});
});
