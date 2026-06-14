import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolApprovalRequest } from "@clinebot/core";
import { afterEach, describe, expect, it } from "vitest";

import { createKanbanToolApprovalPolicy } from "../../../src/cline-sdk/cline-runtime-setup";

const TEMP_PREFIX = "kanban-runtime-setup-";

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

	it("blocks large read_files requests without explicit ranges", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath);
		const largeFilePath = join(workspacePath, "big.ts");
		const largeContent = Array.from({ length: 1200 }, (_, index) => `const line${index} = ${index};`).join("\n");
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
		expect(result.reason).toContain("require explicit start_line and end_line");
	});

	it("enforces overlapping code chunks for large read_files requests", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const policy = createKanbanToolApprovalPolicy(workspacePath);
		const largeFilePath = join(workspacePath, "big.ts");
		const largeContent = Array.from({ length: 1500 }, (_, index) => `const line${index} = ${index};`).join("\n");
		await writeFile(largeFilePath, largeContent, "utf-8");

		const firstRead = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "read_files",
				input: {
					files: [{ path: largeFilePath, start_line: 1, end_line: 200 }],
				},
			}),
		);
		expect(firstRead.approved).toBe(true);

		const insufficientOverlapRead = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "read_files",
				input: {
					files: [{ path: largeFilePath, start_line: 201, end_line: 400 }],
				},
			}),
		);
		expect(insufficientOverlapRead.approved).toBe(false);
		expect(insufficientOverlapRead.reason).toContain("insufficient code-chunk overlap");

		const validOverlapRead = await policy.requestToolApproval(
			createApprovalRequest({
				toolName: "read_files",
				input: {
					files: [{ path: largeFilePath, start_line: 181, end_line: 380 }],
				},
			}),
		);
		expect(validOverlapRead.approved).toBe(true);
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
