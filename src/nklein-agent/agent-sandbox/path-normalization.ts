import { existsSync } from "node:fs";
import { resolve } from "node:path";

function normalizedHostPath(hostProjectPath: string | null | undefined): string | null {
	const normalized = hostProjectPath?.trim().replace(/\/+$/u, "") ?? "";
	return normalized || null;
}

export function isPathInputKey(key: string): boolean {
	const normalizedKey = key.trim().toLowerCase();
	return (
		normalizedKey === "path" ||
		normalizedKey === "filepath" ||
		normalizedKey === "file_path" ||
		normalizedKey === "targetpath" ||
		normalizedKey === "target_path" ||
		normalizedKey === "oldpath" ||
		normalizedKey === "old_path" ||
		normalizedKey === "newpath" ||
		normalizedKey === "new_path"
	);
}

export function rewriteHostProjectPath(rawPath: string, hostProjectPath: string | null, cwd: string): string {
	if (!rawPath.startsWith("/")) {
		return rawPath;
	}
	const normalized = normalizedHostPath(hostProjectPath);
	if (normalized) {
		if (rawPath === normalized) {
			return ".";
		}
		const hostPrefix = `${normalized}/`;
		if (rawPath.startsWith(hostPrefix)) {
			return rawPath.slice(hostPrefix.length) || ".";
		}
	}
	const workspaceRelativeCandidate = rawPath.replace(/^\/+/u, "");
	if (
		workspaceRelativeCandidate &&
		!workspaceRelativeCandidate.startsWith("..") &&
		existsSync(resolve(cwd, workspaceRelativeCandidate))
	) {
		return workspaceRelativeCandidate;
	}
	return rawPath;
}

export function rewriteHostProjectPathsInCommand(command: string, hostProjectPath: string | null): string {
	const normalized = normalizedHostPath(hostProjectPath);
	if (!normalized) {
		return command;
	}
	return command.split(normalized).join(".");
}

export function normalizeHostPathInputs(
	input: unknown,
	hostProjectPath: string | null,
	cwd: string,
	key: string | null = null,
): unknown {
	if (typeof input === "string") {
		return key && isPathInputKey(key) ? rewriteHostProjectPath(input, hostProjectPath, cwd) : input;
	}
	if (Array.isArray(input)) {
		return input.map((item) => normalizeHostPathInputs(item, hostProjectPath, cwd));
	}
	if (!input || typeof input !== "object") {
		return input;
	}
	const normalized: Record<string, unknown> = {};
	for (const [entryKey, entryValue] of Object.entries(input)) {
		normalized[entryKey] = normalizeHostPathInputs(entryValue, hostProjectPath, cwd, entryKey);
	}
	return normalized;
}

export function normalizeSandboxBashInput(input: unknown, hostProjectPath: string | null, cwd: string): unknown {
	if (typeof input === "string") {
		return rewriteHostProjectPathsInCommand(input, hostProjectPath);
	}
	if (Array.isArray(input)) {
		return input.map((item) => normalizeSandboxBashInput(item, hostProjectPath, cwd));
	}
	if (!input || typeof input !== "object") {
		return input;
	}
	const normalized: Record<string, unknown> = {};
	for (const [entryKey, entryValue] of Object.entries(input)) {
		if (typeof entryValue === "string" && /^(?:command|commands|cmd|script|shell_command)$/iu.test(entryKey)) {
			normalized[entryKey] = rewriteHostProjectPathsInCommand(entryValue, hostProjectPath);
		} else {
			normalized[entryKey] = normalizeHostPathInputs(entryValue, hostProjectPath, cwd, entryKey);
		}
	}
	return coerceShellSyntaxToShellString(normalized);
}

const SHELL_SYNTAX_PATTERN = /&&|\|\||[|;<>]|\$\(|\$\{|`|\*|(?:^|\s)~\//u;

/** True when a structured command's text only makes sense to a shell (pipes, chains, redirects, globs, subshells). */
export function looksLikeShellSyntax(text: string): boolean {
	return SHELL_SYNTAX_PATTERN.test(text);
}

/**
 * The SDK's structured bash input (`{ command, args }`) is spawned as an EXECUTABLE — no shell. Models routinely
 * put shell syntax in it anyway (live 2026-09-05, v31 review: `{"command": "pwd && ls -la"}` and
 * `{"command": "ls", "args": ["node_modules/.bin", "| head -20"]}` → `spawn "pwd && ls -la" ENOENT`, every
 * exploration command of the turn dead). When the command or any arg carries shell syntax the ONLY faithful
 * reading is a shell line, so the structured form becomes `/bin/sh -c "<line>"` — still structured, so every
 * other field rides along; args without shell syntax but with whitespace are single-quoted to stay one word.
 */
export function coerceShellSyntaxToShellString(input: Record<string, unknown>): Record<string, unknown> {
	const command = input.command;
	if (typeof command !== "string" || command.trim().length === 0) {
		return input;
	}
	const args = Array.isArray(input.args) ? input.args.filter((arg): arg is string => typeof arg === "string") : [];
	if (!looksLikeShellSyntax(command) && !args.some(looksLikeShellSyntax)) {
		return input;
	}
	const words = [
		command.trim(),
		...args.map((arg) => (!looksLikeShellSyntax(arg) && /\s/u.test(arg) ? `'${arg.replace(/'/gu, "'\\''")}'` : arg)),
	];
	return { ...input, command: "/bin/sh", args: ["-c", words.join(" ")] };
}
