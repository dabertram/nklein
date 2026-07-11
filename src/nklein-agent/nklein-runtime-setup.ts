import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
	buildProtectedTestApprovalRequest,
	countTextLines,
	DEFAULT_MAX_AGENT_WRITABLE_FILE_LINES,
	findPotentialSecretInText,
	findProtectedTestPath,
	formatProtectedTestBlockReason,
	HARD_WRITE_BACKSTOP_MULTIPLIER,
	normalizeMaxAgentWritableFileLines,
	resolveHardWriteBackstopLines,
} from "../core/agent-write-guard";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { type ProtectedTestApprovalStore, protectedTestApprovalStore } from "../core/protected-test-approval-store";
import { buildAgentSandboxWorkdir } from "./nklein-agent-sandbox";
import { parseApplyPatchTargets } from "./nklein-apply-patch-targets";
import { buildKanbanContextSafetyBudgets, countKanbanTextTokens } from "./nklein-context-budgets";
import { KANBAN_DECOMPOSE_WORKFLOW_MARKDOWN } from "./nklein-decomposition-workflow";
import { parseEditFileRequest } from "./nklein-edit-file-tool";
import { NKLEIN_GUIDANCE_SKILL_DEFAULTS } from "./nklein-guidance-skills";
import { isLargeFileForWorkflow } from "./nklein-large-file-workflow";
import { parseReadFileRequests } from "./nklein-read-file-request";
import { confineToolPath } from "./nklein-tool-path-containment";
import { parseWriteFilesRequests } from "./nklein-write-files-tool";
import { normalizeScopePath, normalizeWriteScope } from "./nklein-write-scope";
import {
	createNKleinSdkUserInstructionService,
	loadNKleinSdkRulesForSystemPrompt,
	type NKleinSdkStartSessionInput,
	type NKleinSdkToolApprovalRequest,
	type NKleinSdkToolApprovalResult,
	type NKleinSdkUserInstructionService,
	resolveNKleinSdkSkillSearchPaths,
	resolveNKleinSdkWorkflowSearchPaths,
	resolveNKleinSdkWorkflowSlashCommand,
} from "./sdk-runtime-boundary";

export interface KanbanToolApprovalOptions {
	contextWindow?: number | null;
	maxAgentWritableFileLines?: number | null;
	taskId?: string | null;
	filesLikelyTouched?: readonly string[] | null;
	protectedTestApprovals?: ProtectedTestApprovalStore;
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

function buildSecretWriteBlockReason(toolName: string, path: string, label: string): string {
	return `Blocked ${toolName}: potential ${label} detected in ${path}. Remove the secret, replace it with a placeholder, or store it in the runtime's configured secret store before retrying.`;
}

function extractScopedWriteTargetPaths(request: NKleinSdkToolApprovalRequest): string[] {
	if (request.toolName === "write_file" || request.toolName === "write_files") {
		return parseWriteFilesRequests(request.input).map((writeRequest) => writeRequest.path);
	}
	if (request.toolName === "apply_patch") {
		return parseApplyPatchTargets(request.input).map((target) => target.path);
	}
	if (request.toolName === "edit_file") {
		const parsed = parseEditFileRequest(request.input);
		return parsed ? [parsed.path] : [];
	}
	if (request.toolName !== "editor" || !request.input || typeof request.input !== "object") {
		return [];
	}
	const rawPath = (request.input as Record<string, unknown>).path;
	return typeof rawPath === "string" && rawPath.trim() ? [rawPath] : [];
}

/**
 * Every path-bearing field the tool would read or write, for the workspace-containment gate (§5.Y #4). Covers the
 * read tools too (not just the scoped-write tools): a `read_files` / `read_large_file` with a host-absolute path
 * outside the workspace, or a `..` escape, must be rejected by the approval layer as defense-in-depth even though
 * the in-tool containment is the primary boundary.
 */
function extractToolPathTargets(request: NKleinSdkToolApprovalRequest): string[] {
	if (request.toolName === "read_files") {
		return parseReadFileRequests(request.input).map((readRequest) => readRequest.path);
	}
	if (request.toolName === "read_large_file") {
		if (!request.input || typeof request.input !== "object") {
			return [];
		}
		const rawPath = (request.input as Record<string, unknown>).path;
		return typeof rawPath === "string" && rawPath.trim() ? [rawPath] : [];
	}
	return extractScopedWriteTargetPaths(request);
}

/**
 * Defense-in-depth workspace containment at the approval layer (§5.Y #4). The approval policy is constructed with
 * the HOST workspace root, but a Docker-isolated task's agent uses container paths (`/workspaces/<taskId>/...`).
 * So we allow the sandbox container workdir as an additional root for a non-home task, plus host-absolute paths
 * within the host root and workspace-relative paths; genuine escapes (host-absolute outside the root, `..`
 * traversal) are denied with a non-leaky, workspace-relative reason. This mirrors the in-tool check so a path that
 * reaches the tools is confined regardless of whether the sandbox proxy is present.
 */
function approveToolPathContainment(
	workspacePath: string,
	request: NKleinSdkToolApprovalRequest,
	options: KanbanToolApprovalOptions,
): NKleinSdkToolApprovalResult | null {
	const targetPaths = extractToolPathTargets(request);
	if (targetPaths.length === 0) {
		return null;
	}
	const taskId = options.taskId?.trim();
	const sandboxWorkdir = taskId && !isHomeAgentSessionId(taskId) ? buildAgentSandboxWorkdir(taskId) : null;
	for (const targetPath of targetPaths) {
		const contained = confineToolPath(workspacePath, targetPath, { sandboxWorkdir });
		if (!contained.ok) {
			return {
				approved: false,
				reason: `Blocked ${request.toolName}: ${contained.message} Operate only on files within this card's workspace.`,
			};
		}
	}
	return null;
}

function approveScopedWriteTargets(
	workspacePath: string,
	request: NKleinSdkToolApprovalRequest,
	options: KanbanToolApprovalOptions,
): NKleinSdkToolApprovalResult | null {
	const allowedPaths = normalizeWriteScope(workspacePath, options.taskId, options.filesLikelyTouched);
	if (allowedPaths.size === 0) {
		return null;
	}
	const targetPaths = extractScopedWriteTargetPaths(request);
	if (targetPaths.length === 0) {
		return null;
	}
	for (const targetPath of targetPaths) {
		const normalizedTarget = normalizeScopePath(targetPath, workspacePath, options.taskId);
		if (!allowedPaths.has(normalizedTarget)) {
			return {
				approved: false,
				reason: `Blocked ${request.toolName}: ${targetPath} is outside this card's declared file scope (${Array.from(allowedPaths).join(", ")}). Update only the scoped files for this card, or revise the card's likely touched files before starting it.`,
			};
		}
	}
	return null;
}

async function approveReadFilesTool(
	workspacePath: string,
	request: NKleinSdkToolApprovalRequest,
	options: KanbanToolApprovalOptions,
): Promise<NKleinSdkToolApprovalResult> {
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
	request: NKleinSdkToolApprovalRequest,
	maxAgentWritableFileLines: number,
	options: KanbanToolApprovalOptions,
): Promise<NKleinSdkToolApprovalResult> {
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
	const newText = typeof input.new_text === "string" ? input.new_text : "";
	const protectedPath = findProtectedTestPath(rawPath);
	if (protectedPath) {
		const approvalRequest = buildProtectedTestApprovalRequest({
			toolName: request.toolName,
			path: protectedPath,
			diff: newText,
			reason: "The editor tool attempted to change a protected test-suite file.",
			expectedEffects: "The protected test-suite file would be edited with the supplied new text.",
		});
		const grant = options.protectedTestApprovals?.consume({
			taskId: options.taskId,
			request: approvalRequest,
		});
		if (grant) {
			return {
				approved: true,
				reason: `Approved by !Klein runtime for ${request.toolName}: one-use protected-test approval granted at ${new Date(grant.approvedAt).toISOString()}.`,
			};
		}
		return {
			approved: false,
			reason: formatProtectedTestBlockReason({
				toolName: request.toolName,
				path: protectedPath,
				diff: newText,
				reason: "The editor tool attempted to change a protected test-suite file.",
				expectedEffects: "The protected test-suite file would be edited with the supplied new text.",
			}),
		};
	}
	const path = resolveToolPath(workspacePath, rawPath);
	const currentText = (await readFile(path, "utf-8").catch(() => "")) as string;
	const currentLines = countTextLines(currentText);

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
	// SOFT target, not a hard wall (207bb4f5 / §5.BF 2026-07-11): allow over-target writes up to the hard backstop so
	// the approval layer stops contradicting the system prompt (which tells models the limit is soft + MAY be exceeded).
	const hardBackstopLines = resolveHardWriteBackstopLines(maxAgentWritableFileLines);
	if (nextLines > hardBackstopLines) {
		return {
			approved: false,
			reason: `Blocked ${request.toolName}: writing ${nextLines} lines to ${rawPath} exceeds the ${hardBackstopLines}-line hard backstop (${HARD_WRITE_BACKSTOP_MULTIPLIER}× the ${maxAgentWritableFileLines}-line soft target). Split content across multiple files.`,
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
	request: NKleinSdkToolApprovalRequest,
	maxAgentWritableFileLines: number,
	options: KanbanToolApprovalOptions,
): Promise<NKleinSdkToolApprovalResult> {
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
			const approvalRequest = buildProtectedTestApprovalRequest({
				toolName: request.toolName,
				path: protectedPath,
				diff: writeRequest.content,
				reason: "The write-file tool attempted to replace a protected test-suite file.",
				expectedEffects: "The protected test-suite file would be replaced with the supplied content.",
			});
			const grant = options.protectedTestApprovals?.consume({
				taskId: options.taskId,
				request: approvalRequest,
			});
			if (grant) {
				return {
					approved: true,
					reason: `Approved by !Klein runtime for ${request.toolName}: one-use protected-test approval granted at ${new Date(grant.approvedAt).toISOString()}.`,
				};
			}
			return {
				approved: false,
				reason: formatProtectedTestBlockReason({
					toolName: request.toolName,
					path: protectedPath,
					diff: writeRequest.content,
					reason: "The write-file tool attempted to replace a protected test-suite file.",
					expectedEffects: "The protected test-suite file would be replaced with the supplied content.",
				}),
			};
		}
		const lineCount = countTextLines(writeRequest.content);
		// SOFT target (207bb4f5 / §5.BF 2026-07-11): match the write tool's own semantics — allow over-target writes
		// up to the hard backstop; hard-denying at the soft target here made the tool's soft-target design dead code.
		const hardBackstopLines = resolveHardWriteBackstopLines(maxAgentWritableFileLines);
		if (lineCount > hardBackstopLines) {
			return {
				approved: false,
				reason: `Blocked ${request.toolName}: writing ${lineCount} lines to ${writeRequest.path} exceeds the ${hardBackstopLines}-line hard backstop (${HARD_WRITE_BACKSTOP_MULTIPLIER}× the ${maxAgentWritableFileLines}-line soft target). Split content across multiple files.`,
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
	request: NKleinSdkToolApprovalRequest,
	maxAgentWritableFileLines: number,
	options: KanbanToolApprovalOptions,
): Promise<NKleinSdkToolApprovalResult> {
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
			const approvalRequest = buildProtectedTestApprovalRequest({
				toolName: request.toolName,
				path: protectedPath,
				diff: target.type === "delete" ? `Delete ${target.path}` : target.addedText,
				reason: "The patch tool attempted to change a protected test-suite path.",
				expectedEffects: "The protected test-suite path would be changed by the supplied patch.",
			});
			const grant = options.protectedTestApprovals?.consume({
				taskId: options.taskId,
				request: approvalRequest,
			});
			if (grant) {
				return {
					approved: true,
					reason: `Approved by !Klein runtime for ${request.toolName}: one-use protected-test approval granted at ${new Date(grant.approvedAt).toISOString()}.`,
				};
			}
			return {
				approved: false,
				reason: formatProtectedTestBlockReason({
					toolName: request.toolName,
					path: protectedPath,
					diff: target.type === "delete" ? `Delete ${target.path}` : target.addedText,
					reason: "The patch tool attempted to change a protected test-suite path.",
					expectedEffects: "The protected test-suite path would be changed by the supplied patch.",
				}),
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
		// SOFT target (207bb4f5 / §5.BF 2026-07-11): allow over-target patches up to the hard backstop, matching the
		// write tool + system prompt; only a runaway (soft × multiplier) is denied.
		const hardBackstopLines = resolveHardWriteBackstopLines(maxAgentWritableFileLines);
		if (target.type === "add") {
			if (target.addedLines > hardBackstopLines) {
				return {
					approved: false,
					reason: `Blocked ${request.toolName}: new file ${target.path} (${target.addedLines} lines) exceeds the ${hardBackstopLines}-line hard backstop (${HARD_WRITE_BACKSTOP_MULTIPLIER}× the ${maxAgentWritableFileLines}-line soft target).`,
				};
			}
			continue;
		}

		const currentLines = (await readFileLineCount(path)) ?? 0;
		const nextLines = currentLines + target.delta;
		if (nextLines > hardBackstopLines) {
			return {
				approved: false,
				reason: `Blocked ${request.toolName}: patch would grow ${target.path} to ${nextLines} lines, exceeding the ${hardBackstopLines}-line hard backstop (${HARD_WRITE_BACKSTOP_MULTIPLIER}× the ${maxAgentWritableFileLines}-line soft target).`,
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
	requestToolApproval: (request: NKleinSdkToolApprovalRequest) => Promise<NKleinSdkToolApprovalResult>;
} {
	return {
		requestToolApproval: async (request: NKleinSdkToolApprovalRequest) => {
			const maxAgentWritableFileLines = normalizeMaxAgentWritableFileLines(
				options.maxAgentWritableFileLines ?? DEFAULT_MAX_AGENT_WRITABLE_FILE_LINES,
			);
			const approvalOptions: KanbanToolApprovalOptions = {
				...options,
				protectedTestApprovals: options.protectedTestApprovals ?? protectedTestApprovalStore,
			};
			const containmentDenial = approveToolPathContainment(workspacePath, request, approvalOptions);
			if (containmentDenial) {
				return containmentDenial;
			}
			const scopedWriteApproval = approveScopedWriteTargets(workspacePath, request, approvalOptions);
			if (scopedWriteApproval) {
				return scopedWriteApproval;
			}
			switch (request.toolName) {
				case "read_files":
					return await approveReadFilesTool(workspacePath, request, options);
				case "editor":
					return await approveEditorTool(workspacePath, request, maxAgentWritableFileLines, approvalOptions);
				case "write_file":
				case "write_files":
					return await approveWriteFilesTool(request, maxAgentWritableFileLines, approvalOptions);
				case "apply_patch":
					return await approveApplyPatchTool(workspacePath, request, maxAgentWritableFileLines, approvalOptions);
				default:
					return {
						approved: true,
						reason: `Approved by !Klein runtime for ${request.toolName}.`,
					};
			}
		},
	};
}

export function createKanbanToolPolicies(): NonNullable<NKleinSdkStartSessionInput["toolPolicies"]> {
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

export interface NKleinRuntimeSetup {
	userInstructionService: NKleinSdkUserInstructionService;
	resolvePrompt: (prompt: string) => string;
	loadRules: () => string;
	toolPolicies: NonNullable<NKleinSdkStartSessionInput["toolPolicies"]>;
	requestToolApproval: (request: NKleinSdkToolApprovalRequest) => Promise<NKleinSdkToolApprovalResult>;
	createToolApproval: (
		options?: KanbanToolApprovalOptions,
	) => (request: NKleinSdkToolApprovalRequest) => Promise<NKleinSdkToolApprovalResult>;
	dispose: () => Promise<void>;
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

function resolveWorkspaceWorkflowDirectory(workspacePath: string): string {
	return resolveWorkspaceInstructionDirectory({
		workspacePath,
		searchPaths: resolveNKleinSdkWorkflowSearchPaths(workspacePath),
		fallbackDirectory: join(workspacePath, ".nklein", "workflows"),
	});
}

function resolveWorkspaceSkillDirectory(workspacePath: string): string {
	return resolveWorkspaceInstructionDirectory({
		workspacePath,
		searchPaths: resolveNKleinSdkSkillSearchPaths(workspacePath),
		fallbackDirectory: join(workspacePath, ".nklein", "skills"),
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
	for (const skill of NKLEIN_GUIDANCE_SKILL_DEFAULTS) {
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

export async function createNKleinRuntimeSetup(workspacePath: string): Promise<NKleinRuntimeSetup> {
	await ensureKanbanDefaultWorkflows(workspacePath);
	await ensureKanbanDefaultSkills(workspacePath);
	const userInstructionService = createNKleinSdkUserInstructionService(workspacePath);
	const toolApprovalPolicy = createKanbanToolApprovalPolicy(workspacePath);
	try {
		await userInstructionService.start();
	} catch {}

	return {
		userInstructionService,
		resolvePrompt: (prompt: string) => resolveNKleinSdkWorkflowSlashCommand(prompt, userInstructionService),
		loadRules: () => loadNKleinSdkRulesForSystemPrompt(userInstructionService),
		toolPolicies: createKanbanToolPolicies(),
		requestToolApproval: toolApprovalPolicy.requestToolApproval,
		createToolApproval: (options = {}) =>
			createKanbanToolApprovalPolicy(workspacePath, {
				...options,
				protectedTestApprovals: options.protectedTestApprovals ?? protectedTestApprovalStore,
			}).requestToolApproval,
		dispose: async () => {
			try {
				userInstructionService.stop();
			} catch {}
		},
	};
}
