import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	getDefaultCreatedWorkspaceBaseDir,
	getForbiddenWorkspaceSubtree,
	isPathInsideGitWorkTree,
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

	// The robust guard (todo §5.W incident): a created workspace must never land inside ANY git work tree — this is
	// what catches the !Klein repo and its `.claude/worktrees/*` checkouts regardless of where the code runs from.
	const createdDirs: string[] = [];
	afterEach(() => {
		for (const dir of createdDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("isPathInsideGitWorkTree detects an enclosing repo and clears a plain dir", () => {
		const gitRoot = mkdtempSync(join(tmpdir(), "nklein-gitguard-"));
		createdDirs.push(gitRoot);
		execFileSync("git", ["init", "-q"], { cwd: gitRoot });
		expect(isPathInsideGitWorkTree(gitRoot)).toBe(true);
		// A not-yet-created path nested inside the repo is still flagged (we walk up to the existing `.git`).
		expect(isPathInsideGitWorkTree(join(gitRoot, "nested", "workspace"))).toBe(true);

		const plain = mkdtempSync(join(tmpdir(), "nklein-nogit-"));
		createdDirs.push(plain);
		expect(isPathInsideGitWorkTree(plain)).toBe(false);
	});

	it("redirects a requested parent inside a git work tree even when it is NOT below the forbidden subtree", () => {
		// A git repo in the OS temp dir: not at/below !Klein's parent folder, so only the git-awareness can catch it.
		const gitRoot = mkdtempSync(join(tmpdir(), "nklein-gitguard-"));
		createdDirs.push(gitRoot);
		execFileSync("git", ["init", "-q"], { cwd: gitRoot });

		const insideRepo = join(gitRoot, "nested", "workspace");
		expect(isBelowForbidden(insideRepo)).toBe(false); // the old dirname-based check would have allowed this

		const result = resolveSafeCreatedWorkspaceParentDir({ requestedParentDir: insideRepo });
		expect(result.redirected).toBe(true);
		expect(result.reason).toContain("git work tree");
		expect(isPathInsideGitWorkTree(result.parentDir)).toBe(false); // redirected to a non-repo location
	});
});
