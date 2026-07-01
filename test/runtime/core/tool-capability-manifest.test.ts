import { describe, expect, it } from "vitest";
import {
	type ChatActionKind,
	type ChatExecutionMode,
	decideChatActionAccess,
} from "../../../src/chat/chat-execution-mode";
import {
	decideManifestChatAccess,
	KANBAN_TOOL_MANIFESTS,
	manifestForChatAction,
	manifestForKanbanTool,
	type ToolCapabilityManifest,
} from "../../../src/core/tool-capability-manifest";
import { createKanbanToolPolicies } from "../../../src/nklein-agent/nklein-runtime-setup";

const ACTIONS: ChatActionKind[] = [
	"sandbox_read",
	"sandbox_write",
	"control_plane",
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
