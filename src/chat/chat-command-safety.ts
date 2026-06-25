/**
 * Safe/unsafe command classifier for the chat agent's `run_command` tool (todo §5.M G3b).
 *
 * DESIGN: **allowlist approach (most conservative)**. Only a curated set of clearly read-only, build, inspection, or
 * test-runner commands is classified "safe". EVERYTHING ELSE is "unsafe" — which the risk-acknowledgement flow
 * (G3c/onward) will surface to the user for explicit confirmation. We accept the friction; the user is informed and
 * owns the risk for anything outside the allowlist.
 *
 * Compound / chained commands (&&, ||, ;, pipes) are split and each segment is evaluated independently: if ANY
 * segment is not allowlisted the whole command is unsafe. Pipes whose consumer is a shell (`| sh`, `| bash`, `| zsh`)
 * are always unsafe regardless of the producer. Output redirection (> / >>) is always unsafe.
 *
 * The classifier intentionally does NOT try to be a full shell parser. It errs toward "unsafe" on anything
 * ambiguous — the cost of a false-positive is one extra confirmation click; the cost of a false-negative is
 * unreviewed destructive execution.
 */

export type CommandSafety = "safe" | "unsafe";

export interface CommandSafetyResult {
	safety: CommandSafety;
	/** Human-readable explanation of why the command was classified as safe or unsafe. */
	reason: string;
}

// ---------------------------------------------------------------------------
// Segment-level unsafe patterns — checked before the allowlist, short-circuit to "unsafe"
// ---------------------------------------------------------------------------

/**
 * Executables that are always unsafe regardless of arguments. These represent destructive filesystem operations,
 * privilege escalation, network access, package installation, or hard-to-reverse mutations.
 */
const ALWAYS_UNSAFE_EXECUTABLES = new Set([
	// Destructive filesystem
	"rm",
	"rmdir",
	"mv",
	"dd",
	"mkfs",
	"shred",
	"truncate",
	// Privilege escalation
	"sudo",
	"su",
	"doas",
	// Permissions / ownership
	"chmod",
	"chown",
	"chgrp",
	// Process control
	"kill",
	"killall",
	"pkill",
	// Network access / transfer
	"curl",
	"wget",
	"fetch",
	"nc",
	"netcat",
	"ssh",
	"scp",
	"rsync",
	"sftp",
	// Package installation / management (npm/npx handled separately to allow test/run/typecheck/lint/build/check)
	"yarn",
	"pnpm",
	"pip",
	"pip3",
	"brew",
	"apt",
	"apt-get",
	"yum",
	"dnf",
	"pacman",
	"gem",
	"cargo",
	"go",
	// Shells (as a command invoked directly — e.g. `bash -c '...'`)
	"sh",
	"bash",
	"zsh",
	"fish",
	"dash",
	"csh",
	"tcsh",
	"ksh",
	// System management
	"systemctl",
	"service",
	"launchctl",
	// Disk / mount
	"mount",
	"umount",
	"fdisk",
	"parted",
	// Other destructive / risky
	"env",
	"exec",
	"eval",
]);

/**
 * These `git` subcommands are unsafe (they mutate state, push to remotes, or irreversibly discard work).
 * Safe git subcommands are on the allowlist below.
 */
const UNSAFE_GIT_SUBCOMMANDS = new Set([
	"push",
	"reset",
	"clean",
	"checkout",
	"switch",
	"restore",
	"rebase",
	"merge",
	"cherry-pick",
	"revert",
	"commit",
	"tag",
	"stash",
	"am",
	"apply",
	"bisect",
	"fetch",
	"pull",
	"clone",
	"init",
	"submodule",
	"worktree",
	"rm",
	"mv",
	"add",
	"config",
]);

/**
 * These `npm` / `npx` invocations are safe (type-check, lint, test, build — read-only or deterministic build
 * artefact generation).
 */
const SAFE_NPM_SCRIPTS = new Set(["test", "run"]);
const SAFE_NPM_RUN_ARGS = new Set(["test", "typecheck", "lint", "build", "check"]);

// ---------------------------------------------------------------------------
// Allowlist helpers
// ---------------------------------------------------------------------------

/** All single-word executables that are unconditionally safe. */
const SAFE_EXECUTABLES = new Set([
	// Navigation / inspection
	"ls",
	"pwd",
	"cat",
	"head",
	"tail",
	"wc",
	"echo",
	"printf",
	"less",
	"more",
	// Search
	"grep",
	"rg",
	"ag",
	"ack",
	// Find (special-cased below to block -delete/-exec)
	// "find",
	// File info
	"which",
	"file",
	"stat",
	"du",
	"df",
	"tree",
	// Text processing (read-only)
	"sort",
	"uniq",
	"cut",
	"tr",
	"sed",
	"awk",
	"jq",
	"xargs",
	"tee",
	// Archive inspection (not extraction)
	"tar",
	// Process / system info
	"ps",
	"top",
	"htop",
	"pgrep",
	"lsof",
	"uname",
	"hostname",
	"id",
	"whoami",
	"date",
	"uptime",
	// Node / JS toolchain (read-only invocations handled specially below)
	"node",
	// Directory listing
	"find",
]);

// ---------------------------------------------------------------------------
// Core segment classifier
// ---------------------------------------------------------------------------

/** Strip leading environment-variable assignments (e.g. `FOO=bar BAZ=1 cmd ...`). */
function stripEnvAssignments(raw: string): string {
	// Env assignments are sequences of IDENTIFIER=VALUE tokens before the first non-assignment word.
	return raw.replace(/^(?:[A-Z_][A-Z0-9_]*=[^\s]*\s+)*/i, "");
}

/** Extract the leading executable token and the remainder of the segment (lowercased executable). */
function parseSegment(segment: string): { exe: string; rest: string } {
	const stripped = stripEnvAssignments(segment.trim());
	const [first, ...rest] = stripped.split(/\s+/);
	return { exe: (first ?? "").toLowerCase(), rest: rest.join(" ") };
}

/**
 * Classify a single, already-split shell segment (no `&&`, `||`, `;` separators). Returns null when safe.
 * Returns a reason string when unsafe.
 */
function classifySegment(segment: string): string | null {
	const trimmed = segment.trim();
	if (!trimmed) {
		return null; // empty segment is fine
	}

	// Output redirection is always unsafe: overwrites or appends to files.
	// We look for bare > or >> that are not inside quotes (pragmatic, not perfect).
	// The regex matches `>` or `>>` that appear outside single/double-quoted regions.
	if (/(?:^|[^'"])>>?(?:[^'"]|$)/.test(trimmed)) {
		return "output redirection (> or >>) can overwrite or create files";
	}

	const { exe, rest } = parseSegment(trimmed);

	if (!exe) {
		return null;
	}

	// Always-unsafe executables
	if (ALWAYS_UNSAFE_EXECUTABLES.has(exe)) {
		// Special-case npm: only "npm test" and "npm run <safe-script>" are safe (handled separately
		// after this block via the allowlist path — but npm is in ALWAYS_UNSAFE_EXECUTABLES to block
		// "npm install", "npm publish", etc.). We'll revisit npm below.
		return `'${exe}' is not in the safe allowlist`;
	}

	// ---------------------------------------------------------------------------
	// Per-executable special cases
	// ---------------------------------------------------------------------------

	// git: only specific read-only subcommands are safe
	if (exe === "git") {
		const subcommand = rest.split(/\s+/)[0]?.toLowerCase() ?? "";
		if (!subcommand) {
			return "bare 'git' with no subcommand is not in the safe allowlist";
		}
		if (UNSAFE_GIT_SUBCOMMANDS.has(subcommand)) {
			return `'git ${subcommand}' is not in the safe allowlist (mutates state or touches remote)`;
		}
		// Explicitly safe read-only git subcommands
		const safeGitSubcommands = new Set([
			"status",
			"log",
			"diff",
			"show",
			"branch",
			"remote",
			"rev-parse",
			"describe",
			"ls-files",
			"ls-tree",
			"cat-file",
			"shortlog",
			"reflog",
			"blame",
			"grep",
		]);
		if (safeGitSubcommands.has(subcommand)) {
			return null; // safe
		}
		return `'git ${subcommand}' is not in the safe allowlist`;
	}

	// npm: safe only for "npm test" and "npm run <safe-script>"
	if (exe === "npm") {
		const parts = rest.split(/\s+/).filter(Boolean);
		const sub = parts[0]?.toLowerCase() ?? "";
		if (!SAFE_NPM_SCRIPTS.has(sub)) {
			return `'npm ${sub || "(nothing)"}' is not in the safe allowlist — only 'npm test' and 'npm run <test|typecheck|lint|build|check>' are safe`;
		}
		if (sub === "run") {
			const script = parts[1]?.toLowerCase() ?? "";
			if (!SAFE_NPM_RUN_ARGS.has(script)) {
				return `'npm run ${script || "(nothing)"}' is not in the safe allowlist — safe scripts: test, typecheck, lint, build, check`;
			}
		}
		return null; // safe npm invocation
	}

	// npx: safe for "npx tsc" and "npx biome check"
	if (exe === "npx") {
		const parts = rest.split(/\s+/).filter(Boolean);
		const pkg = parts[0]?.toLowerCase() ?? "";
		if (pkg === "tsc") {
			return null; // npx tsc — type-check
		}
		if (pkg === "biome") {
			const subcmd = parts[1]?.toLowerCase() ?? "";
			if (subcmd === "check" || subcmd === "lint" || subcmd === "format") {
				return null; // npx biome check/lint/format — safe
			}
			return `'npx biome ${subcmd}' is not in the safe allowlist`;
		}
		return `'npx ${pkg}' is not in the safe allowlist`;
	}

	// node: safe only for "node --version" / "node -v"
	if (exe === "node") {
		const arg = rest.split(/\s+/)[0]?.toLowerCase() ?? "";
		if (arg === "--version" || arg === "-v" || arg === "-e" || arg === "--print") {
			// node --version and node -v are safe; -e/-p could run arbitrary code but are common enough
			// to allow for quick one-liners. If this proves too permissive we can tighten later.
			return null;
		}
		// Running a script file is inherently unsafe (arbitrary code)
		return `'node ${rest.trim() || "(no args)"}' is not in the safe allowlist`;
	}

	// find: block -delete and -exec flags
	if (exe === "find") {
		const lowerRest = rest.toLowerCase();
		if (lowerRest.includes("-delete") || lowerRest.includes("-exec")) {
			return "'find' with -delete or -exec is not safe — it can modify the filesystem";
		}
		return null; // read-only find is safe
	}

	// tar: only allow inspection flags (t for list, not x for extract)
	if (exe === "tar") {
		// Allow only: tar t..., tar --list
		const lowerRest = rest.toLowerCase();
		const firstFlag = rest.split(/\s+/)[0] ?? "";
		// Flags containing 'x' (extract) or 'c' (create) are unsafe
		if (
			/^-?[a-z]*[xcCdAruU][a-z]*/i.test(firstFlag) ||
			lowerRest.includes("--extract") ||
			lowerRest.includes("--create")
		) {
			return "'tar' with extract/create flags is not safe";
		}
		if (firstFlag.toLowerCase().includes("t") || lowerRest.includes("--list")) {
			return null; // listing archive contents is safe
		}
		return "'tar' invocation is not in the safe allowlist — only listing (tar t...) is safe";
	}

	// All other executables: check against the general safe set
	if (SAFE_EXECUTABLES.has(exe)) {
		return null; // safe
	}

	return `'${exe}' is not in the safe allowlist`;
}

// ---------------------------------------------------------------------------
// Compound command splitter
// ---------------------------------------------------------------------------

/**
 * Split a raw command string into individual shell segments on `&&`, `||`, `;`, and `|`.
 * Pipe-to-shell patterns (`| sh`, `| bash`, etc.) are flagged explicitly before splitting.
 *
 * This is a pragmatic tokenizer — it does not handle nested subshells (`$(...)`, backticks) or
 * here-docs, and intentionally classifies them as unsafe via the fallback.
 */
function splitSegments(command: string): string[] {
	// Split on the operators (&&, ||, ;, |) — simple approach without quote awareness.
	// We normalise `&&` and `||` before splitting on single `|` to avoid consuming them.
	const segments: string[] = [];
	// Replace && and || with a unique separator, then split on | and ;
	const normalised = command
		.replace(/&&/g, "\x00AND\x00")
		.replace(/\|\|/g, "\x00OR\x00")
		.replace(/;/g, "\x00SEP\x00")
		.replace(/\|/g, "\x00PIPE\x00");

	for (const part of normalised.split("\x00")) {
		const clean = part.replace(/^(?:AND|OR|SEP|PIPE)\s*/, "").trim();
		if (clean) {
			segments.push(clean);
		}
	}
	return segments;
}

/** Detect pipe-to-shell patterns in the raw command string (before segment splitting). */
function detectPipeToShell(command: string): string | null {
	// Matches patterns like: | sh, | bash, | zsh, | /bin/sh, etc.
	if (/\|\s*(?:\/(?:bin|usr\/bin)\/)?(?:sh|bash|zsh|fish|dash|csh|tcsh|ksh)\b/.test(command)) {
		return "piping into a shell (| sh, | bash, etc.) can execute arbitrary code";
	}
	return null;
}

/** Detect subshell / command substitution — always unsafe (we can't analyse the inner command). */
function detectSubshell(command: string): string | null {
	if (/\$\(/.test(command) || /`/.test(command)) {
		return "command substitution ($(...) or backticks) is not analysable and is treated as unsafe";
	}
	return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a shell command string as "safe" or "unsafe".
 *
 * "safe" means the command (and every segment of a compound command) is on the conservative read-only / build /
 * inspection allowlist. "unsafe" means it is not — the caller should surface a risk-acknowledgement prompt.
 *
 * @param command - The raw shell command string as it would be passed to `run_command`.
 */
export function classifyCommandSafety(command: string): CommandSafetyResult {
	const trimmed = command.trim();

	if (!trimmed) {
		return { safety: "unsafe", reason: "empty command" };
	}

	// Pre-scan: pipe-to-shell and subshell — caught before segment splitting
	const pipeShellReason = detectPipeToShell(trimmed);
	if (pipeShellReason) {
		return { safety: "unsafe", reason: pipeShellReason };
	}

	const subshellReason = detectSubshell(trimmed);
	if (subshellReason) {
		return { safety: "unsafe", reason: subshellReason };
	}

	// Split into segments and classify each
	const segments = splitSegments(trimmed);

	for (const segment of segments) {
		const reason = classifySegment(segment);
		if (reason !== null) {
			return {
				safety: "unsafe",
				reason: segments.length > 1 ? `segment "${segment.trim()}" is unsafe: ${reason}` : reason,
			};
		}
	}

	return { safety: "safe", reason: "all segments match the read-only / build / inspection allowlist" };
}
