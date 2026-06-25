import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
	getDefaultCreatedWorkspaceBaseDir,
	getForbiddenWorkspaceSubtree,
	resolveSafeCreatedWorkspaceParentDir,
} from "../../../src/config/workspace-location";

describe("resolveSafeCreatedWorkspaceParentDir (workspace-location safety invariant)", () => {
	const forbidden = getForbiddenWorkspaceSubtree();
	const isBelowForbidden = (path: string) => path === forbidden || path.startsWith(`${forbidden}${sep}`);

	it("the home-default base is itself outside !Klein's parent subtree", () => {
		expect(isBelowForbidden(getDefaultCreatedWorkspaceBaseDir())).toBe(false);
	});

	it("redirects a requested parent that sits BELOW !Klein's parent folder", () => {
		const unsafe = join(forbidden, "kanban", "nested", "workspaces");
		const result = resolveSafeCreatedWorkspaceParentDir({ requestedParentDir: unsafe });
		expect(result.redirected).toBe(true);
		expect(result.reason).toBeTruthy();
		expect(isBelowForbidden(result.parentDir)).toBe(false);
	});

	it("redirects when the requested parent IS the forbidden subtree itself", () => {
		const result = resolveSafeCreatedWorkspaceParentDir({ requestedParentDir: forbidden });
		expect(result.redirected).toBe(true);
		expect(isBelowForbidden(result.parentDir)).toBe(false);
	});

	it("honors a safe requested parent (e.g. the OS temp dir)", () => {
		const result = resolveSafeCreatedWorkspaceParentDir({ requestedParentDir: tmpdir() });
		expect(result.redirected).toBe(false);
		expect(result.parentDir).toBe(resolve(tmpdir()));
	});

	it("defaults to the home-dir base when nothing is requested", () => {
		const result = resolveSafeCreatedWorkspaceParentDir({});
		expect(result.redirected).toBe(false);
		expect(result.parentDir).toBe(getDefaultCreatedWorkspaceBaseDir());
	});

	it("uses a safe configured base over the home default", () => {
		const configured = join(homedir(), "my-nklein-workspaces");
		const result = resolveSafeCreatedWorkspaceParentDir({ configuredBaseDir: configured });
		expect(result.parentDir).toBe(resolve(configured));
	});

	it("ignores an UNSAFE configured base and falls back to the home default", () => {
		const result = resolveSafeCreatedWorkspaceParentDir({ configuredBaseDir: join(forbidden, "inside-install") });
		expect(isBelowForbidden(result.parentDir)).toBe(false);
		expect(result.parentDir).toBe(getDefaultCreatedWorkspaceBaseDir());
	});

	it("a safe requested parent wins over a configured base", () => {
		const result = resolveSafeCreatedWorkspaceParentDir({
			requestedParentDir: tmpdir(),
			configuredBaseDir: join(homedir(), "configured"),
		});
		expect(result.parentDir).toBe(resolve(tmpdir()));
	});
});
