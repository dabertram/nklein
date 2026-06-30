import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { buildKanbanContextSafetyBudgets, countKanbanTextTokens } from "./nklein-context-budgets";
import { isLargeFileForWorkflow } from "./nklein-large-file-workflow";
import type { AgentTool } from "./sdk-agent-types";

const DEFAULT_MAX_RESULTS = 200;
const MAX_RESULTS_LIMIT = 1_000;
const DEFAULT_MAX_DEPTH = 3;
const MAX_DEPTH_LIMIT = 20;
const DEFAULT_EXCLUDED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo"]);

interface FileDiscoveryEntry {
	path: string;
	type: "file" | "directory" | "symlink" | "other";
	sizeBytes: number | null;
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function asBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.max(min, Math.min(max, Math.trunc(value)));
}

function normalizeHostWorkspacePath(rawPath: string | null, hostWorkspacePath?: string | null): string | null {
	if (!rawPath || !isAbsolute(rawPath)) {
		return rawPath;
	}
	const normalizedHostWorkspacePath = hostWorkspacePath ? resolve(hostWorkspacePath) : null;
	if (!normalizedHostWorkspacePath) {
		return rawPath;
	}
	const resolvedRawPath = resolve(rawPath);
	if (resolvedRawPath === normalizedHostWorkspacePath) {
		return ".";
	}
	const relativePath = relative(normalizedHostWorkspacePath, resolvedRawPath);
	if (relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)) {
		return relativePath;
	}
	return rawPath;
}

function resolveWorkspacePath(
	workspacePath: string,
	rawPath: string | null,
	hostWorkspacePath?: string | null,
): string {
	const resolvedWorkspacePath = resolve(workspacePath);
	const normalizedRawPath = normalizeHostWorkspacePath(rawPath, hostWorkspacePath);
	const resolvedPath = normalizedRawPath
		? isAbsolute(normalizedRawPath)
			? resolve(normalizedRawPath)
			: resolve(resolvedWorkspacePath, normalizedRawPath)
		: resolvedWorkspacePath;
	const relativePath = relative(resolvedWorkspacePath, resolvedPath);
	if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
		return resolvedPath;
	}
	throw new Error(`Path ${rawPath ?? "."} is outside the workspace. Use a workspace-relative path.`);
}

function toWorkspaceRelativePath(workspacePath: string, absolutePath: string): string {
	const relativePath = relative(resolve(workspacePath), absolutePath);
	return relativePath.length > 0 ? relativePath.split(sep).join("/") : ".";
}

function isHiddenPath(relativePath: string): boolean {
	return relativePath.split("/").some((segment) => segment.startsWith("."));
}

function globToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	const source = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
	return new RegExp(`^${source}$`, "i");
}

function createNameMatcher(
	pattern: string | null,
	query: string | null,
	extension: string | null,
): (entry: FileDiscoveryEntry) => boolean {
	const normalizedQuery = query?.toLowerCase() ?? null;
	const normalizedExtension = extension
		? extension.startsWith(".")
			? extension.toLowerCase()
			: `.${extension.toLowerCase()}`
		: null;
	const patternMatcher = pattern ? globToRegExp(pattern) : null;
	return (entry) => {
		if (entry.type !== "file") {
			return false;
		}
		const name = basename(entry.path);
		if (patternMatcher && !patternMatcher.test(name) && !patternMatcher.test(entry.path)) {
			return false;
		}
		if (
			normalizedQuery &&
			!name.toLowerCase().includes(normalizedQuery) &&
			!entry.path.toLowerCase().includes(normalizedQuery)
		) {
			return false;
		}
		if (normalizedExtension && extname(name).toLowerCase() !== normalizedExtension) {
			return false;
		}
		return true;
	};
}

async function walkEntries(options: {
	workspacePath: string;
	rootPath: string;
	recursive: boolean;
	maxDepth: number;
	includeHidden: boolean;
	maxResults: number;
	includeDirectories: boolean;
	fileFilter?: (entry: FileDiscoveryEntry) => boolean;
}): Promise<{ entries: FileDiscoveryEntry[]; truncated: boolean }> {
	const entries: FileDiscoveryEntry[] = [];
	let truncated = false;

	const visit = async (currentPath: string, depth: number): Promise<void> => {
		if (entries.length >= options.maxResults) {
			truncated = true;
			return;
		}
		const dirEntries = await readdir(currentPath, { withFileTypes: true }).catch(() => []);
		for (const dirEntry of dirEntries) {
			if (entries.length >= options.maxResults) {
				truncated = true;
				return;
			}
			if (!options.includeHidden && dirEntry.name.startsWith(".")) {
				continue;
			}
			if (dirEntry.isDirectory() && DEFAULT_EXCLUDED_DIRS.has(dirEntry.name)) {
				continue;
			}
			const absolutePath = resolve(currentPath, dirEntry.name);
			const relativePath = toWorkspaceRelativePath(options.workspacePath, absolutePath);
			if (!options.includeHidden && isHiddenPath(relativePath)) {
				continue;
			}
			const info = await lstat(absolutePath).catch(() => null);
			if (!info) {
				continue;
			}
			const entry: FileDiscoveryEntry = {
				path: relativePath,
				type: info.isDirectory()
					? "directory"
					: info.isFile()
						? "file"
						: info.isSymbolicLink()
							? "symlink"
							: "other",
				sizeBytes: info.isFile() ? info.size : null,
			};
			const includeEntry =
				entry.type === "file" ? (options.fileFilter?.(entry) ?? true) : options.includeDirectories;
			if (includeEntry) {
				entries.push(entry);
			}
			if (dirEntry.isDirectory() && options.recursive && depth < options.maxDepth) {
				await visit(absolutePath, depth + 1);
			}
		}
	};

	await visit(options.rootPath, 0);
	return { entries, truncated };
}

function createListFilesTool(workspacePath: string, hostWorkspacePath?: string | null): AgentTool {
	return {
		name: "list_files",
		description:
			"List files and directories under a workspace path without reading file contents. Use this before reading when the exact source file set is unclear.",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Workspace-relative directory to list. Defaults to the workspace root.",
				},
				recursive: { type: "boolean", description: "Whether to recurse into subdirectories. Defaults to false." },
				maxDepth: { type: "number", description: "Maximum recursive depth. Defaults to 3 and is capped." },
				includeHidden: { type: "boolean", description: "Whether to include hidden paths. Defaults to false." },
				maxResults: { type: "number", description: "Maximum entries to return. Defaults to 200." },
			},
			additionalProperties: false,
		},
		async execute(input) {
			const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
			const rootPath = resolveWorkspacePath(workspacePath, asString(record.path), hostWorkspacePath);
			const result = await walkEntries({
				workspacePath,
				rootPath,
				recursive: asBoolean(record.recursive, false),
				maxDepth: asBoundedInteger(record.maxDepth, DEFAULT_MAX_DEPTH, 0, MAX_DEPTH_LIMIT),
				includeHidden: asBoolean(record.includeHidden, false),
				maxResults: asBoundedInteger(record.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS_LIMIT),
				includeDirectories: true,
			});
			return {
				path: toWorkspaceRelativePath(workspacePath, rootPath),
				entries: result.entries,
				truncated: result.truncated,
				instruction:
					"Use this metadata to choose exact files. Call get_file_size before reading unknown or potentially large files.",
			};
		},
	};
}

function createFindFilesTool(workspacePath: string, hostWorkspacePath?: string | null): AgentTool {
	return {
		name: "find_files",
		description:
			"Find candidate files by name, glob-like pattern, query, or extension without reading contents. Use this to establish the exact source set before synthesis.",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Workspace-relative directory to search. Defaults to the workspace root.",
				},
				pattern: { type: "string", description: "Glob-like file name pattern using * and ?, for example *.txt." },
				query: { type: "string", description: "Case-insensitive substring to match in file paths." },
				extension: { type: "string", description: "File extension to match, for example .md or txt." },
				maxDepth: { type: "number", description: "Maximum recursive depth. Defaults to 3 and is capped." },
				includeHidden: { type: "boolean", description: "Whether to include hidden paths. Defaults to false." },
				maxResults: { type: "number", description: "Maximum files to return. Defaults to 200." },
			},
			additionalProperties: false,
		},
		async execute(input) {
			const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
			const rootPath = resolveWorkspacePath(workspacePath, asString(record.path), hostWorkspacePath);
			const fileFilter = createNameMatcher(
				asString(record.pattern),
				asString(record.query),
				asString(record.extension),
			);
			const result = await walkEntries({
				workspacePath,
				rootPath,
				recursive: true,
				maxDepth: asBoundedInteger(record.maxDepth, DEFAULT_MAX_DEPTH, 0, MAX_DEPTH_LIMIT),
				includeHidden: asBoolean(record.includeHidden, false),
				maxResults: asBoundedInteger(record.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS_LIMIT),
				includeDirectories: false,
				fileFilter,
			});
			return {
				path: toWorkspaceRelativePath(workspacePath, rootPath),
				files: result.entries,
				truncated: result.truncated,
				instruction:
					"Treat this as the candidate file inventory, not source content. Confirm sizes with get_file_size before choosing read_files or read_large_file.",
			};
		},
	};
}

function createGetFileSizeTool(
	workspacePath: string,
	contextWindow?: number | null,
	hostWorkspacePath?: string | null,
): AgentTool {
	return {
		name: "get_file_size",
		description:
			"Return file size, line count, and large-file recommendation without reading source content into the model context.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Workspace-relative or workspace-contained file path." },
			},
			required: ["path"],
			additionalProperties: false,
		},
		async execute(input) {
			const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
			const rawPath = asString(record.path);
			if (!rawPath) {
				throw new Error("get_file_size requires a non-empty path.");
			}
			const absolutePath = resolveWorkspacePath(workspacePath, rawPath, hostWorkspacePath);
			const info = await lstat(absolutePath);
			if (!info.isFile()) {
				throw new Error(`get_file_size requires a file path, got ${rawPath}.`);
			}
			const content = await readFile(absolutePath, "utf8");
			const lineCount = content.length === 0 ? 0 : content.split("\n").length;
			const tokenCount = countKanbanTextTokens(content);
			const budgets = buildKanbanContextSafetyBudgets(contextWindow);
			const useReadLargeFile = isLargeFileForWorkflow(info.size, tokenCount, budgets.fileChunkContentTokenBudget);
			return {
				path: toWorkspaceRelativePath(workspacePath, absolutePath),
				sizeBytes: info.size,
				lineCount,
				tokenCount,
				useReadLargeFile,
				recommendedTool: useReadLargeFile ? "read_large_file" : "read_files",
				instruction: useReadLargeFile
					? "Use read_large_file with cursor `start`; do not use read_files for this file."
					: "This file fits the normal read_files path unless the task only needs metadata.",
			};
		},
	};
}

export function createFileDiscoveryTools(options: {
	workspacePath: string;
	hostWorkspacePath?: string | null;
	contextWindow?: number | null;
}): AgentTool[] {
	return [
		createListFilesTool(options.workspacePath, options.hostWorkspacePath),
		createFindFilesTool(options.workspacePath, options.hostWorkspacePath),
		createGetFileSizeTool(options.workspacePath, options.contextWindow, options.hostWorkspacePath),
	];
}
