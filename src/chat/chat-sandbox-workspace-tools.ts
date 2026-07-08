import { createHash } from "node:crypto";
import {
	relative as hostRelative,
	resolve as hostResolve,
	sep as hostSep,
	isAbsolute as isHostAbsolute,
} from "node:path";
import { dirname, isAbsolute, normalize, relative as posixRelative } from "node:path/posix";
import type { AgentSandboxExecResult, AgentSandboxWritableMount } from "../nklein-agent/nklein-agent-sandbox";
import type { LocalLlmToolDefinition } from "../nklein-agent/nklein-local-llm-client";
import type { ChatToolSet } from "./chat-board-tools";
import type { ChatSession } from "./chat-session-store";
import type { ChatTool } from "./chat-tool-executor";

const DEFAULT_MAX_BYTES = 64 * 1024;
const SANDBOX_TOOL_TIMEOUT_MS = 10_000;
const USER_WRITABLE_MOUNT_ROOT = "/nklein/user-writable";

export interface ChatSandboxWorkspace {
	exec: (argv: readonly string[], options?: { timeoutMs?: number }) => Promise<AgentSandboxExecResult>;
	dispose: () => Promise<void>;
}

export interface ChatSandboxWorkspaceProvider {
	prepare: (input: { session: ChatSession; workspacePath: string }) => Promise<ChatSandboxWorkspace | null>;
}

export interface AgentSandboxChatWorkspaceManager {
	assertAvailable: () => Promise<void>;
	prepareWorkspace: (input: {
		taskId: string;
		projectRepoPath: string;
		baseRef?: string | null;
		maxQueueWaitMs?: number;
	}) => Promise<{ workdir: string; uid: number }>;
	exec: (taskId: string, argv: readonly string[], options?: { timeoutMs?: number }) => Promise<AgentSandboxExecResult>;
	disposeWorkspace: (taskId: string) => Promise<void>;
}

export interface SandboxWritablePathMount extends AgentSandboxWritableMount {
	/** Workspace-relative directory approved by the user; "." means the workspace root. */
	relativePath: string;
}

function sandboxTaskIdForChatSession(sessionId: string): string {
	const normalized = sessionId.replace(/[^a-zA-Z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "");
	return `chat-${normalized || "session"}`;
}

function mountNameForRelativePath(relativePath: string): string {
	if (relativePath === ".") {
		return "root";
	}
	return createHash("sha256").update(relativePath).digest("hex").slice(0, 16);
}

function canonicalWorkspaceRelativeDir(value: string): string {
	const withoutTrailingSlash = value.replace(/\/+$/gu, "");
	return withoutTrailingSlash === "" || withoutTrailingSlash === "." ? "." : withoutTrailingSlash;
}

function normalizeApprovedWritablePath(workspacePath: string, value: string): string | null {
	const raw = value.trim();
	if (!raw) {
		return null;
	}
	if (isHostAbsolute(raw)) {
		const root = hostResolve(workspacePath);
		const target = hostResolve(raw);
		const relative = hostRelative(root, target);
		if (relative === ".." || relative.startsWith(`..${hostSep}`) || isHostAbsolute(relative)) {
			return null;
		}
		const normalized = normalize(relative.replaceAll(hostSep, "/"));
		return canonicalWorkspaceRelativeDir(normalized);
	}
	const normalized = normalize(raw.replaceAll("\\", "/"));
	if (isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
		return null;
	}
	return canonicalWorkspaceRelativeDir(normalized);
}

export function resolveSandboxWritablePathMounts(
	workspacePath: string,
	approvedPaths: readonly string[],
): SandboxWritablePathMount[] {
	const byRelativePath = new Map<string, SandboxWritablePathMount>();
	for (const path of approvedPaths) {
		const relativePath = normalizeApprovedWritablePath(workspacePath, path);
		if (!relativePath || byRelativePath.has(relativePath)) {
			continue;
		}
		byRelativePath.set(relativePath, {
			relativePath,
			hostPath: relativePath === "." ? hostResolve(workspacePath) : hostResolve(workspacePath, relativePath),
			containerPath: `${USER_WRITABLE_MOUNT_ROOT}/${mountNameForRelativePath(relativePath)}`,
		});
	}
	return [...byRelativePath.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function createAgentSandboxChatWorkspaceProvider(
	manager: AgentSandboxChatWorkspaceManager,
): ChatSandboxWorkspaceProvider {
	return {
		prepare: async ({ session, workspacePath }) => {
			const taskId = sandboxTaskIdForChatSession(session.id);
			await manager.assertAvailable();
			await manager.prepareWorkspace({ taskId, projectRepoPath: workspacePath });
			return {
				exec: (argv, options) => manager.exec(taskId, argv, options),
				dispose: () => manager.disposeWorkspace(taskId),
			};
		},
	};
}

interface RelativePathResult {
	ok: true;
	path: string;
	displayPath: string;
}

function resolveRelativePath(
	value: unknown,
	options: { fallback?: string; kind: "file" | "directory" },
): RelativePathResult | { ok: false; message: string } {
	const raw = typeof value === "string" && value.trim() ? value.trim() : options.fallback;
	if (!raw) {
		return {
			ok: false,
			message:
				options.kind === "file"
					? "Provide a `path` (a file path relative to the workspace root)."
					: "Provide a `path` (a directory path relative to the workspace root).",
		};
	}
	if (isAbsolute(raw)) {
		return { ok: false, message: "Path must be workspace-relative." };
	}
	const normalized = normalize(raw);
	if (normalized === ".." || normalized.startsWith("../")) {
		return { ok: false, message: "Path escapes the workspace." };
	}
	return {
		ok: true,
		path: normalized === "" ? "." : normalized,
		displayPath: normalized === "" ? "." : normalized,
	};
}

function firstLine(value: string): string {
	return value.split(/\r?\n/u)[0]?.trim() ?? "";
}

function isInside(root: string, target: string): boolean {
	return target === root || target.startsWith(`${root}/`);
}

async function execCapture(workspace: ChatSandboxWorkspace, argv: readonly string[]) {
	return await workspace.exec(argv, { timeoutMs: SANDBOX_TOOL_TIMEOUT_MS });
}

async function assertRealPathInsideWorkspace(
	workspace: ChatSandboxWorkspace,
	relativePath: string,
	displayPath: string,
): Promise<{ ok: true } | { ok: false; notFound?: true; message: string }> {
	const root = await execCapture(workspace, ["pwd", "-P"]);
	if (root.exitCode !== 0) {
		return { ok: false, message: "Could not resolve the sandbox workspace root." };
	}
	const real = await execCapture(workspace, ["realpath", "--", relativePath]);
	if (real.exitCode !== 0) {
		return { ok: false, notFound: true, message: `Could not access ${displayPath}.` };
	}
	if (!isInside(firstLine(root.stdout), firstLine(real.stdout))) {
		return { ok: false, message: `${displayPath} escapes the workspace.` };
	}
	return { ok: true };
}

async function assertWritablePathInsideWorkspace(
	workspace: ChatSandboxWorkspace,
	relativePath: string,
	displayPath: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
	const root = await execCapture(workspace, ["pwd", "-P"]);
	if (root.exitCode !== 0) {
		return { ok: false, message: "Could not resolve the sandbox workspace root." };
	}
	const realRoot = firstLine(root.stdout);
	let candidate = relativePath;
	for (;;) {
		const real = await execCapture(workspace, ["realpath", "--", candidate]);
		if (real.exitCode === 0) {
			if (!isInside(realRoot, firstLine(real.stdout))) {
				return { ok: false, message: `${displayPath} escapes the workspace.` };
			}
			return { ok: true };
		}
		const parent = dirname(candidate);
		if (parent === candidate) {
			return { ok: false, message: `Could not write ${displayPath} (path not writable).` };
		}
		candidate = parent === "" ? "." : parent;
	}
}

async function withSandbox<T>(
	provider: ChatSandboxWorkspaceProvider,
	session: ChatSession,
	workspacePath: string,
	run: (workspace: ChatSandboxWorkspace) => Promise<T>,
): Promise<T | string> {
	const workspace = await provider.prepare({ session, workspacePath }).catch(() => null);
	if (!workspace) {
		return "Sandbox workspace is unavailable.";
	}
	try {
		return await run(workspace);
	} finally {
		await workspace.dispose().catch(() => undefined);
	}
}

function parseByteCount(stdout: string): number | null {
	const token = stdout.trim().split(/\s+/u)[0];
	if (!token) {
		return null;
	}
	const parsed = Number(token);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseFindEntries(stdout: string, displayPath: string): string {
	const entries = stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [name, kind] = line.split("\t");
			if (!name) {
				return null;
			}
			const entryPath = displayPath === "." ? name : `${displayPath}/${name}`;
			return kind === "d" ? `${entryPath}/` : entryPath;
		})
		.filter((entry): entry is string => entry !== null)
		.sort((left, right) => left.localeCompare(right));
	return entries.length > 0 ? entries.join("\n") : `${displayPath} is empty.`;
}

function isPathWithinApprovedMount(path: string, mount: SandboxWritablePathMount): boolean {
	return mount.relativePath === "." || path === mount.relativePath || path.startsWith(`${mount.relativePath}/`);
}

function findWritableMountForPath(
	path: string,
	mounts: readonly SandboxWritablePathMount[],
): SandboxWritablePathMount | null {
	return (
		[...mounts]
			.filter((mount) => isPathWithinApprovedMount(path, mount))
			.sort((left, right) => right.relativePath.length - left.relativePath.length)[0] ?? null
	);
}

export function isSandboxWritePathApproved(path: unknown, mounts: readonly SandboxWritablePathMount[]): boolean {
	const resolved = resolveRelativePath(path, { kind: "file" });
	return resolved.ok && resolved.path !== "." && findWritableMountForPath(resolved.path, mounts) !== null;
}

function toMountedWritePath(path: string, mount: SandboxWritablePathMount): string {
	if (mount.relativePath === ".") {
		return path === "." ? mount.containerPath : `${mount.containerPath}/${path}`;
	}
	const suffix = posixRelative(mount.relativePath, path);
	return suffix ? `${mount.containerPath}/${suffix}` : mount.containerPath;
}

async function writeUtf8File(workspace: ChatSandboxWorkspace, path: string, content: string): Promise<boolean> {
	const parent = dirname(path);
	const mkdir = await execCapture(workspace, ["mkdir", "-p", "--", parent === "" ? "." : parent]);
	if (mkdir.exitCode !== 0) {
		return false;
	}
	const encoded = Buffer.from(content, "utf8").toString("base64");
	const written = await execCapture(workspace, [
		"sh",
		"-c",
		'printf "%s" "$2" | base64 -d > "$1"',
		"nklein-write-file",
		path,
		encoded,
	]);
	return written.exitCode === 0;
}

export function createSandboxWorkspaceReadTools(input: {
	session: ChatSession;
	workspacePath: string;
	provider: ChatSandboxWorkspaceProvider;
	maxBytes?: number;
}): ChatToolSet {
	const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
	const tools: ChatTool[] = [
		{
			name: "read_file",
			actionKind: "sandbox_read",
			run: async (args) => {
				const resolved = resolveRelativePath(args.path, { kind: "file" });
				if (!resolved.ok) {
					return resolved.message;
				}
				return await withSandbox(input.provider, input.session, input.workspacePath, async (workspace) => {
					const real = await assertRealPathInsideWorkspace(workspace, resolved.path, resolved.displayPath);
					if (!real.ok) {
						return real.notFound
							? `Could not read ${resolved.displayPath} (no such file or not readable).`
							: real.message;
					}
					const count = await execCapture(workspace, ["wc", "-c", "--", resolved.path]);
					const byteCount = count.exitCode === 0 ? parseByteCount(count.stdout) : null;
					const read =
						byteCount !== null && byteCount > maxBytes
							? await execCapture(workspace, ["head", "-c", String(maxBytes), "--", resolved.path])
							: await execCapture(workspace, ["cat", "--", resolved.path]);
					if (read.exitCode !== 0) {
						return `Could not read ${resolved.displayPath} (no such file or not readable).`;
					}
					if (byteCount !== null && byteCount > maxBytes) {
						return `${read.stdout}\n\n[truncated: ${resolved.displayPath} is larger than ${maxBytes} bytes]`;
					}
					return read.stdout;
				});
			},
		},
		{
			name: "list_dir",
			actionKind: "sandbox_read",
			run: async (args) => {
				const resolved = resolveRelativePath(args.path, { fallback: ".", kind: "directory" });
				if (!resolved.ok) {
					return resolved.message;
				}
				return await withSandbox(input.provider, input.session, input.workspacePath, async (workspace) => {
					const real = await assertRealPathInsideWorkspace(workspace, resolved.path, resolved.displayPath);
					if (!real.ok) {
						return real.notFound
							? `Could not list ${resolved.displayPath} (no such directory or not readable).`
							: real.message;
					}
					const listed = await execCapture(workspace, [
						"find",
						resolved.path,
						"-mindepth",
						"1",
						"-maxdepth",
						"1",
						"-printf",
						"%f\t%y\n",
					]);
					if (listed.exitCode !== 0) {
						return `Could not list ${resolved.displayPath} (no such directory or not readable).`;
					}
					return parseFindEntries(listed.stdout, resolved.displayPath);
				});
			},
		},
	];

	const definitions: LocalLlmToolDefinition[] = [
		{
			name: "read_file",
			description:
				"Read a UTF-8 text file from the sandbox workspace. The path must be relative to the workspace root.",
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
				"List the entries of a sandbox workspace directory. Omit `path` (or pass '.') to list the workspace root.",
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

export function createSandboxWorkspaceWriteTools(input: {
	session: ChatSession;
	workspacePath: string;
	provider: ChatSandboxWorkspaceProvider;
	writableMounts: readonly SandboxWritablePathMount[];
}): ChatToolSet {
	const tools: ChatTool[] = [
		{
			name: "write_file",
			actionKind: "sandbox_write",
			run: async (args) => {
				const resolved = resolveRelativePath(args.path, { kind: "file" });
				if (!resolved.ok) {
					return resolved.message;
				}
				if (resolved.path === ".") {
					return "Provide a file path, not the workspace root.";
				}
				if (typeof args.content !== "string") {
					return "Provide `content` (the text to write) as a string.";
				}
				const content = args.content;
				const mount = findWritableMountForPath(resolved.path, input.writableMounts);
				if (!mount) {
					return `${resolved.displayPath} is not under an approved writable path.`;
				}
				return await withSandbox(input.provider, input.session, input.workspacePath, async (workspace) => {
					const real = await assertWritablePathInsideWorkspace(workspace, resolved.path, resolved.displayPath);
					if (!real.ok) {
						return real.message;
					}
					const mountedPath = toMountedWritePath(resolved.path, mount);
					const wroteWorkspace = await writeUtf8File(workspace, resolved.path, content);
					if (!wroteWorkspace) {
						return `Could not write ${resolved.displayPath} (path not writable).`;
					}
					const wroteHostMount = await writeUtf8File(workspace, mountedPath, content);
					if (!wroteHostMount) {
						return `Could not write ${resolved.displayPath} (approved mount not writable).`;
					}
					return `Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${resolved.displayPath}.`;
				});
			},
		},
	];

	const definitions: LocalLlmToolDefinition[] = [
		{
			name: "write_file",
			description:
				"Create or overwrite a UTF-8 text file under an approved writable path in the sandbox workspace. This is a write action and requires confirmation.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Workspace-relative file path to write, e.g. 'src/app.ts'." },
					content: { type: "string", description: "The full file content to write." },
				},
				required: ["path", "content"],
			},
		},
	];

	return { tools, definitions };
}
