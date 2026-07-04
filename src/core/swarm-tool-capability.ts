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

import type { TaintLabel } from "./taint-labels";
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

/**
 * The per-tool STATIC capability manifest for a swarm tool by name, or `null` when the tool has no declared manifest
 * (the broker then leaves that call ungated — fail-open only for UNKNOWN tools, which the SDK tool-policy map anyway
 * gates by enablement). Base kanban file tools resolve via {@link manifestForKanbanTool}; the egress extras map to the
 * `egress_read` manifest.
 */
export function swarmToolManifest(toolName: string): ToolCapabilityManifest | null {
	const kanban = manifestForKanbanTool(toolName);
	if (kanban) {
		return kanban;
	}
	if (EGRESS_TOOL_NAMES.has(toolName)) {
		return EGRESS_READ_MANIFEST;
	}
	return null;
}

/**
 * The taint a swarm tool's OUTPUT carries into the turn's trust window. `web_search` / `browse_url` return untrusted
 * external web content → `["web"]`; every local/read tool returns trusted output → `[]`.
 */
export function swarmToolOutputTaint(toolName: string): readonly TaintLabel[] {
	return EGRESS_TOOL_NAMES.has(toolName) ? ["web"] : [];
}
