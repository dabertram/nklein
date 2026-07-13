import { describe, expect, it } from "vitest";
import {
	type ChatActionKind,
	type ChatExecutionMode,
	decideChatActionAccess,
} from "../../../src/chat/chat-execution-mode";
import { decideCapabilityBrokerGate } from "../../../src/core/capability-broker-gate";
import { swarmToolManifest } from "../../../src/core/swarm-tool-capability";
import {
	auditDetailForManifest,
	DELIVERY_ACTION_MANIFEST,
	decideManifestChatAccess,
	KANBAN_TOOL_MANIFESTS,
	manifestCost,
	manifestForChatAction,
	manifestForKanbanTool,
	manifestIdempotent,
	manifestReplayPolicy,
	manifestTaintSource,
	type ToolCapabilityManifest,
	toolPoliciesFromManifests,
} from "../../../src/core/tool-capability-manifest";
import { createKanbanToolPolicies } from "../../../src/nklein-agent/nklein-runtime-setup";

const ACTIONS: ChatActionKind[] = [
	"sandbox_read",
	"sandbox_write",
	"control_plane",
	"egress_read",
	"host_read",
	"host_write",
	"host_command",
];
const MODES: ChatExecutionMode[] = ["isolated_readonly", "sandbox_with_host_escape", "host"];

describe("tool-capability-manifest — chat-gate characterization", () => {
	it("the manifest gate reproduces decideChatActionAccess for EVERY (mode × action)", () => {
		for (const mode of MODES) {
			for (const action of ACTIONS) {
				const expected = decideChatActionAccess(mode, action).decision;
				const viaManifest = decideManifestChatAccess(manifestForChatAction(action), mode).decision;
				expect(viaManifest, `${mode} × ${action}`).toBe(expected);
			}
		}
	});

	it("each action maps to a sensible manifest (host scope, mutation level, replayability)", () => {
		expect(manifestForChatAction("sandbox_read")).toMatchObject({
			mutationLevel: "read",
			fsScope: "workspace",
			replayable: true,
		});
		expect(manifestForChatAction("control_plane")).toMatchObject({
			mutationLevel: "control_plane",
			fsScope: "workspace",
		});
		expect(manifestForChatAction("host_read")).toMatchObject({
			mutationLevel: "read",
			fsScope: "host",
			replayable: true,
		});
		expect(manifestForChatAction("host_write")).toMatchObject({
			mutationLevel: "host_write",
			fsScope: "host",
			replayable: false,
		});
		// host_command is a host mutation — same manifest as host_write (decision-equivalent).
		expect(manifestForChatAction("host_command")).toEqual(manifestForChatAction("host_write"));
	});

	it("denies host access in the most-isolated mode and never auto-runs a host mutation", () => {
		const hostWrite: ToolCapabilityManifest = manifestForChatAction("host_write");
		expect(decideManifestChatAccess(hostWrite, "isolated_readonly").decision).toBe("deny");
		expect(decideManifestChatAccess(hostWrite, "sandbox_with_host_escape").decision).toBe("confirm");
		expect(decideManifestChatAccess(hostWrite, "host").decision).toBe("confirm"); // never auto, even in host mode
	});
});

describe("tool-capability-manifest — NKlein kanban tool bridge (§5.AF slice 2)", () => {
	const READ_TOOLS = ["find_files", "list_files", "get_file_size", "read_files", "read_large_file"] as const;
	const WRITE_TOOLS = ["write_file", "write_files", "editor", "apply_patch"] as const;

	// Anchor: every tool !Klein actually offers (createKanbanToolPolicies) must declare a manifest — same drift-proof
	// pattern as the tool cards. A new/removed kanban tool fails here until its manifest follows.
	it("declares a manifest for exactly the createKanbanToolPolicies() tool set", () => {
		const policyToolNames = new Set(
			Object.entries(createKanbanToolPolicies())
				.filter(([, policy]) => policy?.enabled !== false)
				.map(([name]) => name),
		);
		expect(new Set(Object.keys(KANBAN_TOOL_MANIFESTS))).toEqual(policyToolNames);
	});

	it("maps read tools to the read tier and write tools to the sandbox-write tier", () => {
		for (const tool of READ_TOOLS) {
			expect(manifestForKanbanTool(tool)).toMatchObject({
				mutationLevel: "read",
				networkLevel: "none",
				fsScope: "workspace",
				replayable: true,
			});
		}
		for (const tool of WRITE_TOOLS) {
			expect(manifestForKanbanTool(tool)).toMatchObject({
				mutationLevel: "sandbox_write",
				networkLevel: "none",
				fsScope: "workspace",
				replayable: false,
			});
		}
	});

	it("returns null for a name that isn't a declared kanban tool", () => {
		expect(manifestForKanbanTool("run_commands")).toBeNull(); // native SDK tool, not a kanban-scoped tool
		expect(manifestForKanbanTool("no_such_tool")).toBeNull();
	});

	// The unification thesis, evidenced: the NKlein tools' manifests, run through the CHAT gate, produce sensible
	// decisions — proving ONE vocabulary spans both mechanisms (no NKlein-specific gate needed to reason about tiers).
	it("cross-checks through decideManifestChatAccess: reads always allowed, sandbox writes gated by mode", () => {
		for (const mode of MODES) {
			for (const tool of READ_TOOLS) {
				const manifest = manifestForKanbanTool(tool) as ToolCapabilityManifest;
				expect(decideManifestChatAccess(manifest, mode).decision, `${tool} in ${mode}`).toBe("allow");
			}
		}
		for (const tool of WRITE_TOOLS) {
			const manifest = manifestForKanbanTool(tool) as ToolCapabilityManifest;
			// Isolated read-only: a sandbox write needs confirmation; the host-capable modes allow it outright.
			expect(decideManifestChatAccess(manifest, "isolated_readonly").decision).toBe("confirm");
			expect(decideManifestChatAccess(manifest, "sandbox_with_host_escape").decision).toBe("allow");
			expect(decideManifestChatAccess(manifest, "host").decision).toBe("allow");
		}
	});
});

describe("tool-capability-manifest — external-action (egress) gate, prime-directive #1", () => {
	// A web-fetch-shaped tool: a READ that reaches the network. The egress tier must gate it BEFORE the sandbox-read
	// allow, or a network read would slip through as "always allowed".
	const egressRead: ToolCapabilityManifest = {
		mutationLevel: "read",
		networkLevel: "egress",
		fsScope: "workspace",
		approval: "confirm",
		replayable: false,
	};

	it("denies egress in the most-isolated mode and confirms it (never auto) in host-capable modes", () => {
		expect(decideManifestChatAccess(egressRead, "isolated_readonly").decision).toBe("deny");
		expect(decideManifestChatAccess(egressRead, "sandbox_with_host_escape").decision).toBe("confirm");
		expect(decideManifestChatAccess(egressRead, "host").decision).toBe("confirm");
	});

	it("gates an egress READ (it does NOT fall through to the sandbox-read allow)", () => {
		// Same fields as an always-allowed sandbox read EXCEPT networkLevel — the egress check must win.
		expect(decideManifestChatAccess(egressRead, "host").decision).not.toBe("allow");
	});

	it("audits egress at the FULL tier (external-action policy)", () => {
		expect(auditDetailForManifest(egressRead)).toBe("full");
	});

	it("leaves non-egress manifests byte-identical (network gate only triggers on egress)", () => {
		for (const action of ACTIONS) {
			if (action === "egress_read") {
				continue;
			}
			const withEgress = decideManifestChatAccess(manifestForChatAction(action), "host");
			expect(withEgress.reason).not.toContain("egress");
		}
	});
});

describe("auditDetailForManifest (§5.AF research addendum)", () => {
	it("audits host actions + egress at FULL, workspace mutations at SUMMARY, sandbox reads at NONE", () => {
		expect(auditDetailForManifest(manifestForChatAction("sandbox_read"))).toBe("none");
		expect(auditDetailForManifest(manifestForChatAction("sandbox_write"))).toBe("summary");
		expect(auditDetailForManifest(manifestForChatAction("control_plane"))).toBe("summary");
		expect(auditDetailForManifest(manifestForChatAction("egress_read"))).toBe("full");
		expect(auditDetailForManifest(manifestForChatAction("host_read"))).toBe("full"); // host scope
		expect(auditDetailForManifest(manifestForChatAction("host_write"))).toBe("full");
		expect(auditDetailForManifest(manifestForChatAction("host_command"))).toBe("full");
	});

	it("mirrors the tiers for the NKlein kanban tools (reads none, writes summary)", () => {
		expect(auditDetailForManifest(manifestForKanbanTool("read_files") as ToolCapabilityManifest)).toBe("none");
		expect(auditDetailForManifest(manifestForKanbanTool("write_file") as ToolCapabilityManifest)).toBe("summary");
		expect(auditDetailForManifest(manifestForKanbanTool("apply_patch") as ToolCapabilityManifest)).toBe("summary");
	});

	it("never returns none for anything mutating or off-workspace (audit floor)", () => {
		for (const action of ["sandbox_write", "control_plane", "host_read", "host_write", "host_command"] as const) {
			expect(auditDetailForManifest(manifestForChatAction(action))).not.toBe("none");
		}
	});
});

describe("toolPoliciesFromManifests (§5.AF slice 3 — NKlein static tool-policy subsumption)", () => {
	// CENTERPIECE characterization: the derived policy map must reproduce the hand-written createKanbanToolPolicies()
	// EXACTLY — same key set AND each value {enabled:true,autoApprove:false}. A drift between the manifest set and the
	// runtime's policy map is now a failing test rather than a silent divergence.
	it("reproduces createKanbanToolPolicies() EXACTLY from KANBAN_TOOL_MANIFESTS", () => {
		expect(toolPoliciesFromManifests(KANBAN_TOOL_MANIFESTS)).toEqual(createKanbanToolPolicies());
	});

	// The oracle really is uniform {enabled:true,autoApprove:false} per tool — pin that so the mapping rule stays honest.
	it("createKanbanToolPolicies() is uniformly {enabled:true,autoApprove:false} (the mapping oracle)", () => {
		for (const [tool, policy] of Object.entries(createKanbanToolPolicies())) {
			expect(policy, tool).toEqual({ enabled: true, autoApprove: false });
		}
	});

	it("yields {enabled:true,autoApprove:false} for every manifest key", () => {
		const policies = toolPoliciesFromManifests(KANBAN_TOOL_MANIFESTS);
		expect(new Set(Object.keys(policies))).toEqual(new Set(Object.keys(KANBAN_TOOL_MANIFESTS)));
		for (const policy of Object.values(policies)) {
			expect(policy).toEqual({ enabled: true, autoApprove: false });
		}
	});

	it("an empty manifest map yields an empty policy map", () => {
		expect(toolPoliciesFromManifests({})).toEqual({});
	});

	it("a synthetic 2-key manifest map yields both keys with the default policy", () => {
		const synthetic: Readonly<Record<string, ToolCapabilityManifest>> = {
			// Deliberately mixed tiers (an egress host mutation + a plain read) to prove the derived policy is INDEPENDENT
			// of the manifest's approval/network/scope fields — the static map is always enable + never-auto-approve.
			some_host_egress_tool: {
				mutationLevel: "host_write",
				networkLevel: "egress",
				fsScope: "host",
				approval: "typed_host",
				replayable: false,
			},
			some_read_tool: {
				mutationLevel: "read",
				networkLevel: "none",
				fsScope: "workspace",
				approval: "auto",
				replayable: true,
			},
		};
		expect(toolPoliciesFromManifests(synthetic)).toEqual({
			some_host_egress_tool: { enabled: true, autoApprove: false },
			some_read_tool: { enabled: true, autoApprove: false },
		});
	});

	describe("F1.20 completed metadata (defaulted accessors + per-tool population)", () => {
		it("defaults: reads are idempotent/reconfirm, mutations are not/reuse; egress ingests untrusted content", () => {
			const read = manifestForKanbanTool("find_files");
			const write = manifestForKanbanTool("apply_patch");
			if (!read || !write) {
				throw new Error("expected manifests");
			}
			expect(manifestIdempotent(read)).toBe(true);
			expect(manifestReplayPolicy(read)).toBe("reconfirm");
			expect(manifestTaintSource(read)).toBe("none");
			expect(manifestIdempotent(write)).toBe(false); // relative patch — repeat double-applies
			expect(manifestReplayPolicy(write)).toBe("reuse"); // a side effect never re-fires on replay
			expect(manifestTaintSource(manifestForChatAction("egress_read"))).toBe("untrusted_content");
		});

		it("per-tool population: absolute writes are idempotent, relative edits are not; costs + semantic errors set", () => {
			expect(manifestIdempotent(manifestForKanbanTool("write_file") ?? ({} as never))).toBe(true);
			expect(manifestIdempotent(manifestForKanbanTool("edit_file") ?? ({} as never))).toBe(false);
			expect(manifestCost(manifestForKanbanTool("read_large_file") ?? ({} as never))).toBe("expensive");
			expect(manifestCost(manifestForKanbanTool("list_files") ?? ({} as never))).toBe("trivial");
			expect(manifestForKanbanTool("edit_file")?.semanticErrors).toContain("search_not_found");
			// EVERY offered kanban tool now declares semantic-error metadata.
			for (const [name, manifest] of Object.entries(KANBAN_TOOL_MANIFESTS)) {
				expect(manifest.semanticErrors?.length, name).toBeGreaterThan(0);
			}
		});
	});

	describe("F1.21 — the manifest as the single live gate (new routes)", () => {
		it("the delivery action manifests onto the git_delivery sink and the broker denies a tainted, plan-less run", () => {
			expect(DELIVERY_ACTION_MANIFEST.taintSinks).toContain("git_delivery");
			const tainted = decideCapabilityBrokerGate({
				manifest: DELIVERY_ACTION_MANIFEST,
				taintLabels: ["web"],
			});
			expect(tainted.allow).toBe(false);
			// A trusted plan (a decomposed card) relaxes the rule; an untainted run always passes.
			expect(
				decideCapabilityBrokerGate({
					manifest: DELIVERY_ACTION_MANIFEST,
					taintLabels: ["web"],
					backedByTrustedPlan: true,
				}).allow,
			).toBe(true);
			expect(decideCapabilityBrokerGate({ manifest: DELIVERY_ACTION_MANIFEST, taintLabels: [] }).allow).toBe(true);
		});

		it("MCP-bundle tools resolve a conservative manifest (untrusted source, egress-read tier) — no more fail-open", () => {
			const manifest = swarmToolManifest("some_mcp_tool", { mcpToolNames: new Set(["some_mcp_tool"]) });
			expect(manifest).not.toBeNull();
			expect(manifestTaintSource(manifest ?? ({} as never))).toBe("untrusted_content");
			expect(manifest?.networkLevel).toBe("egress_read");
			// Unknown NON-MCP tools stay null (the enablement policy gates them).
			expect(swarmToolManifest("some_mcp_tool", {})).toBeNull();
		});
	});
});
