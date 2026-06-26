import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentAfterModelContext, AgentBeforeModelContext } from "@nklein/shared";
import { afterEach, describe, expect, it } from "vitest";

import { NKleinLargeFileWorkflow } from "../../../src/nklein-agent/nklein-large-file-workflow";

const TEMP_PREFIX = "kanban-large-file-workflow-";

function createLargeContent(lineCount: number): string {
	return Array.from(
		{ length: lineCount },
		(_, index) => `line-${index + 1}: ${"content ".repeat(16)}boundary-value-${index + 1}`,
	).join("\n");
}

function createBeforeModelContext(tools: AgentBeforeModelContext["request"]["tools"] = []): AgentBeforeModelContext {
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
			tools,
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

function createAfterModelToolCallContext(): AgentAfterModelContext {
	return {
		...createAfterModelContext(),
		assistantMessage: {
			id: "assistant-tool-call",
			role: "assistant",
			content: [
				{
					type: "tool-call",
					toolCallId: "tool-1",
					toolName: "read_files",
					input: { files: [{ path: "other.txt" }] },
				},
			],
			createdAt: Date.now(),
		},
	};
}

const TOOL_DEFINITIONS = [
	{ name: "read_files", description: "Read files", inputSchema: {} },
	{ name: "read_large_file", description: "Read large files", inputSchema: {} },
	{ name: "run_commands", description: "Run commands", inputSchema: {} },
];

describe("NKleinLargeFileWorkflow", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.map(async (path) => rm(path, { recursive: true, force: true })));
		tempDirs.length = 0;
	});

	it("reads through EOF, parks verified coverage, and allows reading another source file", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const sourcePath = join(workspacePath, "large.txt");
		const secondSourcePath = join(workspacePath, "second-large.txt");
		await writeFile(sourcePath, createLargeContent(4_000), "utf8");
		await writeFile(secondSourcePath, createLargeContent(4_000), "utf8");
		const workflow = new NKleinLargeFileWorkflow("session-rails", workspacePath, join(workspacePath, ".runtime"));
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
		const stitchingRequest = await workflow.beforeModel(createBeforeModelContext(TOOL_DEFINITIONS));
		expect(JSON.stringify(stitchingRequest?.messages)).toContain("separate pending stitching areas");
		expect(JSON.stringify(stitchingRequest?.messages)).toContain("laid over its own primary-chunk boundary");
		expect(JSON.stringify(stitchingRequest?.messages)).toContain("one continuous read");
		expect(JSON.stringify(stitchingRequest?.messages)).toContain("Make one read_large_file call");
		expect(JSON.stringify(stitchingRequest?.messages)).toContain("Do not call each boundary separately");
		expect(JSON.stringify(stitchingRequest?.messages)).toContain("Never issue parallel read_large_file calls");

		const stitchResults: Array<Record<string, unknown>> = [];
		for (let attempt = 0; attempt < 200; attempt += 1) {
			const result = await workflow.readNext("large.txt", 16_000, cursor);
			if (result.phase !== "stitching") {
				expect(result.phase).toBe("synthesis");
				break;
			}
			stitchResults.push(result);
			expect(result.startLine).toBeUndefined();
			expect(result.endLine).toBeUndefined();
			expect(result.content).toContain("discontiguous boundary windows");
			expect(result.content).toContain("STITCH BOUNDARY");
			expect(result.instruction).toContain("Do not call read_large_file in parallel");
			expect(result.instruction).toMatch(/exactly one read_large_file call|make another read_large_file call now/);
			expect(result.stitchingAreas).toEqual(result.windows);
			const stitchingAreas = Array.isArray(result.stitchingAreas) ? result.stitchingAreas : [];
			expect(stitchingAreas.length).toBeGreaterThan(0);
			expect(stitchingAreas[0]).toMatchObject({
				boundary: expect.stringMatching(/^\d+\/\d+$/),
				stitchLocation: {
					leftLine: expect.any(Number),
					rightLine: expect.any(Number),
					leftPrimaryRange: expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) }),
					rightPrimaryRange: expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) }),
				},
			});
			cursor = String(result.nextCursor ?? cursor);
			const blockingReason = await workflow.getReadFilesBlockingReason();
			if (cursor === "synthesis") {
				expect(blockingReason).toBeNull();
			} else {
				expect(blockingReason).toContain("read_large_file");
			}
		}

		const stitchWindowCount = stitchResults.reduce((count, result) => {
			const windows = Array.isArray(result.windows) ? result.windows : [];
			return count + Math.max(1, windows.length);
		}, 0);
		expect(stitchWindowCount).toBe(primaryResults.length - 1);
		expect(stitchResults.some((result) => Array.isArray(result.windows) && result.windows.length > 1)).toBe(true);
		expect(await workflow.getReadFilesBlockingReason()).toBeNull();
		expect(await workflow.getReadLargeFileBlockingReason()).toBeNull();
		const parkedRequest = await workflow.beforeModel(createBeforeModelContext(TOOL_DEFINITIONS));
		expect(JSON.stringify(parkedRequest?.messages)).toContain("verified coverage parked");
		expect(JSON.stringify(parkedRequest?.messages)).toContain("persisted read_large_file context");
		expect(JSON.stringify(parkedRequest?.messages)).toContain("continue with discovery or the next exact file");
		expect(JSON.stringify(parkedRequest?.messages)).toContain("reconciling each marked stitching boundary in place");
		expect(JSON.stringify(parkedRequest?.messages)).toContain(
			"without treating discontiguous stitching areas as one continuous source range",
		);
		expect(parkedRequest?.tools?.map((tool) => tool.name)).toEqual(TOOL_DEFINITIONS.map((tool) => tool.name));

		const secondFile = await workflow.readNext("second-large.txt", 16_000, "start");
		expect(secondFile.phase).toBe("reading");
		expect(secondFile.path).toBe("second-large.txt");

		await workflow.afterModel(createAfterModelToolCallContext());
		expect(await workflow.getReadFilesBlockingReason()).toContain("second-large.txt");

		await workflow.afterModel(createAfterModelContext());
		expect(await workflow.getReadFilesBlockingReason()).toContain("second-large.txt");
		const parked = await workflow.readNext("large.txt", 16_000, "synthesis");
		expect(parked.phase).toBe("synthesis");
		expect(parked.coverageStatus).toBe("complete");
		expect(parked.instruction).toContain("Do not call read_large_file again for this file");
		expect(parked.instruction).toContain("continue with other required source files");
	});

	it("hides read_files while a large-file workflow is active", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const sourcePath = join(workspacePath, "large.txt");
		await writeFile(sourcePath, createLargeContent(4_000), "utf8");
		const workflow = new NKleinLargeFileWorkflow(
			"session-tool-filtering",
			workspacePath,
			join(workspacePath, ".runtime"),
		);

		await workflow.readNext("large.txt", 16_000, "start");

		const result = await workflow.beforeModel(createBeforeModelContext(TOOL_DEFINITIONS));

		expect(result?.tools?.map((tool) => tool.name)).toEqual(["read_large_file"]);
		expect(JSON.stringify(result?.messages)).toContain("reading incomplete");
	});

	it("rejects stale cursors and reports the expected next cursor", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const sourcePath = join(workspacePath, "large.txt");
		await writeFile(sourcePath, createLargeContent(4_000), "utf8");
		const workflow = new NKleinLargeFileWorkflow("session-cursor", workspacePath, join(workspacePath, ".runtime"));

		const first = await workflow.readNext("large.txt", 16_000, "start");
		expect(first.phase).toBe("reading");
		const expectedNextCursor = String(first.nextCursor);

		await expect(workflow.readNext("large.txt", 16_000, "start")).rejects.toThrow(expectedNextCursor);
	});

	it("explains that synthesis cursor means the file is fully covered", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const sourcePath = join(workspacePath, "large.txt");
		await writeFile(sourcePath, createLargeContent(4_000), "utf8");
		const workflow = new NKleinLargeFileWorkflow(
			"session-synthesis-cursor-message",
			workspacePath,
			join(workspacePath, ".runtime"),
		);

		let cursor = "start";
		for (let attempt = 0; attempt < 200; attempt += 1) {
			const result = await workflow.readNext("large.txt", 16_000, cursor);
			cursor = String(result.nextCursor ?? cursor);
			if (cursor === "synthesis") {
				break;
			}
		}

		await expect(workflow.readNext("large.txt", 16_000, "read:3151:99")).rejects.toThrow(
			"Do not read more from this file",
		);
	});

	it("includes monotonic counters in read and stitch cursors", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const sourcePath = join(workspacePath, "large.txt");
		await writeFile(sourcePath, createLargeContent(4_000), "utf8");
		const workflow = new NKleinLargeFileWorkflow(
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

		expect(stitchCursor).toMatch(/^stitch:\d+\/\d+:\d+$/);
	});

	it("accepts legacy no-counter cursor forms for compatibility", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const sourcePath = join(workspacePath, "large.txt");
		await writeFile(sourcePath, createLargeContent(4_000), "utf8");
		const workflow = new NKleinLargeFileWorkflow(
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
		const firstWorkflow = new NKleinLargeFileWorkflow("session-persisted", workspacePath, storageRoot);
		const first = await firstWorkflow.readNext("large.txt", 16_000, "start");
		expect(first.phase).toBe("reading");
		expect(first.startLine).toBe(1);

		const restoredWorkflow = new NKleinLargeFileWorkflow("session-persisted", workspacePath, storageRoot);
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

	it('drives the whole workflow with only cursor "next" and reports index/total progress (§5.O)', async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		await writeFile(join(workspacePath, "large.txt"), createLargeContent(4_000), "utf8");
		const workflow = new NKleinLargeFileWorkflow("session-next", workspacePath, join(workspacePath, ".runtime"));

		const phasesSeen = new Set<string>();
		let sawReadingProgress = false;
		let sawStitchingProgress = false;
		let reachedSynthesis = false;

		// Never compute a cursor — just keep asking for "next" the way a small model now can.
		for (let attempt = 0; attempt < 400; attempt += 1) {
			const result = await workflow.readNext("large.txt", 16_000, "next");
			phasesSeen.add(String(result.phase));
			if (result.phase === "reading") {
				expect(String(result.progress)).toMatch(/Covered \d+ of 4000 lines \(\d+%\)\./);
				expect(result.instruction).toContain('cursor "next"');
				sawReadingProgress = true;
			} else if (result.phase === "stitching") {
				expect(String(result.progress)).toMatch(/Verified \d+ of \d+ stitching area/);
				sawStitchingProgress = true;
			} else if (result.phase === "synthesis") {
				reachedSynthesis = true;
				break;
			}
		}

		expect(sawReadingProgress).toBe(true);
		expect(sawStitchingProgress).toBe(true);
		expect(reachedSynthesis).toBe(true);
		expect(phasesSeen).toContain("reading");
		expect(phasesSeen).toContain("stitching");
	});

	it('treats an empty/omitted cursor the same as "next" (advance from persisted state)', async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		await writeFile(join(workspacePath, "large.txt"), createLargeContent(4_000), "utf8");
		const workflow = new NKleinLargeFileWorkflow(
			"session-empty-cursor",
			workspacePath,
			join(workspacePath, ".runtime"),
		);

		const first = await workflow.readNext("large.txt", 16_000, "");
		expect(first.phase).toBe("reading");
		expect(first.startLine).toBe(1);
		// Empty cursor again advances (does not re-read from the start or throw a stale-cursor error).
		const second = await workflow.readNext("large.txt", 16_000, "");
		expect(second.phase).toBe("reading");
		expect(second.startLine).toBe((first.endLine as number) + 1);
	});
});

describe("read_large_file workspace containment (§5.Y #4)", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.map(async (path) => rm(path, { recursive: true, force: true })));
		tempDirs.length = 0;
	});

	function newWorkflow(workspacePath: string): NKleinLargeFileWorkflow {
		return new NKleinLargeFileWorkflow("session-containment", workspacePath, join(workspacePath, ".runtime"));
	}

	it("rejects reading a host-absolute path outside the workspace root", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		const outside = await mkdtemp(join(tmpdir(), "kanban-large-outside-"));
		tempDirs.push(workspacePath, outside);
		const secretPath = join(outside, "secret.txt");
		await writeFile(secretPath, createLargeContent(4_000), "utf8");
		const workflow = newWorkflow(workspacePath);

		await expect(workflow.readNext(secretPath, 16_000, "start")).rejects.toThrow(
			/escapes the workspace|outside the workspace/,
		);
	});

	it("rejects a `..` traversal escape", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const workflow = newWorkflow(workspacePath);

		await expect(workflow.readNext("../../../../etc/hosts", 16_000, "start")).rejects.toThrow(
			/escapes the workspace|outside the workspace/,
		);
	});

	it("rejects a symlinked-parent escape (real path lands outside)", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		const outside = await mkdtemp(join(tmpdir(), "kanban-large-symlink-outside-"));
		tempDirs.push(workspacePath, outside);
		await writeFile(join(outside, "secret.txt"), createLargeContent(4_000), "utf8");
		await symlink(outside, join(workspacePath, "evil-link"));
		const workflow = newWorkflow(workspacePath);

		await expect(workflow.readNext("evil-link/secret.txt", 16_000, "start")).rejects.toThrow(
			/escapes the workspace|outside the workspace/,
		);
	});

	it("allows reading a host-absolute path within the workspace root (host/home session)", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		await writeFile(join(workspacePath, "large.txt"), createLargeContent(4_000), "utf8");
		const workflow = newWorkflow(workspacePath);

		const result = await workflow.readNext(join(workspacePath, "large.txt"), 16_000, "start");
		expect(result.phase).toBe("reading");
		expect(result.startLine).toBe(1);
	});

	it("allows a normal workspace-relative read", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		await writeFile(join(workspacePath, "large.txt"), createLargeContent(4_000), "utf8");
		const workflow = newWorkflow(workspacePath);

		const result = await workflow.readNext("large.txt", 16_000, "start");
		expect(result.phase).toBe("reading");
	});
});
