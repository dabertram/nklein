/**
 * F4.24 — deterministic bundle screening for EXECUTABLES / binary payloads. The text-content screener
 * ({@link prescreenSkillInjection}) catches obfuscation / opaque blobs / capability over-reach in a skill's prose; this
 * complements it by inspecting the bundle's FILES for native-executable or script payloads a skill has no business
 * shipping — flagged by magic bytes (ELF / Mach-O / PE / shell archives), a leading shebang, or an executable file
 * extension. A flagged bundle is QUARANTINED (never a "safe" clear on its own — F4.24 is a screen, not an allow).
 *
 * PURE + deterministic: inspects the supplied `head` bytes + path, no I/O, no execution. `head` is the file's leading
 * bytes decoded as latin1 (so byte N is `head.charCodeAt(N)`); a few dozen bytes suffice for magic-number detection.
 */

export interface BundleFileInput {
	/** The file's bundle-relative path (used for the extension heuristic + reporting). */
	path: string;
	/** The file's leading bytes decoded as latin1 (`charCodeAt(i)` === byte i). Empty for a zero-byte file. */
	head: string;
}

export interface BundleFileVerdict {
	path: string;
	/** True when the file looks like a native executable / script payload. */
	flagged: boolean;
	/** Why it was flagged (magic / shebang / extension), or null when clean. */
	reason: string | null;
}

export interface BundleScreenResult {
	/** `quarantine` when ANY file is flagged; `safe` only when every file is clean (a screen, never an allow). */
	verdict: "safe" | "quarantine";
	files: BundleFileVerdict[];
}

/** File extensions that are executable/script payloads regardless of content. */
const EXECUTABLE_EXTENSIONS = new Set([
	"sh",
	"bash",
	"zsh",
	"command",
	"exe",
	"bat",
	"cmd",
	"ps1",
	"psm1",
	"bin",
	"dylib",
	"so",
	"dll",
	"o",
	"a",
	"app",
	"scpt",
	"vbs",
	"jar",
	"msi",
	"deb",
	"rpm",
	"pkg",
	"dmg",
	"wasm",
]);

/** Leading magic-byte signatures for native executables / archives. */
function magicReason(head: string): string | null {
	const b = (i: number): number => head.charCodeAt(i);
	if (head.length >= 4 && b(0) === 0x7f && b(1) === 0x45 && b(2) === 0x4c && b(3) === 0x46) {
		return "ELF executable magic";
	}
	// Mach-O (32/64, LE/BE) + universal/fat binary.
	if (
		head.length >= 4 &&
		((b(0) === 0xfe && b(1) === 0xed && (b(2) === 0xfa || b(3) === 0xfa)) ||
			(b(0) === 0xcf && b(1) === 0xfa && b(2) === 0xed && b(3) === 0xfe) ||
			(b(0) === 0xca && b(1) === 0xfe && b(2) === 0xba && b(3) === 0xbe))
	) {
		return "Mach-O executable magic";
	}
	if (head.length >= 2 && b(0) === 0x4d && b(1) === 0x5a) {
		return "PE/DOS (MZ) executable magic";
	}
	if (head.startsWith("#!")) {
		return "shebang script header";
	}
	return null;
}

function extensionOf(path: string): string {
	const base = path.split(/[\\/]/).pop() ?? path;
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Screen one file for an executable/script payload. */
export function screenBundleFile(file: BundleFileInput): BundleFileVerdict {
	const magic = magicReason(file.head);
	if (magic) {
		return { path: file.path, flagged: true, reason: magic };
	}
	const ext = extensionOf(file.path);
	if (EXECUTABLE_EXTENSIONS.has(ext)) {
		return { path: file.path, flagged: true, reason: `executable extension .${ext}` };
	}
	return { path: file.path, flagged: false, reason: null };
}

/** Screen a bundle: `quarantine` if any file is a native-executable / script payload, else `safe`. */
export function screenBundleForExecutables(files: readonly BundleFileInput[]): BundleScreenResult {
	const verdicts = files.map(screenBundleFile);
	return { verdict: verdicts.some((verdict) => verdict.flagged) ? "quarantine" : "safe", files: verdicts };
}
