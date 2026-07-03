import { describe, expect, it } from "vitest";
import type { ChatActionKind } from "../../../src/chat/chat-execution-mode";
import { manifestAllowedInPhase, selectPhaseManifestTools } from "../../../src/core/manifest-phase-gate";
import { isToolAllowedInPhase, type RunPhase } from "../../../src/core/run-state-machine";
import {
	KANBAN_TOOL_MANIFESTS,
	manifestForChatAction,
	type ToolCapabilityManifest,
} from "../../../src/core/tool-capability-manifest";

/** Every run phase, terminal ones included — the gate must be total over the whole ladder. */
const ALL_PHASES: readonly RunPhase[] = [
	"intake",
	"plan",
	"validate_plan",
	"localize",
	"execute_step",
	"observe",
	"evaluate",
	"repair",
	"retry_or_split",
	"review",
	"merge_or_escalate",
	"done",
	"park",
	"escalate",
];

/** Every chat action-kind — the source for `manifestForChatAction`, spanning read/sandbox/control-plane/host tiers. */
const ALL_ACTION_KINDS: readonly ChatActionKind[] = [
	"sandbox_read",
	"sandbox_write",
	"control_plane",
	"host_read",
	"host_write",
	"host_command",
];

describe("manifest-phase-gate — manifestAllowedInPhase", () => {
	// CENTERPIECE (characterization): the manifest-level gate must equal the scalar gate on the manifest's own mutation
	// level, for EVERY phase × EVERY real manifest — proving the two §5.AF cores agree through the one vocabulary and that
	// this adapter adds no independent decision.
	it("agrees with isToolAllowedInPhase for every phase × every KANBAN_TOOL_MANIFESTS entry", () => {
		for (const phase of ALL_PHASES) {
			for (const manifest of Object.values(KANBAN_TOOL_MANIFESTS)) {
				expect(manifestAllowedInPhase(manifest, phase)).toBe(isToolAllowedInPhase(phase, manifest.mutationLevel));
			}
		}
	});

	it("agrees with isToolAllowedInPhase for every phase × manifestForChatAction over all action kinds", () => {
		for (const phase of ALL_PHASES) {
			for (const action of ALL_ACTION_KINDS) {
				const manifest = manifestForChatAction(action);
				expect(manifestAllowedInPhase(manifest, phase)).toBe(isToolAllowedInPhase(phase, manifest.mutationLevel));
			}
		}
	});

	it("gates on mutationLevel alone — network/fs/approval axes do not change the verdict", () => {
		const base = manifestForChatAction("host_read"); // read level, but fsScope: "host"
		// Same mutation level ("read"), different fs/network/approval → same phase verdict as a workspace read manifest.
		const workspaceRead = KANBAN_TOOL_MANIFESTS.read_files;
		expect(base.mutationLevel).toBe(workspaceRead.mutationLevel);
		for (const phase of ALL_PHASES) {
			expect(manifestAllowedInPhase(base, phase)).toBe(manifestAllowedInPhase(workspaceRead, phase));
		}
	});
});

describe("manifest-phase-gate — concrete read-only-phase case", () => {
	// `observe` is a read-only phase (maxMutationLevel: "read"): it must admit a sandbox_read manifest and deny a
	// host_write manifest — the exact allowedRunStates intuition the adapter encodes.
	const sandboxRead: ToolCapabilityManifest = manifestForChatAction("sandbox_read");
	const hostWrite: ToolCapabilityManifest = manifestForChatAction("host_write");

	it("a read-only phase admits a sandbox_read manifest but denies a host_write manifest", () => {
		expect(sandboxRead.mutationLevel).toBe("read");
		expect(hostWrite.mutationLevel).toBe("host_write");
		expect(manifestAllowedInPhase(sandboxRead, "observe")).toBe(true);
		expect(manifestAllowedInPhase(hostWrite, "observe")).toBe(false);
	});

	it("execute_step (sandbox_write ceiling) admits sandbox_write but still denies host_write", () => {
		const sandboxWrite = manifestForChatAction("sandbox_write");
		expect(manifestAllowedInPhase(sandboxWrite, "execute_step")).toBe(true);
		expect(manifestAllowedInPhase(hostWrite, "execute_step")).toBe(false);
	});
});

describe("manifest-phase-gate — selectPhaseManifestTools", () => {
	// A mixed tool set carrying manifests; the filter must keep only those the phase admits, preserving order.
	const tools = [
		{ name: "read_files", manifest: manifestForChatAction("sandbox_read") },
		{ name: "write_file", manifest: manifestForChatAction("sandbox_write") },
		{ name: "board_move", manifest: manifestForChatAction("control_plane") },
		{ name: "host_edit", manifest: manifestForChatAction("host_write") },
	] as const;

	it("a read-only phase keeps only the read tool", () => {
		const kept = selectPhaseManifestTools("observe", tools);
		expect(kept.map((t) => t.name)).toEqual(["read_files"]);
	});

	it("execute_step keeps read + sandbox_write (control_plane/host_write exceed its ceiling)", () => {
		const kept = selectPhaseManifestTools("execute_step", tools);
		expect(kept.map((t) => t.name)).toEqual(["read_files", "write_file"]);
	});

	it("merge_or_escalate (control_plane ceiling) keeps everything up to control_plane but not host_write", () => {
		// MUTATION_RANK orders sandbox_write (1) BELOW control_plane (2), so a control_plane ceiling admits sandbox_write too.
		const kept = selectPhaseManifestTools("merge_or_escalate", tools);
		expect(kept.map((t) => t.name)).toEqual(["read_files", "write_file", "board_move"]);
	});

	it("agrees element-for-element with manifestAllowedInPhase across every phase", () => {
		for (const phase of ALL_PHASES) {
			const kept = selectPhaseManifestTools(phase, tools);
			const expected = tools.filter((t) => manifestAllowedInPhase(t.manifest, phase));
			expect(kept).toEqual(expected);
		}
	});

	it("returns an empty array (never throws) for an empty tool set", () => {
		expect(selectPhaseManifestTools("execute_step", [])).toEqual([]);
	});
});
