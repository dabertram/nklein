import type { ToolUseVerdict } from "./model-capability-catalog.js";

/**
 * LLM-based ONLINE capability lookup for UNKNOWN models (todo §5.AL). When the catalog has no verdict for a model —
 * especially when it's the only one loaded — !Klein can use THAT SAME model (given a web/browser tool) to research its
 * own tool-use / function-calling capability online and report a structured verdict, which becomes user advice + a
 * provisional catalog entry to confirm. The lookup itself is also diagnostic: a model that can't even drive a simple
 * web-research tool flow to produce a usable verdict is, by that very failure, suspect for agentic tool use.
 *
 * This module is the PURE core (prompt construction + response parsing) — effect-free and unit-tested. The effectful
 * wiring (driving the chat agent with browser tools, the "check model" button, the opt-in automatic-lookup setting) is
 * layered on top; both reuse the {@link ToolUseVerdict} vocabulary so a confirmed result drops straight into the catalog.
 */

/** The catalog verdict buckets the model is asked to choose from (kept in lockstep with {@link ToolUseVerdict}). */
const VERDICT_VALUES: readonly ToolUseVerdict[] = [
	"TOOL_NATIVE",
	"TOOL_CAPABLE",
	"TOOL_WEAK",
	"TOOL_UNSUITABLE",
	"UNKNOWN",
];

/**
 * Build the instruction that asks a model to research its OWN tool-use capability online and report a structured
 * verdict. The model is told to use its web/search tool, to weigh the model card + community reports, and to answer
 * with a single JSON object `{ toolUse, summary, sources }` — the shape {@link parseModelInvestigationResult} reads.
 */
export function buildModelInvestigationPrompt(modelId: string): string {
	return [
		`You are investigating the local LLM "${modelId}" to decide whether it is suitable for AGENTIC TOOL USE`,
		"(function calling / multi-step tool chains), the way an autonomous coding agent needs.",
		"",
		"Use your web/search/browser tool to find authoritative evidence: the model card (e.g. on Hugging Face),",
		"the vendor's docs, and community/user reports about its tool-calling reliability (especially multi-tool chains).",
		"",
		"Then reply with EXACTLY ONE JSON object and nothing else, in this shape:",
		'{"toolUse": "<verdict>", "summary": "<one or two sentences>", "sources": ["<url>", ...]}',
		"",
		`where <verdict> is one of: ${VERDICT_VALUES.join(" | ")}.`,
		"- TOOL_NATIVE: explicitly trained for tool/function calling, reliable at its size.",
		"- TOOL_CAPABLE: tool calling works but isn't a headline feature / needs a matched parser.",
		"- TOOL_WEAK: community/empirical reports of unreliable tool use (leaks calls into text, breaks on multi-tool).",
		"- TOOL_UNSUITABLE: not trained for tool use (reasoning-/chat-only) or ships it broken — avoid for tool chains.",
		"- UNKNOWN: you could not find reliable evidence either way.",
		"Cite the URLs you actually used in `sources`. Do not invent sources. Be honest about uncertainty (UNKNOWN).",
	].join("\n");
}

/** The outcome of an online investigation — best-effort parsed from the model's free-text reply. */
export interface ModelInvestigationResult {
	/** False when no usable verdict could be parsed (the model didn't/couldn't produce one — itself a soft signal). */
	succeeded: boolean;
	/** The parsed verdict, or `UNKNOWN` when none was usable. */
	toolUse: ToolUseVerdict;
	/** The model's one-line justification (trimmed; empty when absent). */
	summary: string;
	/** Source URLs the model cited (deduped; `http(s)` only — fabricated/relative entries are dropped). */
	sources: string[];
}

/** A failed/empty investigation result with the given reason as the summary (used for the can't-parse / no-output cases). */
function failedResult(summary: string): ModelInvestigationResult {
	return { succeeded: false, toolUse: "UNKNOWN", summary, sources: [] };
}

/**
 * Parse a model's investigation reply into a {@link ModelInvestigationResult}. Tolerant of surrounding prose and
 * markdown fences: it scans for the LAST balanced `{…}` object that carries a recognizable `toolUse` and reads
 * `toolUse` / `summary` / `sources` from it. A reply with no valid verdict → `succeeded: false` (the lookup failed,
 * which the caller may treat as evidence the model is a poor agentic fit).
 */
export function parseModelInvestigationResult(text: string): ModelInvestigationResult {
	const trimmed = (text ?? "").trim();
	if (trimmed.length === 0) {
		return failedResult("The model produced no output for the capability investigation.");
	}
	// Prefer the LAST parseable object that has a verdict (models often think aloud, then answer with the JSON last).
	let chosen: { toolUse?: unknown; summary?: unknown; sources?: unknown } | null = null;
	for (const candidate of extractJsonObjects(trimmed)) {
		const verdict = normalizeVerdict(candidate.toolUse);
		if (verdict) {
			chosen = candidate;
		}
	}
	if (!chosen) {
		return failedResult("Could not parse a tool-use verdict from the model's reply.");
	}
	const toolUse = normalizeVerdict(chosen.toolUse) ?? "UNKNOWN";
	return {
		succeeded: true,
		toolUse,
		summary: typeof chosen.summary === "string" ? chosen.summary.trim() : "",
		sources: normalizeSources(chosen.sources),
	};
}

/** Map a raw `toolUse` value (case-insensitive, trimmed) to a {@link ToolUseVerdict}, or null when unrecognized. */
function normalizeVerdict(value: unknown): ToolUseVerdict | null {
	if (typeof value !== "string") {
		return null;
	}
	const upper = value.trim().toUpperCase();
	return VERDICT_VALUES.find((verdict) => verdict === upper) ?? null;
}

/** Keep only well-formed http(s) source URLs, deduped, preserving order. */
function normalizeSources(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const seen = new Set<string>();
	const out: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") {
			continue;
		}
		const url = entry.trim();
		if (/^https?:\/\/\S+$/.test(url) && !seen.has(url)) {
			seen.add(url);
			out.push(url);
		}
	}
	return out;
}

/** Extract every balanced top-level `{…}` block from text and JSON-parse the ones that parse to plain objects. */
function extractJsonObjects(text: string): { toolUse?: unknown; summary?: unknown; sources?: unknown }[] {
	const objects: { toolUse?: unknown; summary?: unknown; sources?: unknown }[] = [];
	let depth = 0;
	let start = -1;
	let inString = false;
	let escaped = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
		} else if (ch === "{") {
			if (depth === 0) {
				start = i;
			}
			depth++;
		} else if (ch === "}") {
			if (depth > 0) {
				depth--;
				if (depth === 0 && start >= 0) {
					const slice = text.slice(start, i + 1);
					try {
						const parsed = JSON.parse(slice);
						if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
							objects.push(parsed);
						}
					} catch {
						// Not valid JSON — skip this block.
					}
					start = -1;
				}
			}
		}
	}
	return objects;
}
