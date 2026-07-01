import { describe, expect, it } from "vitest";
import { chatScopeCanAct, chatScopeToExecutionMode } from "../../../src/chat/chat-scope-capability";

describe("chatScopeToExecutionMode — §5.M permission floor", () => {
	it("maps chat_only to the read-only isolated mode", () => {
		expect(chatScopeToExecutionMode("chat_only")).toBe("isolated_readonly");
	});

	it("maps host_access to the on-host mode", () => {
		expect(chatScopeToExecutionMode("host_access")).toBe("host");
	});

	it("maps the project scopes to sandbox-with-host-escape", () => {
		expect(chatScopeToExecutionMode("project_sandboxed")).toBe("sandbox_with_host_escape");
		expect(chatScopeToExecutionMode("all_projects")).toBe("sandbox_with_host_escape");
	});
});

describe("chatScopeCanAct", () => {
	it("is false only for the read-only chat_only floor", () => {
		expect(chatScopeCanAct("chat_only")).toBe(false);
		expect(chatScopeCanAct("project_sandboxed")).toBe(true);
		expect(chatScopeCanAct("all_projects")).toBe(true);
		expect(chatScopeCanAct("host_access")).toBe(true);
	});

	// Consistency: the only non-acting scope is exactly the one mapped to the isolated read-only mode.
	it("agrees with the mode mapping (non-acting ⟺ isolated_readonly)", () => {
		for (const scope of ["chat_only", "project_sandboxed", "all_projects", "host_access"] as const) {
			expect(chatScopeCanAct(scope)).toBe(chatScopeToExecutionMode(scope) !== "isolated_readonly");
		}
	});
});
