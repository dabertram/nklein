import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectInputPath } from "../../../src/projects/project-path";

describe("resolveProjectInputPath", () => {
	it("expands a bare ~ to the home directory", () => {
		expect(resolveProjectInputPath("~", "/some/cwd")).toBe(homedir());
	});

	it("expands ~/… and ~\\… relative to home (both slash styles)", () => {
		expect(resolveProjectInputPath("~/projects/app", "/some/cwd")).toBe(resolve(homedir(), "projects/app"));
		expect(resolveProjectInputPath("~\\projects\\app", "/some/cwd")).toBe(resolve(homedir(), "projects\\app"));
	});

	it("resolves a relative path against cwd", () => {
		expect(resolveProjectInputPath("sub/dir", "/base")).toBe(resolve("/base", "sub/dir"));
	});

	it("keeps an absolute path (cwd is ignored by resolve)", () => {
		expect(resolveProjectInputPath("/abs/path", "/base")).toBe("/abs/path");
	});

	it("does NOT expand a tilde that isn't the home shorthand (e.g. ~user)", () => {
		// "~user" is not "~" nor "~/…" — treated as a normal relative segment against cwd, never home.
		expect(resolveProjectInputPath("~user/x", "/base")).toBe(resolve("/base", "~user/x"));
	});
});
