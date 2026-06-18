import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
	countTextLines,
	DEFAULT_MAX_AGENT_WRITABLE_FILE_LINES,
	findPotentialSecretInText,
	findProtectedTestPath,
	normalizeMaxAgentWritableFileLines,
} from "../core/agent-write-guard";
import { buildKanbanContextSafetyBudgets, countKanbanTextTokens } from "./cline-context-budgets";
import { KANBAN_DECOMPOSE_WORKFLOW_MARKDOWN } from "./cline-decomposition-workflow";
import { CLINE_GUIDANCE_SKILL_DEFAULTS } from "./cline-guidance-skills";
import { isLargeFileForWorkflow, parseReadFileRequests } from "./cline-large-file-workflow";
import { parseWriteFilesRequests } from "./cline-write-files-tool";
import {
	type ClineSdkStartSessionInput,
	type ClineSdkToolApprovalRequest,
	type ClineSdkToolApprovalResult,
	type ClineSdkUserInstructionService,
	createClineSdkUserInstructionService,
	loadClineSdkRulesForSystemPrompt,
	resolveClineSdkSkillSearchPaths,
	resolveClineSdkWorkflowSearchPaths,
	resolveClineSdkWorkflowSlashCommand,
} from "./sdk-runtime-boundary";

export interface KanbanToolApprovalOptions {
	contextWindow?: number | null;
	maxAgentWritableFileLines?: number | null;
}

async function readFileLineCount(path: string): Promise<number | null> {
	try {
		await access(path);
		const content = await readFile(path, "utf-8");
		return countTextLines(content);
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
	| { type: "add"; path: string; addedLines: number; addedText: string }
	| { type: "update"; path: string; delta: number; addedText: string }
	| { type: "delete"; path: string };

function appendPatchAddedLine(existing: string, line: string): string {
	return existing ? `${existing}\n${line}` : line;
}

function buildSecretWriteBlockReason(toolName: string, path: string, label: string): string {
	return `Blocked ${toolName}: potential ${label} detected in ${path}. Remove the secret, replace it with a placeholder, or store it in the runtime's configured secret store before retrying.`;
}

function buildProtectedTestBlockReason(toolName: string, path: string): string {
	return `Blocked ${toolName}: ${path} is part of the protected test suite. Changing protected tests requires explicit human approval with intent, diff, reason, and expected effects.`;
}

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
				current = { type: "add", path, addedLines: 0, addedText: "" };
			} else if (action === "Update") {
				current = { type: "update", path, delta: 0, addedText: "" };
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
				current.addedText = appendPatchAddedLine(current.addedText, line.slice(1));
			}
			continue;
		}
		if (current.type === "update") {
			if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
				continue;
			}
			if (line.startsWith("+")) {
				current.delta += 1;
				current.addedText = appendPatchAddedLine(current.addedText, line.slice(1));
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
		reason: `Approved by !Klein runtime for ${request.toolName}.`,
	};
}

async function approveEditorTool(
	workspacePath: string,
	request: ClineSdkToolApprovalRequest,
	maxAgentWritableFileLines: number,
): Promise<ClineSdkToolApprovalResult> {
	if (!request.input || typeof request.input !== "object") {
		return {
			approved: true,
			reason: `Approved by !Klein runtime for ${request.toolName}.`,
		};
	}
	const input = request.input as Record<string, unknown>;
	const rawPath = typeof input.path === "string" ? input.path.trim() : "";
	if (!rawPath) {
		return {
			approved: true,
			reason: `Approved by !Klein runtime for ${request.toolName}.`,
		};
	}
	const protectedPath = findProtectedTestPath(rawPath);
	if (protectedPath) {
		return {
			approved: false,
			reason: buildProtectedTestBlockReason(request.toolName, protectedPath),
		};
	}
	const path = resolveToolPath(workspacePath, rawPath);
	const currentText = (await readFile(path, "utf-8").catch(() => "")) as string;
	const currentLines = countTextLines(currentText);

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

	const nextLines = countTextLines(nextText);
	if (nextLines > maxAgentWritableFileLines) {
		return {
			approved: false,
			reason: `Blocked ${request.toolName}: writing ${nextLines} lines to ${rawPath} exceeds the ${maxAgentWritableFileLines}-line file limit. Split content across multiple files.`,
		};
	}
	const secretFinding = findPotentialSecretInText(newText);
	if (secretFinding) {
		return {
			approved: false,
			reason: buildSecretWriteBlockReason(request.toolName, rawPath, secretFinding.label),
		};
	}

	return {
		approved: true,
		reason: `Approved by !Klein runtime for ${request.toolName} (${currentLines} -> ${nextLines} lines).`,
	};
}

async function approveWriteFilesTool(
	request: ClineSdkToolApprovalRequest,
	maxAgentWritableFileLines: number,
): Promise<ClineSdkToolApprovalResult> {
	const writeRequests = parseWriteFilesRequests(request.input);
	if (writeRequests.length === 0) {
		return {
			approved: false,
			reason: `Blocked ${request.toolName}: no files with path and content fields were provided.`,
		};
	}
	for (const writeRequest of writeRequests) {
		const protectedPath = findProtectedTestPath(writeRequest.path);
		if (protectedPath) {
			return {
				approved: false,
				reason: buildProtectedTestBlockReason(request.toolName, protectedPath),
			};
		}
		const lineCount = countTextLines(writeRequest.content);
		if (lineCount > maxAgentWritableFileLines) {
			return {
				approved: false,
				reason: `Blocked ${request.toolName}: writing ${lineCount} lines to ${writeRequest.path} exceeds the ${maxAgentWritableFileLines}-line file limit. Split content across multiple files.`,
			};
		}
		const secretFinding = findPotentialSecretInText(writeRequest.content);
		if (secretFinding) {
			return {
				approved: false,
				reason: buildSecretWriteBlockReason(request.toolName, writeRequest.path, secretFinding.label),
			};
		}
	}
	return {
		approved: true,
		reason: `Approved by !Klein runtime for ${request.toolName}.`,
	};
}

async function approveApplyPatchTool(
	workspacePath: string,
	request: ClineSdkToolApprovalRequest,
	maxAgentWritableFileLines: number,
): Promise<ClineSdkToolApprovalResult> {
	const targets = parseApplyPatchTargets(request.input);
	if (targets.length === 0) {
		return {
			approved: false,
			reason: `Blocked ${request.toolName}: could not identify changed files in patch input. Retry with a standard apply_patch body.`,
		};
	}
	for (const target of targets) {
		const protectedPath = findProtectedTestPath(target.path);
		if (protectedPath) {
			return {
				approved: false,
				reason: buildProtectedTestBlockReason(request.toolName, protectedPath),
			};
		}
		if (target.type === "delete") {
			continue;
		}
		const secretFinding = findPotentialSecretInText(target.addedText);
		if (secretFinding) {
			return {
				approved: false,
				reason: buildSecretWriteBlockReason(request.toolName, target.path, secretFinding.label),
			};
		}
		const path = resolveToolPath(workspacePath, target.path);
		if (target.type === "add") {
			if (target.addedLines > maxAgentWritableFileLines) {
				return {
					approved: false,
					reason: `Blocked ${request.toolName}: new file ${target.path} would exceed the ${maxAgentWritableFileLines}-line file limit.`,
				};
			}
			continue;
		}

		const currentLines = (await readFileLineCount(path)) ?? 0;
		const nextLines = currentLines + target.delta;
		if (nextLines > maxAgentWritableFileLines) {
			return {
				approved: false,
				reason: `Blocked ${request.toolName}: patch would grow ${target.path} to ${nextLines} lines, above the ${maxAgentWritableFileLines}-line file limit.`,
			};
		}
	}

	return {
		approved: true,
		reason: `Approved by !Klein runtime for ${request.toolName}.`,
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
			const maxAgentWritableFileLines = normalizeMaxAgentWritableFileLines(
				options.maxAgentWritableFileLines ?? DEFAULT_MAX_AGENT_WRITABLE_FILE_LINES,
			);
			switch (request.toolName) {
				case "read_files":
					return await approveReadFilesTool(workspacePath, request, options);
				case "editor":
					return await approveEditorTool(workspacePath, request, maxAgentWritableFileLines);
				case "write_file":
				case "write_files":
					return await approveWriteFilesTool(request, maxAgentWritableFileLines);
				case "apply_patch":
					return await approveApplyPatchTool(workspacePath, request, maxAgentWritableFileLines);
				default:
					return {
						approved: true,
						reason: `Approved by !Klein runtime for ${request.toolName}.`,
					};
			}
		},
	};
}

export function createKanbanToolPolicies(): NonNullable<ClineSdkStartSessionInput["toolPolicies"]> {
	return {
		find_files: { enabled: true, autoApprove: false },
		list_files: { enabled: true, autoApprove: false },
		get_file_size: { enabled: true, autoApprove: false },
		read_files: { enabled: true, autoApprove: false },
		read_large_file: { enabled: true, autoApprove: false },
		write_file: { enabled: true, autoApprove: false },
		write_files: { enabled: true, autoApprove: false },
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

function isNodeErrorWithCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

function resolveWorkspaceWorkflowDirectory(workspacePath: string): string {
	return resolveWorkspaceInstructionDirectory({
		workspacePath,
		searchPaths: resolveClineSdkWorkflowSearchPaths(workspacePath),
		fallbackDirectory: join(workspacePath, ".cline", "workflows"),
	});
}

function resolveWorkspaceSkillDirectory(workspacePath: string): string {
	return resolveWorkspaceInstructionDirectory({
		workspacePath,
		searchPaths: resolveClineSdkSkillSearchPaths(workspacePath),
		fallbackDirectory: join(workspacePath, ".cline", "skills"),
	});
}

function resolveWorkspaceInstructionDirectory(input: {
	workspacePath: string;
	searchPaths: readonly string[];
	fallbackDirectory: string;
}): string {
	const resolvedWorkspacePath = resolve(input.workspacePath);
	const workspacePathWithSeparator = `${resolvedWorkspacePath}/`;
	return (
		input.searchPaths.find((searchPath) => {
			const resolvedSearchPath = resolve(searchPath);
			return (
				resolvedSearchPath === resolvedWorkspacePath || resolvedSearchPath.startsWith(workspacePathWithSeparator)
			);
		}) ?? input.fallbackDirectory
	);
}

async function excludeGeneratedInstructionFromGit(workspacePath: string, instructionPath: string): Promise<void> {
	const resolvedWorkspacePath = resolve(workspacePath);
	const resolvedInstructionPath = resolve(instructionPath);
	const relativeInstructionPath = relative(resolvedWorkspacePath, resolvedInstructionPath);
	if (!relativeInstructionPath || relativeInstructionPath.startsWith("..") || isAbsolute(relativeInstructionPath)) {
		return;
	}
	const excludePath = join(resolvedWorkspacePath, ".git", "info", "exclude");
	try {
		const existing = await readFile(excludePath, "utf8").catch(() => "");
		const normalizedRelativePath = relativeInstructionPath.replaceAll("\\", "/");
		const excludeLine = `/${normalizedRelativePath}`;
		if (existing.split(/\r?\n/).includes(excludeLine)) {
			return;
		}
		await mkdir(join(resolvedWorkspacePath, ".git", "info"), { recursive: true });
		await appendFile(excludePath, `${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}${excludeLine}\n`, {
			encoding: "utf8",
		});
	} catch {
		// Best effort only: the instruction is still useful even if the workspace is not a Git repository yet.
	}
}

export async function ensureKanbanDefaultWorkflows(workspacePath: string): Promise<string> {
	const workflowDirectory = resolveWorkspaceWorkflowDirectory(workspacePath);
	const workflowPath = join(workflowDirectory, "kanban-decompose.md");
	await mkdir(workflowDirectory, { recursive: true });
	try {
		await writeFile(workflowPath, KANBAN_DECOMPOSE_WORKFLOW_MARKDOWN, { encoding: "utf8", flag: "wx" });
	} catch (error) {
		if (!isNodeErrorWithCode(error, "EEXIST")) {
			throw error;
		}
	}
	await excludeGeneratedInstructionFromGit(workspacePath, workflowPath);
	return workflowPath;
}

export async function ensureKanbanDefaultSkills(workspacePath: string): Promise<string[]> {
	const skillDirectory = resolveWorkspaceSkillDirectory(workspacePath);
	await mkdir(skillDirectory, { recursive: true });
	const seededPaths: string[] = [];
	for (const skill of CLINE_GUIDANCE_SKILL_DEFAULTS) {
		const skillPath = join(skillDirectory, skill.directoryName, "SKILL.md");
		await mkdir(join(skillDirectory, skill.directoryName), { recursive: true });
		try {
			await writeFile(skillPath, skill.markdown, { encoding: "utf8", flag: "wx" });
		} catch (error) {
			if (!isNodeErrorWithCode(error, "EEXIST")) {
				throw error;
			}
		}
		await excludeGeneratedInstructionFromGit(workspacePath, skillPath);
		seededPaths.push(skillPath);
	}
	return seededPaths;
}

export async function createClineRuntimeSetup(workspacePath: string): Promise<ClineRuntimeSetup> {
	await ensureKanbanDefaultWorkflows(workspacePath);
	await ensureKanbanDefaultSkills(workspacePath);
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
