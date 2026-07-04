/**
 * §5.AL / §5.AP — decide whether a curated MCP server's tools should be OFFERED to a given model ("for models where it
 * fits"). Pure + deterministic over the §5.AL capability catalog; no I/O, no registry, no clock — the model's capability
 * facts are looked up by the caller (or passed in) and this only DECIDES.
 *
 * Why this exists (user 2026-07-01, "integrate MCP servers for models where it fits — avoid misuse"): today every
 * configured MCP server's tools are handed to EVERY agent unconditionally (see the session runtime's tool assembly),
 * which is the misuse the research flagged. Two concrete cases from the live-web research (recorded in
 * `docs/dev/integrations.md`):
 *
 *   • **sequential-thinking** (`@modelcontextprotocol/server-sequential-thinking`) — a structured reasoning scaffold. It
 *     HELPS models WITHOUT native extended reasoning that can still tool-call reliably, on non-trivial tasks; it is
 *     REDUNDANT/HARMFUL for native-reasoning models (o1/DeepSeek-R1-style → overthinking, self-verification + oscillation
 *     loops — 2025-26 arXiv) and LOOP-RISKY for weak tool-callers (`needsMoreThoughts`/`isRevision` can spiral). So its
 *     fit profile skips reasoning models and requires a model that can sustain a multi-step chain.
 *   • **codebase-memory** (DeusData `codebase-memory-mcp`) — a stateless code-graph query (`search_graph` etc.) that CUTS
 *     tokens ~99%. Low-risk and broadly useful; its profile only asks that the model can attempt a tool call.
 *
 * A profile is per-server and declarative, so a NEW MCP server is gated by adding a profile — the decision logic never
 * changes. The gate is deliberately conservative on the loop-risk axis (unknown capability + a loop-prone tool ⇒ skip),
 * and permissive on the low-risk axis (a cheap stateless query is offered even to an uncatalogued model).
 */

import { lookupModelCapability, type ModelCapabilityEntry, type ToolUseVerdict } from "./model-capability-catalog";

/**
 * A curated MCP server's model-fit profile — the declarative "who should be offered these tools" rule. Each field maps
 * to a §5.AL capability axis so the decision is a pure function of the catalog entry.
 */
export interface McpServerModelFitProfile {
	/** Stable server id, e.g. `"sequential-thinking"` / `"codebase-memory"` (for telemetry + matching a live server). */
	serverId: string;
	/**
	 * Minimum tool-use tier required to offer this server's tools. A model whose `toolUse` ranks below this is skipped
	 * (handing more tool schemas to a model that can't call them just burns context). `UNKNOWN` is handled separately by
	 * {@link allowUnknownToolUse}, not by this rank.
	 */
	minToolUse: ToolUseVerdict;
	/**
	 * Whether to OFFER when the model's tool-use is `UNKNOWN` (uncatalogued family, or a catalog entry with no verdict).
	 * `true` for low-risk stateless tools (offer optimistically — worst case the model ignores them); `false` for
	 * loop-prone tools where we only want a KNOWN-capable model (fail-safe: absence of evidence ⇒ skip).
	 */
	allowUnknownToolUse?: boolean;
	/**
	 * Skip for NATIVE-REASONING models (`kind === "reasoning"`). Set for reasoning-scaffold tools (sequential-thinking):
	 * a model that already thinks step-by-step gains nothing and tends to overthink/loop when handed an external scaffold.
	 */
	skipForReasoningModels?: boolean;
	/**
	 * Require the model can SUSTAIN a multi-step chain — skip when `chaining` is `"fails"` or `"single_only"`. Set for
	 * iterative tools (sequential-thinking) whose value depends on the model looping the tool without spiraling or stalling.
	 */
	requiresChaining?: boolean;
	/** One-line justification for operator visibility / telemetry. */
	rationale: string;
}

/** The decision: whether to offer the server's tools to this model, and a short human `reason`. */
export interface McpServerModelFitDecision {
	offer: boolean;
	/** Why — for operator visibility / telemetry. */
	reason: string;
}

/**
 * Rank of the CONCRETE tool-use verdicts (higher = more capable). `UNKNOWN` is intentionally absent — it is not a point
 * on this scale (it means "no evidence") and is decided by {@link McpServerModelFitProfile.allowUnknownToolUse} instead.
 */
const TOOL_USE_RANK: Record<Exclude<ToolUseVerdict, "UNKNOWN">, number> = {
	TOOL_UNSUITABLE: 0,
	TOOL_WEAK: 1,
	TOOL_CAPABLE: 2,
	TOOL_NATIVE: 3,
};

/** True when the model can't sustain a multi-step tool chain (one-shot or worse) — the loop/no-progress risk band. */
function cannotSustainChain(entry: ModelCapabilityEntry): boolean {
	return entry.chaining === "fails" || entry.chaining === "single_only";
}

/**
 * Decide whether to offer a curated MCP server's tools to a model, given the model's §5.AL capability entry (or `null`
 * when the family is uncatalogued). Pure; order of checks is significant — the disqualifiers (reasoning-harm, tool-use
 * floor, chain requirement) run before the accept so the `reason` names the FIRST failing axis.
 */
export function decideMcpServerModelFit(
	profile: McpServerModelFitProfile,
	entry: ModelCapabilityEntry | null,
): McpServerModelFitDecision {
	if (entry === null) {
		// Uncatalogued family: no capability evidence at all. Low-risk servers still get offered; loop-prone ones don't.
		return profile.allowUnknownToolUse === true
			? { offer: true, reason: `uncatalogued model — offered (${profile.serverId}: low-risk, offer optimistically)` }
			: { offer: false, reason: `uncatalogued model — skipped (${profile.serverId} needs a known-capable model)` };
	}

	if (profile.skipForReasoningModels === true && entry.kind === "reasoning") {
		return {
			offer: false,
			reason: `native-reasoning model (${entry.family}) — reasoning scaffold is redundant/loop-prone; skipped`,
		};
	}

	if (entry.toolUse === "UNKNOWN") {
		if (profile.allowUnknownToolUse !== true) {
			return {
				offer: false,
				reason: `tool-use UNKNOWN for ${entry.family} — ${profile.serverId} needs a known verdict`,
			};
		}
	} else if (
		TOOL_USE_RANK[entry.toolUse] <
		TOOL_USE_RANK[profile.minToolUse === "UNKNOWN" ? "TOOL_UNSUITABLE" : profile.minToolUse]
	) {
		return {
			offer: false,
			reason: `tool-use ${entry.toolUse} (${entry.family}) below required ${profile.minToolUse}; skipped`,
		};
	}

	if (profile.requiresChaining === true && cannotSustainChain(entry)) {
		return {
			offer: false,
			reason: `chaining "${entry.chaining}" (${entry.family}) — loop/no-progress risk for ${profile.serverId}; skipped`,
		};
	}

	return { offer: true, reason: `fits (${entry.family}: kind=${entry.kind}, toolUse=${entry.toolUse})` };
}

/**
 * Convenience: resolve the model's §5.AL entry from its id and decide. Thin wrapper over {@link decideMcpServerModelFit}
 * + {@link lookupModelCapability} so a caller with only a model id doesn't repeat the lookup. Still pure (the catalog is
 * a static, checked-in artifact).
 */
export function decideMcpServerModelFitById(
	profile: McpServerModelFitProfile,
	modelId: string,
): McpServerModelFitDecision {
	return decideMcpServerModelFit(profile, lookupModelCapability(modelId));
}

/**
 * Curated fit profile for **sequential-thinking** — the textbook "for models where it fits" case. Offered ONLY to
 * non-reasoning, tool-capable models that can sustain a chain; skipped for native reasoners (redundant/overthinking) and
 * weak/one-shot callers (loop risk). Uncatalogued models are skipped (fail-safe: the loop risk outweighs the upside).
 */
export const SEQUENTIAL_THINKING_FIT: McpServerModelFitProfile = {
	serverId: "sequential-thinking",
	minToolUse: "TOOL_CAPABLE",
	allowUnknownToolUse: false,
	skipForReasoningModels: true,
	requiresChaining: true,
	rationale:
		"Structured reasoning scaffold: helps non-reasoning, tool-reliable models on non-trivial tasks; redundant/harmful " +
		"for native reasoners (overthinking + oscillation loops) and loop-risky for weak/one-shot tool callers.",
};

/**
 * Curated fit profile for **codebase-memory** (`codebase-memory-mcp`) — a stateless code-graph query that cuts tokens
 * ~99%. Low-risk and broadly useful, so it is offered to anything that can attempt a tool call, INCLUDING uncatalogued
 * models (offer optimistically); only genuinely tool-unsuitable models are skipped.
 */
export const CODEBASE_MEMORY_FIT: McpServerModelFitProfile = {
	serverId: "codebase-memory",
	minToolUse: "TOOL_WEAK",
	allowUnknownToolUse: true,
	skipForReasoningModels: false,
	requiresChaining: false,
	rationale:
		"Stateless code-graph query (search_graph/trace_path/get_code_snippet) that reduces tokens ~99%; helps any " +
		"tool-capable model with no reasoning-harm, so it is offered broadly (uncatalogued models included).",
};

/**
 * Curated fit profile for **basic-memory** (§5.AR authored markdown-graph memory) — a WRITE-capable, multi-tool surface
 * (write_note/read_note/search_notes/build_context/…). Unlike codebase-memory (a read-only token-cutter offered broadly),
 * a weak/one-shot caller that mis-drives a write tool can accrete GARBAGE into a durable store, so it is offered only to
 * TOOL_CAPABLE+ models and NOT to uncatalogued ones (fail-safe: a memory tool that loops or writes junk is worse than
 * none). Not reasoning-harmful, so native reasoners are fine; it does not require multi-step chaining.
 */
export const BASIC_MEMORY_FIT: McpServerModelFitProfile = {
	serverId: "basic-memory",
	minToolUse: "TOOL_CAPABLE",
	allowUnknownToolUse: false,
	skipForReasoningModels: false,
	requiresChaining: false,
	rationale:
		"Write-capable authored-memory tool (write_note/read_note/search_notes/build_context): offered to tool-reliable " +
		"mid+ models only (weak/one-shot callers can accrete junk into a durable store), uncatalogued skipped (fail-safe).",
};
