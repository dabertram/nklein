import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	normalizeHostPathInputs,
	normalizeSandboxBashInput,
	rewriteHostProjectPath,
	rewriteHostProjectPathsInCommand,
} from "../../../src/cline-sdk/agent-sandbox/path-normalization";

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
			command: "cd . && ls",
			path: "src/plugin.ts",
			reason: "inspect /host/project literally",
		});
	});
});
