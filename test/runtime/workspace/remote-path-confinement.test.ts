import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { confineToAllowedRoots, resolveRemoteBrowseRoots } from "../../../src/workspace/remote-path-confinement";

describe("resolveRemoteBrowseRoots", () => {
	it("always includes the resolved home directory first", () => {
		expect(resolveRemoteBrowseRoots({})).toEqual([resolve(homedir())]);
	});

	it("appends a configured workspace base dir and extra roots, resolved + deduped", () => {
		const roots = resolveRemoteBrowseRoots({
			configuredWorkspaceBaseDir: "/srv/workspaces",
			extraAllowedRoots: ["/data/projects", "/srv/workspaces"], // duplicate of configured
		});
		expect(roots).toContain(resolve("/srv/workspaces"));
		expect(roots).toContain(resolve("/data/projects"));
		// The duplicate is collapsed.
		expect(roots.filter((r) => r === resolve("/srv/workspaces"))).toHaveLength(1);
	});

	it("resolves relative roots to absolute paths and ignores a blank configured dir", () => {
		const roots = resolveRemoteBrowseRoots({ configuredWorkspaceBaseDir: "   ", extraAllowedRoots: ["rel/dir"] });
		expect(roots).toEqual([resolve(homedir()), resolve("rel/dir")]);
		expect(roots.every((r) => isAbsolute(r))).toBe(true);
	});
});

describe("confineToAllowedRoots", () => {
	const roots = ["/home/user", "/srv/work"];

	it("allows an exact root and a nested path, reporting the matched root", () => {
		expect(confineToAllowedRoots("/home/user", roots)).toEqual({ allowed: true, matchedRoot: resolve("/home/user") });
		expect(confineToAllowedRoots("/home/user/project/src", roots)).toEqual({
			allowed: true,
			matchedRoot: resolve("/home/user"),
		});
	});

	it("returns the FIRST matching root when roots overlap in priority order", () => {
		expect(confineToAllowedRoots("/srv/work/a", roots).matchedRoot).toBe(resolve("/srv/work"));
	});

	it("rejects a sibling-prefix attack (/home/user2 is NOT inside /home/user)", () => {
		expect(confineToAllowedRoots("/home/user2", roots)).toEqual({ allowed: false, matchedRoot: null });
	});

	it("rejects an unrelated path and a `..` traversal escape", () => {
		expect(confineToAllowedRoots("/etc/passwd", roots).allowed).toBe(false);
		// /home/user/../user2 resolves to /home/user2 → outside the root.
		expect(confineToAllowedRoots("/home/user/../user2", roots).allowed).toBe(false);
	});

	it("rejects everything when there are no allowed roots", () => {
		expect(confineToAllowedRoots("/home/user", []).allowed).toBe(false);
	});
});
