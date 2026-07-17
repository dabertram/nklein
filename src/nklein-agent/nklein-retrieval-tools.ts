import { searchAstShapes } from "./nklein-ast-search";
import type { NKleinCodeEmbeddingProvider } from "./nklein-code-embeddings";
import { searchNKleinCode } from "./nklein-code-search";
import { searchEgoGraph } from "./nklein-ego-graph-search";
import { buildNKleinRepoMap } from "./nklein-repo-map";
import type { AgentTool } from "./sdk-agent-types";

/** One retrieval turn's observable telemetry — query + how many hits were considered + the cited source paths. */
export interface RetrievalRecord {
	query: string;
	hitsConsidered: number;
	citations: readonly string[];
	/** F11.2e: hits the tool itself PRUNED as distractors (e.g. ego_graph hub names) — feeds `hitsPruned`. */
	pruned?: number;
}

/**
 * Sink for retrieval telemetry — the retrieval tools stay ledger-agnostic and just hand each turn's record here; the
 * caller (which owns the task/workflow identity) decides whether/how to persist it. Best-effort: must never throw.
 */
export type RetrievalRecorder = (record: RetrievalRecord) => void;

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

function createCodeSearchTool(
	workspacePath: string,
	embeddingProvider?: NKleinCodeEmbeddingProvider,
	recordRetrieval?: RetrievalRecorder,
): AgentTool {
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
			// §5.AC retrieval telemetry (record-only): the model considered these matches and their source files. The
			// helped/hurt `signal` is left to the caller/ledger (unknown here) — this seam only knows what was retrieved.
			recordRetrieval?.({
				query: search.query,
				hitsConsidered: search.matches.length,
				citations: search.matches.map((match) => match.path),
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

/** F12.1(a): the STRUCTURAL tier — find code by SHAPE where a text grep drowns (callers/definitions/implementations). */
function createAstSearchTool(workspacePath: string, recordRetrieval?: RetrievalRecorder): AgentTool {
	return {
		name: "ast_search",
		description:
			"Structural code search by SHAPE (TypeScript/JavaScript): all CALLERS of a function, all DEFINITIONS of a symbol, or all classes IMPLEMENTING/extending a type. Escalation order: search_code for text, ast_search for shape questions text-search answers noisily, repo_map for orientation.",
		inputSchema: {
			type: "object",
			properties: {
				kind: {
					type: "string",
					enum: ["callers", "definitions", "implementations", "references"],
					description:
						"The shape to find: callers of, definitions of, classes implementing/extending, or ALL references to the symbol (usages excluding its own definition).",
				},
				symbol: { type: "string", description: "The exact identifier to match (case-sensitive)." },
				maxResults: { type: "number", description: "Maximum matches to return. Defaults to 30." },
			},
			required: ["kind", "symbol"],
			additionalProperties: false,
		},
		async execute(input) {
			const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
			const kind =
				record.kind === "callers" ||
				record.kind === "definitions" ||
				record.kind === "implementations" ||
				record.kind === "references"
					? record.kind
					: "definitions";
			const symbol = typeof record.symbol === "string" ? record.symbol.trim() : "";
			if (!symbol) {
				return { error: "ast_search requires a non-empty `symbol`." };
			}
			const result = await searchAstShapes({
				workspacePath,
				query: { kind, symbol },
				maxResults: asBoundedInteger(record.maxResults, 30, 1, 100),
			});
			recordRetrieval?.({
				query: `${kind}:${symbol}`,
				hitsConsidered: result.matches.length,
				citations: result.matches.map((match) => match.path),
			});
			return {
				...result,
				instruction:
					result.matches.length > 0
						? "Read the smallest relevant ranges at these locations; the `enclosing` field names who contains each match."
						: "No structural matches — the symbol may be misspelled, non-TS, or dynamic; fall back to search_code.",
			};
		},
	};
}

/** F11.2c: k-hop ego-graph localization — hand the model the ranked NEIGHBORHOOD around the task's symbols. */
function createEgoGraphTool(workspacePath: string, recordRetrieval?: RetrievalRecorder): AgentTool {
	return {
		name: "ego_graph",
		description:
			"Localize a task's code neighborhood (TypeScript/JavaScript): seed on the symbol names the task mentions and get the ranked k-hop neighborhood — declaration sites (file:line), the files that use them, and import neighbors — as a small read-target list. Escalation order: repo_map for orientation, ego_graph to LOCALIZE which files matter for a task, ast_search for exact per-file shape matches, search_code for text.",
		inputSchema: {
			type: "object",
			properties: {
				symbols: {
					type: "array",
					items: { type: "string" },
					description: "1–8 symbol names the task mentions (functions/classes/types — exact identifiers).",
				},
				k: { type: "number", description: "Neighborhood radius in hops (1–3). Defaults to 2." },
				maxTargets: { type: "number", description: "Maximum read targets to return. Defaults to 24." },
			},
			required: ["symbols"],
			additionalProperties: false,
		},
		async execute(input) {
			const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
			const seeds = Array.isArray(record.symbols)
				? record.symbols.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
				: [];
			if (seeds.length === 0) {
				return { error: "ego_graph requires a non-empty `symbols` array." };
			}
			const result = await searchEgoGraph({
				workspacePath,
				seeds: seeds.slice(0, 8),
				k: asBoundedInteger(record.k, 2, 1, 3),
				maxTargets: asBoundedInteger(record.maxTargets, 24, 1, 60),
			});
			recordRetrieval?.({
				// Considered = kept targets + hub names the tool itself pruned as distractors (the ledger clamps
				// pruned ≤ considered, so the pruned names must count as considered hits — honest accounting).
				query: `ego:${seeds.slice(0, 8).join(",")}`,
				hitsConsidered: result.targets.length + result.hubNamesPruned.length,
				citations: [...new Set(result.targets.map((target) => target.path))],
				pruned: result.hubNamesPruned.length,
			});
			return {
				...result,
				instruction:
					result.targets.length > 0
						? "These are the task's neighborhood files, closest first (`hop` 0 = declares/uses a seed; `via` says why). read_files the hop-0/1 declaration lines with focused ranges; use ast_search for exact reference lines inside a file. Unmatched seeds may be misspelled, non-TS, or dynamic."
						: "No neighborhood found — the seeds may be misspelled, non-TS, or dynamic; fall back to search_code.",
			};
		},
	};
}

export function createNKleinRetrievalTools(options: {
	workspacePath: string;
	embeddingProvider?: NKleinCodeEmbeddingProvider;
	/** Optional sink for §5.AC retrieval telemetry; omit (e.g. sandbox tool sets with no task identity) to skip recording. */
	recordRetrieval?: RetrievalRecorder;
}): AgentTool[] {
	return [
		createRepoMapTool(options.workspacePath),
		createCodeSearchTool(options.workspacePath, options.embeddingProvider, options.recordRetrieval),
		createAstSearchTool(options.workspacePath, options.recordRetrieval),
		createEgoGraphTool(options.workspacePath, options.recordRetrieval),
	];
}
