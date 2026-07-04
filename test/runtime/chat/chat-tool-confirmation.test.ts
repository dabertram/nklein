import { describe, expect, it } from "vitest";
import { resolveChatToolConfirmation } from "../../../src/chat/chat-tool-confirmation";

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

	it("denies any other tool by default", () => {
		expect(resolveChatToolConfirmation({ name: "write_file", riskAcknowledged: true, browserEnabled: true })).toBe(
			false,
		);
	});
});
