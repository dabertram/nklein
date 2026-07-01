import { describe, expect, it } from "vitest";
import { type DeriveStreamsInput, deriveStreams } from "../../../src/core/stream-derivation";

const run = (over: Partial<DeriveStreamsInput> = {}) => deriveStreams({ cards: [], dependencies: [], ...over });

describe("deriveStreams — decomposition (planSlug) streams", () => {
	it("groups all cards sharing a planSlug into one stream, titled from the slug", () => {
		const r = run({
			cards: [
				{ id: "a", title: "A", planSlug: "auth-refactor" },
				{ id: "b", title: "B", planSlug: "auth-refactor" },
			],
		});
		expect(r.streams).toEqual([
			{ id: "stream-auth-refactor", title: "Auth Refactor", source: "decomposition", planSlug: "auth-refactor" },
		]);
		expect(r.cardStreamId).toEqual({ a: "stream-auth-refactor", b: "stream-auth-refactor" });
	});

	it("makes one stream per distinct slug", () => {
		const r = run({
			cards: [
				{ id: "a", title: "A", planSlug: "x" },
				{ id: "b", title: "B", planSlug: "y" },
			],
		});
		expect(r.streams.map((s) => s.id)).toEqual(["stream-x", "stream-y"]);
	});

	it("is idempotent + order-independent (same ids regardless of card order)", () => {
		const cards = [
			{ id: "b", title: "B", planSlug: "s" },
			{ id: "a", title: "A", planSlug: "s" },
		];
		const r1 = run({ cards });
		const r2 = run({ cards: [...cards].reverse() });
		expect(r1).toEqual(r2);
		expect(r1.streams[0]?.id).toBe("stream-s");
	});
});

describe("deriveStreams — dependency (connected-component) fallback", () => {
	it("groups ungrouped cards connected by dependsOn into one stream (root = smallest id)", () => {
		const r = run({
			cards: [
				{ id: "c2", title: "Two" },
				{ id: "c1", title: "One" },
				{ id: "c3", title: "Three" },
			],
			dependencies: [
				{ fromTaskId: "c1", toTaskId: "c2" },
				{ fromTaskId: "c2", toTaskId: "c3" },
			],
		});
		expect(r.streams).toEqual([{ id: "stream-dep-c1", title: "One", source: "dependency" }]);
		expect(r.cardStreamId).toEqual({ c1: "stream-dep-c1", c2: "stream-dep-c1", c3: "stream-dep-c1" });
	});

	it("leaves a lone card ungrouped (a singleton is not a stream)", () => {
		const r = run({ cards: [{ id: "solo", title: "Solo" }] });
		expect(r.streams).toEqual([]);
		expect(r.cardStreamId).toEqual({});
	});

	it("does NOT pull a planSlug-grouped card into a dependency component", () => {
		// c1 belongs to a decomposition stream; the edge c1→c2 must not merge c2 into c1's decomposition.
		const r = run({
			cards: [
				{ id: "c1", title: "One", planSlug: "s" },
				{ id: "c2", title: "Two" },
			],
			dependencies: [{ fromTaskId: "c1", toTaskId: "c2" }],
		});
		expect(r.cardStreamId.c1).toBe("stream-s");
		// c2 is ungrouped (its only edge partner is already in a decomposition stream, so no ≥2 component forms).
		expect(r.cardStreamId.c2).toBeUndefined();
	});

	it("forms two separate dependency streams for two disconnected components", () => {
		const r = run({
			cards: [
				{ id: "a1", title: "A1" },
				{ id: "a2", title: "A2" },
				{ id: "b1", title: "B1" },
				{ id: "b2", title: "B2" },
			],
			dependencies: [
				{ fromTaskId: "a1", toTaskId: "a2" },
				{ fromTaskId: "b1", toTaskId: "b2" },
			],
		});
		expect(r.streams.map((s) => s.id).sort()).toEqual(["stream-dep-a1", "stream-dep-b1"]);
	});
});
