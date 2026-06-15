import { access, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { buildKanbanContextSafetyBudgets, countKanbanTextTokens } from "./cline-context-budgets";
import { isLargeFileForWorkflow, parseReadFileRequests } from "./cline-large-file-workflow";
import {
	type ClineSdkStartSessionInput,
	type ClineSdkToolApprovalRequest,
	type ClineSdkToolApprovalResult,
	type ClineSdkUserInstructionService,
	createClineSdkUserInstructionService,
	loadClineSdkRulesForSystemPrompt,
	resolveClineSdkWorkflowSlashCommand,
} from "./sdk-runtime-boundary";

const MAX_AGENT_WRITABLE_FILE_LINES = 1000;

export interface KanbanToolApprovalOptions {
	contextWindow?: number | null;
}

function countLines(text: string): number {
	if (text.length === 0) {
		return 0;
	}
	return text.split("\n").length;
}

async function readFileLineCount(path: string): Promise<number | null> {
	try {
		await access(path);
		const content = await readFile(path, "utf-8");
		return countLines(content);
	} catch {
		return null;
	}
}

async function readFileText(path: string): Promise<string | null> {
	try {
		await access(path);
		return await readFile(path, "utf-8");
	} catch {
		return null;
	}
}

function formatReadFilesInventory(
	entries: Array<{ path: string; sizeBytes: number; tokenCount: number; readable: boolean }>,
): string {
	if (entries.length === 0) {
		return "";
	}
	return ` Requested file inventory: ${entries
		.map((entry) =>
			entry.readable
				? `${entry.path} (${entry.sizeBytes.toLocaleString()} bytes, ~${entry.tokenCount.toLocaleString()} tokens)`
				: `${entry.path} (not readable)`,
		)
		.join("; ")}.`;
}

function resolveToolPath(workspacePath: string, rawPath: string): string {
	return isAbsolute(rawPath) ? rawPath : resolve(workspacePath, rawPath);
}

function asNumber(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	return Math.trunc(value);
}

type ApplyPatchTarget =
	| { type: "add"; path: string; addedLines: number }
	| { type: "update"; path: string; delta: number }
	| { type: "delete"; path: string };

function parseApplyPatchTargets(input: unknown): ApplyPatchTarget[] {
	const rawPatch =
		typeof input === "string"
			? input
			: input && typeof input === "object" && typeof (input as Record<string, unknown>).input === "string"
				? ((input as Record<string, unknown>).input as string)
				: "";
	if (!rawPatch.trim()) {
		return [];
	}

	const lines = rawPatch.split("\n");
	const targets: ApplyPatchTarget[] = [];
	let current: ApplyPatchTarget | null = null;

	const flushCurrent = (): void => {
		if (current) {
			targets.push(current);
			current = null;
		}
	};

	for (const line of lines) {
		const headerMatch = line.match(/^\*\*\*\s+(Add|Update|Delete)\s+File:\s+(.+)$/);
		if (headerMatch) {
			flushCurrent();
			const action = headerMatch[1];
			const path = headerMatch[2]?.trim() ?? "";
			if (!path) {
				continue;
			}
			if (action === "Add") {
				current = { type: "add", path, addedLines: 0 };
			} else if (action === "Update") {
				current = { type: "update", path, delta: 0 };
			} else {
				current = { type: "delete", path };
			}
			continue;
		}
		if (!current) {
			continue;
		}
		if (line.startsWith("***")) {
			continue;
		}
		if (current.type === "add") {
			if (line.startsWith("+")) {
				current.addedLines += 1;
			}
			continue;
		}
		if (current.type === "update") {
			if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
				continue;
			}
			if (line.startsWith("+")) {
				current.delta += 1;
			} else if (line.startsWith("-")) {
				current.delta -= 1;
			}
		}
	}
	flushCurrent();

	return targets;
}

async function approveReadFilesTool(
	workspacePath: string,
	request: ClineSdkToolApprovalRequest,
	options: KanbanToolApprovalOptions,
): Promise<ClineSdkToolApprovalResult> {
	const budgets = buildKanbanContextSafetyBudgets(options.contextWindow ?? null);
	const readRequests = parseReadFileRequests(request.input);
	const resolvedReadRequests = await Promise.all(
		readRequests.map(async (readRequest) => {
			const absolutePath = resolveToolPath(workspacePath, readRequest.path);
			const content = await readFileText(absolutePath);
			if (content === null) {
				return {
					readRequest,
					content: null,
					sizeBytes: 0,
					tokenCount: 0,
				};
			}
			const sizeBytes = Buffer.byteLength(content, "utf8");
			return {
				readRequest,
				content,
				sizeBytes,
				tokenCount: countKanbanTextTokens(content),
			};
		}),
	);
	const inventory = resolvedReadRequests.map(({ readRequest, content, sizeBytes, tokenCount }) => ({
		path: readRequest.path,
		sizeBytes,
		tokenCount,
		readable: content !== null,
	}));
	let totalRequestedTokens = 0;
	let totalRequestedLines = 0;
	for (const { readRequest, content, sizeBytes, tokenCount: totalTokens } of resolvedReadRequests) {
		if (content === null) {
			continue;
		}

		const startLine = readRequest.startLine;
		const endLine = readRequest.endLine;
		const hasValidRange =
			typeof startLine === "number" && typeof endLine === "number" && startLine > 0 && endLine >= startLine;
		if (!hasValidRange && isLargeFileForWorkflow(sizeBytes, totalTokens, budgets.fileChunkContentTokenBudget)) {
			return {
				approved: false,
				reason: `Blocked ${request.toolName}: ${readRequest.path} is a large file (${sizeBytes.toLocaleString()} bytes, ~${totalTokens.toLocaleString()} tokens).${formatReadFilesInventory(inventory)} No lines were read by this failed attempt. Use read_large_file for automatic chunk coverage, stitching verification, and final synthesis, or provide an explicit numeric start_line/end_line range for a focused excerpt.`,
			};
		}

		const requestedLines =
			typeof startLine === "number" && typeof endLine === "number"
				? content.split("\n").slice(Math.max(0, startLine - 1), Math.max(0, endLine))
				: content.split("\n");
		const requestedText = requestedLines.join("\n");
		totalRequestedLines += requestedLines.length;
		totalRequestedTokens += countKanbanTextTokens(requestedText);
		if (totalRequestedTokens > budgets.fileChunkContentTokenBudget) {
			const suggestedTotalLines = Math.max(
				1,
				Math.floor((totalRequestedLines * budgets.fileChunkContentTokenBudget * 0.8) / totalRequestedTokens),
			);
			return {
				approved: false,
				reason: `Blocked ${request.toolName}: this request used ranges, but the selected source text is ~${totalRequestedTokens.toLocaleString()} tokens across ${totalRequestedLines.toLocaleString()} lines, above the per-read source budget of ${budgets.fileChunkContentTokenBudget.toLocaleString()} tokens (${budgets.fileChunkTokenBudget.toLocaleString()} total read budget minus tool-result overhead). No lines were read by this failed attempt; do not mark the failed range as covered. Retry one large file per call with at most about ${suggestedTotalLines.toLocaleString()} total selected lines. If the smaller retry succeeds, the next unread line is the successful end_line + 1, not the failed end_line + 1. Grow only gradually after successful reads and never skip line gaps. Do not rely on truncation.`,
			};
		}
	}

	return {
		approved: true,
		reason: `Approved by Kanban runtime for ${request.toolName}.`,
	};
}

async function approveEditorTool(
	workspacePath: string,
	request: ClineSdkToolApprovalRequest,
): Promise<ClineSdkToolApprovalResult> {
	if (!request.input || typeof request.input !== "object") {
		return {
			approved: true,
			reason: `Approved by Kanban runtime for ${request.toolName}.`,
		};
	}
	const input = request.input as Record<string, unknown>;
	const rawPath = typeof input.path === "string" ? input.path.trim() : "";
	if (!rawPath) {
		return {
			approved: true,
			reason: `Approved by Kanban runtime for ${request.toolName}.`,
		};
	}
	const path = resolveToolPath(workspacePath, rawPath);
	const currentText = (await readFile(path, "utf-8").catch(() => "")) as string;
	const currentLines = countLines(currentText);

	const newText = typeof input.new_text === "string" ? input.new_text : "";
	const oldText = typeof input.old_text === "string" ? input.old_text : null;
	const insertLine = asNumber(input.insert_line);

	let nextText: string;
	if (typeof insertLine === "number" && insertLine >= 1) {
		const sourceLines = currentText.length > 0 ? currentText.split("\n") : [];
		const insertionIndex = Math.min(Math.max(0, insertLine - 1), sourceLines.length);
		const insertedLines = newText.length > 0 ? newText.split("\n") : [""];
		sourceLines.splice(insertionIndex, 0, ...insertedLines);
		nextText = sourceLines.join("\n");
	} else if (oldText !== null) {
		nextText = currentText.replace(oldText, newText);
	} else {
		nextText = newText;
	}

	const nextLines = countLines(nextText);
	if (nextLines > MAX_AGENT_WRITABLE_FILE_LINES) {
		return {
			approved: false,
			reason: `Blocked ${request.toolName}: writing ${nextLines} lines to ${rawPath} exceeds the ${MAX_AGENT_WRITABLE_FILE_LINES}-line file limit. Split content across multiple files.`,
		};
	}

	return {
		approved: true,
		reason: `Approved by Kanban runtime for ${request.toolName} (${currentLines} -> ${nextLines} lines).`,
	};
}

async function approveApplyPatchTool(
	workspacePath: string,
	request: ClineSdkToolApprovalRequest,
): Promise<ClineSdkToolApprovalResult> {
	const targets = parseApplyPatchTargets(request.input);
	if (targets.length === 0) {
		return {
			approved: false,
			reason: `Blocked ${request.toolName}: could not identify changed files in patch input. Retry with a standard apply_patch body.`,
		};
	}
	for (const target of targets) {
		if (target.type === "delete") {
			continue;
		}
		const path = resolveToolPath(workspacePath, target.path);
		if (target.type === "add") {
			if (target.addedLines > MAX_AGENT_WRITABLE_FILE_LINES) {
				return {
					approved: false,
					reason: `Blocked ${request.toolName}: new file ${target.path} would exceed the ${MAX_AGENT_WRITABLE_FILE_LINES}-line file limit.`,
				};
			}
			continue;
		}

		const currentLines = (await readFileLineCount(path)) ?? 0;
		const nextLines = currentLines + target.delta;
		if (nextLines > MAX_AGENT_WRITABLE_FILE_LINES) {
			return {
				approved: false,
				reason: `Blocked ${request.toolName}: patch would grow ${target.path} to ${nextLines} lines, above the ${MAX_AGENT_WRITABLE_FILE_LINES}-line file limit.`,
			};
		}
	}

	return {
		approved: true,
		reason: `Approved by Kanban runtime for ${request.toolName}.`,
	};
}

export function createKanbanToolApprovalPolicy(
	workspacePath: string,
	options: KanbanToolApprovalOptions = {},
): {
	requestToolApproval: (request: ClineSdkToolApprovalRequest) => Promise<ClineSdkToolApprovalResult>;
} {
	return {
		requestToolApproval: async (request: ClineSdkToolApprovalRequest) => {
			switch (request.toolName) {
				case "read_files":
					return await approveReadFilesTool(workspacePath, request, options);
				case "editor":
					return await approveEditorTool(workspacePath, request);
				case "apply_patch":
					return await approveApplyPatchTool(workspacePath, request);
				default:
					return {
						approved: true,
						reason: `Approved by Kanban runtime for ${request.toolName}.`,
					};
			}
		},
	};
}

export function createKanbanToolPolicies(): NonNullable<ClineSdkStartSessionInput["toolPolicies"]> {
	return {
		read_files: { enabled: true, autoApprove: false },
		editor: { enabled: true, autoApprove: false },
		apply_patch: { enabled: true, autoApprove: false },
	};
}

export interface ClineRuntimeSetup {
	userInstructionService: ClineSdkUserInstructionService;
	resolvePrompt: (prompt: string) => string;
	loadRules: () => string;
	toolPolicies: NonNullable<ClineSdkStartSessionInput["toolPolicies"]>;
	requestToolApproval: (request: ClineSdkToolApprovalRequest) => Promise<ClineSdkToolApprovalResult>;
	createToolApproval: (
		options?: KanbanToolApprovalOptions,
	) => (request: ClineSdkToolApprovalRequest) => Promise<ClineSdkToolApprovalResult>;
	dispose: () => Promise<void>;
}

export async function createClineRuntimeSetup(workspacePath: string): Promise<ClineRuntimeSetup> {
	const userInstructionService = createClineSdkUserInstructionService(workspacePath);
	const toolApprovalPolicy = createKanbanToolApprovalPolicy(workspacePath);
	try {
		await userInstructionService.start();
	} catch {}

	return {
		userInstructionService,
		resolvePrompt: (prompt: string) => resolveClineSdkWorkflowSlashCommand(prompt, userInstructionService),
		loadRules: () => loadClineSdkRulesForSystemPrompt(userInstructionService),
		toolPolicies: createKanbanToolPolicies(),
		requestToolApproval: toolApprovalPolicy.requestToolApproval,
		createToolApproval: (options = {}) => createKanbanToolApprovalPolicy(workspacePath, options).requestToolApproval,
		dispose: async () => {
			try {
				userInstructionService.stop();
			} catch {}
		},
	};
}
