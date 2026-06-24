import { describe, expect, it } from "vitest";
import { createWorkspaceReadTools, type WorkspaceToolFsDeps } from "../../../src/chat/chat-workspace-tools";

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
