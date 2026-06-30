import { describe, expect, it } from "vitest";

import { createWorkspaceIdCollisionSuffix, toWorkspaceIdBase } from "../../../src/state/workspace-id-generation";

describe("toWorkspaceIdBase", () => {
	it("slugifies the final path segment", () => {
		expect(toWorkspaceIdBase("/Users/dev/My Project")).toBe("my-project");
	});

	it("ignores trailing slashes when picking the folder name", () => {
		expect(toWorkspaceIdBase("/Users/dev/kanban///")).toBe("kanban");
	});

	it("collapses runs of non-alphanumerics to single dashes and trims the edges", () => {
		expect(toWorkspaceIdBase("/x/__Foo..Bar!!__")).toBe("foo-bar");
	});

	it("lowercases and NFKD-normalizes accented characters", () => {
		expect(toWorkspaceIdBase("/x/Café")).toBe("cafe");
	});

	it("falls back to 'project' for a path with no usable folder name", () => {
		expect(toWorkspaceIdBase("/")).toBe("project");
		expect(toWorkspaceIdBase("   ")).toBe("project");
	});

	it("falls back to 'project' when the folder name has no alphanumerics", () => {
		expect(toWorkspaceIdBase("/x/!!!")).toBe("project");
	});
});

describe("createWorkspaceIdCollisionSuffix", () => {
	it("returns a suffix of exactly the requested length", () => {
		expect(createWorkspaceIdCollisionSuffix(6)).toHaveLength(6);
		expect(createWorkspaceIdCollisionSuffix(1)).toHaveLength(1);
	});

	it("returns an empty string for length 0", () => {
		expect(createWorkspaceIdCollisionSuffix(0)).toBe("");
	});

	it("only uses lowercase letters and digits", () => {
		const suffix = createWorkspaceIdCollisionSuffix(64);
		expect(suffix).toMatch(/^[a-z0-9]+$/);
	});
});
