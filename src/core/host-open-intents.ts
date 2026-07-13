import { isAbsolute, normalize } from "node:path";

/**
 * F2.6 (§5.M) — typed, allowlisted HOST-OPEN intents replacing the raw `runCommand` string surface. The client
 * sends ONLY a target id from this closed enum; the SERVER builds the exact command from its own platform + the
 * workspace path it already knows — no arbitrary local-mode strings cross the wire, ever. Ported verbatim from
 * the proven web-ui builder (`open-targets.ts`) including its shell quoting; the web-ui keeps only the option
 * METADATA (labels/icons) for the picker.
 */

export const HOST_OPEN_TARGET_IDS = [
	"vscode",
	"vscode-insiders",
	"cursor",
	"windsurf",
	"finder",
	"terminal",
	"iterm2",
	"ghostty",
	"warp",
	"xcode",
	"intellijidea",
	"zed",
] as const;

export type HostOpenTargetId = (typeof HOST_OPEN_TARGET_IDS)[number];

export type HostOpenPlatform = "mac" | "windows" | "linux" | "other";

const TARGETS_BY_PLATFORM: Record<HostOpenPlatform, readonly HostOpenTargetId[]> = {
	mac: [
		"vscode",
		"cursor",
		"windsurf",
		"finder",
		"terminal",
		"iterm2",
		"ghostty",
		"warp",
		"xcode",
		"intellijidea",
		"vscode-insiders",
		"zed",
	],
	windows: ["vscode", "cursor", "windsurf", "finder", "vscode-insiders", "zed"],
	linux: ["vscode", "cursor", "windsurf", "finder", "vscode-insiders", "zed"],
	other: ["vscode", "vscode-insiders", "finder"],
};

export function isHostOpenTargetId(value: string): value is HostOpenTargetId {
	return (HOST_OPEN_TARGET_IDS as readonly string[]).includes(value);
}

/** Map `process.platform` to the open-target platform. */
export function hostOpenPlatformFromProcess(platform: string): HostOpenPlatform {
	if (platform === "darwin") {
		return "mac";
	}
	if (platform === "win32") {
		return "windows";
	}
	if (platform === "linux") {
		return "linux";
	}
	return "other";
}

function quoteShellArgument(value: string): string {
	return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function quoteWindowsShellArgument(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

function buildOpenAppCommand(path: string, ...appNames: string[]): string {
	const quotedPath = quoteShellArgument(path);
	if (appNames.length === 0) {
		return `open ${quotedPath}`;
	}
	const openAttempts = appNames.map((appName) => `open -a ${quoteShellArgument(appName)} ${quotedPath}`);
	if (openAttempts.length === 1) {
		return openAttempts[0] ?? `open ${quotedPath}`;
	}
	return `(${openAttempts.join(" || ")})`;
}

function buildLinuxCommand(targetId: HostOpenTargetId, quotedPath: string): string {
	switch (targetId) {
		case "vscode":
			return `code ${quotedPath}`;
		case "vscode-insiders":
			return `code-insiders ${quotedPath}`;
		case "cursor":
			return `cursor ${quotedPath}`;
		case "windsurf":
			return `windsurf ${quotedPath}`;
		case "zed":
			return `zed ${quotedPath}`;
		default:
			return `xdg-open ${quotedPath}`;
	}
}

function buildWindowsCommand(targetId: HostOpenTargetId, quotedPath: string): string {
	switch (targetId) {
		case "vscode":
			return `code ${quotedPath}`;
		case "vscode-insiders":
			return `code-insiders ${quotedPath}`;
		case "cursor":
			return `cursor ${quotedPath}`;
		case "windsurf":
			return `windsurf ${quotedPath}`;
		case "zed":
			return `zed ${quotedPath}`;
		default:
			return `explorer ${quotedPath}`;
	}
}

const MAC_APP_NAMES: Record<HostOpenTargetId, readonly string[]> = {
	vscode: ["Visual Studio Code"],
	"vscode-insiders": ["Visual Studio Code - Insiders"],
	cursor: ["Cursor"],
	windsurf: ["Windsurf"],
	finder: [],
	terminal: ["Terminal"],
	iterm2: ["iTerm", "iTerm2"],
	ghostty: ["Ghostty", "Ghostie"],
	warp: ["Warp"],
	xcode: ["Xcode"],
	intellijidea: ["IntelliJ IDEA", "IntelliJ IDEA CE"],
	zed: ["Zed"],
};

/**
 * Build the host open command for a TYPED target. An unsupported target on the platform falls back to the
 * platform's first (default) target, mirroring the proven web-ui behavior. The path is always shell-quoted.
 */
export function buildHostOpenCommand(targetId: HostOpenTargetId, path: string, platform: HostOpenPlatform): string {
	const supported = TARGETS_BY_PLATFORM[platform];
	const resolved = supported.includes(targetId) ? targetId : (supported[0] ?? "vscode");
	if (platform === "windows") {
		return buildWindowsCommand(resolved, quoteWindowsShellArgument(path));
	}
	if (platform === "linux" || platform === "other") {
		return buildLinuxCommand(resolved, quoteShellArgument(path));
	}
	return buildOpenAppCommand(path, ...MAC_APP_NAMES[resolved]);
}

export type HostOpenFileValidation = { ok: true; path: string } | { ok: false; reason: string };

/**
 * F2.6 server-side target validation for `openFile`: the path must be a plain ABSOLUTE filesystem path — no
 * URL schemes (an `http://…` string handed to a host opener would open an arbitrary site), no relative
 * traversal. Existence/type checks are the caller's (effectful) half; this is the pure shape gate.
 */
export function validateHostOpenFilePath(filePath: string): HostOpenFileValidation {
	const trimmed = filePath.trim();
	if (!trimmed) {
		return { ok: false, reason: "File path cannot be empty." };
	}
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
		return { ok: false, reason: "URLs are not openable through the host file opener." };
	}
	if (!isAbsolute(trimmed)) {
		return { ok: false, reason: "Only absolute file paths can be opened on the host." };
	}
	return { ok: true, path: normalize(trimmed) };
}
