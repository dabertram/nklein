import { isAbsolute, resolve } from "node:path";
import type { AgentTool } from "@clinebot/shared";
import {
	countTextLines,
	findPotentialSecretInText,
	normalizeMaxAgentWritableFileLines,
} from "../core/agent-write-guard";
import { lockedFileSystem } from "../fs/locked-file-system";

export interface WriteFilesRequest {
	path: string;
	content: string;
}

type WriteToolName = "write_file" | "write_files";

export function parseWriteFilesRequests(input: unknown): WriteFilesRequest[] {
	const toRequest = (value: unknown): WriteFilesRequest | null => {
		if (!value || typeof value !== "object") {
			return null;
		}
		const record = value as Record<string, unknown>;
		const rawPath =
			typeof record.path === "string" ? record.path : typeof record.file_path === "string" ? record.file_path : "";
		const path = rawPath.trim();
		const content = typeof record.content === "string" ? record.content : null;
		return path && content !== null ? { path, content } : null;
	};

	if (!input || typeof input !== "object") {
		return [];
	}
	const record = input as Record<string, unknown>;
	const files = record.files;
	if (Array.isArray(files)) {
		const requests = files.map(toRequest);
		return requests.every((request): request is WriteFilesRequest => request !== null) ? requests : [];
	}
	const singleRequest = toRequest(record);
	return singleRequest ? [singleRequest] : [];
}

function resolveWritablePath(workspacePath: string, rawPath: string): string {
	return isAbsolute(rawPath) ? rawPath : resolve(workspacePath, rawPath);
}

function createWriteTool(options: {
	name: WriteToolName;
	workspacePath: string;
	maxFileLines?: number | null;
}): AgentTool {
	const maxFileLines = normalizeMaxAgentWritableFileLines(options.maxFileLines);
	const isBatchTool = options.name === "write_files";
	return {
		name: options.name,
		description: isBatchTool
			? "Create or replace one or more text files. Each file entry must include both path and complete content in the same tool call. Use this for generated artifacts that fit Kanban's per-file line guard rail; split larger output across files."
			: "Create or replace one text file. Include both path and complete content in the same tool call. Use this for a generated artifact that fits Kanban's per-file line guard rail; split larger output across files.",
		inputSchema: {
			type: "object",
			properties: isBatchTool
				? {
						files: {
							type: "array",
							items: {
								type: "object",
								properties: {
									path: {
										type: "string",
										description: "Absolute path or workspace-relative path to create or replace.",
									},
									content: {
										type: "string",
										description: "Complete UTF-8 text content to write.",
									},
								},
								required: ["path", "content"],
								additionalProperties: false,
							},
							minItems: 1,
						},
					}
				: {
						path: {
							type: "string",
							description: "Absolute path or workspace-relative path to create or replace.",
						},
						content: {
							type: "string",
							description: "Complete UTF-8 text content to write.",
						},
					},
			required: isBatchTool ? ["files"] : ["path", "content"],
			additionalProperties: false,
		},
		async execute(input) {
			const requests = parseWriteFilesRequests(input);
			if (requests.length === 0) {
				throw new Error(`${options.name} requires path and content fields.`);
			}
			if (!isBatchTool && requests.length !== 1) {
				throw new Error("write_file writes exactly one file. Use write_files for batches.");
			}
			const validatedRequests: Array<{ path: string; content: string; lines: number }> = [];
			for (const request of requests) {
				const lineCount = countTextLines(request.content);
				if (lineCount > maxFileLines) {
					throw new Error(
						`Blocked ${options.name}: writing ${lineCount} lines to ${request.path} exceeds the ${maxFileLines}-line file limit. Split content across multiple files or raise the global setting intentionally.`,
					);
				}
				const secretFinding = findPotentialSecretInText(request.content);
				if (secretFinding) {
					throw new Error(
						`Blocked ${options.name}: potential ${secretFinding.label} detected in ${request.path}. Remove the secret, replace it with a placeholder, or store it in the runtime's configured secret store before retrying.`,
					);
				}
				validatedRequests.push({ ...request, lines: lineCount });
			}
			const written: Array<{ path: string; lines: number }> = [];
			for (const request of validatedRequests) {
				await lockedFileSystem.writeTextFileAtomic(
					resolveWritablePath(options.workspacePath, request.path),
					request.content,
				);
				written.push({ path: request.path, lines: request.lines });
			}
			return {
				written,
				instruction: `Wrote ${written.length} file${written.length === 1 ? "" : "s"}. Continue from these files instead of repeating the same ${options.name} call.`,
			};
		},
	};
}

export function createWriteFileTool(options: { workspacePath: string; maxFileLines?: number | null }): AgentTool {
	return createWriteTool({ name: "write_file", ...options });
}

export function createWriteFilesTool(options: { workspacePath: string; maxFileLines?: number | null }): AgentTool {
	return createWriteTool({ name: "write_files", ...options });
}
