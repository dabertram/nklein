/**
 * §5.AR skill-import safety — item D's NO-AUTO-EXECUTE bundled-script gate ("the real protection").
 *
 * The single most important containment rule in the whole skill-import epic: **a bundled script is NEVER auto-executed.**
 * `scripts/*` is RCE-by-default — a "productivity" skill that ships an executable is a red flag, not a feature. Where
 * {@link validateSkillBundledFileManifest} (item A) DETECTS the execution surface (category `scripts`, an `executable_mode`
 * bit, an `executable_script` extension), THIS module is the POLICY over that detection: it decides, per bundled file,
 * whether it may be materialised-and-read as inert DATA, must be gated behind EXPLICIT per-file human approval before it
 * can ever run, or must not be placed on disk at all (a reject-level containment violation).
 *
 * It is deliberately CONSERVATIVE — it fails toward `approval-required`. A file is approval-gated if ANY of these hold:
 *   (a) it lives under the `scripts/` root (script-by-LOCATION — RCE-by-default regardless of extension/mode);
 *   (b) the manifest flagged it `executable_mode` or `executable_script`;
 *   (c) its normalised path carries a known executable/script/native-binary extension (defence-in-depth — catches a
 *       `.sh` smuggled into `assets/` without the exec bit, which the manifest only flags under `scripts/`).
 * The overlap with the manifest is intentional: detection and policy are separate layers, and the policy layer double-
 * checks rather than trusting a single upstream signal.
 *
 * This is DISTINCT from the epic's other D leaf — {@link reconcileSkillCapabilityGrant}, which gates which TOOLS a skill
 * may call — and from {@link decideSkillImport} (Mode C), which gates the IMPORT friction. A skill can pass import review
 * yet still have every bundled script pinned behind approval here; the two decisions compose, they don't substitute.
 * A `requires-approval` disposition is NOT permission to run — it is the mark that running requires a human's explicit,
 * per-file yes, inside the §5.L sandbox + egress allowlist. Nothing here executes, reads disk, or mutates its input:
 * pure + total over the manifest's already-parsed {@link BundledFileEntryReport}s.
 */

import type { BundledFileEntryReport, BundledFileFindingCode } from "./skill-bundled-file-manifest.js";

/**
 * The per-file execution disposition:
 *   - `inert`             — a non-executable data file (references/assets/custom); may be materialised + read, never runs.
 *   - `requires-approval` — an executable/script; NEVER auto-run — a human must approve it per-file before any execution.
 *   - `blocked`           — a reject-level containment violation (traversal/absolute/UNC); must not be materialised at all.
 */
export type SkillFileExecutionDisposition = "inert" | "requires-approval" | "blocked";

/** Why a file landed on its disposition (machine-stable; a UI/quarantine record branches on these without string-matching). */
export type SkillExecutionReasonCode =
	| "reject_containment" // a reject-level manifest finding — do not place on disk
	| "under_scripts_root" // script-by-location — RCE-by-default
	| "executable_bit" // manifest `executable_mode`
	| "executable_extension" // a script/binary extension (manifest `executable_script`, or this gate's own check)
	| "inert_data"; // nothing executable detected

/** One file's execution decision. */
export interface SkillFileExecutionDecision {
	/** The path exactly as declared (untrusted; echoed for the reviewer). */
	rawPath: string;
	/** The normalised path (or `null` when the entry had no usable path) — echoed from the manifest report. */
	normalizedPath: string | null;
	disposition: SkillFileExecutionDisposition;
	/** The reason codes that drove the disposition, worst-first. */
	reasons: SkillExecutionReasonCode[];
}

/** The overall bundle posture — the worst disposition present across all files. */
export type SkillExecutionPosture = "clean" | "approval-required" | "blocked";

/** The discriminated gate result over a whole bundle. */
export interface SkillExecutionGateResult {
	posture: SkillExecutionPosture;
	/** One decision per input entry, in input order. */
	entries: SkillFileExecutionDecision[];
	/** The never-auto-run set: every file whose disposition is `requires-approval` (for the reviewer's approval list). */
	approvalRequired: SkillFileExecutionDecision[];
	/** Every file blocked outright (reject-level containment). */
	blocked: SkillFileExecutionDecision[];
	/** A one-line operator summary. */
	reason: string;
}

/** Reject-level manifest findings mean "do not even materialise this file". */
const REJECT_FINDINGS: ReadonlySet<BundledFileFindingCode> = new Set([
	"path_traversal",
	"absolute_path",
	"windows_drive_path",
	"unc_path",
]);

/**
 * Conservative executable/script/native-binary extension set (lower-cased, no dot). The gate treats a match as
 * `requires-approval` wherever it appears — defence-in-depth over the manifest, which only raises `executable_script`
 * for files under `scripts/`. Intentionally broad: the safe direction is to over-gate, since a false "approval-required"
 * just asks a human, while a false "inert" could auto-run a payload.
 */
const EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
	// shell / scripting
	"sh",
	"bash",
	"zsh",
	"ksh",
	"fish",
	"ps1",
	"psm1",
	"bat",
	"cmd",
	"com",
	"py",
	"pyc",
	"pyo",
	"pyw",
	"rb",
	"pl",
	"pm",
	"php",
	"lua",
	"tcl",
	"r",
	"js",
	"mjs",
	"cjs",
	"ts",
	"jsx",
	"tsx",
	"coffee",
	// native / linkable binaries
	"exe",
	"bin",
	"run",
	"app",
	"out",
	"so",
	"dylib",
	"dll",
	"o",
	"a",
	"ko",
	// other executable-ish
	"jar",
	"war",
	"class",
	"wasm",
	"appimage",
	"msi",
	"scr",
	"gadget",
]);

function extensionOf(path: string | null): string | null {
	if (!path) return null;
	// Use the last path segment only, so a dot in a directory name doesn't count.
	const lastSlash = path.lastIndexOf("/");
	const base = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
	const dot = base.lastIndexOf(".");
	// No extension, or a dotfile with no real extension (".env" → treat as no ext here; the manifest handles secrets).
	if (dot <= 0 || dot === base.length - 1) return null;
	return base.slice(dot + 1).toLowerCase();
}

function hasFinding(entry: BundledFileEntryReport, code: BundledFileFindingCode): boolean {
	return Array.isArray(entry.findings) && entry.findings.some((f) => f?.code === code);
}

/**
 * Classify one bundled-file report into an execution decision. Pure + total: defends against a malformed entry (missing
 * findings array, non-string paths) by degrading toward the safe direction (`requires-approval` if anything looks
 * executable; `inert` only when nothing does).
 */
export function classifyBundledFileExecution(entry: BundledFileEntryReport): SkillFileExecutionDecision {
	const rawPath = typeof entry?.rawPath === "string" ? entry.rawPath : "";
	const normalizedPath = typeof entry?.normalizedPath === "string" ? entry.normalizedPath : null;

	// 1. Reject-level containment dominates — this file must not be placed on disk, so execution is moot.
	const hasReject =
		Array.isArray(entry?.findings) && entry.findings.some((f) => f?.code != null && REJECT_FINDINGS.has(f.code));
	if (hasReject) {
		return { rawPath, normalizedPath, disposition: "blocked", reasons: ["reject_containment"] };
	}

	// 2. Executable surface ⇒ approval-required (never auto-run). Collect every reason that applies, worst-first.
	const reasons: SkillExecutionReasonCode[] = [];
	if (entry?.category === "scripts") reasons.push("under_scripts_root");
	if (hasFinding(entry, "executable_mode")) reasons.push("executable_bit");
	const ext = extensionOf(normalizedPath) ?? extensionOf(rawPath);
	if (hasFinding(entry, "executable_script") || (ext != null && EXECUTABLE_EXTENSIONS.has(ext))) {
		reasons.push("executable_extension");
	}
	if (reasons.length > 0) {
		return { rawPath, normalizedPath, disposition: "requires-approval", reasons };
	}

	// 3. Nothing executable detected — inert data.
	return { rawPath, normalizedPath, disposition: "inert", reasons: ["inert_data"] };
}

/**
 * The bundle-level gate: classify every entry, then aggregate to the worst posture. `blocked` if ANY file is a reject-
 * level containment violation; else `approval-required` if ANY file is an executable; else `clean` (all inert — the
 * bundle may be materialised as data with nothing to execute). Pure + total (a non-array input ⇒ an empty clean bundle).
 */
export function gateSkillBundleExecution(entries: readonly BundledFileEntryReport[]): SkillExecutionGateResult {
	const decisions = Array.isArray(entries) ? entries.map(classifyBundledFileExecution) : [];
	const blocked = decisions.filter((d) => d.disposition === "blocked");
	const approvalRequired = decisions.filter((d) => d.disposition === "requires-approval");

	let posture: SkillExecutionPosture;
	if (blocked.length > 0) posture = "blocked";
	else if (approvalRequired.length > 0) posture = "approval-required";
	else posture = "clean";

	const reason =
		posture === "clean"
			? `clean: ${decisions.length} inert file(s), nothing executable`
			: posture === "approval-required"
				? `approval-required: ${approvalRequired.length} executable file(s) must never auto-run`
				: `blocked: ${blocked.length} file(s) violate containment (not materialised)`;

	return { posture, entries: decisions, approvalRequired, blocked, reason };
}

// ---------------------------------------------------------------------------
// Convenience predicates
// ---------------------------------------------------------------------------

/** True when the bundle carries at least one file that must never auto-run without explicit human approval. */
export function skillBundleRequiresExecutionApproval(result: SkillExecutionGateResult): boolean {
	return result.approvalRequired.length > 0;
}

/**
 * The INVARIANT this whole module protects: the set of files that must NEVER be auto-executed. A caller wiring the
 * sandbox boundary uses this to enforce that no path in it is ever handed to a shell/exec seam without a recorded
 * per-file human approval. Returns the normalised paths (falling back to the raw path when normalisation failed).
 */
export function neverAutoExecutePaths(result: SkillExecutionGateResult): string[] {
	return result.approvalRequired.map((d) => d.normalizedPath ?? d.rawPath);
}
