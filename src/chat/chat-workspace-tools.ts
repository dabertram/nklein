import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { LocalLlmToolDefinition } from "../nklein-sdk/nklein-local-llm-client";
import type { ChatTool } from "./chat-tool-executor";

/**
 * Concrete read-only workspace tools for the chat agent (todo §5.M) — the first real tool set the tool-using
 * chat loop can call. Both are `sandbox_read` actions (always allowed by the execution-mode gate), so they're the
 * safe, governance-free baseline; mutating/host tools layer on the `confirm`/`deny` gate separately.
 *
 * Host-isolation invariant: the agent only ever names **workspace-relative** paths. Every argument is resolved
 * against the workspace root and confined to it (absolute paths and `..` escapes are refused), and errors echo the
 * relative path the agent supplied — a host path can never enter the agent's view through a tool argument or result.
 * The fs operations are injected so the tools are unit-testable without touching disk.
 */

export interface WorkspaceToolFsDeps {
	readFile: (path: string) => Promise<string>;
	readdir: (path: string) => Promise<Array<{ name: string; isDirectory: boolean }>>;
	stat: (path: string) => Promise<{ size: number }>;
}

const DEFAULT_FS: WorkspaceToolFsDeps = {
	readFile: (path) => readFile(path, "utf8"),
	readdir: async (path) => {
		const entries = await readdir(path, { withFileTypes: true });
		return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
	},
	stat: async (path) => {
		const info = await stat(path);
		return { size: info.size };
	},
};

/** Default cap so a single read can't blow the agent's context with a huge file. */
const DEFAULT_MAX_BYTES = 64 * 1024;

/**
 * Resolve an agent-supplied path within the workspace root, refusing anything that escapes it. Returns the
 * absolute on-disk path plus the normalized workspace-relative path used in all agent-facing copy.
 */
function resolveWithinWorkspace(
	rootDir: string,
	rawPath: unknown,
): { ok: true; absolute: string; relativePath: string } | { ok: false; message: string } {
	if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
		return { ok: false, message: "Provide a `path` (a file path relative to the workspace root)." };
	}
	const requested = rawPath.trim();
	if (isAbsolute(requested)) {
		return { ok: false, message: `Path must be workspace-relative, not absolute: ${requested}` };
	}
	const root = resolve(rootDir);
	const absolute = resolve(root, requested);
	const rel = relative(root, absolute);
	if (rel === ".." || rel.startsWith(`..${sep}`)) {
		return { ok: false, message: `Path escapes the workspace: ${requested}` };
	}
	return { ok: true, absolute, relativePath: rel === "" ? "." : rel };
}

export interface WorkspaceReadTools {
	/** Runnable, gate-aware tools for the executor. */
	tools: ChatTool[];
	/** OpenAI-style tool schemas to offer the model. */
	definitions: LocalLlmToolDefinition[];
}

/**
 * Build the read-only workspace tool set rooted at `rootDir` (the in-container `/workspaces/<taskId>` for a
 * sandboxed session, or a project root for a host-read session). The returned `tools` plug into
 * `createGatedChatToolExecutor`; the `definitions` are offered to the model via `createChatAgentModel`.
 */
export function createWorkspaceReadTools(
	rootDir: string,
	options: { fs?: WorkspaceToolFsDeps; maxBytes?: number } = {},
): WorkspaceReadTools {
	const fs = options.fs ?? DEFAULT_FS;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

	const tools: ChatTool[] = [
		{
			name: "read_file",
			actionKind: "sandbox_read",
			run: async (args) => {
				const resolved = resolveWithinWorkspace(rootDir, args.path);
				if (!resolved.ok) {
					return resolved.message;
				}
				try {
					const content = await fs.readFile(resolved.absolute);
					if (content.length > maxBytes) {
						return `${content.slice(0, maxBytes)}\n\n[truncated: ${resolved.relativePath} is larger than ${maxBytes} bytes]`;
					}
					return content;
				} catch {
					return `Could not read ${resolved.relativePath} (no such file or not readable).`;
				}
			},
		},
		{
			name: "list_dir",
			actionKind: "sandbox_read",
			run: async (args) => {
				const resolved = resolveWithinWorkspace(rootDir, args.path ?? ".");
				if (!resolved.ok) {
					return resolved.message;
				}
				try {
					const entries = await fs.readdir(resolved.absolute);
					if (entries.length === 0) {
						return `${resolved.relativePath} is empty.`;
					}
					const lines = entries
						.slice()
						.sort((a, b) => a.name.localeCompare(b.name))
						.map((entry) => {
							const entryPath =
								resolved.relativePath === "." ? entry.name : join(resolved.relativePath, entry.name);
							return entry.isDirectory ? `${entryPath}/` : entryPath;
						});
					return lines.join("\n");
				} catch {
					return `Could not list ${resolved.relativePath} (no such directory or not readable).`;
				}
			},
		},
	];

	const definitions: LocalLlmToolDefinition[] = [
		{
			name: "read_file",
			description: "Read a UTF-8 text file from the workspace. The path must be relative to the workspace root.",
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: "Workspace-relative path to the file, e.g. 'README.md' or 'src/app.ts'.",
					},
				},
				required: ["path"],
			},
		},
		{
			name: "list_dir",
			description:
				"List the entries of a workspace directory. Omit `path` (or pass '.') to list the workspace root.",
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: "Workspace-relative directory path; defaults to the workspace root.",
					},
				},
			},
		},
	];

	return { tools, definitions };
}
