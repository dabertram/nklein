import { describe, expect, it } from "vitest";
import {
	type ChatActionKind,
	type ChatExecutionMode,
	decideChatActionAccess,
} from "../../../src/chat/chat-execution-mode";
import {
	decideManifestChatAccess,
	manifestForChatAction,
	type ToolCapabilityManifest,
} from "../../../src/core/tool-capability-manifest";

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
