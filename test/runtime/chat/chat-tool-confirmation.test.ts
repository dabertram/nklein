import { describe, expect, it } from "vitest";
import { classifyChatToolConfirmation, resolveChatToolConfirmation } from "../../../src/chat/chat-tool-confirmation";

describe("classifyChatToolConfirmation — the three-tier verdict (F2.2b/F2.12b)", () => {
	it("allows a safe command; a pre-authorized (risk-acked) unsafe one; asks the operator for an un-acked unsafe one", () => {
		expect(classifyChatToolConfirmation({ name: "run_command", command: "pwd" })).toBe("allow");
		expect(classifyChatToolConfirmation({ name: "run_command", command: "rm -rf /", riskAcknowledged: true })).toBe(
			"allow",
		);
		// Not pre-authorized but legitimate ⇒ CONFIRM (was auto-deny before the dialog).
		expect(classifyChatToolConfirmation({ name: "run_command", command: "rm -rf /", riskAcknowledged: false })).toBe(
			"confirm",
		);
	});

	it("confirms a write outside the approved mounts, allows an approved one", () => {
		expect(classifyChatToolConfirmation({ name: "write_file", sandboxWriteApproved: true })).toBe("allow");
		expect(classifyChatToolConfirmation({ name: "write_file", sandboxWriteApproved: false })).toBe("confirm");
	});

	it("gates browsing on the toggle (allow/deny — the toggle is the consent, not a per-action prompt)", () => {
		expect(classifyChatToolConfirmation({ name: "browse_url", browserEnabled: true })).toBe("allow");
		expect(classifyChatToolConfirmation({ name: "web_search", browserEnabled: false })).toBe("deny");
	});

	it("denies an unknown tool and a non-string command", () => {
		expect(classifyChatToolConfirmation({ name: "something_else" })).toBe("deny");
		expect(classifyChatToolConfirmation({ name: "run_command", command: 42 })).toBe("deny");
	});

	it("resolveChatToolConfirmation is true ONLY for the allow tier (confirm still blocks pre-round-trip)", () => {
		expect(resolveChatToolConfirmation({ name: "run_command", command: "rm -rf /", riskAcknowledged: false })).toBe(
			false,
		);
		expect(resolveChatToolConfirmation({ name: "write_file", sandboxWriteApproved: false })).toBe(false);
	});
});

describe("resolveChatToolConfirmation — §5.M run_command + browse_url gate", () => {
	it("auto-approves a SAFE run_command regardless of risk acknowledgement", () => {
		expect(resolveChatToolConfirmation({ name: "run_command", command: "pwd", riskAcknowledged: false })).toBe(true);
		expect(resolveChatToolConfirmation({ name: "run_command", command: "cat package.json" })).toBe(true);
	});

	it("requires risk acknowledgement for an UNSAFE run_command", () => {
		expect(resolveChatToolConfirmation({ name: "run_command", command: "rm -rf /", riskAcknowledged: true })).toBe(
			true,
		);
		expect(resolveChatToolConfirmation({ name: "run_command", command: "rm -rf /", riskAcknowledged: false })).toBe(
			false,
		);
		// undefined risk ack ⇒ not acknowledged ⇒ deny.
		expect(resolveChatToolConfirmation({ name: "run_command", command: "rm -rf /" })).toBe(false);
	});

	it("denies a run_command whose command isn't a string", () => {
		expect(resolveChatToolConfirmation({ name: "run_command", command: undefined, riskAcknowledged: true })).toBe(
			false,
		);
		expect(
			resolveChatToolConfirmation({ name: "run_command", command: { shell: "x" }, riskAcknowledged: true }),
		).toBe(false);
	});

	it("gates browse_url AND web_search on the per-session browserEnabled opt-in", () => {
		for (const name of ["browse_url", "web_search"]) {
			expect(resolveChatToolConfirmation({ name, browserEnabled: true })).toBe(true);
			expect(resolveChatToolConfirmation({ name, browserEnabled: false })).toBe(false);
			expect(resolveChatToolConfirmation({ name })).toBe(false);
		}
	});

	it("auto-confirms write_file only after the runtime approves the sandbox write path", () => {
		expect(resolveChatToolConfirmation({ name: "write_file", sandboxWriteApproved: true })).toBe(true);
		expect(resolveChatToolConfirmation({ name: "write_file", sandboxWriteApproved: false })).toBe(false);
		expect(resolveChatToolConfirmation({ name: "write_file" })).toBe(false);
	});

	it("denies any other tool by default", () => {
		expect(
			resolveChatToolConfirmation({ name: "delete_everything", riskAcknowledged: true, browserEnabled: true }),
		).toBe(false);
	});
});
