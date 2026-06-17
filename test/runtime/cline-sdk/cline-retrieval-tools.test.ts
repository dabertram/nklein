import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClineRetrievalTools } from "../../../src/cline-sdk/cline-retrieval-tools";

async function createWorkspace(): Promise<string> {
	const workspacePath = await mkdtemp(join(tmpdir(), "kanban-retrieval-tools-"));
	await mkdir(join(workspacePath, "src"), { recursive: true });
	await writeFile(
		join(workspacePath, "src", "index.ts"),
		[
			"export function alphaFeature(): string {",
			"  return betaFeature();",
			"}",
			"export function betaFeature(): string {",
			"  return 'beta';",
			"}",
		].join("\n"),
		"utf8",
	);
	return workspacePath;
}

function getTool(name: string, workspacePath: string) {
	const tool = createClineRetrievalTools({ workspacePath }).find((candidate) => candidate.name === name);
	if (!tool) {
		throw new Error(`Missing tool ${name}`);
	}
	return tool;
}

describe("cline retrieval tools", () => {
	it("returns a compact repo map", async () => {
		const workspacePath = await createWorkspace();
		const repoMapTool = getTool("repo_map", workspacePath);

		const result = (await repoMapTool.execute({ tokenBudget: 200 }, undefined as never)) as {
			map: string;
			filesScanned: number;
			symbolsReturned: number;
			truncated: boolean;
		};

		expect(result.filesScanned).toBe(1);
		expect(result.symbolsReturned).toBeGreaterThanOrEqual(2);
		expect(result.truncated).toBe(false);
		expect(result.map).toContain("alphaFeature");
		expect(result.map).toContain("src/index.ts");
	});
});
