import { describe, expect, it } from "vitest";
import {
	extractFunctionExemplarCandidates,
	renderFewShotExemplarBlock,
	selectFewShotExemplars,
	tokenizeForOverlap,
} from "../../../src/nklein-agent/nklein-few-shot-exemplars";

const PARSER_FILE = {
	path: "src/parse-config.ts",
	content: [
		"/** Parse the config file into settings. */",
		"export function parseConfigFile(raw: string) {",
		"  return JSON.parse(raw);",
		"}",
		"export const validateConfigSchema = (value: unknown) => {",
		"  return Boolean(value);",
		"};",
	].join("\n"),
};

const RENDER_FILE = {
	path: "src/render-badge.tsx",
	content: [
		"export function renderBadgeLabel(label: string) {",
		"  return ['<b>', label, '</b>'].join('');",
		"}",
	].join("\n"),
};

describe("nklein-few-shot-exemplars (F11.2h)", () => {
	it("tokenizes camelCase and snake_case identifiers into overlap tokens", () => {
		const tokens = tokenizeForOverlap("parseConfigFile validate_schema ab");
		expect(tokens.has("parse")).toBe(true);
		expect(tokens.has("config")).toBe(true);
		expect(tokens.has("schema")).toBe(true);
		expect(tokens.has("ab")).toBe(false); // sub-3-char noise dropped
	});

	it("extracts named function declarations AND arrow consts with exact line spans", () => {
		const candidates = extractFunctionExemplarCandidates(PARSER_FILE.path, PARSER_FILE.content);
		expect(candidates.map((candidate) => candidate.name)).toEqual(["parseConfigFile", "validateConfigSchema"]);
		expect(candidates[0]?.lineStart).toBe(2);
		expect(candidates[0]?.lineEnd).toBe(4);
	});

	it("selects the task-similar exemplar, excludes the card's own target files, one per file", () => {
		const candidates = [
			...extractFunctionExemplarCandidates(PARSER_FILE.path, PARSER_FILE.content),
			...extractFunctionExemplarCandidates(RENDER_FILE.path, RENDER_FILE.content),
		];
		const picked = selectFewShotExemplars({
			taskText: "Add a parser for the workspace config file with schema validation",
			targetPaths: [],
			candidates,
		});
		expect(picked.map((exemplar) => exemplar.name)).toEqual(["parseConfigFile"]);
		// Excluding the file the card will edit leaves nothing similar enough.
		const excluded = selectFewShotExemplars({
			taskText: "Add a parser for the workspace config file with schema validation",
			targetPaths: [PARSER_FILE.path],
			candidates,
		});
		expect(excluded).toEqual([]);
	});

	it("does not select an unrelated function merely because its body mentions task words", () => {
		const noisy = extractFunctionExemplarCandidates(
			"src/run-thing.ts",
			[
				"export function runThing(value: unknown) {",
				'  const configFile = "workspace config file";',
				'  const schemaValidation = "schema validation";',
				"  return { value, configFile, schemaValidation };",
				"}",
			].join("\n"),
		);
		const picked = selectFewShotExemplars({
			taskText: "Add a parser for the workspace config file with schema validation",
			targetPaths: [],
			candidates: noisy,
		});
		expect(picked).toEqual([]);
	});

	it("keeps identity overlap relevant when the task includes a precise behavioral contract", () => {
		const picked = selectFewShotExemplars({
			taskText:
				"Normalize workspace source file paths by trimming outer whitespace, replacing backslashes, removing leading segments, dropping empty values and exact duplicates, and preserving first-seen order.",
			targetPaths: [],
			candidates: extractFunctionExemplarCandidates(
				"src/core/workspace-paths.ts",
				"export function normalizeWorkspacePaths(values: readonly string[]) { return [...values]; }",
			),
		});
		expect(picked.map((exemplar) => exemplar.name)).toEqual(["normalizeWorkspacePaths"]);
	});

	it("renders an honestly-labeled style block and null for no exemplars", () => {
		const picked = selectFewShotExemplars({
			taskText: "parse config file",
			targetPaths: [],
			candidates: extractFunctionExemplarCandidates(PARSER_FILE.path, PARSER_FILE.content),
		});
		const block = renderFewShotExemplarBlock(picked);
		expect(block).toContain("Style exemplars");
		expect(block).toContain("do not copy their logic");
		expect(block).toContain("src/parse-config.ts:2 (parseConfigFile)");
		expect(renderFewShotExemplarBlock([])).toBeNull();
	});
});
