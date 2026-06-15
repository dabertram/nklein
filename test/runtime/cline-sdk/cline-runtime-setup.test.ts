import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolApprovalRequest } from "@clinebot/core";
import { afterEach, describe, expect, it } from "vitest";

import { createKanbanToolApprovalPolicy, createKanbanToolPolicies } from "../../../src/cline-sdk/cline-runtime-setup";

const TEMP_PREFIX = "kanban-runtime-setup-";

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

	it("marks guarded tools as approval-required", () => {
		const policies = createKanbanToolPolicies();

		expect(policies.read_files).toEqual({ enabled: true, autoApprove: false });
		expect(policies.editor).toEqual({ enabled: true, autoApprove: false });
		expect(policies.apply_patch).toEqual({ enabled: true, autoApprove: false });
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
