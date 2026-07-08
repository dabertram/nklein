import { describe, expect, it } from "vitest";
import { PLAN_MODE_DISABLED_TOOLS, restrictToolPoliciesForPlanning } from "../../../src/core/decompose-tool-policy";

const policy = (enabled: boolean, autoApprove = false) => ({ enabled, autoApprove });

describe("decompose plan-mode tool-policy restriction (§5.B)", () => {
	it("disables execution + mutation tools while keeping read-only discovery", () => {
		const base = {
			find_files: policy(true),
			list_files: policy(true),
			read_files: policy(true),
			read_large_file: policy(true),
			write_file: policy(true),
			write_files: policy(true),
			editor: policy(true),
			apply_patch: policy(true),
		};
		const restricted = restrictToolPoliciesForPlanning(base);
		// read-only stays enabled
		expect(restricted.read_files.enabled).toBe(true);
		expect(restricted.find_files.enabled).toBe(true);
		expect(restricted.list_files.enabled).toBe(true);
		// mutation tools disabled
		expect(restricted.write_file.enabled).toBe(false);
		expect(restricted.write_files.enabled).toBe(false);
		expect(restricted.editor.enabled).toBe(false);
		expect(restricted.apply_patch.enabled).toBe(false);
	});

	it("disables run_commands even when it was absent from the base map (SDK-default-enabled)", () => {
		const base = { read_files: policy(true) }; // no run_commands key
		const restricted = restrictToolPoliciesForPlanning(base);
		expect(restricted.run_commands).toEqual({ enabled: false, autoApprove: false });
	});

	it("covers every PLAN_MODE_DISABLED_TOOL", () => {
		const restricted = restrictToolPoliciesForPlanning({});
		for (const tool of PLAN_MODE_DISABLED_TOOLS) {
			expect(restricted[tool].enabled).toBe(false);
		}
	});

	it("is pure — does not mutate the input", () => {
		const base = { run_commands: policy(true), read_files: policy(true) };
		const restricted = restrictToolPoliciesForPlanning(base);
		expect(base.run_commands.enabled).toBe(true); // input untouched
		expect(restricted.run_commands.enabled).toBe(false);
		expect(restricted).not.toBe(base);
	});

	it("is idempotent", () => {
		const once = restrictToolPoliciesForPlanning({ run_commands: policy(true) });
		const twice = restrictToolPoliciesForPlanning(once);
		expect(twice).toEqual(once);
	});
});
