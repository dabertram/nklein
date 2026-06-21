import type { AgentTool } from "@nklein/shared";
import type { NKleinCodeEmbeddingProvider } from "./nklein-code-embeddings";
import { searchNKleinCode } from "./nklein-code-search";
import { buildNKleinRepoMap } from "./nklein-repo-map";

const DEFAULT_REPO_MAP_TOKEN_BUDGET = 1_200;
const MAX_REPO_MAP_TOKEN_BUDGET = 12_000;
const DEFAULT_REPO_MAP_MAX_FILES = 1_000;
const MAX_REPO_MAP_MAX_FILES = 5_000;
const DEFAULT_CODE_SEARCH_MAX_RESULTS = 8;
const MAX_CODE_SEARCH_MAX_RESULTS = 30;

function asBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.max(min, Math.min(max, Math.trunc(value)));
}

function createRepoMapTool(workspacePath: string): AgentTool {
	return {
		name: "repo_map",
		description:
			"Return a compact ranked map of important source symbols. Use this before reading files when you need codebase orientation.",
		inputSchema: {
			type: "object",
			properties: {
				tokenBudget: {
					type: "number",
					description: "Approximate maximum tokens for the rendered map. Defaults to 1200.",
				},
				maxFiles: {
					type: "number",
					description: "Maximum source files to scan. Defaults to 1000.",
				},
				query: {
					type: "string",
					description: "Optional prompt, symbol, error text, or topic used to personalize the ranked map.",
				},
				seedPaths: {
					type: "array",
					items: { type: "string" },
					description: "Optional workspace-relative file paths to boost in the ranked map.",
				},
			},
			additionalProperties: false,
		},
		async execute(input) {
			const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
			const repoMap = await buildNKleinRepoMap({
				workspacePath,
				tokenBudget: asBoundedInteger(
					record.tokenBudget,
					DEFAULT_REPO_MAP_TOKEN_BUDGET,
					100,
					MAX_REPO_MAP_TOKEN_BUDGET,
				),
				maxFiles: asBoundedInteger(record.maxFiles, DEFAULT_REPO_MAP_MAX_FILES, 1, MAX_REPO_MAP_MAX_FILES),
				personalizationText: typeof record.query === "string" ? record.query : undefined,
				seedPaths: Array.isArray(record.seedPaths)
					? record.seedPaths.filter((path): path is string => typeof path === "string")
					: undefined,
			});
			return {
				map: repoMap.rendered,
				filesScanned: repoMap.filesScanned,
				symbolsReturned: repoMap.symbols.length,
				tokenCount: repoMap.tokenCount,
				truncated: repoMap.truncated,
				instruction:
					"Use file paths and symbol names from this map to choose focused read_files calls. Do not read whole files unless necessary.",
			};
		},
	};
}

function createCodeSearchTool(workspacePath: string, embeddingProvider?: NKleinCodeEmbeddingProvider): AgentTool {
	return {
		name: "search_code",
		description:
			"Search source code and return focused line-numbered snippets. Use this to find relevant functions, types, errors, or identifiers before reading files.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: 'Required search text, for example "calculateScore" or "failed to parse config".',
				},
				maxResults: {
					type: "number",
					description: "Maximum snippets to return. Defaults to 8.",
				},
				contextLines: {
					type: "number",
					description: "Lines of context before and after each match. Defaults to 3.",
				},
				maxFiles: {
					type: "number",
					description: "Maximum source files to scan. Defaults to 1000.",
				},
			},
			required: ["query"],
			additionalProperties: false,
		},
		async execute(input) {
			const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
			const query = typeof record.query === "string" ? record.query : "";
			const search = await searchNKleinCode({
				workspacePath,
				query,
				maxFiles: asBoundedInteger(record.maxFiles, DEFAULT_REPO_MAP_MAX_FILES, 1, MAX_REPO_MAP_MAX_FILES),
				maxResults: asBoundedInteger(
					record.maxResults,
					DEFAULT_CODE_SEARCH_MAX_RESULTS,
					1,
					MAX_CODE_SEARCH_MAX_RESULTS,
				),
				contextLines: asBoundedInteger(record.contextLines, 3, 0, 12),
				embeddingProvider,
			});
			return {
				query: search.query,
				filesScanned: search.filesScanned,
				matches: search.matches,
				truncated: search.truncated,
				instruction:
					"Pick the smallest relevant file excerpts from these snippets. Prefer read_files with focused ranges before reading whole files.",
			};
		},
	};
}

export function createNKleinRetrievalTools(options: {
	workspacePath: string;
	embeddingProvider?: NKleinCodeEmbeddingProvider;
}): AgentTool[] {
	return [
		createRepoMapTool(options.workspacePath),
		createCodeSearchTool(options.workspacePath, options.embeddingProvider),
	];
}
