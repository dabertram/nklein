import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createWorkspaceReadTools,
	createWorkspaceWriteTools,
	type WorkspaceToolFsDeps,
	type WorkspaceWriteToolFsDeps,
} from "../../../src/chat/chat-workspace-tools";

const ROOT = "/workspaces/task-1";

function fakeFs(
	files: Record<string, string>,
	dirs: Record<string, Array<{ name: string; isDirectory: boolean }>> = {},
): WorkspaceToolFsDeps {
	return {
		readFile: async (path) => {
			const content = files[path];
			if (content === undefined) {
				throw new Error("ENOENT");
			}
			return content;
		},
		readdir: async (path) => {
			const entries = dirs[path];
			if (entries === undefined) {
				throw new Error("ENOENT");
			}
			return entries;
		},
		stat: async (path) => ({ size: (files[path] ?? "").length }),
		// No symlinks in fake fs — realpath is identity.
		realpath: async (path) => path,
	};
}

function tool(tools: ReturnType<typeof createWorkspaceReadTools>["tools"], name: string) {
	const found = tools.find((candidate) => candidate.name === name);
	if (!found) {
		throw new Error(`tool ${name} not found`);
	}
	return found;
}

describe("createWorkspaceReadTools", () => {
	it("exposes read_file + list_dir as sandbox_read tools with matching definitions", () => {
		const { tools, definitions } = createWorkspaceReadTools(ROOT);
		expect(tools.map((t) => t.name).sort()).toEqual(["list_dir", "read_file"]);
		expect(tools.every((t) => t.actionKind === "sandbox_read")).toBe(true);
		expect(definitions.map((d) => d.name).sort()).toEqual(["list_dir", "read_file"]);
	});

	it("reads a file by its workspace-relative path", async () => {
		const { tools } = createWorkspaceReadTools(ROOT, { fs: fakeFs({ [`${ROOT}/README.md`]: "# Project" }) });
		expect(await tool(tools, "read_file").run({ path: "README.md" })).toBe("# Project");
	});

	it("truncates a file over the byte cap and notes the relative path (no host path)", async () => {
		const big = "x".repeat(100);
		const { tools } = createWorkspaceReadTools(ROOT, { fs: fakeFs({ [`${ROOT}/big.txt`]: big }), maxBytes: 10 });
		const out = await tool(tools, "read_file").run({ path: "big.txt" });
		expect(out).toContain("truncated: big.txt");
		expect(out).not.toContain(ROOT);
	});

	it("refuses absolute paths without leaking that they were tried against a host root", async () => {
		const { tools } = createWorkspaceReadTools(ROOT, { fs: fakeFs({}) });
		const out = await tool(tools, "read_file").run({ path: "/etc/passwd" });
		expect(out).toContain("must be workspace-relative");
		expect(out).not.toContain(ROOT);
	});

	it("refuses paths that escape the workspace root", async () => {
		const { tools } = createWorkspaceReadTools(ROOT, { fs: fakeFs({}) });
		const out = await tool(tools, "read_file").run({ path: "../../secrets.txt" });
		expect(out).toContain("escapes the workspace");
	});

	it("requires a path argument", async () => {
		const { tools } = createWorkspaceReadTools(ROOT, { fs: fakeFs({}) });
		expect(await tool(tools, "read_file").run({})).toContain("Provide a `path`");
	});

	it("reports a friendly relative-path error for a missing file", async () => {
		const { tools } = createWorkspaceReadTools(ROOT, { fs: fakeFs({}) });
		const out = await tool(tools, "read_file").run({ path: "nope.txt" });
		expect(out).toContain("Could not read nope.txt");
		expect(out).not.toContain(ROOT);
	});

	it("lists a directory with trailing slashes for subdirectories, sorted", async () => {
		const { tools } = createWorkspaceReadTools(ROOT, {
			fs: fakeFs(
				{},
				{
					[ROOT]: [
						{ name: "src", isDirectory: true },
						{ name: "README.md", isDirectory: false },
					],
					[`${ROOT}/src`]: [{ name: "app.ts", isDirectory: false }],
				},
			),
		});
		expect(await tool(tools, "list_dir").run({})).toBe("README.md\nsrc/");
		expect(await tool(tools, "list_dir").run({ path: "src" })).toBe("src/app.ts");
	});
});

describe("createWorkspaceWriteTools", () => {
	function fakeWriteFs(): { fs: WorkspaceWriteToolFsDeps; written: Record<string, string>; dirs: string[] } {
		const written: Record<string, string> = {};
		const dirs: string[] = [];
		return {
			written,
			dirs,
			fs: {
				writeFile: async (path, content) => {
					written[path] = content;
				},
				mkdir: async (dir) => {
					dirs.push(dir);
				},
				// No symlinks in fake fs — realpath is identity.
				realpath: async (path) => path,
			},
		};
	}

	it("exposes write_file as a sandbox_write tool with a matching definition", () => {
		const { tools, definitions } = createWorkspaceWriteTools(ROOT);
		expect(tools.map((t) => t.name)).toEqual(["write_file"]);
		expect(tools[0]?.actionKind).toBe("sandbox_write");
		expect(definitions.map((d) => d.name)).toEqual(["write_file"]);
	});

	it("writes content to a workspace-relative path, creating the parent directory", async () => {
		const { fs, written, dirs } = fakeWriteFs();
		const { tools } = createWorkspaceWriteTools(ROOT, { fs });
		const out = await tool(tools, "write_file").run({ path: "src/app.ts", content: "export const x = 1;" });
		expect(out).toBe("Wrote 19 bytes to src/app.ts.");
		expect(written[`${ROOT}/src/app.ts`]).toBe("export const x = 1;");
		expect(dirs).toContain(`${ROOT}/src`);
	});

	it("requires string content", async () => {
		const { fs } = fakeWriteFs();
		const { tools } = createWorkspaceWriteTools(ROOT, { fs });
		expect(await tool(tools, "write_file").run({ path: "a.txt" })).toContain("Provide `content`");
	});

	it("refuses to write outside the workspace (no host-path leak)", async () => {
		const { fs, written } = fakeWriteFs();
		const { tools } = createWorkspaceWriteTools(ROOT, { fs });
		const out = await tool(tools, "write_file").run({ path: "../escape.txt", content: "x" });
		expect(out).toContain("escapes the workspace");
		expect(out).not.toContain(ROOT);
		expect(Object.keys(written)).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Symlink-escape regression tests (real disk, real fs.realpath)
// These tests exercise the realpath-based confinement added to close the
// symlink-escape hole: a workspace symlink whose real path lands outside
// the workspace must be rejected by read_file, list_dir, and write_file,
// even though it passes the lexical path check.
// ---------------------------------------------------------------------------

describe("symlink-escape confinement (real fs)", () => {
	let tmpDir: string;
	let workspace: string;
	let outsideDir: string;
	let outsideFile: string;

	beforeAll(() => {
		// Create a temp root entirely outside the repo.
		tmpDir = mkdtempSync(join(tmpdir(), "kbn-ws-tools-test-"));
		workspace = join(tmpDir, "workspace");
		outsideDir = join(tmpDir, "outside");
		outsideFile = join(outsideDir, "secret.txt");

		mkdirSync(workspace, { recursive: true });
		mkdirSync(outsideDir, { recursive: true });

		// A real file inside the workspace.
		writeFileSync(join(workspace, "real.txt"), "hello from workspace");

		// A real subdirectory inside the workspace.
		mkdirSync(join(workspace, "subdir"), { recursive: true });
		writeFileSync(join(workspace, "subdir", "nested.txt"), "nested file");

		// The "secret" target outside the workspace.
		writeFileSync(outsideFile, "sensitive data");

		// Symlink: workspace/link-to-file -> ../outside/secret.txt  (escapes)
		symlinkSync(outsideFile, join(workspace, "link-to-file"));

		// Symlink: workspace/link-to-dir -> ../outside/  (escapes, directory)
		symlinkSync(outsideDir, join(workspace, "link-to-dir"));

		// Deep symlink: workspace/subdir/deep-link -> ../../outside/secret.txt  (escapes via deep path)
		symlinkSync(outsideFile, join(workspace, "subdir", "deep-link"));

		// Within-workspace symlink: workspace/intra-link -> ./real.txt  (safe, must still work)
		symlinkSync(join(workspace, "real.txt"), join(workspace, "intra-link"));

		// Within-workspace dir symlink: workspace/intra-dir -> ./subdir  (safe, must still work for list_dir)
		symlinkSync(join(workspace, "subdir"), join(workspace, "intra-dir"));
	});

	afterAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// --- read_file ---

	it("read_file: rejects a file symlink that escapes the workspace", async () => {
		const { tools } = createWorkspaceReadTools(workspace);
		const out = await tool(tools, "read_file").run({ path: "link-to-file" });
		expect(out).toContain("escapes the workspace");
		expect(out).not.toContain(outsideFile);
		expect(out).not.toContain(outsideDir);
		expect(out).not.toContain(tmpDir);
		// Must not have returned the secret content.
		expect(out).not.toContain("sensitive data");
	});

	it("read_file: rejects a directory symlink that escapes the workspace", async () => {
		// Reading a directory-symlink as a file will normally fail, but the confinement check
		// must fire before the read attempt so the reason is "escapes" not a generic read error.
		const { tools } = createWorkspaceReadTools(workspace);
		const out = await tool(tools, "read_file").run({ path: "link-to-dir" });
		expect(out).toContain("escapes the workspace");
	});

	it("read_file: rejects a deep/nested symlink that escapes the workspace", async () => {
		const { tools } = createWorkspaceReadTools(workspace);
		const out = await tool(tools, "read_file").run({ path: "subdir/deep-link" });
		expect(out).toContain("escapes the workspace");
		expect(out).not.toContain("sensitive data");
	});

	it("read_file: allows a real file inside the workspace", async () => {
		const { tools } = createWorkspaceReadTools(workspace);
		const out = await tool(tools, "read_file").run({ path: "real.txt" });
		expect(out).toBe("hello from workspace");
	});

	it("read_file: allows a within-workspace symlink (intra-link -> real.txt)", async () => {
		const { tools } = createWorkspaceReadTools(workspace);
		const out = await tool(tools, "read_file").run({ path: "intra-link" });
		expect(out).toBe("hello from workspace");
	});

	// --- list_dir ---

	it("list_dir: rejects a directory symlink that escapes the workspace", async () => {
		const { tools } = createWorkspaceReadTools(workspace);
		const out = await tool(tools, "list_dir").run({ path: "link-to-dir" });
		expect(out).toContain("escapes the workspace");
		expect(out).not.toContain("sensitive data");
	});

	it("list_dir: rejects a file symlink that escapes the workspace (treated as dir target)", async () => {
		// link-to-file points to a file outside; listing it as a dir will fail, but confinement fires first.
		const { tools } = createWorkspaceReadTools(workspace);
		const out = await tool(tools, "list_dir").run({ path: "link-to-file" });
		expect(out).toContain("escapes the workspace");
	});

	it("list_dir: allows a real directory inside the workspace", async () => {
		const { tools } = createWorkspaceReadTools(workspace);
		const out = await tool(tools, "list_dir").run({ path: "subdir" });
		expect(out).toContain("subdir/nested.txt");
	});

	it("list_dir: allows a within-workspace dir symlink (intra-dir -> subdir)", async () => {
		const { tools } = createWorkspaceReadTools(workspace);
		const out = await tool(tools, "list_dir").run({ path: "intra-dir" });
		expect(out).toContain("nested.txt");
	});

	// --- write_file ---

	it("write_file: rejects writing through a file symlink that escapes the workspace", async () => {
		const { tools } = createWorkspaceWriteTools(workspace);
		const out = await tool(tools, "write_file").run({ path: "link-to-file", content: "pwned" });
		expect(out).toContain("escapes the workspace");
		expect(out).not.toContain(outsideFile);
		expect(out).not.toContain(tmpDir);
		// The outside file must be untouched.
		const { readFileSync } = await import("node:fs");
		expect(readFileSync(outsideFile, "utf8")).toBe("sensitive data");
	});

	it("write_file: rejects writing a new file inside an escaping dir symlink", async () => {
		// link-to-dir/new.txt would land outside the workspace.
		const { tools } = createWorkspaceWriteTools(workspace);
		const out = await tool(tools, "write_file").run({ path: "link-to-dir/new.txt", content: "pwned" });
		expect(out).toContain("escapes the workspace");
	});

	it("write_file: allows writing a new file in a real workspace directory", async () => {
		const { tools } = createWorkspaceWriteTools(workspace);
		const out = await tool(tools, "write_file").run({ path: "new-file.txt", content: "safe write" });
		expect(out).toContain("Wrote");
		expect(out).toContain("new-file.txt");
		const { readFileSync } = await import("node:fs");
		expect(readFileSync(join(workspace, "new-file.txt"), "utf8")).toBe("safe write");
	});

	it("write_file: allows writing through a within-workspace symlink", async () => {
		// intra-link points to real.txt which is inside the workspace — overwrite should be allowed.
		const { tools } = createWorkspaceWriteTools(workspace);
		const out = await tool(tools, "write_file").run({ path: "intra-link", content: "updated" });
		expect(out).toContain("Wrote");
	});
});
