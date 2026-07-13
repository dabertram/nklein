import { describe, expect, it } from "vitest";
import type { ChatActionDecision, ChatActionKind, ChatExecutionMode } from "../../../src/chat/chat-execution-mode";
import {
	AGENT_CAPABILITY_TIERS,
	AGENT_DELIVERY_TIERS,
	capabilitiesForTier,
	DEFAULT_AGENT_CAPABILITY_TIER,
	DEFAULT_AGENT_DELIVERY_TIER,
	deliveryPolicyForTier,
} from "../../../src/core/agent-rulesets";
import { swarmToolManifest } from "../../../src/core/swarm-tool-capability";
import {
	decideManifestChatAccess,
	KANBAN_TOOL_MANIFESTS,
	manifestForChatAction,
	manifestForKanbanTool,
} from "../../../src/core/tool-capability-manifest";

/**
 * F1.22 — the manifest behavior PARITY LOCK (after F1.20/F1.21): every mode×action decision cell, the approval
 * paths, the local-only restrictions, the current ruleset tier tables, and the unknown-tool posture are pinned as
 * GOLDEN values. The existing characterization tests prove the manifest gate EQUALS the legacy gate (a moving
 * target); this file pins the actual decisions, so ANY future change to either side is a visible, reviewed diff —
 * never a silent drift.
 */

const MODES: readonly ChatExecutionMode[] = ["isolated_readonly", "sandbox_with_host_escape", "host"];
const ACTIONS: readonly ChatActionKind[] = [
	"sandbox_read",
	"sandbox_write",
	"control_plane",
	"egress_read",
	"host_read",
	"host_write",
	"host_command",
];

describe("F1.22 manifest parity lock", () => {
	it("GOLDEN: the full mode × action decision matrix", () => {
		const matrix: Record<string, ChatActionDecision> = {};
		for (const mode of MODES) {
			for (const action of ACTIONS) {
				matrix[`${mode}/${action}`] = decideManifestChatAccess(manifestForChatAction(action), mode).decision;
			}
		}
		expect(matrix).toEqual({
			// (a) isolated_readonly — Docker-isolated READ-ONLY: reads free; sandbox writes CONFIRM (opt-in to the
			// user-mounted folders); control-plane mutations DENIED (a read-only mode may not move the board);
			// nothing host, no egress.
			"isolated_readonly/sandbox_read": "allow",
			"isolated_readonly/sandbox_write": "confirm",
			"isolated_readonly/control_plane": "deny",
			"isolated_readonly/egress_read": "deny",
			"isolated_readonly/host_read": "deny",
			"isolated_readonly/host_write": "deny",
			"isolated_readonly/host_command": "deny",
			// (b) sandbox_with_host_escape — host actions exist but EVERY one is a confirmed escape hatch.
			"sandbox_with_host_escape/sandbox_read": "allow",
			// A sandbox write inside a can-act mode is free — the sandbox is the blast-radius boundary.
			"sandbox_with_host_escape/sandbox_write": "allow",
			"sandbox_with_host_escape/control_plane": "allow",
			"sandbox_with_host_escape/egress_read": "confirm",
			"sandbox_with_host_escape/host_read": "confirm",
			"sandbox_with_host_escape/host_write": "confirm",
			"sandbox_with_host_escape/host_command": "confirm",
			// (c) host — the whole session is on the host (typed phrase), mutations still per-action confirmed.
			"host/sandbox_read": "allow",
			"host/sandbox_write": "allow",
			"host/control_plane": "allow",
			"host/egress_read": "confirm",
			"host/host_read": "allow",
			"host/host_write": "confirm",
			"host/host_command": "confirm",
		});
	});

	it("GOLDEN: approval paths — no host mutation or egress is ever auto; declared approvals are pinned", () => {
		const approvals: Record<string, string> = {};
		for (const action of ACTIONS) {
			approvals[action] = manifestForChatAction(action).approval;
		}
		expect(approvals).toEqual({
			sandbox_read: "auto",
			sandbox_write: "confirm",
			control_plane: "auto",
			egress_read: "confirm",
			host_read: "confirm",
			host_write: "confirm",
			host_command: "confirm",
		});
		for (const [name, manifest] of Object.entries(KANBAN_TOOL_MANIFESTS)) {
			expect(manifest.approval, name).toBe(manifest.mutationLevel === "read" ? "auto" : "confirm");
		}
	});

	it("GOLDEN: local-only restrictions — every kanban tool is workspace-scoped and network-free", () => {
		for (const [name, manifest] of Object.entries(KANBAN_TOOL_MANIFESTS)) {
			expect(manifest.networkLevel, name).toBe("none");
			expect(manifest.fsScope, name).toBe("workspace");
		}
		// The only egress the swarm can ever see is the READ tier (browse/search) — never exfiltration-capable.
		for (const toolName of ["web_search", "browse_url", "fetch_web_content"]) {
			expect(swarmToolManifest(toolName)?.networkLevel, toolName).toBe("egress_read");
		}
	});

	it("GOLDEN: unknown-tool posture — no manifest is invented; the enablement policy layer owns unknowns", () => {
		expect(manifestForKanbanTool("totally_unknown_tool")).toBeNull();
		expect(swarmToolManifest("totally_unknown_tool")).toBeNull();
		// An MCP-declared name is NOT unknown (F1.21 closed that hole).
		expect(
			swarmToolManifest("totally_unknown_tool", { mcpToolNames: new Set(["totally_unknown_tool"]) }),
		).not.toBeNull();
	});

	it("GOLDEN: the current ruleset tier tables (capability + delivery) and their defaults", () => {
		expect(DEFAULT_AGENT_CAPABILITY_TIER).toBe("fully_open");
		expect(DEFAULT_AGENT_DELIVERY_TIER).toBe("fully_open");
		const capabilityTable = Object.fromEntries(
			AGENT_CAPABILITY_TIERS.map((tier) => [tier, capabilitiesForTier(tier)]),
		);
		const deliveryTable = Object.fromEntries(AGENT_DELIVERY_TIERS.map((tier) => [tier, deliveryPolicyForTier(tier)]));
		expect({ capabilityTable, deliveryTable }).toMatchSnapshot();
	});
});
