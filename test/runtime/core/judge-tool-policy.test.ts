import { describe, expect, it } from "vitest";
import {
	restrictToolPoliciesForVerdictSession,
	VERDICT_ONLY_SESSION_KINDS,
	VERDICT_SESSION_DISABLED_TOOLS,
} from "../../../src/core/judge-tool-policy";

describe("verdict-session tool narrowing (F4.37 second half)", () => {
	it("disables every mutation/decomposition tool and leaves inspection untouched", () => {
		const base = {
			read_files: { enabled: true, autoApprove: false },
			run_commands: { enabled: true, autoApprove: false },
			decompose_project: { enabled: true, autoApprove: true },
			edit_file: { enabled: true, autoApprove: false },
		};
		const restricted = restrictToolPoliciesForVerdictSession(base);
		expect(restricted.read_files).toEqual({ enabled: true, autoApprove: false });
		expect(restricted.run_commands).toEqual({ enabled: true, autoApprove: false });
		expect(restricted.decompose_project).toEqual({ enabled: false, autoApprove: false });
		expect(restricted.edit_file).toEqual({ enabled: false, autoApprove: false });
		// Tools absent from the base map still get an explicit disabled policy (the SDK default is enabled).
		expect(restricted.write_files).toEqual({ enabled: false, autoApprove: false });
		expect(restricted.begin_implementation).toEqual({ enabled: false, autoApprove: false });
		// Pure: the base map is untouched.
		expect(base.decompose_project.enabled).toBe(true);
	});

	it("covers the fat distractor schemas measured on the wire", () => {
		for (const tool of ["decompose_project", "editor", "edit_file", "update_focus_chain", "skills"]) {
			expect(VERDICT_SESSION_DISABLED_TOOLS).toContain(tool);
		}
	});

	it("applies to review and plan-critique but NOT merge (merge must edit files)", () => {
		expect(VERDICT_ONLY_SESSION_KINDS.has("review")).toBe(true);
		expect(VERDICT_ONLY_SESSION_KINDS.has("plan-critique")).toBe(true);
		expect(VERDICT_ONLY_SESSION_KINDS.has("merge")).toBe(false);
		expect(VERDICT_ONLY_SESSION_KINDS.has("worker")).toBe(false);
	});

	it("never disables the submission or core inspection tools", () => {
		const disabled: readonly string[] = VERDICT_SESSION_DISABLED_TOOLS;
		for (const kept of ["submit_review", "read_files", "search_code", "run_commands", "repo_map", "list_files"]) {
			expect(disabled).not.toContain(kept);
		}
	});
});
