import {
	applyRetrievalDiscriminator,
	type RetrievalDiscriminatorCandidate,
	type RetrievalDiscriminatorDecision,
} from "../core/retrieval-discriminator";
import { type AstSearchQuery, searchAstShapes } from "./nklein-ast-search";
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

export type RetrievalDiscriminator = (input: {
	readonly taskContext: string;
	readonly searchQuery: string;
	readonly candidates: readonly RetrievalDiscriminatorCandidate[];
}) => Promise<RetrievalDiscriminatorDecision | null>;

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
			"Return a compact task-ranked architecture map. Use for conceptual orientation when codebase-memory graph tools are unavailable; use search_code for literal strings and search_ast for syntax shapes.",
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
	discriminateRetrieval?: RetrievalDiscriminator,
	taskContext = "",
): AgentTool {
	return {
		name: "search_code",
		description:
			"Search source text and return focused line-numbered snippets. Route exact strings, error messages, config keys, and literals here; route syntax/code shapes to search_ast and callers/architecture/concepts to codebase-memory graph tools (repo_map fallback).",
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
			const discriminatedCandidates = search.matches.map((match, index) => ({
				id: `hit-${index}`,
				text: `PATH: ${match.path}:${match.lineStart}-${match.lineEnd}\n${match.snippet}`,
				match,
			}));
			let displayedMatches = search.matches;
			let discriminatorApplied = false;
			let discriminatorPruned = 0;
			// The measured production shape is the default bounded search result (up to eight candidates). A caller
			// explicitly asking for a wider diagnostic dump gets the unmodified result instead of a partial cross-batch
			// ranking that would falsely compare candidates from different model calls.
			if (discriminateRetrieval && discriminatedCandidates.length >= 3 && discriminatedCandidates.length <= 8) {
				try {
					const decision = await discriminateRetrieval({
						taskContext,
						searchQuery: search.query,
						candidates: discriminatedCandidates,
					});
					const applied = applyRetrievalDiscriminator(discriminatedCandidates, decision, {
						minKeep: 2,
						maxKeep: 4,
					});
					if (applied.applied) {
						displayedMatches = applied.kept.map((candidate) => candidate.match);
						discriminatorApplied = true;
						discriminatorPruned = applied.pruned.length;
					}
				} catch {
					// A relevance helper is advisory. Any endpoint, parse, or timeout failure returns every original hit.
				}
			}
			// §5.AC retrieval telemetry (record-only): the model considered these matches and their source files. The
			// helped/hurt `signal` is left to the caller/ledger (unknown here) — this seam only knows what was retrieved.
			recordRetrieval?.({
				query: search.query,
				hitsConsidered: search.matches.length,
				citations: displayedMatches.map((match) => match.path),
				pruned: discriminatorPruned,
			});
			return {
				query: search.query,
				filesScanned: search.filesScanned,
				matches: displayedMatches,
				truncated: search.truncated,
				rerank: {
					applied: discriminatorApplied,
					considered: search.matches.length,
					kept: displayedMatches.length,
					pruned: discriminatorPruned,
				},
				instruction:
					"Pick the smallest relevant file excerpts from these snippets. Prefer read_files with focused ranges before reading whole files.",
			};
		},
	};
}

/** F11.2b: the STRUCTURAL tier — find code by SHAPE without comment/string false positives. */
function createAstSearchTool(workspacePath: string, recordRetrieval?: RetrievalRecorder): AgentTool {
	return {
		name: "search_ast",
		description:
			"ast-grep/tree-sitter search by CODE SHAPE (TypeScript/JavaScript), excluding comment/string false positives. Use `pattern` for arbitrary syntax with $META/$$$MULTI metavariables, or a canned symbol kind. Exact text belongs in search_code; call chains/concepts belong in codebase-memory graph tools (repo_map fallback).",
		inputSchema: {
			type: "object",
			properties: {
				kind: {
					type: "string",
					enum: ["pattern", "callers", "definitions", "implementations", "references"],
					description:
						"Use `pattern` for an arbitrary ast-grep shape; canned modes find callers, definitions, implementations/extensions, or references.",
				},
				pattern: {
					type: "string",
					description: "For kind=pattern: source-shaped ast-grep pattern, e.g. `fetch($URL, $$$OPTIONS)`.",
				},
				language: {
					type: "string",
					enum: ["auto", "typescript", "tsx", "javascript"],
					description: "Pattern language; auto searches every JS/TS-family file. Defaults to auto.",
				},
				symbol: { type: "string", description: "For canned kinds: exact identifier (case-sensitive)." },
				maxResults: { type: "number", description: "Maximum matches to return. Defaults to 30." },
			},
			required: ["kind"],
			additionalProperties: false,
		},
		async execute(input) {
			const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
			const kind = record.kind;
			const pattern = typeof record.pattern === "string" ? record.pattern.trim() : "";
			const symbol = typeof record.symbol === "string" ? record.symbol.trim() : "";
			const language =
				record.language === "javascript" || record.language === "tsx" || record.language === "typescript"
					? record.language
					: "auto";
			if (kind === "pattern" && !pattern)
				return { error: "search_ast kind=pattern requires a non-empty `pattern`." };
			if (kind !== "pattern" && !symbol) return { error: "search_ast canned kinds require a non-empty `symbol`." };
			if (
				kind !== "pattern" &&
				kind !== "callers" &&
				kind !== "definitions" &&
				kind !== "implementations" &&
				kind !== "references"
			) {
				return { error: "search_ast requires a supported `kind`." };
			}
			const query: AstSearchQuery = kind === "pattern" ? { kind: "pattern", pattern, language } : { kind, symbol };
			const result = await searchAstShapes({
				workspacePath,
				query,
				maxResults: asBoundedInteger(record.maxResults, 30, 1, 100),
			}).catch((error: unknown) => ({
				error: `Invalid ast-grep query: ${error instanceof Error ? error.message : String(error)}`,
			}));
			if ("error" in result) return result;
			recordRetrieval?.({
				query: kind === "pattern" ? `pattern:${pattern}` : `${kind}:${symbol}`,
				hitsConsidered: result.matches.length,
				citations: result.matches.map((match) => match.path),
			});
			return {
				...result,
				instruction:
					result.matches.length > 0
						? "Read the smallest relevant ranges at these locations; the `enclosing` field names who contains each match."
						: "No structural matches — check the pattern/language or use search_code for literal text; use the graph for call chains/concepts.",
			};
		},
	};
}

/** F11.2c: k-hop ego-graph localization — hand the model the ranked NEIGHBORHOOD around the task's symbols. */
function createEgoGraphTool(workspacePath: string, recordRetrieval?: RetrievalRecorder): AgentTool {
	return {
		name: "ego_graph",
		description:
			"Localize a task's code neighborhood (TypeScript/JavaScript): seed on the symbol names the task mentions and get the ranked k-hop neighborhood — declaration sites (file:line), the files that use them, and import neighbors — as a small read-target list. Escalation order: repo_map for orientation, ego_graph to LOCALIZE which files matter for a task, search_ast for exact per-file shape matches, search_code for text.",
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
						? "These are the task's neighborhood files, closest first (`hop` 0 = declares/uses a seed; `via` says why). read_files the hop-0/1 declaration lines with focused ranges; use search_ast for exact reference lines inside a file. Unmatched seeds may be misspelled, non-TS, or dynamic."
						: "No neighborhood found — the seeds may be misspelled, non-TS, or dynamic; fall back to search_code.",
			};
		},
	};
}

export function createNKleinRetrievalTools(options: {
	workspacePath: string;
	embeddingProvider?: NKleinCodeEmbeddingProvider;
	taskContext?: string;
	discriminateRetrieval?: RetrievalDiscriminator;
	/** Optional sink for §5.AC retrieval telemetry; omit (e.g. sandbox tool sets with no task identity) to skip recording. */
	recordRetrieval?: RetrievalRecorder;
}): AgentTool[] {
	return [
		createRepoMapTool(options.workspacePath),
		createCodeSearchTool(
			options.workspacePath,
			options.embeddingProvider,
			options.recordRetrieval,
			options.discriminateRetrieval,
			options.taskContext,
		),
		createAstSearchTool(options.workspacePath, options.recordRetrieval),
		createEgoGraphTool(options.workspacePath, options.recordRetrieval),
	];
}
