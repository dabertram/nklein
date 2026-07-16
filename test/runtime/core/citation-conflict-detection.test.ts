import { describe, expect, it } from "vitest";
import { detectClaimConflicts, type KeyedClaim } from "../../../src/core/citation-conflict-detection";

const c = (claimKey: string, value: string, sourceId: string): KeyedClaim => ({ claimKey, value, sourceId });

describe("detectClaimConflicts (F4.5)", () => {
	it("clusters a key where two sources assert different values", () => {
		const clusters = detectClaimConflicts([c("latest node LTS", "20", "src-a"), c("latest node LTS", "22", "src-b")]);
		expect(clusters).toHaveLength(1);
		expect(clusters[0]?.claimKey).toBe("latest node LTS");
		expect(clusters[0]?.claims.map((x) => x.sourceId)).toEqual(["src-a", "src-b"]);
		expect(clusters[0]?.distinctValues).toEqual(["20", "22"]);
	});

	it("does NOT flag agreement (same value from many sources is not a conflict)", () => {
		expect(detectClaimConflicts([c("k", "v", "a"), c("k", "v", "b"), c("k", "V ", "c")])).toEqual([]); // casefold+trim agree
	});

	it("keeps unrelated keys separate and preserves first-seen key order", () => {
		const clusters = detectClaimConflicts([
			c("price", "10", "a"),
			c("color", "red", "b"),
			c("price", "12", "c"),
			c("color", "blue", "d"),
		]);
		expect(clusters.map((x) => x.claimKey)).toEqual(["price", "color"]);
	});

	it("matches keys/values case-insensitively by default, case-sensitively on request", () => {
		expect(detectClaimConflicts([c("Node LTS", "20", "a"), c("node lts", "20", "b")])).toEqual([]); // same key+value
		const strict = detectClaimConflicts([c("k", "Yes", "a"), c("k", "yes", "b")], { caseSensitive: true });
		expect(strict).toHaveLength(1); // "Yes" vs "yes" now distinct
	});

	it("skips claims with a blank key (ungroupable)", () => {
		expect(detectClaimConflicts([c("  ", "x", "a"), c("  ", "y", "b")])).toEqual([]);
	});

	it("groups three sources on one key when at least two values differ", () => {
		const clusters = detectClaimConflicts([
			c("release date", "2024", "a"),
			c("release date", "2024", "b"),
			c("release date", "2025", "c"),
		]);
		expect(clusters).toHaveLength(1);
		expect(clusters[0]?.claims).toHaveLength(3); // all retained for the resolver
		expect(clusters[0]?.distinctValues).toEqual(["2024", "2025"]);
	});
});
