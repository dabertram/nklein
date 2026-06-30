import { describe, expect, it } from "vitest";

import {
	extractDirectoryForSegmentPattern,
	extractDirectoryForSegmentSequence,
	isPathInside,
	toPosixLowerPath,
} from "../../../src/update/update-install-paths";

describe("toPosixLowerPath", () => {
	it("converts backslashes to forward slashes and lowercases", () => {
		expect(toPosixLowerPath("C:\\Users\\Foo\\App.JS")).toBe("c:/users/foo/app.js");
	});
});

describe("isPathInside", () => {
	it("treats an identical path as inside", () => {
		expect(isPathInside("/home/u/app", "/home/u/app")).toBe(true);
	});

	it("treats a nested path as inside", () => {
		expect(isPathInside("/home/u/app/dist/cli.js", "/home/u/app")).toBe(true);
	});

	it("rejects a sibling sharing a name prefix (no /foo-inside-/foobar bug)", () => {
		expect(isPathInside("/home/u/foobar/cli.js", "/home/u/foo")).toBe(false);
	});

	it("rejects an unrelated path", () => {
		expect(isPathInside("/var/lib/other", "/home/u/app")).toBe(false);
	});

	it("compares case-insensitively", () => {
		expect(isPathInside("/Home/U/App/Cli.js", "/home/u/app")).toBe(true);
	});
});

describe("extractDirectoryForSegmentSequence", () => {
	it("returns the directory ending one segment after an npx-cache sequence", () => {
		const path = "/home/u/.npm/_npx/abc123/node_modules/pkg/dist/cli.js";
		expect(extractDirectoryForSegmentSequence(path, [[".npm", "_npx"]], 1)).toBe("/home/u/.npm/_npx/abc123");
	});

	it("matches case-insensitively but preserves the original casing in the result", () => {
		const path = "/Home/U/.NPM/_NPX/AbC/node_modules/pkg/cli.js";
		expect(extractDirectoryForSegmentSequence(path, [[".npm", "_npx"]], 1)).toBe("/Home/U/.NPM/_NPX/AbC");
	});

	it("tries each sequence and returns the first that matches", () => {
		const path = "/root/npm-cache/_npx/xyz/node_modules/pkg/cli.js";
		expect(
			extractDirectoryForSegmentSequence(
				path,
				[
					[".npm", "_npx"],
					["npm-cache", "_npx"],
				],
				1,
			),
		).toBe("/root/npm-cache/_npx/xyz");
	});

	it("honors a trailing segment count greater than one (pnpm dlx)", () => {
		const path = "/home/u/.pnpm-store/pnpm/dlx/aaa/bbb/node_modules/pkg/cli.js";
		expect(extractDirectoryForSegmentSequence(path, [["pnpm", "dlx"]], 2)).toBe(
			"/home/u/.pnpm-store/pnpm/dlx/aaa/bbb",
		);
	});

	it("rejects a match whose trailing segment is node_modules/./..", () => {
		const path = "/home/u/.npm/_npx/node_modules/pkg/cli.js";
		expect(extractDirectoryForSegmentSequence(path, [[".npm", "_npx"]], 1)).toBeNull();
	});

	it("returns null when no sequence is present", () => {
		expect(
			extractDirectoryForSegmentSequence("/usr/local/lib/node_modules/pkg/cli.js", [["pnpm", "dlx"]], 2),
		).toBeNull();
	});
});

describe("extractDirectoryForSegmentPattern", () => {
	it("returns the directory up to and including the first segment matching the pattern", () => {
		const path = "/home/u/.yarn/berry/cache/dlx-12345/node_modules/pkg/cli.js";
		expect(extractDirectoryForSegmentPattern(path, /^dlx-\d+$/u)).toBe("/home/u/.yarn/berry/cache/dlx-12345");
	});

	it("matches a bunx-prefixed segment", () => {
		const path = "/tmp/bunx-1000-pkg/node_modules/pkg/cli.js";
		expect(extractDirectoryForSegmentPattern(path, /^bunx-/u)).toBe("/tmp/bunx-1000-pkg");
	});

	it("returns null when no segment matches the pattern", () => {
		expect(extractDirectoryForSegmentPattern("/usr/local/lib/node_modules/pkg/cli.js", /^dlx-\d+$/u)).toBeNull();
	});
});
