import { describe, expect, it } from "vitest";

import {
	normalizeTaskIdForSandboxPath,
	stripRedundantSandboxWorkdirPrefix,
} from "../../../src/nklein-agent/nklein-agent-sandbox-task-path";

describe("normalizeTaskIdForSandboxPath", () => {
	it("keeps already-safe ids unchanged", () => {
		expect(normalizeTaskIdForSandboxPath("task_123.abc-XY")).toBe("task_123.abc-XY");
	});

	it("replaces disallowed characters with dashes", () => {
		expect(normalizeTaskIdForSandboxPath("a/b c:d")).toBe("a-b-c-d");
	});

	it("strips leading dashes (incl. those produced by leading disallowed chars)", () => {
		expect(normalizeTaskIdForSandboxPath("///abc")).toBe("abc");
		expect(normalizeTaskIdForSandboxPath("--keep")).toBe("keep");
	});

	it("is INJECTIVE past the bound: three ids sharing 80 characters get three directories (live 2026-09-11)", () => {
		// Project 50's real card ids. A bare truncation mapped all three onto one 0700 directory whose owner uid
		// hashes the FULL id, so two of the three cards hit EACCES on every tool including `spawn /bin/bash`.
		const plan = "confirm-r-01-r-05-subtotal-total-formula-spec-conformance-data-not-testable";
		const ids = [
			`${plan}-discrimination-and-completeness-pass`,
			`${plan}-discount-threshold-and-rate`,
			`${plan}-discount-cap`,
		];
		const segments = ids.map(normalizeTaskIdForSandboxPath);
		expect(new Set(segments).size).toBe(3);
		for (const segment of segments) {
			expect(segment.length).toBeLessThanOrEqual(80);
			// Still readable: the prefix survives, only the tail becomes a digest.
			expect(segment.startsWith("confirm-r-01-r-05-subtotal")).toBe(true);
		}
		// Stable: the same id always yields the same directory.
		expect(ids.map(normalizeTaskIdForSandboxPath)).toEqual(segments);
	});

	it("leaves ids INSIDE the bound byte-identical — existing workspaces are unaffected", () => {
		for (const id of [
			"spec-conformance-suite-spec-r03-discount-cap",
			"dev-50-spec-conformance-suite-decompose",
			"task1::merge",
			"x".repeat(80),
		]) {
			expect(normalizeTaskIdForSandboxPath(id)).toBe(
				id
					.trim()
					.replaceAll(/[^a-zA-Z0-9._-]/g, "-")
					.replace(/^-+/g, ""),
			);
		}
	});

	it("separates ids that differ only in characters the sanitizer flattens", () => {
		const long = "y".repeat(90);
		expect(normalizeTaskIdForSandboxPath(`${long}/a`)).not.toBe(normalizeTaskIdForSandboxPath(`${long}:a`));
	});

	it("trims surrounding whitespace before normalizing", () => {
		expect(normalizeTaskIdForSandboxPath("  hello  ")).toBe("hello");
	});

	it("caps the result at 80 characters", () => {
		expect(normalizeTaskIdForSandboxPath("x".repeat(200))).toHaveLength(80);
	});

	it("falls back to 'task' when nothing usable remains", () => {
		expect(normalizeTaskIdForSandboxPath("")).toBe("task");
		expect(normalizeTaskIdForSandboxPath("///")).toBe("task");
		expect(normalizeTaskIdForSandboxPath("   ")).toBe("task");
	});
});

describe("stripRedundantSandboxWorkdirPrefix (§5.O path recovery)", () => {
	const taskId = "verify-completion-1";

	it("strips a redundant relative workspaces/<taskId>/ prefix so the file lands at the intended path", () => {
		expect(stripRedundantSandboxWorkdirPrefix("workspaces/verify-completion-1/hello.txt", taskId)).toBe("hello.txt");
		expect(stripRedundantSandboxWorkdirPrefix("workspaces/verify-completion-1/src/app.ts", taskId)).toBe(
			"src/app.ts",
		);
	});

	it("strips the ./-prefixed relative form too", () => {
		expect(stripRedundantSandboxWorkdirPrefix("./workspaces/verify-completion-1/hello.txt", taskId)).toBe(
			"hello.txt",
		);
	});

	it("uses the path-safe segment, matching the actual in-container workdir name", () => {
		// The workdir uses normalizeTaskIdForSandboxPath, so a `::`-suffixed synthetic id maps to `--`.
		expect(stripRedundantSandboxWorkdirPrefix("workspaces/task--merge/out.txt", "task::merge")).toBe("out.txt");
	});

	it("leaves an ABSOLUTE /workspaces/<taskId>/ path untouched (it already resolves correctly)", () => {
		expect(stripRedundantSandboxWorkdirPrefix("/workspaces/verify-completion-1/hello.txt", taskId)).toBe(
			"/workspaces/verify-completion-1/hello.txt",
		);
	});

	it("leaves an ordinary root-relative path untouched", () => {
		expect(stripRedundantSandboxWorkdirPrefix("hello.txt", taskId)).toBe("hello.txt");
		expect(stripRedundantSandboxWorkdirPrefix("src/app.ts", taskId)).toBe("src/app.ts");
	});

	it("does not strip a different task's prefix or a lookalike directory", () => {
		expect(stripRedundantSandboxWorkdirPrefix("workspaces/other-task/hello.txt", taskId)).toBe(
			"workspaces/other-task/hello.txt",
		);
		expect(stripRedundantSandboxWorkdirPrefix("workspaces-config/verify-completion-1.txt", taskId)).toBe(
			"workspaces-config/verify-completion-1.txt",
		);
	});

	it("does not rewrite the bare prefix to an empty path", () => {
		expect(stripRedundantSandboxWorkdirPrefix("workspaces/verify-completion-1/", taskId)).toBe(
			"workspaces/verify-completion-1/",
		);
	});

	it("returns an empty string input unchanged", () => {
		expect(stripRedundantSandboxWorkdirPrefix("", taskId)).toBe("");
	});
});
