import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	coerceShellSyntaxToShellString,
	looksLikeShellSyntax,
	normalizeHostPathInputs,
	normalizeSandboxBashInput,
	rewriteHostProjectPath,
	rewriteHostProjectPathsInCommand,
} from "../../../src/nklein-agent/agent-sandbox/path-normalization";

describe('structured bash input carrying shell syntax (live 2026-09-05: spawn "pwd && ls -la" ENOENT)', () => {
	it("turns a structured command with shell syntax into /bin/sh -c of the joined line", () => {
		expect(normalizeSandboxBashInput({ command: "pwd && ls -la" }, null, "/work")).toEqual({
			command: "/bin/sh",
			args: ["-c", "pwd && ls -la"],
		});
		expect(
			normalizeSandboxBashInput(
				{ command: "git", args: ["status", "--porcelain=v1", "2>/dev/null", "|", "head", "-50"] },
				null,
				"/work",
			),
		).toEqual({ command: "/bin/sh", args: ["-c", "git status --porcelain=v1 2>/dev/null | head -50"] });
		expect(coerceShellSyntaxToShellString({ command: "ls", args: ["node_modules/.bin", "| head -20"] })).toEqual({
			command: "/bin/sh",
			args: ["-c", "ls node_modules/.bin | head -20"],
		});
	});

	it("keeps a plain structured command structured and quotes whitespace args only when collapsing", () => {
		expect(normalizeSandboxBashInput({ command: "npm", args: ["test"] }, null, "/work")).toEqual({
			command: "npm",
			args: ["test"],
		});
		expect(coerceShellSyntaxToShellString({ command: "grep", args: ["a phrase", "src/*.ts"] })).toEqual({
			command: "/bin/sh",
			args: ["-c", "grep 'a phrase' src/*.ts"],
		});
		expect(looksLikeShellSyntax("npm run build")).toBe(false);
		expect(looksLikeShellSyntax("cat $(git ls-files)")).toBe(true);
		expect(looksLikeShellSyntax("echo `date`")).toBe(true);
	});
});

describe("sandbox path normalization", () => {
	it("maps structured host project paths to sandbox-relative paths", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "nklein-sandbox-normalize-"));
		await mkdir(join(cwd, "src"), { recursive: true });
		await writeFile(join(cwd, "src", "index.ts"), "export {};\n", "utf8");

		expect(rewriteHostProjectPath("/host/project/src/index.ts", "/host/project", cwd)).toBe("src/index.ts");
		expect(rewriteHostProjectPath("/src/index.ts", "/host/project", cwd)).toBe("src/index.ts");
		expect(
			normalizeHostPathInputs({ files: [{ path: "/host/project/src/index.ts" }] }, "/host/project", cwd),
		).toEqual({
			files: [{ path: "src/index.ts" }],
		});
	});

	it("maps host project paths embedded in bash command strings", () => {
		const hostProjectPath = "/private/var/folders/example/nklein-audio-vst";

		expect(rewriteHostProjectPathsInCommand(`cd ${hostProjectPath} && npm test`, hostProjectPath)).toBe(
			"cd . && npm test",
		);
		expect(rewriteHostProjectPathsInCommand(`cat ${hostProjectPath}/src/plugin.ts`, hostProjectPath)).toBe(
			"cat ./src/plugin.ts",
		);
	});

	it("normalizes bash command fields without changing unrelated values", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "nklein-sandbox-bash-normalize-"));

		expect(
			normalizeSandboxBashInput(
				{
					command: "cd /host/project && ls",
					path: "/host/project/src/plugin.ts",
					reason: "inspect /host/project literally",
				},
				"/host/project",
				cwd,
			),
		).toEqual({
			// The `&&` chain only means something to a shell (live 2026-09-05: spawned as an executable → ENOENT).
			command: "/bin/sh",
			args: ["-c", "cd . && ls"],
			path: "src/plugin.ts",
			reason: "inspect /host/project literally",
		});
	});
});
