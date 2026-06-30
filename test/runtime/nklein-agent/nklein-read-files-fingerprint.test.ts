import { describe, expect, it } from "vitest";

import {
	buildReadFilesRequestFingerprint,
	buildReadFilesTargetKeys,
	type ReadFilesTargetKey,
} from "../../../src/nklein-agent/nklein-read-files-fingerprint";

const key = (rangeKey: string): ReadFilesTargetKey => ({ path: rangeKey, rangeKey, fullFile: false });

describe("buildReadFilesTargetKeys", () => {
	it("builds a range key per request and flags whole-file reads", () => {
		const keys = buildReadFilesTargetKeys([
			{ path: "a.ts", start_line: 1, end_line: 10 },
			"b.ts", // a bare path = whole file
		]);
		expect(keys).toEqual([
			{ path: "a.ts", rangeKey: "a.ts:1:10", fullFile: false },
			{ path: "b.ts", rangeKey: "b.ts::", fullFile: true },
		]);
	});

	it("drops blank paths", () => {
		expect(buildReadFilesTargetKeys([{ path: "   " }, { path: "" }])).toEqual([]);
	});

	it("returns no keys for unparseable input", () => {
		expect(buildReadFilesTargetKeys(null)).toEqual([]);
		expect(buildReadFilesTargetKeys(42)).toEqual([]);
	});
});

describe("buildReadFilesRequestFingerprint", () => {
	it("is null for an empty request", () => {
		expect(buildReadFilesRequestFingerprint([])).toBeNull();
	});

	it("is order-independent (sorted) so the same set fingerprints identically", () => {
		const forward = buildReadFilesRequestFingerprint([key("a:1:2"), key("b:3:4")]);
		const reversed = buildReadFilesRequestFingerprint([key("b:3:4"), key("a:1:2")]);
		expect(forward).toBe("a:1:2\nb:3:4");
		expect(forward).toBe(reversed);
	});

	it("distinguishes different range sets", () => {
		expect(buildReadFilesRequestFingerprint([key("a:1:2")])).not.toBe(
			buildReadFilesRequestFingerprint([key("a:1:3")]),
		);
	});

	it("round-trips through buildReadFilesTargetKeys for the same request, regardless of order", () => {
		const a = buildReadFilesRequestFingerprint(
			buildReadFilesTargetKeys([{ path: "x.ts", start_line: 1, end_line: 5 }, { path: "y.ts" }]),
		);
		const b = buildReadFilesRequestFingerprint(
			buildReadFilesTargetKeys([{ path: "y.ts" }, { path: "x.ts", start_line: 1, end_line: 5 }]),
		);
		expect(a).toBe(b);
	});
});
