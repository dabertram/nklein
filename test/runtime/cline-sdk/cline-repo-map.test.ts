import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildClineRepoMap } from "../../../src/cline-sdk/cline-repo-map";

async function createRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "kanban-repo-map-"));
	await mkdir(join(root, "src"), { recursive: true });
	await mkdir(join(root, "node_modules", "ignored"), { recursive: true });
	await writeFile(
		join(root, "src", "score.ts"),
		[
			"export interface ScoreInput { value: number }",
			"export function calculateScore(input: ScoreInput): number {",
			"  return normalizeScore(input.value);",
			"}",
			"export function normalizeScore(value: number): number {",
			"  return Math.max(0, Math.min(100, value));",
			"}",
			"export const scoreLabel = 'score';",
		].join("\n"),
		"utf8",
	);
	await writeFile(
		join(root, "src", "consumer.ts"),
		[
			"import { calculateScore, normalizeScore } from './score';",
			"export function renderScore(value: number): string {",
			"  return calculateScore({ value }).toString() + ':' + normalizeScore(value).toString();",
			"}",
		].join("\n"),
		"utf8",
	);
	await writeFile(
		join(root, "node_modules", "ignored", "bad.ts"),
		"export function ignoredSymbol() { return true; }",
		"utf8",
	);
	return root;
}

describe("cline repo map", () => {
	it("extracts and ranks source symbols", async () => {
		const workspacePath = await createRepo();

		const repoMap = await buildClineRepoMap({
			workspacePath,
			tokenBudget: 500,
		});

		expect(repoMap.filesScanned).toBe(2);
		expect(repoMap.symbols.map((symbol) => symbol.name)).toContain("calculateScore");
		expect(repoMap.symbols.map((symbol) => symbol.name)).toContain("renderScore");
		expect(repoMap.symbols.map((symbol) => symbol.name)).not.toContain("ignoredSymbol");
		expect(repoMap.symbols[0]?.rankScore).toBeGreaterThanOrEqual(repoMap.symbols.at(-1)?.rankScore ?? 0);
		expect(repoMap.symbols.find((symbol) => symbol.name === "calculateScore")?.rankScore).toBeGreaterThan(
			repoMap.symbols.find((symbol) => symbol.name === "scoreLabel")?.rankScore ?? 0,
		);
		expect(repoMap.rendered).toContain("Repo map:");
		expect(repoMap.rendered).toContain("rank=");
		expect(repoMap.rendered).toContain("src/score.ts");
	});

	it("truncates rendered output to the token budget", async () => {
		const workspacePath = await createRepo();

		const repoMap = await buildClineRepoMap({
			workspacePath,
			tokenBudget: 12,
		});

		expect(repoMap.truncated).toBe(true);
		expect(repoMap.tokenCount).toBeLessThanOrEqual(12);
	});
});
