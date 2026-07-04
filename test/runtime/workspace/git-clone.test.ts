import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock git commands ─────────────────────────────────────
const childProcessMocks = vi.hoisted(() => ({
	execFile: vi.fn(),
	execFilePromise: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFile: Object.assign(childProcessMocks.execFile, {
		[promisify.custom]: childProcessMocks.execFilePromise,
	}),
}));

// ── Mock fs/promises for access, mkdir & stat ─────────────
const fsMocks = vi.hoisted(() => ({
	access: vi.fn(),
	mkdir: vi.fn(),
	stat: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	access: fsMocks.access,
	mkdir: fsMocks.mkdir,
	stat: fsMocks.stat,
}));

import {
	cloneGitRepository,
	deriveRepoNameFromUrl,
	isRemoteGitUrl,
	validateCloneDestination,
} from "../../../src/workspace/git-clone";

describe("isRemoteGitUrl", () => {
	it("accepts network git transports", () => {
		for (const url of [
			"https://github.com/u/r.git",
			"http://host/r.git",
			"git://host/r.git",
			"ssh://git@host/u/r.git",
			"git@github.com:u/r.git", // scp-style
		]) {
			expect(isRemoteGitUrl(url)).toBe(true);
		}
	});

	it("rejects local-filesystem transports (the exfiltration vectors)", () => {
		for (const url of [
			"file:///etc/secret",
			"/abs/path/secret",
			"../relative/secret",
			"./repo",
			"~/repo",
			"ext::sh -c cmd", // dangerous helper transport
			"fd::7",
			"",
			"   ",
		]) {
			expect(isRemoteGitUrl(url)).toBe(false);
		}
	});
});

describe("deriveRepoNameFromUrl", () => {
	it("extracts repo name from HTTPS URL", () => {
		expect(deriveRepoNameFromUrl("https://github.com/user/my-repo.git")).toBe("my-repo");
	});

	it("extracts repo name from HTTPS URL without .git suffix", () => {
		expect(deriveRepoNameFromUrl("https://github.com/user/my-repo")).toBe("my-repo");
	});

	it("extracts repo name from SSH URL", () => {
		expect(deriveRepoNameFromUrl("git@github.com:user/my-repo.git")).toBe("my-repo");
	});

	it("extracts repo name from SSH URL without .git suffix", () => {
		expect(deriveRepoNameFromUrl("git@github.com:user/my-repo")).toBe("my-repo");
	});

	it("handles trailing slashes", () => {
		expect(deriveRepoNameFromUrl("https://github.com/user/my-repo.git/")).toBe("my-repo");
	});

	it("handles bare repository name", () => {
		expect(deriveRepoNameFromUrl("my-repo.git")).toBe("my-repo");
	});

	it("returns null for empty string", () => {
		expect(deriveRepoNameFromUrl("")).toBeNull();
	});

	it("returns null for whitespace-only string", () => {
		expect(deriveRepoNameFromUrl("   ")).toBeNull();
	});

	it("handles complex SSH paths", () => {
		expect(deriveRepoNameFromUrl("git@gitlab.com:org/sub-group/project.git")).toBe("project");
	});

	it("handles URL with nested path segments", () => {
		expect(deriveRepoNameFromUrl("https://gitlab.com/org/sub/deep/repo.git")).toBe("repo");
	});
});

describe("validateCloneDestination", () => {
	const serverCwd = "/home/user/workspace";

	it("accepts a path within the CWD", () => {
		expect(validateCloneDestination("/home/user/workspace/my-repo", serverCwd)).toBe("/home/user/workspace/my-repo");
	});

	it("accepts a deeply nested path within the CWD", () => {
		expect(validateCloneDestination("/home/user/workspace/a/b/c", serverCwd)).toBe("/home/user/workspace/a/b/c");
	});

	it("accepts the CWD itself", () => {
		expect(validateCloneDestination("/home/user/workspace", serverCwd)).toBe("/home/user/workspace");
	});

	it("rejects a path outside the CWD", () => {
		expect(() => validateCloneDestination("/home/user/other", serverCwd)).toThrow(
			"outside the server working directory",
		);
	});

	it("rejects a parent traversal that escapes CWD", () => {
		expect(() => validateCloneDestination("/home/user/workspace/../other", serverCwd)).toThrow(
			"outside the server working directory",
		);
	});

	it("rejects a sibling directory with similar prefix", () => {
		expect(() => validateCloneDestination("/home/user/workspace-other/repo", serverCwd)).toThrow(
			"outside the server working directory",
		);
	});

	it("rejects absolute path to root", () => {
		expect(() => validateCloneDestination("/tmp/repo", serverCwd)).toThrow("outside the server working directory");
	});
});

describe("cloneGitRepository", () => {
	let testCwd: string;

	beforeEach(() => {
		testCwd = join(tmpdir(), `kanban-test-clone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
		// Use real mkdirSync for setup only; the module uses mocked mkdir from fs/promises
		require("node:fs").mkdirSync(testCwd, { recursive: true });
		childProcessMocks.execFilePromise.mockReset();
		fsMocks.access.mockReset();
		fsMocks.mkdir.mockReset();
		fsMocks.stat.mockReset();
	});

	afterEach(() => {
		rmSync(testCwd, { recursive: true, force: true });
	});

	it("clones a repo to the default destination derived from URL", async () => {
		fsMocks.access.mockRejectedValueOnce(new Error("ENOENT"));
		fsMocks.mkdir.mockResolvedValueOnce(undefined);
		childProcessMocks.execFilePromise.mockResolvedValueOnce({ stdout: "", stderr: "" });

		const result = await cloneGitRepository("https://github.com/user/my-repo.git", testCwd);

		expect(result.ok).toBe(true);
		expect(result.clonedPath).toBe(resolve(testCwd, "my-repo"));
		expect(childProcessMocks.execFilePromise).toHaveBeenCalledOnce();
		const callArgs = childProcessMocks.execFilePromise.mock.calls[0];
		expect(callArgs[0]).toBe("git");
		expect(callArgs[1]).toContain("clone");
		expect(callArgs[1]).toContain("https://github.com/user/my-repo.git");
		expect(callArgs[1]).toContain(resolve(testCwd, "my-repo"));
	});

	it("remote mode: rejects a file:// source URL and never invokes git clone (source-exfiltration guard)", async () => {
		const result = await cloneGitRepository("file:///etc/secret-repo", testCwd, undefined, testCwd, {
			isRemoteMode: true,
		});
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/Access denied/);
		expect(childProcessMocks.execFilePromise).not.toHaveBeenCalled();
	});

	it("remote mode: rejects a relative local-path source (../secret) before cloning", async () => {
		const result = await cloneGitRepository("../secret-repo", testCwd, undefined, testCwd, { isRemoteMode: true });
		expect(result.ok).toBe(false);
		expect(childProcessMocks.execFilePromise).not.toHaveBeenCalled();
	});

	it("local mode: still allows a file:// source (no regression for the trusted local operator)", async () => {
		fsMocks.access.mockRejectedValueOnce(new Error("ENOENT"));
		fsMocks.mkdir.mockResolvedValueOnce(undefined);
		childProcessMocks.execFilePromise.mockResolvedValueOnce({ stdout: "", stderr: "" });

		const result = await cloneGitRepository("file:///local/repo", testCwd, undefined, testCwd, {
			isRemoteMode: false,
		});
		expect(result.ok).toBe(true);
		expect(childProcessMocks.execFilePromise).toHaveBeenCalledOnce();
	});

	it("clones a repo to a custom destination path", async () => {
		const customDest = join(testCwd, "custom-dir");
		fsMocks.access.mockRejectedValueOnce(new Error("ENOENT"));
		fsMocks.mkdir.mockResolvedValueOnce(undefined);
		childProcessMocks.execFilePromise.mockResolvedValueOnce({ stdout: "", stderr: "" });

		const result = await cloneGitRepository("https://github.com/user/my-repo.git", testCwd, customDest);

		expect(result.ok).toBe(true);
		expect(result.clonedPath).toBe(customDest);
	});

	it("clones into an existing directory by appending repo name", async () => {
		const existingDir = join(testCwd, "projects");
		// First access() succeeds (existingDir exists), stat says it's a directory
		fsMocks.access.mockResolvedValueOnce(undefined);
		fsMocks.stat.mockResolvedValueOnce({ isDirectory: () => true });
		// Second access() for the nested path (projects/my-repo) rejects — does not exist
		fsMocks.access.mockRejectedValueOnce(new Error("ENOENT"));
		fsMocks.mkdir.mockResolvedValueOnce(undefined);
		childProcessMocks.execFilePromise.mockResolvedValueOnce({ stdout: "", stderr: "" });

		const result = await cloneGitRepository("https://github.com/user/my-repo.git", testCwd, existingDir);

		expect(result.ok).toBe(true);
		expect(result.clonedPath).toBe(join(existingDir, "my-repo"));
	});

	it("returns error when existing directory already contains the repo folder", async () => {
		const existingDir = join(testCwd, "projects");
		// First access() succeeds (existingDir exists), stat says it's a directory
		fsMocks.access.mockResolvedValueOnce(undefined);
		fsMocks.stat.mockResolvedValueOnce({ isDirectory: () => true });
		// Second access() for the nested path (projects/my-repo) also succeeds — already exists
		fsMocks.access.mockResolvedValueOnce(undefined);

		const result = await cloneGitRepository("https://github.com/user/my-repo.git", testCwd, existingDir);

		expect(result.ok).toBe(false);
		expect(result.error).toContain("Destination already exists");
		expect(childProcessMocks.execFilePromise).not.toHaveBeenCalled();
	});

	it("returns error when destination exists but is not a directory", async () => {
		fsMocks.access.mockResolvedValueOnce(undefined);
		fsMocks.stat.mockResolvedValueOnce({ isDirectory: () => false });

		const result = await cloneGitRepository("https://github.com/user/my-repo.git", testCwd);

		expect(result.ok).toBe(false);
		expect(result.error).toContain("Destination already exists");
		expect(childProcessMocks.execFilePromise).not.toHaveBeenCalled();
	});

	it("returns error when destination is outside CWD", async () => {
		const result = await cloneGitRepository("https://github.com/user/my-repo.git", testCwd, "/tmp/outside-repo");

		expect(result.ok).toBe(false);
		expect(result.error).toContain("outside the server working directory");
		expect(childProcessMocks.execFilePromise).not.toHaveBeenCalled();
	});

	it("allows destination outside CWD when allowedRootPath is broader", async () => {
		const outsidePath = "/tmp/outside-repo";
		fsMocks.access.mockRejectedValueOnce(new Error("ENOENT"));
		fsMocks.mkdir.mockResolvedValueOnce(undefined);
		childProcessMocks.execFilePromise.mockResolvedValueOnce({ stdout: "", stderr: "" });

		const result = await cloneGitRepository("https://github.com/user/my-repo.git", testCwd, outsidePath, "/");

		expect(result.ok).toBe(true);
		expect(result.clonedPath).toBe(outsidePath);
	});

	it("returns error when repo name cannot be derived and no destination provided", async () => {
		const result = await cloneGitRepository("   ", testCwd);

		expect(result.ok).toBe(false);
		expect(result.error).toContain("Could not derive repository name");
	});

	it("returns error when git clone command fails", async () => {
		fsMocks.access.mockRejectedValueOnce(new Error("ENOENT"));
		fsMocks.mkdir.mockResolvedValueOnce(undefined);
		const gitError = Object.assign(new Error("clone failed"), {
			code: 128,
			stdout: "",
			stderr: "fatal: repository not found",
		});
		childProcessMocks.execFilePromise.mockRejectedValueOnce(gitError);

		const result = await cloneGitRepository("https://github.com/user/bad-repo.git", testCwd);

		expect(result.ok).toBe(false);
		expect(result.error).toBeTruthy();
	});

	it("creates parent directory if it does not exist", async () => {
		const nestedDest = join(testCwd, "nested", "dir", "my-repo");
		fsMocks.access.mockRejectedValueOnce(new Error("ENOENT"));
		fsMocks.mkdir.mockResolvedValueOnce(undefined);
		childProcessMocks.execFilePromise.mockResolvedValueOnce({ stdout: "", stderr: "" });

		const result = await cloneGitRepository("https://github.com/user/my-repo.git", testCwd, nestedDest);

		expect(result.ok).toBe(true);
		expect(fsMocks.mkdir).toHaveBeenCalledWith(join(testCwd, "nested", "dir"), { recursive: true });
	});

	it("returns error when parent directory creation fails", async () => {
		const nestedDest = join(testCwd, "nested", "repo");
		fsMocks.access.mockRejectedValueOnce(new Error("ENOENT"));
		fsMocks.mkdir.mockRejectedValueOnce(new Error("EACCES: permission denied"));

		const result = await cloneGitRepository("https://github.com/user/my-repo.git", testCwd, nestedDest);

		expect(result.ok).toBe(false);
		expect(result.error).toContain("Failed to create parent directory");
	});

	it("passes '--' separator before the URL to prevent flag injection", async () => {
		const maliciousUrl = "--upload-pack=/usr/bin/malicious";
		const dest = join(testCwd, "repo");
		fsMocks.access.mockRejectedValueOnce(new Error("ENOENT"));
		fsMocks.mkdir.mockResolvedValueOnce(undefined);
		childProcessMocks.execFilePromise.mockResolvedValueOnce({ stdout: "", stderr: "" });

		await cloneGitRepository(maliciousUrl, testCwd, dest);

		expect(childProcessMocks.execFilePromise).toHaveBeenCalledOnce();
		const callArgs = childProcessMocks.execFilePromise.mock.calls[0];
		const gitArgs: string[] = callArgs[1];
		const cloneIdx = gitArgs.indexOf("clone");
		const separatorIdx = gitArgs.indexOf("--");
		const urlIdx = gitArgs.indexOf(maliciousUrl);

		// The '--' separator must appear between 'clone' and the URL.
		expect(separatorIdx).toBeGreaterThan(cloneIdx);
		expect(urlIdx).toBeGreaterThan(separatorIdx);
	});

	it("always includes '--' separator even for normal URLs", async () => {
		fsMocks.access.mockRejectedValueOnce(new Error("ENOENT"));
		fsMocks.mkdir.mockResolvedValueOnce(undefined);
		childProcessMocks.execFilePromise.mockResolvedValueOnce({ stdout: "", stderr: "" });

		await cloneGitRepository("https://github.com/user/my-repo.git", testCwd);

		const callArgs = childProcessMocks.execFilePromise.mock.calls[0];
		const gitArgs: string[] = callArgs[1];
		const separatorIdx = gitArgs.indexOf("--");
		const urlIdx = gitArgs.indexOf("https://github.com/user/my-repo.git");

		expect(separatorIdx).not.toBe(-1);
		expect(urlIdx).toBeGreaterThan(separatorIdx);
	});

	it("checks out the requested ref after cloning", async () => {
		fsMocks.access.mockRejectedValueOnce(new Error("ENOENT"));
		fsMocks.mkdir.mockResolvedValueOnce(undefined);
		childProcessMocks.execFilePromise
			.mockResolvedValueOnce({ stdout: "", stderr: "" })
			.mockResolvedValueOnce({ stdout: "", stderr: "" });

		const result = await cloneGitRepository("https://github.com/user/my-repo.git", testCwd, undefined, testCwd, {
			ref: "abc123def456",
		});

		expect(result.ok).toBe(true);
		expect(childProcessMocks.execFilePromise).toHaveBeenCalledTimes(2);
		const checkoutCall = childProcessMocks.execFilePromise.mock.calls[1];
		expect(checkoutCall[0]).toBe("git");
		expect(checkoutCall[1]).toEqual(["-c", "core.quotepath=false", "checkout", "--detach", "--", "abc123def456"]);
		expect(checkoutCall[2]).toMatchObject({ cwd: resolve(testCwd, "my-repo") });
	});

	it("returns an error when requested ref checkout fails", async () => {
		fsMocks.access.mockRejectedValueOnce(new Error("ENOENT"));
		fsMocks.mkdir.mockResolvedValueOnce(undefined);
		childProcessMocks.execFilePromise.mockResolvedValueOnce({ stdout: "", stderr: "" });
		childProcessMocks.execFilePromise.mockRejectedValueOnce(
			Object.assign(new Error("bad ref"), {
				code: 1,
				stdout: "",
				stderr: "error: pathspec 'missing-ref' did not match",
			}),
		);

		const result = await cloneGitRepository("https://github.com/user/my-repo.git", testCwd, undefined, testCwd, {
			ref: "missing-ref",
		});

		expect(result.ok).toBe(false);
		expect(result.error).toContain("checkout");
	});
});
