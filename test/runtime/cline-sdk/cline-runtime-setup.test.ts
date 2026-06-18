import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";

import type { ToolApprovalRequest } from "@clinebot/core";
import { afterEach, describe, expect, it } from "vitest";

import {
	createClineRuntimeSetup,
	createKanbanToolApprovalPolicy,
	createKanbanToolPolicies,
	ensureKanbanDefaultSkills,
	ensureKanbanDefaultWorkflows,
} from "../../../src/cline-sdk/cline-runtime-setup";
import { buildProtectedTestApprovalRequest } from "../../../src/core/agent-write-guard";
import { createProtectedTestApprovalStore } from "../../../src/core/protected-test-approval-store";

const TEMP_PREFIX = "kanban-runtime-setup-";
const execFileAsync = promisify(execFile);

function createTokenDenseContent(lineCount: number, wordsPerLine: number): string {
	return Array.from(
		{ length: lineCount },
		(_, lineIndex) =>
			`${lineIndex}: ${Array.from({ length: wordsPerLine }, (_, wordIndex) => `word${lineIndex}_${wordIndex}`).join(" ")}`,
	).join("\n");
}

function createApprovalRequest(input: Partial<ToolApprovalRequest>): ToolApprovalRequest {
	return {
		sessionId: "session-1",
		agentId: "agent-1",
		conversationId: "conversation-1",
		iteration: 1,
		toolCallId: "tool-call-1",
		toolName: "read_files",
		input: {},
		policy: {},
		...input,
	};
}

describe("createKanbanToolApprovalPolicy", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.map(async (path) => rm(path, { recursive: true, force: true })));
		tempDirs.length = 0;
	});

	it("blocks editor writes that exceed the 1000-line file limit", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath);
		const newText = Array.from({ length: 1001 }, (_, index) => `line-${index + 1}`).join("\n");

		const result = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "editor",
				input: {
					path: "large.txt",
					new_text: newText,
				},
			}),
		);

		expect(result.approved).toBe(false);
		expect(result.reason).toContain("1000-line file limit");
	});

	it("blocks editor writes that introduce obvious secrets", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath);

		const result = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "editor",
				input: {
					path: ".env",
					new_text: "OPENAI_API_KEY=sk-proj-1234567890abcdefghijklmnopqrstuvwxyz",
				},
			}),
		);

		expect(result.approved).toBe(false);
		expect(result.reason).toContain("potential OpenAI-style API key");
		expect(result.reason).toContain("replace it with a placeholder");
	});

	it("blocks write_files calls that introduce obvious secrets", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath);

		const result = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "write_files",
				input: {
					files: [
						{
							path: "config/credentials.txt",
							content: "github_token=ghp_1234567890abcdefghijklmnopQRST",
						},
					],
				},
			}),
		);

		expect(result.approved).toBe(false);
		expect(result.reason).toContain("potential GitHub token");
	});

	it("blocks editor writes to the protected test suite", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath);

		const result = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "editor",
				input: {
					path: "test/protected/protected-tests.json",
					new_text: "{}",
				},
			}),
		);

		expect(result.approved).toBe(false);
		expect(result.reason).toContain("protected test suite");
		expect(result.reason).toContain("ask_followup_question");
		expect(result.reason).toContain(
			'"intent":"Change protected test suite path test/protected/protected-tests.json via editor."',
		);
		expect(result.reason).toContain('"diff":"{}"');
		expect(result.reason).toContain('"expectedEffects":');
	});

	it("allows one exact protected-test edit after explicit approval", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const approvalStore = createProtectedTestApprovalStore();
		const policy = createKanbanToolApprovalPolicy(workspacePath, {
			taskId: "task-approval",
			protectedTestApprovals: approvalStore,
		});
		const request = createApprovalRequest({
			toolName: "editor",
			input: {
				path: "test/protected/protected-tests.json",
				new_text: "{}",
			},
		});
		const approval = buildProtectedTestApprovalRequest({
			toolName: "editor",
			path: "test/protected/protected-tests.json",
			diff: "{}",
			reason: "The editor tool attempted to change a protected test-suite file.",
			expectedEffects: "The protected test-suite file would be edited with the supplied new text.",
		});

		const blocked = await policy.requestToolApproval(request);
		expect(blocked.approved).toBe(false);

		approvalStore.grant({
			taskId: "task-approval",
			request: approval,
			approvedAt: 123,
		});

		const approved = await policy.requestToolApproval(request);
		expect(approved.approved).toBe(true);
		expect(approved.reason).toContain("one-use protected-test approval");

		const blockedAgain = await policy.requestToolApproval(request);
		expect(blockedAgain.approved).toBe(false);
	});

	it("blocks apply_patch calls that introduce obvious secrets", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath);

		const result = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "apply_patch",
				input: [
					"*** Begin Patch",
					"*** Add File: secrets.env",
					"+AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF",
					"*** End Patch",
				].join("\n"),
			}),
		);

		expect(result.approved).toBe(false);
		expect(result.reason).toContain("potential AWS access key id");
	});

	it("blocks apply_patch calls that change the protected suite config", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath);

		const result = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "apply_patch",
				input: [
					"*** Begin Patch",
					"*** Update File: vitest.protected.config.ts",
					"@@",
					"+// weaken protected config",
					"*** End Patch",
				].join("\n"),
			}),
		);

		expect(result.approved).toBe(false);
		expect(result.reason).toContain("vitest.protected.config.ts");
		expect(result.reason).toContain("protected test suite");
		expect(result.reason).toContain('"reason":"The patch tool attempted to change a protected test-suite path."');
	});

	it("seeds the Kanban decomposition workflow without overwriting user edits", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);

		const workflowPath = await ensureKanbanDefaultWorkflows(workspacePath);
		const seeded = await readFile(workflowPath, "utf8");
		expect(seeded).toContain("name: kanban-decompose");
		expect(seeded).toContain("nklein task decompose --slug <slug>");

		await writeFile(workflowPath, "user custom workflow", "utf8");
		await expect(ensureKanbanDefaultWorkflows(workspacePath)).resolves.toBe(workflowPath);
		await expect(readFile(workflowPath, "utf8")).resolves.toBe("user custom workflow");
	});

	it("excludes generated Kanban workflows from task Git diffs", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		await execFileAsync("git", ["init"], { cwd: workspacePath });

		const workflowPath = await ensureKanbanDefaultWorkflows(workspacePath);
		const excludedWorkflowPath = `/${relative(workspacePath, workflowPath).replaceAll("\\", "/")}`;

		const exclude = await readFile(join(workspacePath, ".git", "info", "exclude"), "utf8");
		expect(exclude).toContain(excludedWorkflowPath);
		const status = await execFileAsync("git", ["status", "--short", "--untracked-files=all"], { cwd: workspacePath });
		expect(status.stdout).not.toContain("kanban-decompose.md");
	});

	it("seeds !Klein guidance skills without overwriting user edits", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);

		const skillPaths = await ensureKanbanDefaultSkills(workspacePath);
		const uiSkillPath = skillPaths.find((path) => path.endsWith(join("nklein-ui", "SKILL.md")));
		expect(uiSkillPath).toBeDefined();
		if (!uiSkillPath) {
			throw new Error("Expected seeded nklein-ui guidance skill.");
		}
		const seeded = await readFile(uiSkillPath, "utf8");
		expect(seeded).toContain("name: nklein-ui");
		expect(seeded).toContain("!Klein specifics:");
		expect(seeded).toContain("src/components/ui/");

		await writeFile(uiSkillPath, "custom ui skill", "utf8");
		await expect(ensureKanbanDefaultSkills(workspacePath)).resolves.toEqual(skillPaths);
		await expect(readFile(uiSkillPath, "utf8")).resolves.toBe("custom ui skill");
	});

	it("excludes generated !Klein guidance skills from task Git diffs", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		await execFileAsync("git", ["init"], { cwd: workspacePath });

		const skillPaths = await ensureKanbanDefaultSkills(workspacePath);
		const excludedSkillPaths = skillPaths.map((path) => `/${relative(workspacePath, path).replaceAll("\\", "/")}`);

		const exclude = await readFile(join(workspacePath, ".git", "info", "exclude"), "utf8");
		for (const skillPath of excludedSkillPaths) {
			expect(exclude).toContain(skillPath);
		}
		const status = await execFileAsync("git", ["status", "--short", "--untracked-files=all"], { cwd: workspacePath });
		expect(status.stdout).not.toContain("nklein-ui");
		expect(status.stdout).not.toContain("nklein-security");
		expect(status.stdout).not.toContain("nklein-ts");
	});

	it("seeds and resolves the Kanban decomposition workflow during runtime setup", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);

		const runtimeSetup = await createClineRuntimeSetup(workspacePath);
		try {
			const resolved = runtimeSetup.resolvePrompt("/kanban-decompose\n\nTitle: Built-in workflow");

			expect(resolved).toContain("You are decomposing a project-scale idea for !Klein.");
			expect(resolved).toContain("Title: Built-in workflow");
			await expect(access(join(workspacePath, ".clinerules", "workflows", "kanban-decompose.md"))).resolves.toBe(
				undefined,
			);
			await expect(access(join(workspacePath, ".cline", "workflows", "kanban-decompose.md"))).rejects.toThrow();
		} finally {
			await runtimeSetup.dispose();
		}
	});

	it("seeds !Klein guidance skills for the SDK skills tool during runtime setup", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);

		const runtimeSetup = await createClineRuntimeSetup(workspacePath);
		try {
			const skillRecords = runtimeSetup.userInstructionService.listRecords("skill");
			const skillNames = skillRecords.map((record) => record.item.name);
			const uiSkill = skillRecords.find((record) => record.item.name === "nklein-ui")?.item;
			const commands = runtimeSetup.userInstructionService.listRuntimeCommands().map((command) => command.name);
			const resolved = runtimeSetup.resolvePrompt("/nklein-ui\n\nTask: Tighten the model picker layout.");

			expect(skillNames).toEqual(expect.arrayContaining(["nklein-security", "nklein-ui", "nklein-ts"]));
			expect(uiSkill?.instructions).toContain("Use this skill when a task touches React components");
			expect(uiSkill?.instructions).toContain("!Klein specifics:");
			expect(commands).toEqual(expect.arrayContaining(["nklein-security", "nklein-ui", "nklein-ts"]));
			expect(resolved).toContain("Use this skill when a task touches React components");
			expect(resolved).toContain("Task: Tighten the model picker layout.");
			await expect(access(join(workspacePath, ".clinerules", "skills", "nklein-ui", "SKILL.md"))).resolves.toBe(
				undefined,
			);
			await expect(access(join(workspacePath, ".cline", "skills", "nklein-ui", "SKILL.md"))).rejects.toThrow();
		} finally {
			await runtimeSetup.dispose();
		}
	});

	it("resolves user-edited Kanban decomposition workflows instead of the built-in default", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const workflowPath = await ensureKanbanDefaultWorkflows(workspacePath);
		await writeFile(
			workflowPath,
			[
				"---",
				"name: kanban-decompose",
				"description: Custom decomposition workflow.",
				"---",
				"",
				"Custom Kanban decomposition workflow.",
			].join("\n"),
			"utf8",
		);

		const runtimeSetup = await createClineRuntimeSetup(workspacePath);
		try {
			const resolved = runtimeSetup.resolvePrompt("/kanban-decompose\n\nTitle: Custom workflow");

			expect(resolved).toContain("Custom Kanban decomposition workflow.");
			expect(resolved).toContain("Title: Custom workflow");
			expect(resolved).not.toContain("You are decomposing a project-scale idea for !Klein.");
		} finally {
			await runtimeSetup.dispose();
		}
	});

	it("marks guarded tools as approval-required", () => {
		const policies = createKanbanToolPolicies();

		expect(policies.find_files).toEqual({ enabled: true, autoApprove: false });
		expect(policies.list_files).toEqual({ enabled: true, autoApprove: false });
		expect(policies.get_file_size).toEqual({ enabled: true, autoApprove: false });
		expect(policies.read_files).toEqual({ enabled: true, autoApprove: false });
		expect(policies.read_large_file).toEqual({ enabled: true, autoApprove: false });
		expect(policies.write_file).toEqual({ enabled: true, autoApprove: false });
		expect(policies.write_files).toEqual({ enabled: true, autoApprove: false });
		expect(policies.editor).toEqual({ enabled: true, autoApprove: false });
		expect(policies.apply_patch).toEqual({ enabled: true, autoApprove: false });
	});

	it("blocks write_file payloads above the configured line limit", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath, { maxAgentWritableFileLines: 3 });
		const content = ["one", "two", "three", "four"].join("\n");

		const result = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "write_file",
				input: {
					path: "large.txt",
					content,
				},
			}),
		);

		expect(result.approved).toBe(false);
		expect(result.reason).toContain("3-line file limit");
	});

	it("blocks path-only write_file payloads before approval", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath, { maxAgentWritableFileLines: 3 });

		const result = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "write_file",
				input: {
					path: "new_plan.md",
				},
			}),
		);

		expect(result.approved).toBe(false);
		expect(result.reason).toContain("path and content fields");
	});

	it("blocks write_files payloads above the configured line limit", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath, { maxAgentWritableFileLines: 3 });
		const content = ["one", "two", "three", "four"].join("\n");

		const result = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "write_files",
				input: {
					files: [{ path: "large.txt", content }],
				},
			}),
		);

		expect(result.approved).toBe(false);
		expect(result.reason).toContain("3-line file limit");
	});

	it("blocks token-oversized read_files requests without explicit ranges", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath, { contextWindow: 80_000 });
		const largeFilePath = join(workspacePath, "big.txt");
		const largeContent = createTokenDenseContent(1000, 12);
		await writeFile(largeFilePath, largeContent, "utf-8");

		const result = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "read_files",
				input: {
					files: [{ path: largeFilePath }],
				},
			}),
		);

		expect(result.approved).toBe(false);
		expect(result.reason).toContain("Use read_large_file");
		expect(result.reason).toContain("No lines were read by this failed attempt");
		expect(result.reason).toContain("stitching verification");
	});

	it("includes requested file inventory when a mixed read_files request is blocked", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath, { contextWindow: 80_000 });
		const largeFilePath = join(workspacePath, "card1_raw_discussion.txt");
		const smallFilePath = join(workspacePath, "card2_raw_discussion.txt");
		await writeFile(largeFilePath, createTokenDenseContent(1000, 12), "utf-8");
		await writeFile(smallFilePath, "small discussion\n", "utf-8");

		const result = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "read_files",
				input: {
					files: [{ path: largeFilePath }, { path: smallFilePath }],
				},
			}),
		);

		expect(result.approved).toBe(false);
		expect(result.reason).toContain("card1_raw_discussion.txt");
		expect(result.reason).toContain("card2_raw_discussion.txt");
		expect(result.reason).toContain("Requested file inventory");
	});

	it("keeps ordinary full-file read_files requests unchanged", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath, { contextWindow: 80_000 });
		const sourcePath = join(workspacePath, "small.ts");
		await writeFile(sourcePath, "export const value = 42;\n", "utf8");

		const result = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "read_files",
				input: {
					files: [{ path: sourcePath }],
				},
			}),
		);

		expect(result.approved).toBe(true);
	});

	it("blocks explicit read_files chunks above the token budget", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath, { contextWindow: 80_000 });
		const largeFilePath = join(workspacePath, "wide-lines.txt");
		const largeContent = createTokenDenseContent(400, 80);
		await writeFile(largeFilePath, largeContent, "utf-8");

		const result = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "read_files",
				input: {
					files: [{ path: largeFilePath, start_line: 1, end_line: 400 }],
				},
			}),
		);

		expect(result.approved).toBe(false);
		expect(result.reason).toContain("this request used ranges");
		expect(result.reason).toContain("per-read source budget");
		expect(result.reason).toContain("Retry one large file per call");
		expect(result.reason).toContain("the next unread line is the successful end_line + 1");
		expect(result.reason).toContain("never skip line gaps");
	});

	it("allows moderate read_files chunks on an 80k context model", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath, { contextWindow: 80_000 });
		const largeFilePath = join(workspacePath, "moderate-lines.txt");
		const largeContent = createTokenDenseContent(500, 6);
		await writeFile(largeFilePath, largeContent, "utf-8");

		const result = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "read_files",
				input: {
					files: [{ path: largeFilePath, start_line: 1, end_line: 500 }],
				},
			}),
		);

		expect(result.approved).toBe(true);
	});

	it("blocks combined read_files chunks above the token budget", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath, { contextWindow: 80_000 });
		const firstPath = join(workspacePath, "first.txt");
		const secondPath = join(workspacePath, "second.txt");
		const content = createTokenDenseContent(400, 12);
		await writeFile(firstPath, content, "utf-8");
		await writeFile(secondPath, content, "utf-8");

		const result = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "read_files",
				input: {
					files: [
						{ path: firstPath, start_line: 1, end_line: 400 },
						{ path: secondPath, start_line: 1, end_line: 400 },
					],
				},
			}),
		);

		expect(result.approved).toBe(false);
		expect(result.reason).toContain("per-read source budget");
	});

	it("allows adjacent explicit chunks for large read_files requests", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath, { contextWindow: 80_000 });
		const largeFilePath = join(workspacePath, "big.txt");
		const largeContent = Array.from({ length: 400 }, (_, index) => `${index}: ${"x".repeat(100)}`).join("\n");
		await writeFile(largeFilePath, largeContent, "utf-8");

		const firstRead = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "read_files",
				input: {
					files: [{ path: largeFilePath, start_line: 1, end_line: 150 }],
				},
			}),
		);
		expect(firstRead.approved).toBe(true);

		const adjacentRead = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "read_files",
				input: {
					files: [{ path: largeFilePath, start_line: 151, end_line: 300 }],
				},
			}),
		);
		expect(adjacentRead.approved).toBe(true);
	});

	it("blocks apply_patch updates that push a file over 1000 lines", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath);
		const targetPath = join(workspacePath, "target.ts");
		const baseContent = Array.from({ length: 999 }, (_, index) => `const row${index} = ${index};`).join("\n");
		await writeFile(targetPath, baseContent, "utf-8");

		const patch = [
			"*** Begin Patch",
			"*** Update File: target.ts",
			"@@",
			"+const added_1 = 1;",
			"+const added_2 = 2;",
			"*** End Patch",
		].join("\n");

		const result = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "apply_patch",
				input: { input: patch },
			}),
		);

		expect(result.approved).toBe(false);
		expect(result.reason).toContain("1000-line file limit");
	});

	it("blocks malformed apply_patch input when changed files cannot be identified", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath);

		const result = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "apply_patch",
				input: { input: "not a patch" },
			}),
		);

		expect(result.approved).toBe(false);
		expect(result.reason).toContain("could not identify changed files");
	});
});
