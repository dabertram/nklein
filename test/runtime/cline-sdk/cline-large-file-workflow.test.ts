import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentAfterModelContext, AgentBeforeModelContext } from "@clinebot/shared";
import { afterEach, describe, expect, it } from "vitest";

import { ClineLargeFileWorkflow } from "../../../src/cline-sdk/cline-large-file-workflow";

const TEMP_PREFIX = "kanban-large-file-workflow-";

function createLargeContent(lineCount: number): string {
	return Array.from(
		{ length: lineCount },
		(_, index) => `line-${index + 1}: ${"content ".repeat(16)}boundary-value-${index + 1}`,
	).join("\n");
}

function createBeforeModelContext(): AgentBeforeModelContext {
	return {
		snapshot: {
			agentId: "agent-1",
			status: "running",
			iteration: 1,
			messages: [],
			pendingToolCalls: [],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
		request: {
			messages: [],
			tools: [],
		},
	};
}

function createAfterModelContext(): AgentAfterModelContext {
	return {
		snapshot: {
			agentId: "agent-1",
			status: "running",
			iteration: 1,
			messages: [],
			pendingToolCalls: [],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
		assistantMessage: {
			id: "assistant-1",
			role: "assistant",
			content: [{ type: "text", text: "Final synthesis" }],
			createdAt: Date.now(),
		},
		finishReason: "stop",
	};
}

describe("ClineLargeFileWorkflow", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.map(async (path) => rm(path, { recursive: true, force: true })));
		tempDirs.length = 0;
	});

	it("reads through EOF, returns every stitching window, then requires synthesis", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const sourcePath = join(workspacePath, "large.txt");
		await writeFile(sourcePath, createLargeContent(4_000), "utf8");
		const workflow = new ClineLargeFileWorkflow("session-rails", workspacePath, join(workspacePath, ".runtime"));
		expect(await workflow.getReadFilesBlockingReason()).toBeNull();
		let cursor = "start";

		const primaryResults: Array<Record<string, unknown>> = [];
		for (let attempt = 0; attempt < 200; attempt += 1) {
			const result = await workflow.readNext("large.txt", 16_000, cursor);
			if (result.phase !== "reading") {
				break;
			}
			primaryResults.push(result);
			cursor = String(result.nextCursor ?? cursor);
			expect(await workflow.getReadFilesBlockingReason()).toContain("Blocked read_files");
			if (result.endLine === result.totalLines) {
				break;
			}
		}

		expect(primaryResults.length).toBeGreaterThan(1);
		expect(primaryResults.at(0)?.startLine).toBe(1);
		expect(primaryResults.at(-1)?.endLine).toBe(4_000);

		const stitchResults: Array<Record<string, unknown>> = [];
		for (let attempt = 0; attempt < 200; attempt += 1) {
			const result = await workflow.readNext("large.txt", 16_000, cursor);
			if (result.phase !== "stitching") {
				expect(result.phase).toBe("synthesis");
				break;
			}
			stitchResults.push(result);
			cursor = String(result.nextCursor ?? cursor);
			expect(await workflow.getReadFilesBlockingReason()).toContain("read_large_file");
		}

		expect(stitchResults).toHaveLength(primaryResults.length - 1);
		expect(await workflow.getReadFilesBlockingReason()).toContain("final synthesis is still required");
		const messages = await workflow.beforeModel(createBeforeModelContext());
		expect(JSON.stringify(messages)).toContain("SYNTHESIS NOW");

		await workflow.afterModel(createAfterModelContext());
		expect(await workflow.getReadFilesBlockingReason()).toBeNull();
		const completed = await workflow.readNext("large.txt", 16_000, "synthesis");
		expect(completed.phase).toBe("complete");
	});

	it("rejects stale cursors and reports the expected next cursor", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const sourcePath = join(workspacePath, "large.txt");
		await writeFile(sourcePath, createLargeContent(4_000), "utf8");
		const workflow = new ClineLargeFileWorkflow("session-cursor", workspacePath, join(workspacePath, ".runtime"));

		const first = await workflow.readNext("large.txt", 16_000, "start");
		expect(first.phase).toBe("reading");
		const expectedNextCursor = String(first.nextCursor);

		await expect(workflow.readNext("large.txt", 16_000, "start")).rejects.toThrow(expectedNextCursor);
	});

	it("includes monotonic counters in read and stitch cursors", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const sourcePath = join(workspacePath, "large.txt");
		await writeFile(sourcePath, createLargeContent(4_000), "utf8");
		const workflow = new ClineLargeFileWorkflow(
			"session-counter-cursors",
			workspacePath,
			join(workspacePath, ".runtime"),
		);

		const first = await workflow.readNext("large.txt", 16_000, "start");
		expect(first.phase).toBe("reading");
		expect(String(first.nextCursor)).toMatch(/^read:\d+:2$/);

		const second = await workflow.readNext("large.txt", 16_000, String(first.nextCursor));
		expect(second.phase).toBe("reading");
		expect(String(second.nextCursor)).toMatch(/^read:\d+:3$/);

		let cursor = String(second.nextCursor);
		let stitchCursor = "";
		for (let attempt = 0; attempt < 200; attempt += 1) {
			const result = await workflow.readNext("large.txt", 16_000, cursor);
			if (result.phase === "reading") {
				cursor = String(result.nextCursor);
				continue;
			}
			if (result.phase === "stitching") {
				stitchCursor = String(result.nextCursor);
				break;
			}
			throw new Error("Expected to reach stitching phase");
		}

		expect(stitchCursor).toMatch(/^stitch:\d+\/\d+:2$/);
	});

	it("accepts legacy no-counter cursor forms for compatibility", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const sourcePath = join(workspacePath, "large.txt");
		await writeFile(sourcePath, createLargeContent(4_000), "utf8");
		const workflow = new ClineLargeFileWorkflow(
			"session-legacy-cursor",
			workspacePath,
			join(workspacePath, ".runtime"),
		);

		const first = await workflow.readNext("large.txt", 16_000, "start");
		expect(first.phase).toBe("reading");
		const [legacyReadCursor] = String(first.nextCursor).split(":", 2);
		const legacyReadValue = String(first.nextCursor).split(":").slice(0, 2).join(":");
		expect(legacyReadCursor).toBe("read");

		const second = await workflow.readNext("large.txt", 16_000, legacyReadValue);
		expect(second.phase).toBe("reading");
	});

	it("restores progress from side storage and resets it when source content changes", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const sourcePath = join(workspacePath, "large.txt");
		const initialContent = createLargeContent(4_000);
		await writeFile(sourcePath, initialContent, "utf8");

		const storageRoot = join(workspacePath, ".runtime");
		const firstWorkflow = new ClineLargeFileWorkflow("session-persisted", workspacePath, storageRoot);
		const first = await firstWorkflow.readNext("large.txt", 16_000, "start");
		expect(first.phase).toBe("reading");
		expect(first.startLine).toBe(1);

		const restoredWorkflow = new ClineLargeFileWorkflow("session-persisted", workspacePath, storageRoot);
		const restored = await restoredWorkflow.readNext("large.txt", 16_000, String(first.nextCursor));
		expect(restored.phase).toBe("reading");
		expect(restored.startLine).toBe((first.endLine as number) + 1);

		await writeFile(sourcePath, initialContent.replace("boundary-value-1", "changed-value-01"), "utf8");
		const reset = await restoredWorkflow.readNext("large.txt", 16_000, "start");
		expect(reset.phase).toBe("reading");
		expect(reset.startLine).toBe(1);

		const indexPath = join(storageRoot, "tool-output", "session-persisted", "index.json");
		const index = await readFile(indexPath, "utf8");
		expect(index).toContain('"toolName": "read_large_file"');
	});
});
