import { describe, expect, it } from "vitest";
import {
	computeEgressBundleSourceHash,
	EGRESS_BUNDLE_STAMP_VERSION,
	type EgressBundleStamp,
	evaluateEgressBundleFreshness,
	formatEgressBundleStaleWarning,
	parseEgressBundleStamp,
} from "../../src/core/egress-bundle-stamp";

const sources: Record<string, string> = {
	"src/nklein-agent/egress-proxy-entrypoint.ts": "export const a = 1;\n",
	"src/core/egress-task-identity.ts": "export const b = 2;\n",
};

function stampFor(files: Record<string, string>): EgressBundleStamp {
	return {
		version: EGRESS_BUNDLE_STAMP_VERSION,
		builtAt: "2026-09-06T11:16:00.000Z",
		inputs: Object.keys(files),
		sourceHash: computeEgressBundleSourceHash(Object.entries(files).map(([path, content]) => ({ path, content }))),
	};
}

describe("computeEgressBundleSourceHash", () => {
	it("is order-independent over inputs and sensitive to content and path", () => {
		const forward = computeEgressBundleSourceHash([
			{ path: "a.ts", content: "1" },
			{ path: "b.ts", content: "2" },
		]);
		const reversed = computeEgressBundleSourceHash([
			{ path: "b.ts", content: "2" },
			{ path: "a.ts", content: "1" },
		]);
		expect(reversed).toBe(forward);
		expect(
			computeEgressBundleSourceHash([
				{ path: "a.ts", content: "1" },
				{ path: "b.ts", content: "3" },
			]),
		).not.toBe(forward);
		expect(
			computeEgressBundleSourceHash([
				{ path: "a.ts", content: "1" },
				{ path: "c.ts", content: "2" },
			]),
		).not.toBe(forward);
	});
});

describe("parseEgressBundleStamp", () => {
	it("round-trips a stamp and rejects garbage or a foreign version", () => {
		const stamp = stampFor(sources);
		expect(parseEgressBundleStamp(JSON.stringify(stamp))).toEqual(stamp);
		expect(parseEgressBundleStamp("{not json")).toBeNull();
		expect(parseEgressBundleStamp(JSON.stringify({ ...stamp, version: 99 }))).toBeNull();
		expect(parseEgressBundleStamp(JSON.stringify({ ...stamp, inputs: ["", "x"] }))).toBeNull();
	});
});

describe("evaluateEgressBundleFreshness (2026-09-06 stale proxy bundle)", () => {
	const readFrom = (files: Record<string, string>) => (path: string) => files[path] ?? null;

	it("is fresh when the current tree hashes to the stamp", () => {
		expect(evaluateEgressBundleFreshness({ stamp: stampFor(sources), readInput: readFrom(sources) })).toEqual({
			status: "fresh",
			stamp: stampFor(sources),
		});
	});

	it("is stale when any bundled source changed since the build", () => {
		const changed = { ...sources, "src/core/egress-task-identity.ts": "export const b = 3;\n" };
		const verdict = evaluateEgressBundleFreshness({ stamp: stampFor(sources), readInput: readFrom(changed) });
		expect(verdict.status).toBe("stale");
		if (verdict.status === "stale") {
			expect(verdict.currentHash).not.toBe(verdict.stamp.sourceHash);
		}
	});

	it("is unstamped without a stamp and unverifiable when the tree lacks the inputs (packaged app)", () => {
		expect(evaluateEgressBundleFreshness({ stamp: null, readInput: readFrom(sources) })).toEqual({
			status: "unstamped",
		});
		const verdict = evaluateEgressBundleFreshness({ stamp: stampFor(sources), readInput: () => null });
		expect(verdict.status).toBe("unverifiable");
		if (verdict.status === "unverifiable") {
			expect(verdict.missingInputs).toEqual(Object.keys(sources));
		}
	});
});

describe("formatEgressBundleStaleWarning", () => {
	it("names the bundle, the cause, the blast radius, and the rebuild command", () => {
		const stale = evaluateEgressBundleFreshness({
			stamp: stampFor(sources),
			readInput: () => "changed",
		});
		if (stale.status !== "stale") {
			throw new Error("expected stale");
		}
		const line = formatEgressBundleStaleWarning({
			bundlePath: "/repo/dist/egress-proxy/entrypoint.mjs",
			freshness: stale,
			rebuildCommand: "node scripts/build-egress-proxy.mjs",
		});
		expect(line).toContain("/repo/dist/egress-proxy/entrypoint.mjs is stale: built 2026-09-06T11:16:00.000Z");
		expect(line).toContain("fail-closes every sandbox network call");
		expect(line).toContain("node scripts/build-egress-proxy.mjs");
		expect(
			formatEgressBundleStaleWarning({
				bundlePath: "/x",
				freshness: { status: "unstamped" },
				rebuildCommand: "rebuild",
			}),
		).toContain("carries no build stamp");
	});
});
