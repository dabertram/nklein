import { describe, expect, it, vi } from "vitest";
import {
	restrictCommunitySkillExtraTools,
	restrictCommunitySkillToolExecutors,
	restrictCommunitySkillToolPolicies,
} from "../../../src/nklein-agent/community-skill-tool-admission";
import type { AgentTool } from "../../../src/nklein-agent/sdk-agent-types";

describe("community skill runtime tool admission", () => {
	it("disables every policy not named by the immutable activation grant", () => {
		expect(
			restrictCommunitySkillToolPolicies(
				{
					read_files: { enabled: true, autoApprove: true },
					write_file: { enabled: true, autoApprove: true },
					apply_patch: { enabled: false, autoApprove: false },
				},
				["read_files"],
			),
		).toEqual({
			"*": { enabled: false, autoApprove: false },
			read_files: { enabled: true, autoApprove: false },
			write_file: { enabled: false, autoApprove: false },
			apply_patch: { enabled: false, autoApprove: false },
		});
		expect(restrictCommunitySkillToolPolicies({}, ["search_codebase"])).toEqual({
			"*": { enabled: false, autoApprove: false },
			search_codebase: { enabled: true, autoApprove: false },
		});
	});

	it("maps SDK executor keys and overrides every denied default so the SDK cannot restore its host shell", async () => {
		const executors = {
			bash: vi.fn(),
			readFile: vi.fn(),
			search: vi.fn(),
			editor: vi.fn(),
			applyPatch: vi.fn(),
			webFetch: vi.fn(),
		};
		const narrowed = restrictCommunitySkillToolExecutors(executors, ["read_files", "search_code"]);
		expect(Object.keys(narrowed)).toEqual(["bash", "readFile", "search", "editor", "applyPatch", "webFetch"]);
		expect(narrowed.readFile).toBe(executors.readFile);
		expect(narrowed.search).toBe(executors.search);
		expect(narrowed.bash).not.toBe(executors.bash);
		const context = { agentId: "test", iteration: 0 };
		await expect(narrowed.bash?.("pwd", "/tmp", context)).resolves.toContain("denied");
		const withoutSandbox = restrictCommunitySkillToolExecutors(undefined, ["read_files"]);
		await expect(withoutSandbox.readFile?.({ path: "secret" }, context)).resolves.toContain("could not sandbox");
	});

	it("filters custom tools by exact declared name", () => {
		const tools = ["read_files", "write_file", "web_search"].map(
			(name): AgentTool => ({ name, description: name, inputSchema: {}, execute: vi.fn() }),
		);
		expect(restrictCommunitySkillExtraTools(tools, ["read_files", "web_search"])?.map((tool) => tool.name)).toEqual([
			"read_files",
			"web_search",
		]);
	});
});
