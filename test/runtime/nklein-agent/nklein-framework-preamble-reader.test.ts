import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	clearFrameworkPreambleCache,
	readWorkspaceFrameworkPreamble,
} from "../../../src/nklein-agent/nklein-framework-preamble-reader";

describe("readWorkspaceFrameworkPreamble", () => {
	let dir: string | null = null;
	afterEach(async () => {
		clearFrameworkPreambleCache();
		if (dir) {
			await rm(dir, { recursive: true, force: true });
			dir = null;
		}
	});

	it("produces the react preamble from a workspace package.json (and memoizes)", async () => {
		dir = await mkdtemp(join(tmpdir(), "fw-preamble-"));
		await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: { react: "^19.0.0" } }));
		const lines = await readWorkspaceFrameworkPreamble(dir);
		expect(lines[0]).toContain("react 19");
		// memo: rewrite the file; the cached preamble is returned unchanged
		await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: { vue: "^3.0.0" } }));
		const cached = await readWorkspaceFrameworkPreamble(dir);
		expect(cached[0]).toContain("react 19");
	});

	it("returns [] for backend-only workspaces, missing package.json, and null cwd", async () => {
		dir = await mkdtemp(join(tmpdir(), "fw-preamble-"));
		await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: { express: "^4.0.0" } }));
		expect(await readWorkspaceFrameworkPreamble(dir)).toEqual([]);
		expect(await readWorkspaceFrameworkPreamble(join(dir, "nope"))).toEqual([]);
		expect(await readWorkspaceFrameworkPreamble(null)).toEqual([]);
	});
});
