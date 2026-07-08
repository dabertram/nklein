/**
 * §5.B — MCP-backed {@link LocalizationProvider}, pure over an INJECTED mcp-tool-caller.
 *
 * Implements the read-only fault-localization port ({@link LocalizationProvider}) by calling `codebase-memory-mcp`'s
 * query tools (evaluated → ADOPT, MIT, 100% local — see `docs/dev/integrations.md`). The adapter takes a `callMcpTool`
 * function rather than owning a client/binary, so it is fully unit-testable with a fake and drops onto a real MCP client
 * (or the CLI shim) later with no change here. It NEVER touches the network/filesystem itself — the only side effect is
 * the injected call — so the runtime path stays local (prime-directive #1).
 *
 * Backing tool (`search_graph`) — documented on the upstream repo (README; the exact JSON *result* envelope is NOT
 * formally specified there, so this adapter is deliberately defensive: it tolerates several plausible shapes and skips
 * anything it can't read rather than throwing). Assumed contract, from the README + CLI example
 * `search_graph '{"name_pattern": ".*Handler.*", "label": "Function"}'`:
 *
 *   INPUT  : { name_pattern: string; label?: string; file_pattern?: string; project?: string; limit?: number;
 *              offset?: number }
 *   RESULT : an array of nodes, either bare (`[…]`), wrapped (`{ results: […] }` / `{ nodes: […] }`), or returned
 *            through the standard MCP `content: [{ type: "text", text: "{...json...}" }]` envelope; each node
 *            (best-effort, any subset present):
 *              { name?: string; label?: string; qualified_name?: string; file?: string; file_path?: string;
 *                start_line?: number; end_line?: number; score?: number }
 *
 * Result field → {@link LocalizationHit}:
 *   file          → file            (required; a node with no resolvable file path is skipped)
 *   name          → symbol          (falls back to the last segment of `qualified_name`)
 *   start_line    → startLine       (1-based, passed through only when a positive integer)
 *   end_line      → endLine         (only when a positive integer ≥ startLine)
 *   score         → score           (only when a finite number)
 *   label + name  → reason          (synthesized: e.g. "Function match from search_graph")
 */

import type { LocalizationHit, LocalizationProvider, LocalizationQuery } from "./localization-provider";

/**
 * The injected MCP tool caller. `toolName` is the MCP tool (e.g. `"search_graph"`), `args` its JSON arguments; the
 * result is `unknown` — this adapter narrows it defensively. A real implementation forwards to an MCP client's
 * `callTool`; tests pass a fake. Kept intentionally minimal so it's trivial to satisfy from any transport.
 */
export type McpToolCaller = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

/** The `codebase-memory-mcp` tool the localization query maps onto. */
export const SEARCH_GRAPH_TOOL = "search_graph";

/** Narrow an unknown to a plain object (record) without asserting field types. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** A finite number, or `undefined`. Rejects `NaN`, `±Infinity`, and non-numbers. */
function asFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A positive 1-based line number (integer ≥ 1), or `undefined`. */
function asLine(value: unknown): number | undefined {
	const n = asFiniteNumber(value);
	return n !== undefined && Number.isInteger(n) && n >= 1 ? n : undefined;
}

/** A non-empty trimmed string, or `undefined`. */
function asNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function parseJsonObject(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

function extractNodeArray(result: unknown): readonly unknown[] | undefined {
	if (Array.isArray(result)) {
		return result;
	}
	const record = asRecord(result);
	if (record === undefined) {
		return undefined;
	}
	for (const key of ["results", "nodes", "data", "hits"] as const) {
		const candidate = record[key];
		if (Array.isArray(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

/**
 * Extract the node array from a `search_graph` result, tolerating the undocumented envelope: a bare array, a wrapper
 * object under a `results` / `nodes` / `data` key, a structured-content wrapper, or the standard MCP text-content
 * envelope returned by the real SDK client. Anything else → `[]` (never throws).
 */
function extractNodes(result: unknown): readonly unknown[] {
	const direct = extractNodeArray(result);
	if (direct !== undefined) {
		return direct;
	}

	const record = asRecord(result);
	if (record === undefined) {
		return [];
	}

	const structured = extractNodeArray(record.structuredContent);
	if (structured !== undefined) {
		return structured;
	}

	const content = record.content;
	if (Array.isArray(content)) {
		for (const part of content) {
			const text = asNonEmptyString(asRecord(part)?.text);
			if (text === undefined) {
				continue;
			}
			const parsed = parseJsonObject(text);
			const parsedNodes = extractNodeArray(parsed);
			if (parsedNodes !== undefined) {
				return parsedNodes;
			}
		}
	}

	return [];
}

/** The last dotted segment of a qualified name (`proj.pkg.Class.method` → `method`), or `undefined`. */
function symbolFromQualifiedName(qualifiedName: string | undefined): string | undefined {
	if (qualifiedName === undefined) {
		return undefined;
	}
	const parts = qualifiedName.split(".");
	return asNonEmptyString(parts[parts.length - 1]);
}

/** Build the short human `reason` from a node's label/symbol. */
function buildReason(label: string | undefined, symbol: string | undefined): string {
	const kind = label ?? "symbol";
	return symbol !== undefined
		? `${kind} \`${symbol}\` from ${SEARCH_GRAPH_TOOL}`
		: `${kind} match from ${SEARCH_GRAPH_TOOL}`;
}

/**
 * Map a single (unknown-shaped) `search_graph` node into a {@link LocalizationHit}. Returns `undefined` when the node
 * has no resolvable file path — a hit without a file is meaningless to the kernel, so it is skipped rather than emitted.
 */
function nodeToHit(node: unknown): LocalizationHit | undefined {
	const record = asRecord(node);
	if (record === undefined) {
		return undefined;
	}

	const file = asNonEmptyString(record.file) ?? asNonEmptyString(record.file_path) ?? asNonEmptyString(record.path);
	if (file === undefined) {
		return undefined; // no location → skip
	}

	const qualifiedName = asNonEmptyString(record.qualified_name);
	const symbol = asNonEmptyString(record.name) ?? symbolFromQualifiedName(qualifiedName);
	const label = asNonEmptyString(record.label);

	const startLine = asLine(record.start_line);
	const endLineRaw = asLine(record.end_line);
	// Only keep an end line that is consistent with the start (≥ startLine); otherwise drop it.
	const endLine =
		startLine !== undefined && endLineRaw !== undefined && endLineRaw >= startLine ? endLineRaw : undefined;

	const hit: LocalizationHit = { file, reason: buildReason(label, symbol) };
	if (symbol !== undefined) {
		hit.symbol = symbol;
	}
	if (startLine !== undefined) {
		hit.startLine = startLine;
	}
	if (endLine !== undefined) {
		hit.endLine = endLine;
	}
	const score = asFiniteNumber(record.score);
	if (score !== undefined) {
		hit.score = score;
	}
	return hit;
}

/** Options for {@link createMcpLocalizationProvider}. */
export interface McpLocalizationProviderOptions {
	/** Restrict the `search_graph` query to a single indexed project, when the caller knows it. */
	project?: string;
	/**
	 * Node label to filter on (`"Function"`, `"Class"`, …). Left unset by default so localization sees all symbol kinds;
	 * set it when a caller wants to narrow (e.g. functions only).
	 */
	label?: string;
	/** Scope the search to files matching this pattern (maps to `file_pattern`). */
	filePattern?: string;
}

/**
 * Create a {@link LocalizationProvider} backed by `codebase-memory-mcp`'s `search_graph`, over the injected
 * {@link McpToolCaller}. Pure with respect to the caller: it builds the tool args, invokes `callMcpTool`, and maps the
 * (defensively narrowed) result into ranked-agnostic hits. Errors from the tool are swallowed into `[]` so a flaky/
 * missing backing never breaks the kernel's `localize` step — localization is best-effort by contract.
 *
 * @param callMcpTool injected MCP tool caller (fake in tests, a real client later)
 * @param options optional query scoping (project / label / file pattern)
 */
export function createMcpLocalizationProvider(
	callMcpTool: McpToolCaller,
	options: McpLocalizationProviderOptions = {},
): LocalizationProvider {
	return {
		async localize(query: LocalizationQuery): Promise<readonly LocalizationHit[]> {
			const namePattern = query.query;
			if (asNonEmptyString(namePattern) === undefined) {
				return []; // nothing to localize from
			}

			const args: Record<string, unknown> = { name_pattern: namePattern };
			if (typeof query.maxHits === "number" && Number.isInteger(query.maxHits) && query.maxHits > 0) {
				args.limit = query.maxHits;
			}
			if (options.label !== undefined) {
				args.label = options.label;
			}
			if (options.filePattern !== undefined) {
				args.file_pattern = options.filePattern;
			}
			if (options.project !== undefined) {
				args.project = options.project;
			}

			let result: unknown;
			try {
				result = await callMcpTool(SEARCH_GRAPH_TOOL, args);
			} catch {
				return []; // best-effort: a tool/transport failure yields no hits, never throws
			}

			const hits: LocalizationHit[] = [];
			for (const node of extractNodes(result)) {
				const hit = nodeToHit(node);
				if (hit !== undefined) {
					hits.push(hit);
				}
			}
			// Respect the requested cap even if the tool ignored `limit` (defensive; the tool *should* honor it).
			if (typeof query.maxHits === "number" && query.maxHits > 0 && hits.length > query.maxHits) {
				return hits.slice(0, query.maxHits);
			}
			return hits;
		},
	};
}
