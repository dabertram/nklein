/**
 * Swarm-tool capability lookup (§5.L decision-4) — the PER-TOOL STATIC manifest + output-taint for the autonomous
 * (Docker-isolated) swarm tool set, so the capability broker can gate the swarm path with the SAME
 * {@link decideCapabilityBrokerGate} the chat path uses. Pure + total.
 *
 * The swarm's tools are the workspace-scoped kanban file tools (declared in {@link KANBAN_TOOL_MANIFESTS}) plus the
 * egress-gated retrieval extras (`web_search` / `browse_url`), which are read-only network fetches → the `egress_read`
 * manifest (egress-gated, but NOT a protected taint sink, so repeated retrieval doesn't self-block).
 *
 * NOTE (honest scope): because the swarm is Docker-isolated (invariant #2 — no host access) and its egress is
 * read-only, NO swarm tool currently touches a broker-protected influence sink (host write/exec, egress exfiltration,
 * or an elevated approval). So the broker's taint-influence gate is structurally INERT on today's swarm — the wiring
 * is preventive (it goes live the moment a protected-sink swarm tool is ever added) and makes the broker uniform
 * across chat + swarm for the default-on flip. The `web` taint still accumulates so that future gate is correct.
 */

import { labelsForSourceContent } from "./taint-content-scan";
import { labelsForSource, propagateTaint, type TaintLabel, type TaintSourceKind } from "./taint-labels";
import { manifestForKanbanTool, type ToolCapabilityManifest } from "./tool-capability-manifest";

/** The read-only egress fetch manifest shared by the swarm's `web_search` / `browse_url` retrieval extras. */
const EGRESS_READ_MANIFEST: ToolCapabilityManifest = {
	mutationLevel: "read",
	networkLevel: "egress_read",
	fsScope: "workspace",
	approval: "confirm",
	replayable: true,
};

/** The retrieval extras the swarm binds per session when egress is enabled — read-only network fetches. */
const EGRESS_TOOL_NAMES = new Set(["web_search", "browse_url"]);

/** SDK default-tool aliases / !Klein retrieval extras that are read-only repo admit points. */
const REPO_READ_TOOL_NAMES = new Set(["repo_map", "search_code", "search_codebase", "read_files", "read_large_file"]);

/** SDK/default-tool names that are sandbox-scoped mutations in the autonomous task path. */
const SANDBOX_WRITE_TOOL_NAMES = new Set([
	"run_commands",
	"edit_file",
	"editor",
	"apply_patch",
	"write_file",
	"write_files",
]);

/** SDK web-fetch alias; sandboxed tasks disable it, but the manifest stays egress-read if ever routed. */
const WEB_FETCH_TOOL_NAMES = new Set(["fetch_web_content"]);

const REPO_READ_MANIFEST: ToolCapabilityManifest = {
	mutationLevel: "read",
	networkLevel: "none",
	fsScope: "workspace",
	approval: "auto",
	replayable: true,
};

const SANDBOX_WRITE_MANIFEST: ToolCapabilityManifest = {
	mutationLevel: "sandbox_write",
	networkLevel: "none",
	fsScope: "workspace",
	approval: "confirm",
	replayable: false,
};

export interface SwarmToolOutputTaintOptions {
	/** Exact tool names produced from the MCP bundle for this SDK session. */
	mcpToolNames?: ReadonlySet<string> | readonly string[];
}

/**
 * The per-tool STATIC capability manifest for a swarm tool by name, or `null` when the tool has no declared manifest
 * (the broker then leaves that call ungated — fail-open only for UNKNOWN tools, which the SDK tool-policy map anyway
 * gates by enablement). Base kanban file tools resolve via {@link manifestForKanbanTool}; the egress extras map to the
 * `egress_read` manifest.
 */
/**
 * F1.21: the conservative manifest for an MCP-bundle tool — an MCP server's output is attacker-authorable
 * (untrusted_content SOURCE, like a web fetch) and its transport reaches out (egress-read tier), but it is NOT a
 * protected sink (marking it one would self-block multi-MCP turns exactly like the §5.L multi-browse case); the
 * protected sinks it might steer (writes/host/delivery) are guarded by the taint rule downstream.
 */
const MCP_TOOL_MANIFEST: ToolCapabilityManifest = {
	mutationLevel: "read",
	networkLevel: "egress_read",
	fsScope: "workspace",
	approval: "confirm",
	replayable: false,
	taintSource: "untrusted_content",
	cost: "expensive",
};

export function swarmToolManifest(
	toolName: string,
	options: SwarmToolOutputTaintOptions = {},
): ToolCapabilityManifest | null {
	// F1.21: MCP tools were the gate's fail-open hole (unknown name → null → ungated). They now resolve to the
	// conservative MCP manifest, so the broker sees every MCP call.
	if (mcpToolNamesInclude(options.mcpToolNames, toolName)) {
		return MCP_TOOL_MANIFEST;
	}

	const kanban = manifestForKanbanTool(toolName);
	if (kanban) {
		return kanban;
	}
	if (REPO_READ_TOOL_NAMES.has(toolName)) {
		return REPO_READ_MANIFEST;
	}
	if (EGRESS_TOOL_NAMES.has(toolName)) {
		return EGRESS_READ_MANIFEST;
	}
	if (WEB_FETCH_TOOL_NAMES.has(toolName)) {
		return EGRESS_READ_MANIFEST;
	}
	if (SANDBOX_WRITE_TOOL_NAMES.has(toolName)) {
		return SANDBOX_WRITE_MANIFEST;
	}
	return null;
}

/**
 * The taint a swarm tool's OUTPUT carries into the turn's trust window. Repository, web, and MCP outputs are admitted
 * content rather than operator-authored policy, so they carry source provenance and are scanned for credential-shaped
 * text when an output value is supplied.
 */
export function swarmToolOutputTaint(
	toolName: string,
	output?: unknown,
	options: SwarmToolOutputTaintOptions = {},
): readonly TaintLabel[] {
	const sourceKinds = sourceKindsForSwarmTool(toolName, options);
	let labels: readonly TaintLabel[] = [];
	for (const kind of sourceKinds) {
		const sourceLabels =
			output === undefined ? labelsForSource(kind) : labelsForSourceContent(kind, renderToolOutputForTaint(output));
		labels = propagateTaint(labels, sourceLabels);
	}
	return labels;
}

function sourceKindsForSwarmTool(toolName: string, options: SwarmToolOutputTaintOptions): TaintSourceKind[] {
	const kinds: TaintSourceKind[] = [];
	if (mcpToolNamesInclude(options.mcpToolNames, toolName)) {
		kinds.push("mcp");
	}
	if (EGRESS_TOOL_NAMES.has(toolName) || WEB_FETCH_TOOL_NAMES.has(toolName)) {
		kinds.push("web");
	}
	if (REPO_READ_TOOL_NAMES.has(toolName)) {
		kinds.push("repo");
	}
	return kinds;
}

function mcpToolNamesInclude(names: SwarmToolOutputTaintOptions["mcpToolNames"], toolName: string): boolean {
	if (!names) {
		return false;
	}
	return "has" in names ? names.has(toolName) : names.includes(toolName);
}

function renderToolOutputForTaint(output: unknown): string {
	if (typeof output === "string") {
		return output;
	}
	try {
		const rendered = JSON.stringify(output);
		return rendered ?? String(output);
	} catch {
		return String(output);
	}
}
