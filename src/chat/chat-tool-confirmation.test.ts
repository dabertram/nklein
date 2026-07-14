import { describe, expect, it } from "vitest";
import { classifyCommandSafety } from "./chat-command-safety";
import { classifyChatToolConfirmation, resolveChatToolConfirmation } from "./chat-tool-confirmation";

// A command the allowlist classifier deems SAFE, and one it deems UNSAFE — derived from the real classifier so the
// test can never drift from the policy it guards.
const SAFE_COMMAND = "npm test";
const UNSAFE_COMMAND = "rm -rf build";

describe("classifyChatToolConfirmation — the three-tier host-action gate (F2.2b/F2.12b)", () => {
	it("the sample commands really are safe/unsafe per the allowlist classifier", () => {
		expect(classifyCommandSafety(SAFE_COMMAND).safety).toBe("safe");
		expect(classifyCommandSafety(UNSAFE_COMMAND).safety).not.toBe("safe");
	});

	it("run_command: a SAFE command auto-allows regardless of risk-ack", () => {
		expect(classifyChatToolConfirmation({ name: "run_command", command: SAFE_COMMAND })).toBe("allow");
		expect(
			classifyChatToolConfirmation({ name: "run_command", command: SAFE_COMMAND, riskAcknowledged: false }),
		).toBe("allow");
	});

	it("run_command: an UNSAFE command is pre-authorized by risk-ack, else it CONFIRMS (not deny)", () => {
		expect(
			classifyChatToolConfirmation({ name: "run_command", command: UNSAFE_COMMAND, riskAcknowledged: true }),
		).toBe("allow");
		expect(classifyChatToolConfirmation({ name: "run_command", command: UNSAFE_COMMAND })).toBe("confirm");
		expect(
			classifyChatToolConfirmation({ name: "run_command", command: UNSAFE_COMMAND, riskAcknowledged: false }),
		).toBe("confirm");
	});

	it("run_command: a non-string command denies", () => {
		expect(classifyChatToolConfirmation({ name: "run_command", command: 42 })).toBe("deny");
		expect(classifyChatToolConfirmation({ name: "run_command" })).toBe("deny");
	});

	it("browse_url / web_search: gated by the per-session browserEnabled opt-in", () => {
		expect(classifyChatToolConfirmation({ name: "browse_url", browserEnabled: true })).toBe("allow");
		expect(classifyChatToolConfirmation({ name: "browse_url" })).toBe("deny");
		expect(classifyChatToolConfirmation({ name: "web_search", browserEnabled: true })).toBe("allow");
		expect(classifyChatToolConfirmation({ name: "web_search", browserEnabled: false })).toBe("deny");
	});

	it("write_file: auto-allows only under approved mounts, else CONFIRMS", () => {
		expect(classifyChatToolConfirmation({ name: "write_file", sandboxWriteApproved: true })).toBe("allow");
		expect(classifyChatToolConfirmation({ name: "write_file" })).toBe("confirm");
		expect(classifyChatToolConfirmation({ name: "write_file", sandboxWriteApproved: false })).toBe("confirm");
	});

	it("an unknown tool denies", () => {
		expect(classifyChatToolConfirmation({ name: "exfiltrate" })).toBe("deny");
	});
});

describe("resolveChatToolConfirmation — the boolean AUTO-approval gate stays byte-identical", () => {
	it("true ONLY for the allow tier; confirm and deny both block", () => {
		expect(resolveChatToolConfirmation({ name: "run_command", command: SAFE_COMMAND })).toBe(true);
		// confirm tier blocks the AUTO gate (the round-trip parks it separately)
		expect(resolveChatToolConfirmation({ name: "run_command", command: UNSAFE_COMMAND })).toBe(false);
		expect(resolveChatToolConfirmation({ name: "write_file" })).toBe(false);
		// deny tier blocks
		expect(resolveChatToolConfirmation({ name: "browse_url" })).toBe(false);
		expect(resolveChatToolConfirmation({ name: "exfiltrate" })).toBe(false);
	});
});
