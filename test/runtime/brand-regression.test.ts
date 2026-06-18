import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const SCAN_ROOTS = ["web-ui/src", "web-ui/public/sw.js", "src/cli.ts"] as const;
const FILE_EXTENSIONS = new Set([".ts", ".tsx", ".js"]);
const BRAND_TOKEN_PATTERN = /\b(?:Cline|Kanban)\b/u;

const allowedBrandTextPatterns = [
	/^Ask Cline to add, edit, start, or link tasks$/,
	/^Choose a Cline provider before saving\.$/,
	/^Choose a Cline provider before refreshing models\.$/,
	/^Choose a Cline provider in Settings before selecting a model\.$/,
	/^Choose a local Cline model before sending the advisor prompt\.$/,
	/^Could not save Cline provider settings\.$/,
	/^Could not save Cline MCP settings\.$/,
	/^Could not save Cline model settings\.$/,
	/^Configure a local Cline model before starting this task\.$/,
	/^Cline$/,
	/^Cline context window override$/,
	/^Cline local model$/,
	/^Cline mode$/,
	/^Failed to refresh Cline models\.$/,
	/^Fetching Cline models\.\.\.$/,
	/^Fetching Cline providers\.\.\.$/,
	/^Leaves Cline running\.$/,
	/^Moves Cline sessions to review\.$/,
	/^Needs attention: the Cline session heartbeat was lost\./,
	/^Parks Cline tasks after the autonomous wall-time limit\.$/,
	/^Parks Cline tasks at the turn checkpoint limit\.$/,
	/^Select a Cline provider in Settings to start a home chat session\.$/,
	/^Select a workspace before choosing a Cline model\.$/,
	/^Selected Cline model$/,
	/^Sign in to Cline$/,
	/^Stops tasks that hit Cline's mistake guardrail\.$/,
	/^The selected Cline model may not accept image input\./,
	/^Deprecated\. Please uninstall the legacy Kanban MCP\.$/,
] as const;

function walkFiles(rootPath: string): string[] {
	const absoluteRootPath = join(repoRoot, rootPath);
	const entries = readdirSync(absoluteRootPath, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const absoluteEntryPath = join(absoluteRootPath, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkFiles(relative(repoRoot, absoluteEntryPath)));
			continue;
		}
		if (
			entry.isFile() &&
			FILE_EXTENSIONS.has(absoluteEntryPath.slice(absoluteEntryPath.lastIndexOf("."))) &&
			!absoluteEntryPath.endsWith(".test.ts") &&
			!absoluteEntryPath.endsWith(".test.tsx")
		) {
			files.push(absoluteEntryPath);
		}
	}
	return files;
}

function collectScanFiles(): string[] {
	const files = new Set<string>();
	for (const scanRoot of SCAN_ROOTS) {
		const absolutePath = join(repoRoot, scanRoot);
		if (FILE_EXTENSIONS.has(absolutePath.slice(absolutePath.lastIndexOf(".")))) {
			files.add(absolutePath);
			continue;
		}
		for (const filePath of walkFiles(scanRoot)) {
			files.add(filePath);
		}
	}
	return Array.from(files).sort((left, right) => left.localeCompare(right));
}

function collectStringCandidates(source: string): string[] {
	const candidates: string[] = [];
	const stringLiteralPattern = /(["'`])([^"'`\n]*)\1/gu;
	const jsxTextPattern = />\s*([^<>{}\n][^<>{}]*)\s*</gu;
	for (const line of source.split("\n")) {
		if (!BRAND_TOKEN_PATTERN.test(line)) {
			continue;
		}
		for (const match of line.matchAll(stringLiteralPattern)) {
			const raw = match[2]?.trim();
			if (!raw || raw.includes("${") || !BRAND_TOKEN_PATTERN.test(raw)) {
				continue;
			}
			candidates.push(raw);
		}
		for (const match of line.matchAll(jsxTextPattern)) {
			const raw = match[1]?.trim();
			if (!raw || !BRAND_TOKEN_PATTERN.test(raw)) {
				continue;
			}
			candidates.push(raw);
		}
	}
	return candidates;
}

function isAllowedBrandText(text: string): boolean {
	return allowedBrandTextPatterns.some((pattern) => pattern.test(text));
}

describe("brand regression guard", () => {
	it("keeps user-visible app-brand strings free of accidental Cline/Kanban regressions", () => {
		const violations: string[] = [];
		for (const filePath of collectScanFiles()) {
			const source = readFileSync(filePath, "utf8");
			for (const candidate of collectStringCandidates(source)) {
				if (isAllowedBrandText(candidate)) {
					continue;
				}
				violations.push(`${relative(repoRoot, filePath)} -> ${candidate}`);
			}
		}

		expect(violations).toEqual([]);
	});
});
