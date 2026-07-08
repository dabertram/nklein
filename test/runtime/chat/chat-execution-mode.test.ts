import { describe, expect, it } from "vitest";
import {
	type ChatActionDecision,
	type ChatActionKind,
	type ChatExecutionMode,
	decideChatActionAccess,
} from "../../../src/chat/chat-execution-mode";

const decision = (mode: ChatExecutionMode, action: ChatActionKind): ChatActionDecision =>
	decideChatActionAccess(mode, action).decision;

describe("chat-execution-mode", () => {
	it("isolated_readonly: sandbox reads allowed, writes confirmed, no host access", () => {
		expect(decision("isolated_readonly", "sandbox_read")).toBe("allow");
		expect(decision("isolated_readonly", "sandbox_write")).toBe("confirm");
		expect(decision("isolated_readonly", "egress_read")).toBe("deny");
		expect(decision("isolated_readonly", "host_read")).toBe("deny");
		expect(decision("isolated_readonly", "host_write")).toBe("deny");
		expect(decision("isolated_readonly", "host_command")).toBe("deny");
	});

	it("sandbox_with_host_escape: sandbox free, every host action confirmed", () => {
		expect(decision("sandbox_with_host_escape", "sandbox_read")).toBe("allow");
		expect(decision("sandbox_with_host_escape", "sandbox_write")).toBe("allow");
		expect(decision("sandbox_with_host_escape", "egress_read")).toBe("confirm");
		expect(decision("sandbox_with_host_escape", "host_read")).toBe("confirm");
		expect(decision("sandbox_with_host_escape", "host_write")).toBe("confirm");
		expect(decision("sandbox_with_host_escape", "host_command")).toBe("confirm");
	});

	it("host: host reads allowed, but host mutations still require confirmation", () => {
		expect(decision("host", "sandbox_read")).toBe("allow");
		expect(decision("host", "sandbox_write")).toBe("allow");
		expect(decision("host", "egress_read")).toBe("confirm");
		expect(decision("host", "host_read")).toBe("allow");
		expect(decision("host", "host_write")).toBe("confirm");
		expect(decision("host", "host_command")).toBe("confirm");
	});

	it("never silently allows a host mutation in any mode", () => {
		const modes: ChatExecutionMode[] = ["isolated_readonly", "sandbox_with_host_escape", "host"];
		for (const mode of modes) {
			expect(decision(mode, "host_write")).not.toBe("allow");
			expect(decision(mode, "host_command")).not.toBe("allow");
		}
	});

	it("control_plane: denied in isolated_readonly, allowed in both host-capable modes", () => {
		expect(decision("isolated_readonly", "control_plane")).toBe("deny");
		expect(decision("sandbox_with_host_escape", "control_plane")).toBe("allow");
		expect(decision("host", "control_plane")).toBe("allow");
	});

	it("control_plane: never requires confirmation (no shell or host filesystem involved)", () => {
		const modes: ChatExecutionMode[] = ["sandbox_with_host_escape", "host"];
		for (const mode of modes) {
			expect(decision(mode, "control_plane")).toBe("allow");
		}
	});
});
