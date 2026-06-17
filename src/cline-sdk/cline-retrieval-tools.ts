import type { AgentTool } from "@clinebot/shared";
import { buildClineRepoMap } from "./cline-repo-map";

const DEFAULT_REPO_MAP_TOKEN_BUDGET = 1_200;
const MAX_REPO_MAP_TOKEN_BUDGET = 12_000;
const DEFAULT_REPO_MAP_MAX_FILES = 1_000;
const MAX_REPO_MAP_MAX_FILES = 5_000;

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
			},
			additionalProperties: false,
		},
		async execute(input) {
			const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
			const repoMap = await buildClineRepoMap({
				workspacePath,
				tokenBudget: asBoundedInteger(
					record.tokenBudget,
					DEFAULT_REPO_MAP_TOKEN_BUDGET,
					100,
					MAX_REPO_MAP_TOKEN_BUDGET,
				),
				maxFiles: asBoundedInteger(record.maxFiles, DEFAULT_REPO_MAP_MAX_FILES, 1, MAX_REPO_MAP_MAX_FILES),
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

export function createClineRetrievalTools(options: { workspacePath: string }): AgentTool[] {
	return [createRepoMapTool(options.workspacePath)];
}
