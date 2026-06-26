import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
	/** Resolve the real, symlink-free absolute path. Used for symlink-escape confinement. */
	realpath: (path: string) => Promise<string>;
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
	realpath,
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

/**
 * After the lexical check, confirm the REAL on-disk path (symlinks resolved) stays inside the workspace root.
 * This closes the symlink-escape hole: a workspace symlink pointing outside the root passes the lexical check
 * but its real path lands outside, and this function catches that.
 *
 * For reads and lists: pass the already-resolved `absolute` path. If the path does not exist (dangling symlink or
 * missing file) the caller's own try/catch will surface a friendly error — we return `ok: false` with
 * `notFound: true` so the caller can delegate to its normal not-found handling.
 *
 * For writes: the target file may not exist yet, so pass the `absolute` path and set `allowNotFound: true`. We
 * walk up to the nearest existing ancestor (typically the parent dir after `mkdir` has been called, but we check
 * before the write) and confine that. A symlinked parent that escapes the workspace is rejected; a new file in a
 * real workspace directory is allowed.
 *
 * Returns `{ ok: true }` when the real path is safely inside, `{ ok: false, notFound: true }` when the path
 * does not exist and `allowNotFound` is set, or `{ ok: false, message: string }` on confinement failure.
 */
async function assertRealPathWithinWorkspace(
	rootDir: string,
	absolute: string,
	fsRealpath: (path: string) => Promise<string>,
	options: { allowNotFound?: boolean; relativePath: string } = { relativePath: absolute },
): Promise<{ ok: true } | { ok: false; notFound: true } | { ok: false; message: string }> {
	const realRoot = await fsRealpath(rootDir);
	const rootPrefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;

	// Helper: is a real path inside (or equal to) the real root?
	const isUnderRoot = (p: string) => p === realRoot || p.startsWith(rootPrefix);

	if (options.allowNotFound) {
		// For writes: find the nearest existing ancestor and confine it.
		let candidate = absolute;
		for (;;) {
			try {
				const real = await fsRealpath(candidate);
				if (!isUnderRoot(real)) {
					return { ok: false, message: `Path escapes the workspace: ${options.relativePath}` };
				}
				return { ok: true };
			} catch {
				const parent = dirname(candidate);
				if (parent === candidate) {
					// Reached filesystem root with nothing existing — shouldn't normally happen.
					return { ok: false, message: `Path escapes the workspace: ${options.relativePath}` };
				}
				candidate = parent;
			}
		}
	}

	// For reads and lists: the path must exist and resolve within the root.
	try {
		const real = await fsRealpath(absolute);
		if (!isUnderRoot(real)) {
			return { ok: false, message: `Path escapes the workspace: ${options.relativePath}` };
		}
		return { ok: true };
	} catch {
		// Path does not exist (or dangling symlink) — let the caller's normal error handling take over.
		return { ok: false, notFound: true };
	}
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
				const real = await assertRealPathWithinWorkspace(rootDir, resolved.absolute, fs.realpath, {
					relativePath: resolved.relativePath,
				});
				if (!real.ok) {
					if ("notFound" in real) {
						return `Could not read ${resolved.relativePath} (no such file or not readable).`;
					}
					return real.message;
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
				const real = await assertRealPathWithinWorkspace(rootDir, resolved.absolute, fs.realpath, {
					relativePath: resolved.relativePath,
				});
				if (!real.ok) {
					if ("notFound" in real) {
						return `Could not list ${resolved.relativePath} (no such directory or not readable).`;
					}
					return real.message;
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

export interface WorkspaceWriteToolFsDeps {
	writeFile: (path: string, content: string) => Promise<void>;
	mkdir: (dir: string) => Promise<void>;
	/** Resolve the real, symlink-free absolute path. Used for symlink-escape confinement. */
	realpath: (path: string) => Promise<string>;
}

const DEFAULT_WRITE_FS: WorkspaceWriteToolFsDeps = {
	writeFile: (path, content) => writeFile(path, content, "utf8"),
	mkdir: async (dir) => {
		await mkdir(dir, { recursive: true });
	},
	realpath,
};

/**
 * Build the mutating workspace tool set (`write_file`) rooted at `rootDir`. Unlike the read tools, this is a
 * `sandbox_write` action: the execution-mode gate makes it a **confirm** (in `isolated_readonly`) — the executor
 * only runs it after an explicit confirmation and audits the attempt either way. Same host-isolation invariant as
 * the read tools: the path is confined to the workspace and all agent-facing copy is workspace-relative.
 */
export function createWorkspaceWriteTools(
	rootDir: string,
	options: { fs?: WorkspaceWriteToolFsDeps } = {},
): WorkspaceReadTools {
	const fs = options.fs ?? DEFAULT_WRITE_FS;

	const tools: ChatTool[] = [
		{
			name: "write_file",
			actionKind: "sandbox_write",
			run: async (args) => {
				const resolved = resolveWithinWorkspace(rootDir, args.path);
				if (!resolved.ok) {
					return resolved.message;
				}
				if (typeof args.content !== "string") {
					return "Provide `content` (the text to write) as a string.";
				}
				// Realpath-confine before writing: the target may not exist yet, so we check the nearest
				// existing ancestor (allowNotFound). This blocks a symlinked parent that escapes the workspace
				// while still allowing new files to be created inside a real workspace directory.
				const real = await assertRealPathWithinWorkspace(rootDir, resolved.absolute, fs.realpath, {
					allowNotFound: true,
					relativePath: resolved.relativePath,
				});
				if (!real.ok) {
					return "message" in real
						? real.message
						: `Could not write ${resolved.relativePath} (path not writable).`;
				}
				try {
					await fs.mkdir(dirname(resolved.absolute));
					await fs.writeFile(resolved.absolute, args.content);
					return `Wrote ${args.content.length} bytes to ${resolved.relativePath}.`;
				} catch {
					return `Could not write ${resolved.relativePath} (path not writable).`;
				}
			},
		},
	];

	const definitions: LocalLlmToolDefinition[] = [
		{
			name: "write_file",
			description:
				"Create or overwrite a UTF-8 text file in the workspace. The path must be relative to the workspace root. This is a write action and requires confirmation.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Workspace-relative path to write, e.g. 'src/app.ts'." },
					content: { type: "string", description: "The full file content to write." },
				},
				required: ["path", "content"],
			},
		},
	];

	return { tools, definitions };
}
