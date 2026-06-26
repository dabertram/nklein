import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assertRealToolPathWithinRoot, confineToolPath } from "../../../src/nklein-sdk/nklein-tool-path-containment";

describe("confineToolPath", () => {
	it("allows a workspace-relative path and reports the relative path", () => {
		const result = confineToolPath("/work/space", "src/app.ts");
		expect(result).toEqual({
			ok: true,
			absolutePath: "/work/space/src/app.ts",
			relativePath: "src/app.ts",
			matchedRoot: "/work/space",
		});
	});

	it("allows a host-absolute path that is within the workspace root (home/host session)", () => {
		const result = confineToolPath("/home/user/project", "/home/user/project/src/app.ts");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.absolutePath).toBe("/home/user/project/src/app.ts");
			expect(result.relativePath).toBe("src/app.ts");
			expect(result.matchedRoot).toBe("/home/user/project");
		}
	});

	it("allows the root itself and normalizes the relative path to '.'", () => {
		const result = confineToolPath("/work/space", "/work/space");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.relativePath).toBe(".");
		}
	});

	it("rejects a host-absolute path outside the workspace root without leaking any host path", () => {
		const result = confineToolPath("/home/realuser/secret-project", "/etc/passwd");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toContain("outside the workspace");
			// Non-leaky: the message reveals neither the host workspace location nor the resolved depth (`../` count).
			expect(result.message).not.toContain("/home/realuser/secret-project");
			expect(result.message).not.toContain("..");
			expect(result.message).not.toContain("/etc/passwd");
		}
	});

	it("rejects a relative `..` traversal that escapes the workspace", () => {
		const result = confineToolPath("/work/space", "../../etc/passwd");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toContain("escapes the workspace");
		}
	});

	it("rejects an empty path", () => {
		expect(confineToolPath("/work/space", "   ").ok).toBe(false);
	});

	it("does not match a sibling-prefix root (e.g. /work/space2 is not within /work/space)", () => {
		const result = confineToolPath("/work/space", "/work/space2/file.ts");
		expect(result.ok).toBe(false);
	});

	describe("with a sandbox workdir as an additional allowed root (approval-layer shape)", () => {
		it("allows a container path under the sandbox workdir even though it is outside the host root", () => {
			const result = confineToolPath("/host/project", "/workspaces/task-1/src/app.ts", {
				sandboxWorkdir: "/workspaces/task-1",
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.matchedRoot).toBe("/workspaces/task-1");
				expect(result.relativePath).toBe("src/app.ts");
			}
		});

		it("still rejects an absolute path under neither the host root nor the sandbox workdir", () => {
			const result = confineToolPath("/host/project", "/workspaces/other-task/secret.ts", {
				sandboxWorkdir: "/workspaces/task-1",
			});
			expect(result.ok).toBe(false);
		});

		it("still allows a host-absolute path within the host root when a sandbox workdir is also configured", () => {
			const result = confineToolPath("/host/project", "/host/project/src/app.ts", {
				sandboxWorkdir: "/workspaces/task-1",
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.matchedRoot).toBe("/host/project");
			}
		});
	});
});

describe("assertRealToolPathWithinRoot", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.map(async (path) => rm(path, { recursive: true, force: true })));
		tempDirs.length = 0;
	});

	it("allows a real path inside the real root", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-containment-real-"));
		tempDirs.push(root);
		const target = join(root, "new-file.ts");
		const result = await assertRealToolPathWithinRoot(root, target, "new-file.ts");
		expect(result.ok).toBe(true);
	});

	it("rejects a symlink whose real path escapes the workspace root", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-containment-root-"));
		const outside = await mkdtemp(join(tmpdir(), "nklein-containment-outside-"));
		tempDirs.push(root, outside);
		// A symlink INSIDE the workspace pointing OUT — passes a lexical check but its real path escapes.
		const link = join(root, "escape-link");
		await symlink(outside, link);
		const target = join(link, "secret.ts");
		const result = await assertRealToolPathWithinRoot(root, target, "escape-link/secret.ts");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toContain("escapes the workspace");
		}
	});

	it("treats a non-existent root as no symlink check (lexical confinement already applied)", async () => {
		const result = await assertRealToolPathWithinRoot(
			"/workspaces/task-1",
			"/workspaces/task-1/src/app.ts",
			"src/app.ts",
		);
		// The container root does not exist host-side; we must not reject a lexically-confined path here.
		expect(result.ok).toBe(true);
	});
});
