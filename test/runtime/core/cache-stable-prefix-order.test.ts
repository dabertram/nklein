import { describe, expect, it } from "vitest";
import type { CacheFragment } from "../../../src/core/cache-prefix-reuse";
import {
	type CacheStablePrefixPlan,
	orderFragmentsForStablePrefix,
	PREFIX_STABILITY_ORDER,
	type PrefixOrderFragment,
	type PrefixStability,
	planCacheStablePrefixOrder,
	planCacheStablePrefixWithReuse,
} from "../../../src/core/cache-stable-prefix-order";

/** Terse fragment builder for the tests. */
function frag(id: string, tokenCount: number, stability?: PrefixStability): PrefixOrderFragment {
	return stability === undefined ? { id, tokenCount } : { id, tokenCount, stability };
}

/** Pull just the ids out of an ordered fragment list (for concise order assertions). */
function ids(fragments: readonly PrefixOrderFragment[]): string[] {
	return fragments.map((fragment) => fragment.id);
}

describe("PREFIX_STABILITY_ORDER", () => {
	it("is most-stable-first: static → persistent → session → volatile", () => {
		expect(PREFIX_STABILITY_ORDER).toEqual(["static", "persistent", "session", "volatile"]);
	});
});

describe("orderFragmentsForStablePrefix", () => {
	it("places the most-stable tiers first and volatile last regardless of input order", () => {
		const input = [
			frag("date", 8, "volatile"),
			frag("task", 40, "volatile"),
			frag("repo_map", 300, "persistent"),
			frag("system", 100, "static"),
			frag("tools", 200, "static"),
			frag("focus", 30, "session"),
		];
		// static block, then persistent, then session, then the volatile tail — the byte-stable prefix leads.
		expect(ids(orderFragmentsForStablePrefix(input))).toEqual([
			"system",
			"tools",
			"repo_map",
			"focus",
			"date",
			"task",
		]);
	});

	it("preserves the caller's input order WITHIN a tier (a stable partition — no intra-tier churn)", () => {
		const input = [frag("sys_a", 10, "static"), frag("sys_b", 20, "static"), frag("sys_c", 30, "static")];
		// All same tier ⇒ order is exactly as given (reordering equal-tier fragments would itself break the cache).
		expect(ids(orderFragmentsForStablePrefix(input))).toEqual(["sys_a", "sys_b", "sys_c"]);
	});

	it("treats a fragment with no stability as volatile (safe default: never defeats caching, only defers)", () => {
		const input = [frag("mystery", 50), frag("system", 100, "static")];
		// The untagged fragment is pushed to the tail behind the static system block.
		expect(ids(orderFragmentsForStablePrefix(input))).toEqual(["system", "mystery"]);
	});

	it("keeps two equal-tier fragments stable across turns even when other tiers shuffle around them", () => {
		const turn1 = [frag("system", 100, "static"), frag("tools", 200, "static"), frag("date-A", 8, "volatile")];
		const turn2 = [
			frag("date-B", 8, "volatile"), // volatile arrived in a different input slot this turn
			frag("system", 100, "static"),
			frag("tools", 200, "static"),
		];
		// Both turns yield the SAME stable leading order (system, tools, …) — the churn-free property the cache needs.
		expect(ids(orderFragmentsForStablePrefix(turn1)).slice(0, 2)).toEqual(["system", "tools"]);
		expect(ids(orderFragmentsForStablePrefix(turn2)).slice(0, 2)).toEqual(["system", "tools"]);
	});

	it("returns an empty array for an empty input", () => {
		expect(orderFragmentsForStablePrefix([])).toEqual([]);
	});

	it("orders WITHIN a tier by input order, not by token count (the stable-partition contract callers rely on)", () => {
		// A caller that lists tools before system will keep tools before system — intra-tier order is the caller's, and
		// it must stay consistent across turns for the leading prefix to remain byte-identical (see the reuse tests).
		const input = [frag("tools", 200, "static"), frag("system", 100, "static"), frag("repo", 300, "persistent")];
		expect(ids(orderFragmentsForStablePrefix(input))).toEqual(["tools", "system", "repo"]);
	});

	it("does not mutate its input array or reorder it in place", () => {
		const input = [frag("date", 8, "volatile"), frag("system", 100, "static")];
		const copy = structuredClone(input);
		const ordered = orderFragmentsForStablePrefix(input);
		expect(input).toEqual(copy); // input untouched
		expect(ids(ordered)).toEqual(["system", "date"]); // a fresh, reordered array
	});
});

describe("planCacheStablePrefixOrder", () => {
	it("locates the volatile boundary and splits the stable-prefix vs volatile-tail tokens", () => {
		const plan = planCacheStablePrefixOrder([
			frag("system", 100, "static"),
			frag("tools", 200, "static"),
			frag("repo_map", 300, "persistent"),
			frag("date", 8, "volatile"),
			frag("task", 42, "volatile"),
		]);
		expect(ids(plan.ordered)).toEqual(["system", "tools", "repo_map", "date", "task"]);
		expect(plan.volatileBoundaryIndex).toBe(3); // first volatile is at index 3
		expect(plan.stablePrefixTokens).toBe(600); // 100 + 200 + 300
		expect(plan.volatileTailTokens).toBe(50); // 8 + 42
	});

	it("reports the whole prompt as a stable prefix when nothing is volatile (boundary at the end)", () => {
		const plan = planCacheStablePrefixOrder([
			frag("system", 100, "static"),
			frag("conventions", 150, "persistent"),
			frag("focus", 30, "session"),
		]);
		expect(plan.volatileBoundaryIndex).toBe(3); // === ordered.length
		expect(plan.stablePrefixTokens).toBe(280);
		expect(plan.volatileTailTokens).toBe(0);
	});

	it("reports a zero-length stable prefix when everything is volatile (boundary at 0 — the cliff shape)", () => {
		const plan = planCacheStablePrefixOrder([frag("date", 8, "volatile"), frag("task", 42, "volatile")]);
		expect(plan.volatileBoundaryIndex).toBe(0);
		expect(plan.stablePrefixTokens).toBe(0);
		expect(plan.volatileTailTokens).toBe(50);
	});

	it("counts session fragments as part of the stable prefix (before the volatile boundary)", () => {
		const plan = planCacheStablePrefixOrder([
			frag("system", 100, "static"),
			frag("focus", 30, "session"),
			frag("date", 8, "volatile"),
		]);
		expect(ids(plan.ordered)).toEqual(["system", "focus", "date"]);
		expect(plan.volatileBoundaryIndex).toBe(2);
		expect(plan.stablePrefixTokens).toBe(130); // static + session both counted stable
		expect(plan.volatileTailTokens).toBe(8);
	});

	it("normalizes messy token counts (negative / non-finite / fractional → floored non-negative) in the split", () => {
		const plan = planCacheStablePrefixOrder([
			frag("system", -5, "static"), // → 0
			frag("tools", Number.NaN, "static"), // → 0
			frag("repo", 10.9, "persistent"), // → 10
			frag("date", Number.POSITIVE_INFINITY, "volatile"), // → 0
			frag("task", 7.2, "volatile"), // → 7
		]);
		expect(plan.stablePrefixTokens).toBe(10); // 0 + 0 + 10
		expect(plan.volatileTailTokens).toBe(7); // 0 + 7
	});

	it("handles an empty input (boundary 0, no tokens either side)", () => {
		const plan = planCacheStablePrefixOrder([]);
		expect(plan.ordered).toEqual([]);
		expect(plan.volatileBoundaryIndex).toBe(0);
		expect(plan.stablePrefixTokens).toBe(0);
		expect(plan.volatileTailTokens).toBe(0);
	});
});

describe("planCacheStablePrefixWithReuse", () => {
	it("omits the reuse estimate on a cold turn (no previous ordering to reuse)", () => {
		const plan: CacheStablePrefixPlan = planCacheStablePrefixWithReuse([
			frag("system", 100, "static"),
			frag("date", 8, "volatile"),
		]);
		expect(plan.reuse).toBeUndefined();
		expect(ids(plan.ordered)).toEqual(["system", "date"]);
		expect(plan.stablePrefixTokens).toBe(100);
	});

	it("predicts high reuse when only the volatile tail changed between turns (the §5.AQ target layout)", () => {
		// Previous turn's ordered fragments (what the runtime holds cached).
		const previous: CacheFragment[] = [
			{ id: "system", tokenCount: 100 },
			{ id: "tools", tokenCount: 200 },
			{ id: "date-A", tokenCount: 8 },
		];
		// This turn: same stable fragments in the same intra-tier order (system before tools, matching `previous`), but
		// the fresh date was appended at the FRONT of the input — the orderer moves it to the tail.
		const plan = planCacheStablePrefixWithReuse(
			[frag("date-B", 8, "volatile"), frag("system", 100, "static"), frag("tools", 200, "static")],
			previous,
		);
		// The orderer restores the stable prefix, so reuse covers system+tools; only the changed date re-prefills.
		expect(ids(plan.ordered)).toEqual(["system", "tools", "date-B"]);
		expect(plan.reuse?.sharedTokens).toBe(300);
		expect(plan.reuse?.recomputeTokens).toBe(8);
		expect(plan.reuse?.firstFragmentChanged).toBe(false);
		expect(plan.reuse?.reuseRatio).toBeCloseTo(300 / 308, 10);
	});

	it("shows the orderer RESCUES reuse that a naive volatile-first input would have destroyed", () => {
		const previous: CacheFragment[] = [
			{ id: "system", tokenCount: 100 },
			{ id: "tools", tokenCount: 200 },
			{ id: "date-A", tokenCount: 8 },
		];
		// A caller that (badly) appended the fresh date at the FRONT of the input list.
		const rawInputVolatileFirst = [
			frag("date-B", 8, "volatile"),
			frag("system", 100, "static"),
			frag("tools", 200, "static"),
		];
		// Scoring the raw input order as-is against `previous` = the cliff (0 reuse — volatile leads).
		const asGiven = planCacheStablePrefixWithReuse(rawInputVolatileFirst, previous);
		expect(asGiven.ordered[0]?.id).toBe("system"); // the orderer already fixed it
		expect(asGiven.reuse?.reuseRatio).toBeGreaterThan(0);
		expect(asGiven.reuse?.sharedTokens).toBe(300);
		expect(asGiven.reuse?.firstFragmentChanged).toBe(false);
	});

	it("predicts full reuse when nothing changed turn to turn", () => {
		const ordered = orderFragmentsForStablePrefix([frag("system", 100, "static"), frag("tools", 200, "static")]);
		const plan = planCacheStablePrefixWithReuse(ordered, ordered);
		expect(plan.reuse?.reuseRatio).toBe(1);
		expect(plan.reuse?.recomputeTokens).toBe(0);
		expect(plan.reuse?.requiresRecompute).toBe(false);
	});

	it("predicts a full cold prefill against an empty previous ordering (nothing cached yet)", () => {
		const plan = planCacheStablePrefixWithReuse([frag("system", 100, "static"), frag("tools", 200, "static")], []);
		expect(plan.reuse?.sharedTokens).toBe(0);
		expect(plan.reuse?.recomputeTokens).toBe(300);
		expect(plan.reuse?.firstFragmentChanged).toBe(true);
	});

	it("carries the ordering + boundary + token split through alongside the reuse estimate", () => {
		const previous: CacheFragment[] = [{ id: "system", tokenCount: 100 }];
		const plan = planCacheStablePrefixWithReuse(
			[frag("task", 42, "volatile"), frag("system", 100, "static")],
			previous,
		);
		// The plan is a superset of planCacheStablePrefixOrder's result, with reuse attached.
		expect(ids(plan.ordered)).toEqual(["system", "task"]);
		expect(plan.volatileBoundaryIndex).toBe(1);
		expect(plan.stablePrefixTokens).toBe(100);
		expect(plan.volatileTailTokens).toBe(42);
		expect(plan.reuse?.sharedTokens).toBe(100); // the shared "system" fragment
	});

	it("does not mutate the previous-ordering input", () => {
		const previous: CacheFragment[] = [
			{ id: "system", tokenCount: 100 },
			{ id: "tools", tokenCount: 200 },
		];
		const copy = structuredClone(previous);
		planCacheStablePrefixWithReuse([frag("system", 100, "static"), frag("tools", 200, "static")], previous);
		expect(previous).toEqual(copy);
	});
});
