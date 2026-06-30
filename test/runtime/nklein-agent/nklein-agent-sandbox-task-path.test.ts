import { describe, expect, it } from "vitest";

import { normalizeTaskIdForSandboxPath } from "../../../src/nklein-agent/nklein-agent-sandbox-task-path";

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
