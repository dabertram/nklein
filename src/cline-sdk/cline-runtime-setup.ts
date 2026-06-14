import { access, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

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
const MAX_AGENT_READABLE_CHUNK_CHARS = 32_000;
const MAX_AGENT_READABLE_CHUNK_TOKEN_ESTIMATE = Math.ceil(MAX_AGENT_READABLE_CHUNK_CHARS / 4);

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

function resolveToolPath(workspacePath: string, rawPath: string): string {
	return isAbsolute(rawPath) ? rawPath : resolve(workspacePath, rawPath);
}

function asNumber(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	return Math.trunc(value);
}

function toReadFileRequests(input: unknown): Array<{ path: string; startLine: number | null; endLine: number | null }> {
	const toRequest = (value: unknown): { path: string; startLine: number | null; endLine: number | null } | null => {
		if (typeof value === "string") {
			const trimmed = value.trim();
			if (!trimmed) {
				return null;
			}
			return { path: trimmed, startLine: null, endLine: null };
		}
		if (!value || typeof value !== "object") {
			return null;
		}
		const record = value as Record<string, unknown>;
		const path = typeof record.path === "string" ? record.path.trim() : "";
		if (!path) {
			return null;
		}
		return {
			path,
			startLine: asNumber(record.start_line),
			endLine: asNumber(record.end_line),
		};
	};

	if (typeof input === "string") {
		const request = toRequest(input);
		return request ? [request] : [];
	}
	if (Array.isArray(input)) {
		return input
			.map((value) => toRequest(value))
			.filter((value): value is NonNullable<typeof value> => Boolean(value));
	}
	if (!input || typeof input !== "object") {
		return [];
	}
	const record = input as Record<string, unknown>;
	if (Array.isArray(record.files)) {
		return record.files
			.map((value) => toRequest(value))
			.filter((value): value is NonNullable<typeof value> => Boolean(value));
	}
	if (Array.isArray(record.file_paths)) {
		return record.file_paths
			.map((value) => toRequest(value))
			.filter((value): value is NonNullable<typeof value> => Boolean(value));
	}
	if (typeof record.file_paths === "string") {
		const request = toRequest(record.file_paths);
		return request ? [request] : [];
	}
	if (Array.isArray(record.paths)) {
		return record.paths
			.map((value) => toRequest(value))
			.filter((value): value is NonNullable<typeof value> => Boolean(value));
	}
	if (record.paths) {
		const request = toRequest(record.paths);
		return request ? [request] : [];
	}
	const request = toRequest(record);
	return request ? [request] : [];
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
): Promise<ClineSdkToolApprovalResult> {
	const readRequests = toReadFileRequests(request.input);
	let totalRequestedChars = 0;
	for (const readRequest of readRequests) {
		const absolutePath = resolveToolPath(workspacePath, readRequest.path);
		const content = await readFileText(absolutePath);
		if (content === null) {
			continue;
		}
		const totalChars = content.length;

		const startLine = readRequest.startLine;
		const endLine = readRequest.endLine;
		if (totalChars > MAX_AGENT_READABLE_CHUNK_CHARS) {
			if (typeof startLine !== "number" || typeof endLine !== "number" || startLine <= 0 || endLine < startLine) {
				return {
					approved: false,
					reason: `Blocked ${request.toolName}: files above ${MAX_AGENT_READABLE_CHUNK_CHARS.toLocaleString()} characters require explicit start_line and end_line ranges.`,
				};
			}
		}

		const requestedText =
			typeof startLine === "number" && typeof endLine === "number"
				? content
						.split("\n")
						.slice(Math.max(0, startLine - 1), Math.max(0, endLine))
						.join("\n")
				: content;
		totalRequestedChars += requestedText.length;
		if (totalRequestedChars > MAX_AGENT_READABLE_CHUNK_CHARS) {
			return {
				approved: false,
				reason: `Blocked ${request.toolName}: requested file content is ~${totalRequestedChars.toLocaleString()} characters, above the ${MAX_AGENT_READABLE_CHUNK_CHARS.toLocaleString()}-character read chunk budget (~${MAX_AGENT_READABLE_CHUNK_TOKEN_ESTIMATE.toLocaleString()} tokens before tool framing). Retry with smaller line ranges; do not rely on truncation.`,
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

export function createKanbanToolApprovalPolicy(workspacePath: string): {
	requestToolApproval: (request: ClineSdkToolApprovalRequest) => Promise<ClineSdkToolApprovalResult>;
} {
	return {
		requestToolApproval: async (request: ClineSdkToolApprovalRequest) => {
			switch (request.toolName) {
				case "read_files":
					return await approveReadFilesTool(workspacePath, request);
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
		dispose: async () => {
			try {
				userInstructionService.stop();
			} catch {}
		},
	};
}
