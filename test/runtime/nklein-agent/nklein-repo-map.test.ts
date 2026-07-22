import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildNKleinRepoMap, type RepoMapFactsCacheEntry } from "../../../src/nklein-agent/nklein-repo-map";

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

describe("nklein repo map", () => {
	it("extracts and ranks source symbols", async () => {
		const workspacePath = await createRepo();

		const repoMap = await buildNKleinRepoMap({
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

		const repoMap = await buildNKleinRepoMap({
			workspacePath,
			tokenBudget: 12,
		});

		expect(repoMap.truncated).toBe(true);
		expect(repoMap.tokenCount).toBeLessThanOrEqual(12);
	});

	it("boosts symbols mentioned in personalization text", async () => {
		const workspacePath = await createRepo();

		const repoMap = await buildNKleinRepoMap({
			workspacePath,
			tokenBudget: 500,
			personalizationText: "The bug is probably in scoreLabel. Inspect scoreLabel first.",
		});

		const scoreLabelIndex = repoMap.symbols.findIndex((symbol) => symbol.name === "scoreLabel");
		const calculateScoreIndex = repoMap.symbols.findIndex((symbol) => symbol.name === "calculateScore");

		expect(scoreLabelIndex).toBeGreaterThanOrEqual(0);
		expect(calculateScoreIndex).toBeGreaterThanOrEqual(0);
		expect(scoreLabelIndex).toBeLessThan(calculateScoreIndex);
	});

	it("boosts symbols from seed paths", async () => {
		const workspacePath = await createRepo();

		const repoMap = await buildNKleinRepoMap({
			workspacePath,
			tokenBudget: 500,
			seedPaths: ["src/consumer.ts"],
		});

		const renderScoreIndex = repoMap.symbols.findIndex((symbol) => symbol.name === "renderScore");
		const normalizeScoreIndex = repoMap.symbols.findIndex((symbol) => symbol.name === "normalizeScore");

		expect(renderScoreIndex).toBeGreaterThanOrEqual(0);
		expect(normalizeScoreIndex).toBeGreaterThanOrEqual(0);
		expect(renderScoreIndex).toBeLessThan(normalizeScoreIndex);
	});

	it("preserves task-mentioned symbols beyond the old path-sorted 500-symbol cutoff", async () => {
		const workspacePath = await createRepo();
		const bulkSymbols = Array.from(
			{ length: 550 },
			(_, index) => `export function generated${String(index).padStart(3, "0")}(): number { return ${index}; }`,
		);
		await writeFile(join(workspacePath, "src", "bulk.ts"), bulkSymbols.join("\n"), "utf8");

		const repoMap = await buildNKleinRepoMap({
			workspacePath,
			tokenBudget: 500,
			personalizationText: "Fix generated549 and verify its callers.",
		});

		expect(repoMap.symbols).toHaveLength(555);
		expect(repoMap.symbols[0]?.name).toBe("generated549");
	});

	it("applies square-root reference weighting instead of letting raw occurrence volume dominate", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-repo-map-reference-weight-"));
		const highReferences = Array.from({ length: 100 }, () => "highSignal();").join(" ");
		const lowReferences = Array.from({ length: 4 }, () => "lowSignal();").join(" ");
		await writeFile(
			join(workspacePath, "signals.ts"),
			[
				"export function highSignal(): void {}",
				"export function lowSignal(): void {}",
				highReferences,
				lowReferences,
			].join("\n"),
			"utf8",
		);

		const repoMap = await buildNKleinRepoMap({ workspacePath, tokenBudget: 500 });
		const high = repoMap.symbols.find((symbol) => symbol.name === "highSignal");
		const low = repoMap.symbols.find((symbol) => symbol.name === "lowSignal");
		expect(high).toBeDefined();
		expect(low).toBeDefined();
		if (!high || !low) throw new Error("signal fixtures were not mapped");
		expect(high.rankScore / low.rankScore).toBeCloseTo(Math.sqrt(high.referenceCount / low.referenceCount), 5);
	});

	it("attributes aliased import references to the exported symbol instead of the local spelling", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-repo-map-alias-reference-"));
		await writeFile(join(workspacePath, "source.ts"), "export function originalName(): void {}", "utf8");
		await writeFile(
			join(workspacePath, "consumer.ts"),
			"import { originalName as localName } from './source';\nexport function consume() { localName(); localName(); }",
			"utf8",
		);

		const repoMap = await buildNKleinRepoMap({ workspacePath, tokenBudget: 500 });
		const original = repoMap.symbols.find((symbol) => symbol.name === "originalName");
		expect(original?.referenceCount).toBe(4);
	});

	it("spends a file cap on production architecture before tests, while honoring explicit seed files", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-repo-map-file-priority-"));
		await mkdir(join(workspacePath, "aaa-tests"), { recursive: true });
		await mkdir(join(workspacePath, "zzz-src"), { recursive: true });
		await writeFile(join(workspacePath, "aaa-tests", "feature.test.ts"), "export function testOnly() {}", "utf8");
		await writeFile(join(workspacePath, "zzz-src", "feature.ts"), "export function productionEntry() {}", "utf8");

		const productionFirst = await buildNKleinRepoMap({ workspacePath, maxFiles: 1, tokenBudget: 100 });
		expect(productionFirst.symbols.map((symbol) => symbol.name)).toEqual(["productionEntry"]);

		const explicitlySeededTest = await buildNKleinRepoMap({
			workspacePath,
			maxFiles: 1,
			seedPaths: ["aaa-tests/feature.test.ts"],
			tokenBudget: 100,
		});
		expect(explicitlySeededTest.symbols.map((symbol) => symbol.name)).toEqual(["testOnly"]);
	});

	// F12.67: incremental parse — unchanged files reuse cached facts; edited files re-parse and refresh the entry.
	it("reuses cached extraction facts for unchanged files and refreshes changed ones", async () => {
		const workspacePath = await createRepo();
		const factsCache = new Map<string, RepoMapFactsCacheEntry>();
		await buildNKleinRepoMap({ workspacePath, factsCache });
		expect(factsCache.size).toBe(2);
		const scoreEntry = factsCache.get("src/score.ts");
		const consumerEntry = factsCache.get("src/consumer.ts");
		expect(scoreEntry).toBeDefined();

		// Rebuild with one file edited: the edited entry refreshes (new hash + facts), the other is REUSED by
		// reference (identity proves the parse was skipped, not merely equal).
		await writeFile(
			join(workspacePath, "src", "score.ts"),
			"export function calculateScore(value: number): number { return value; }",
			"utf8",
		);
		const rebuilt = await buildNKleinRepoMap({ workspacePath, factsCache });
		expect(factsCache.get("src/consumer.ts")?.facts).toBe(consumerEntry?.facts);
		expect(factsCache.get("src/score.ts")?.hash).not.toBe(scoreEntry?.hash);
		expect(rebuilt.symbols.some((symbol) => symbol.name === "calculateScore")).toBe(true);
		expect(rebuilt.symbols.some((symbol) => symbol.name === "normalizeScore")).toBe(false);
	});
});
