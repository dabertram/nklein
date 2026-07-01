/**
 * SKILL.md BUNDLED-FILE manifest validator (todo §5.AP.A leaf (b) — the bundled-file (`scripts/` / `references/` /
 * `assets/`) manifest parser explicitly OWED when `skill-md-parse.ts` shipped) — PURE, deterministic decision core.
 *
 * WHAT: a community skill is not just its `SKILL.md` text — it can BUNDLE resource files (`scripts/*`, `references/*`,
 * `assets/*`) that the skill body points the agent at. Given the LIST of those bundled file entries as INJECTED values
 * (each `{ path, sizeBytes?, mode? }`, as an effectful seam would enumerate them from a directory listing — this core
 * NEVER touches the filesystem), STRICTLY validate the manifest's SHAPE and flag every containment risk, returning a
 * discriminated verdict: `{ verdict: "safe" | "review" | "reject", entries, findings, reason }`. Every entry is
 * normalised into a {@link BundledFileEntryReport} that records which category root it belongs under (or that it escapes
 * the recognised roots) and the risk findings attached to it; the top-level verdict is the worst severity present.
 *
 * The risks it flags (all structural — no content is read, no code is run):
 *   - PATH TRAVERSAL: a `..` segment that climbs out of the skill root (`scripts/../../etc/passwd`) → REJECT.
 *   - ABSOLUTE PATH: a POSIX-absolute (`/etc/…`), Windows-drive (`C:\…`), or UNC (`\\host\…`) path that ignores the
 *     skill root entirely → REJECT.
 *   - OUT-OF-ROOT PREFIX: a relative path whose first segment is not one of the recognised bundle roots
 *     (`scripts` / `references` / `assets`) — a file the skill smuggles outside the declared layout → REVIEW.
 *   - BACKSLASH SEPARATOR: a `\` used as a path separator (Windows-style / separator confusion) → REVIEW.
 *   - CONTROL / HIDDEN chars in the path (NUL, other C0 controls, a bare zero-width) — obfuscation a reviewer misses →
 *     REVIEW.
 *   - EXECUTABLE / SCRIPT under `scripts/` (an executable file mode, or a script/binary file extension): §5.AP.D says
 *     bundled `scripts/*` are RCE-by-default and must NEVER be auto-executed — surface every one for the human gate →
 *     REVIEW.
 *   - EMPTY / non-string / duplicate / oversized path → REVIEW/REJECT per the specific defect.
 *
 * WHY (§5.AP is "containment, not detection"): the researched verdict is that a bundled script is one of the TWO attack
 * surfaces a skill fuses (bundled-script RCE + prompt injection), and 84.2% of malicious payloads hide in the text — so
 * the bundled FILE layer needs its own structural gate that (a) is pure (no execution, no fs, no prompt exposure — it
 * dissolves the recursion the user flagged) and (b) COMPOSES with the rest of the pipeline. This is the leaf the two
 * downstream leaves were blocked on: §5.AP.E(i) (scan executables/binaries in `scripts/`/`assets/`) needs a validated,
 * category-tagged file list to scan, and §5.AP.D containment needs to know which entries are `scripts/*` (never
 * auto-exec) versus inert `references/*`/`assets/*`. A `reject`/`review` verdict routes the skill (or the offending
 * entries) to quarantine / a human gate; a `safe` verdict is only the ABSENCE of known-bad SHAPES and is NEVER a trust
 * assertion — containment, not this validator, is what protects the operator, and it never opens, reads, or runs a file.
 *
 * Kept pure + data-driven (no closures over I/O, no `path`/`fs` imports — path handling is done by explicit string rules
 * so the same logic is platform-independent and total) to mirror `skill-md-parse.ts` / `skill-injection-prescreen.ts` /
 * `tool-capability-manifest.ts`, so the whole verdict is unit-testable without a live runtime or fixture files.
 * Composition: it is standalone over the INJECTED entry list; it does not import or mutate {@link ParsedSkillManifest}
 * (the frontmatter and the bundled-file listing are separate inputs enumerated at different seams). It answers only:
 * "is this a well-formed, in-bounds bundled-file manifest, and which entries must a human review before activation?"
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * One bundled file a skill declares, as an effectful seam would enumerate it from the skill directory (this core never
 * reads it). Only {@link path} is required; {@link sizeBytes} / {@link mode} are optional signals that sharpen the
 * executable / oversize findings when a caller can supply them.
 */
export interface BundledFileEntry {
	/** The file's path RELATIVE to the skill root, as declared in the bundle (e.g. `scripts/run.sh`). */
	path: string;
	/** OPTIONAL. File size in bytes, when the seam knows it — used for the oversized-file finding. */
	sizeBytes?: number;
	/**
	 * OPTIONAL. The POSIX file mode bits (e.g. `0o755`), when the seam knows them — used to flag an executable bit. Only
	 * the executable bits (`0o111`) are inspected; the value is otherwise ignored.
	 */
	mode?: number;
}

/** Tunable knobs for the bundled-file validator. All optional; defaults match the §5.AP.A / §5.AP.D intent. */
export interface BundledManifestOptions {
	/**
	 * The recognised top-level bundle roots. A relative entry whose first path segment is not one of these is flagged as
	 * out-of-root (`unexpected_root`). Defaults to {@link DEFAULT_BUNDLE_ROOTS} (`scripts` / `references` / `assets`).
	 * Comparison is case-sensitive to match how a real checkout enumerates directory names.
	 */
	bundleRoots?: readonly string[];
	/**
	 * Maximum path length (characters) before an `oversized_path` finding is raised. Absurdly long paths are an evasion
	 * / DoS signal. Defaults to {@link DEFAULT_MAX_PATH_CHARS}.
	 */
	maxPathChars?: number;
	/**
	 * Maximum bundled-file size (bytes) before an `oversized_file` finding is raised (only when {@link BundledFileEntry.sizeBytes}
	 * is supplied). Defaults to {@link DEFAULT_MAX_FILE_BYTES}.
	 */
	maxFileBytes?: number;
}

/** The default recognised bundle roots (agentskills.io layout). */
export const DEFAULT_BUNDLE_ROOTS: readonly string[] = ["scripts", "references", "assets"];

/** Default maximum path length (chars). Generous for a real nested resource, tight enough to flag an evasion path. */
export const DEFAULT_MAX_PATH_CHARS = 255;

/** Default maximum bundled-file size (bytes) — 5 MiB. A resource far above this warrants a human look. */
export const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/**
 * The overall verdict, ordered by escalation. A `reject` finding forces `reject`; otherwise any `review` finding forces
 * `review`; a clean manifest is `safe`. NOTE: `safe` means only "no known-bad shapes were found" — it is the absence of
 * evidence, never an assertion of trust (see the WHY note; containment, not this validator, protects the operator).
 */
export type BundledManifestVerdict = "safe" | "review" | "reject";

/** The severity a single finding contributes; maps 1:1 onto the verdict it forces. */
export type BundledFileSeverity = "review" | "reject";

/**
 * Which recognised bundle root an entry resolved under, or a marker for the two ways it does not resolve to one. Lets a
 * downstream §5.AP.D containment / §5.AP.E(i) scan branch on the category (e.g. "only scan `scripts`/`assets`").
 */
export type BundleCategory =
	/** Under the recognised `scripts/` root — the RCE-by-default surface (§5.AP.D: never auto-execute). */
	| "scripts"
	/** Under the recognised `references/` root — inert reference material. */
	| "references"
	/** Under the recognised `assets/` root — inert asset files. */
	| "assets"
	/** A custom root supplied via {@link BundledManifestOptions.bundleRoots} (not one of the three standard ones). */
	| "custom"
	/** A relative path whose first segment is NOT a recognised root (smuggled outside the declared layout). */
	| "out_of_root"
	/** The path is absolute / escapes via `..` / is otherwise invalid, so no in-root category applies. */
	| "invalid";

/**
 * Machine-stable finding codes (a quarantine record / UI can branch on these without string-matching the message).
 * A single entry can accrue several. Ordered by family.
 */
export type BundledFileFindingCode =
	// shape defects -----------------------------------------------------------------------------------------------
	/** The entry was not an object, or its `path` was not a string. */
	| "invalid_entry"
	/** The `path` was empty / whitespace-only after trimming. */
	| "empty_path"
	/** Two entries normalised to the same path (a duplicate declaration — ambiguous, possible shadowing). */
	| "duplicate_path"
	/** The path exceeds the configured length budget. */
	| "oversized_path"
	// containment / traversal (reject) ---------------------------------------------------------------------------
	/** A `..` segment climbs out of the skill root (path traversal). */
	| "path_traversal"
	/** A POSIX-absolute path (`/…`) that ignores the skill root. */
	| "absolute_path"
	/** A Windows drive-letter absolute path (`C:\…` / `C:/…`). */
	| "windows_drive_path"
	/** A UNC path (`\\host\share\…`) — an absolute network path. */
	| "unc_path"
	// layout / obfuscation (review) ------------------------------------------------------------------------------
	/** The first path segment is not one of the recognised bundle roots. */
	| "unexpected_root"
	/** A `\` is used as a path separator (Windows-style / separator confusion). */
	| "backslash_separator"
	/** A NUL / other C0 control or a bare zero-width char appears in the path (obfuscation a reviewer misses). */
	| "control_char_in_path"
	// execution surface (review) — §5.AP.D ------------------------------------------------------------------------
	/** A file under `scripts/` (or any root) carries an executable mode bit — RCE-by-default; never auto-run. */
	| "executable_mode"
	/** A file under `scripts/` has a script/binary extension (`.sh`/`.py`/`.js`/… or a native binary) — never auto-run. */
	| "executable_script"
	/** The declared file size exceeds the configured budget. */
	| "oversized_file";

/** A single validation hit on one entry: what was flagged, how bad it is, and a short human message. */
export interface BundledFileFinding {
	/** Machine-stable classification of the hit. */
	code: BundledFileFindingCode;
	/** The severity this finding contributes to the overall verdict. */
	severity: BundledFileSeverity;
	/** Human-readable one-line explanation (safe to show a reviewer). */
	message: string;
}

/** The per-entry report: the original path, its normalised form + category, and every finding attached to it. */
export interface BundledFileEntryReport {
	/** The path exactly as declared in the input (untrusted; echoed verbatim for the reviewer). */
	rawPath: string;
	/**
	 * The path after separator + `.`-segment normalisation (forward slashes, redundant `.`/empty segments removed). For
	 * an invalid/absolute/traversing path this is best-effort and MUST NOT be treated as a safe location — the findings
	 * say why. `null` when the entry had no usable string path at all.
	 */
	normalizedPath: string | null;
	/** Which recognised root the entry resolved under (or `out_of_root` / `invalid`). */
	category: BundleCategory;
	/** Every finding on this entry, worst severity first. */
	findings: BundledFileFinding[];
}

/** The discriminated manifest result: a verdict, the per-entry reports, the flattened findings, and a one-line summary. */
export interface BundledManifestResult {
	verdict: BundledManifestVerdict;
	/** One report per input entry, in input order. */
	entries: BundledFileEntryReport[];
	/** Every finding across all entries (worst first), for a caller that wants the flat list. */
	findings: BundledFileFinding[];
	/** A one-line rationale summarising the verdict. */
	reason: string;
}

// ---------------------------------------------------------------------------
// Detection tables (data-driven)
// ---------------------------------------------------------------------------

/**
 * File extensions that make a bundled file a SCRIPT / native executable — the §5.AP.D "never auto-execute" surface. Kept
 * lowercase and compared against the lowercased extension. Not exhaustive (an extensionless executable is caught by the
 * mode bit instead), but covers the common RCE-carrying and native-binary types a "productivity" skill should not ship.
 */
const EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
	// shells / interpreters
	"sh",
	"bash",
	"zsh",
	"fish",
	"ps1",
	"psm1",
	"bat",
	"cmd",
	"py",
	"pyc",
	"pyo",
	"rb",
	"pl",
	"php",
	"js",
	"cjs",
	"mjs",
	"ts",
	"lua",
	"r",
	"jar",
	// native executables / libraries
	"exe",
	"dll",
	"so",
	"dylib",
	"bin",
	"com",
	"msi",
	"app",
	"deb",
	"rpm",
	"appimage",
	"scpt",
]);

/** The POSIX executable-bit mask (owner/group/other execute). */
const EXECUTABLE_MODE_MASK = 0o111;

/**
 * Zero-width / invisible code points that carry no glyph — an obfuscation in a path a human reviewer cannot see. Written
 * as an ALTERNATION of explicit `\u` escapes (not a character class) so it is self-documenting and does not trip biome's
 * misleading-character-class rule. Ordinary C0 controls (incl. NUL) are handled separately by a codepoint scan.
 */
const ZERO_WIDTH_RE = /​|‌|‍|⁠|﻿/u;

// ---------------------------------------------------------------------------
// Path analysis (pure string rules — no `path`/`fs`)
// ---------------------------------------------------------------------------

/** True if the string contains a C0 control character (U+0000–U+001F) or U+007F DEL. */
function hasControlChar(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f) {
			return true;
		}
	}
	return false;
}

/** True for a UNC path (`\\host\share\…` or `//host/share/…` with a host, i.e. a leading double separator). */
function isUncPath(raw: string): boolean {
	return /^[\\/]{2}[^\\/]/u.test(raw);
}

/** True for a Windows drive-letter absolute path (`C:\…`, `c:/…`, or bare `C:`). */
function isWindowsDrivePath(raw: string): boolean {
	return /^[A-Za-z]:(?:[\\/]|$)/u.test(raw);
}

/** True for a POSIX-absolute path (a single leading `/`), excluding the UNC double-slash form handled separately. */
function isPosixAbsolute(raw: string): boolean {
	return raw.startsWith("/") && !raw.startsWith("//");
}

/** The lowercased file extension (without the dot) of the last path segment, or `""` when there is none. */
function fileExtension(normalizedPath: string): string {
	const lastSlash = normalizedPath.lastIndexOf("/");
	const base = lastSlash >= 0 ? normalizedPath.slice(lastSlash + 1) : normalizedPath;
	const dot = base.lastIndexOf(".");
	// No dot, a leading-dot dotfile (`.env` → no extension), or a trailing dot → no meaningful extension.
	if (dot <= 0 || dot === base.length - 1) {
		return "";
	}
	return base.slice(dot + 1).toLowerCase();
}

/**
 * Normalise separators + collapse `.`/empty segments WITHOUT resolving `..` (resolving would hide a traversal — we want
 * to DETECT it, not silently fix it). Returns the forward-slash form plus whether a climbing `..` segment is present.
 * A `..` that would escape the root (appears before it is balanced by a real segment) sets `escapes`.
 */
function normalizeAndInspect(raw: string): { normalized: string; escapes: boolean } {
	const unified = raw.replace(/\\/g, "/");
	const rawSegments = unified.split("/");
	const out: string[] = [];
	let depth = 0;
	let escapes = false;
	for (const seg of rawSegments) {
		if (seg === "" || seg === ".") {
			continue; // redundant separator / current-dir — drop, does not change location
		}
		if (seg === "..") {
			if (depth === 0) {
				escapes = true; // climbs above the root
			} else {
				depth--;
				out.pop();
			}
			out.push(".."); // keep it visible in the normalized form so a reviewer sees the climb
			continue;
		}
		out.push(seg);
		depth++;
	}
	return { normalized: out.join("/"), escapes };
}

// ---------------------------------------------------------------------------
// Per-entry validation
// ---------------------------------------------------------------------------

/** Append a finding to an entry's list. */
function push(
	findings: BundledFileFinding[],
	code: BundledFileFindingCode,
	severity: BundledFileSeverity,
	message: string,
): void {
	findings.push({ code, severity, message });
}

/**
 * Validate one entry. `seenPaths` accumulates normalised paths across the manifest so a duplicate can be flagged; it is
 * mutated here (the caller owns it). Returns the fully-populated {@link BundledFileEntryReport}.
 */
function validateEntry(
	entry: unknown,
	options: Required<BundledManifestOptions>,
	seenPaths: Set<string>,
): BundledFileEntryReport {
	// Shape: must be an object with a string `path`.
	if (entry === null || typeof entry !== "object") {
		const findings: BundledFileFinding[] = [];
		push(findings, "invalid_entry", "reject", "Bundled-file entry is not an object.");
		return { rawPath: "", normalizedPath: null, category: "invalid", findings };
	}
	const rawPathValue = (entry as { path?: unknown }).path;
	if (typeof rawPathValue !== "string") {
		const findings: BundledFileFinding[] = [];
		push(findings, "invalid_entry", "reject", "Bundled-file entry `path` must be a string.");
		return { rawPath: "", normalizedPath: null, category: "invalid", findings };
	}

	const rawPath = rawPathValue;
	const findings: BundledFileFinding[] = [];
	const trimmed = rawPath.trim();

	if (trimmed.length === 0) {
		push(findings, "empty_path", "reject", "Bundled-file entry `path` is empty.");
		return { rawPath, normalizedPath: null, category: "invalid", findings };
	}

	// Obfuscation: control / zero-width characters anywhere in the path.
	if (hasControlChar(rawPath) || ZERO_WIDTH_RE.test(rawPath)) {
		push(
			findings,
			"control_char_in_path",
			"review",
			"Path contains a control / zero-width character — obfuscation a reviewer cannot see.",
		);
	}

	// Length budget.
	if (rawPath.length > options.maxPathChars) {
		push(
			findings,
			"oversized_path",
			"review",
			`Path is ${rawPath.length} chars, exceeding the ${options.maxPathChars}-char budget.`,
		);
	}

	// Absolute-path family (each is a REJECT — the entry ignores the skill root). These are mutually exclusive shapes.
	let category: BundleCategory = "invalid";
	let absolute = false;
	if (isUncPath(rawPath)) {
		absolute = true;
		push(
			findings,
			"unc_path",
			"reject",
			"Path is a UNC network path (`\\\\host\\share\\…`), not a bundle-relative path.",
		);
	} else if (isWindowsDrivePath(rawPath)) {
		absolute = true;
		push(
			findings,
			"windows_drive_path",
			"reject",
			"Path is a Windows drive-letter absolute path (`C:\\…`), not a bundle-relative path.",
		);
	} else if (isPosixAbsolute(rawPath)) {
		absolute = true;
		push(findings, "absolute_path", "reject", "Path is POSIX-absolute (`/…`), not a bundle-relative path.");
	}

	// Backslash separator (Windows-style / separator confusion). Flagged even when not a drive/UNC path, since a bundle
	// path should use forward slashes; but the UNC/drive findings already cover those two absolute cases, so only flag
	// here when it is NOT one of them (avoid a redundant double-flag on `C:\x`).
	if (!absolute && rawPath.includes("\\")) {
		push(findings, "backslash_separator", "review", "Path uses a `\\` separator; bundle paths must use `/`.");
	}

	// Normalise (relative interpretation) + detect a climbing `..`.
	const { normalized, escapes } = normalizeAndInspect(trimmed);
	if (escapes) {
		push(findings, "path_traversal", "reject", "Path uses `..` to climb out of the skill root (path traversal).");
	}

	// Category resolution (only meaningful for a non-absolute path; an absolute path stays `invalid`).
	if (!absolute && !escapes) {
		const firstSlash = normalized.indexOf("/");
		const firstSegment = firstSlash >= 0 ? normalized.slice(0, firstSlash) : normalized;
		if (firstSegment === "scripts" || firstSegment === "references" || firstSegment === "assets") {
			category = firstSegment;
		} else if (options.bundleRoots.includes(firstSegment)) {
			category = "custom";
		} else {
			category = "out_of_root";
			push(
				findings,
				"unexpected_root",
				"review",
				`Path's first segment '${firstSegment}' is not a recognised bundle root (${options.bundleRoots.join(", ")}).`,
			);
		}
	}

	// Execution surface (§5.AP.D): an executable mode bit, or a script/binary extension. Applied to any in-bounds entry
	// (a script smuggled under `references/` is still executable) — but the risk is sharpest under `scripts/`.
	const mode = (entry as { mode?: unknown }).mode;
	if (typeof mode === "number" && Number.isFinite(mode) && (mode & EXECUTABLE_MODE_MASK) !== 0) {
		push(
			findings,
			"executable_mode",
			"review",
			"File carries an executable mode bit — RCE-by-default; must never be auto-executed (§5.AP.D).",
		);
	}
	const ext = fileExtension(normalized);
	if (ext.length > 0 && EXECUTABLE_EXTENSIONS.has(ext)) {
		push(
			findings,
			"executable_script",
			"review",
			`File has an executable/script extension (.${ext}) — must never be auto-executed (§5.AP.D).`,
		);
	}

	// File-size budget (only when the seam supplied a size).
	const sizeBytes = (entry as { sizeBytes?: unknown }).sizeBytes;
	if (typeof sizeBytes === "number" && Number.isFinite(sizeBytes) && sizeBytes > options.maxFileBytes) {
		push(
			findings,
			"oversized_file",
			"review",
			`File is ${sizeBytes} bytes, exceeding the ${options.maxFileBytes}-byte budget.`,
		);
	}

	// Duplicate detection (on the normalised form; only for entries that produced a usable path).
	if (normalized.length > 0) {
		if (seenPaths.has(normalized)) {
			push(
				findings,
				"duplicate_path",
				"review",
				`Path '${normalized}' is declared more than once (ambiguous / possible shadowing).`,
			);
		} else {
			seenPaths.add(normalized);
		}
	}

	sortFindings(findings);
	return { rawPath, normalizedPath: normalized.length > 0 ? normalized : null, category, findings };
}

// ---------------------------------------------------------------------------
// Verdict assembly
// ---------------------------------------------------------------------------

/** Rank a severity for "worst-of" comparison (higher = worse). */
function severityRank(severity: BundledFileSeverity): number {
	return severity === "reject" ? 2 : 1;
}

/** Sort findings worst-first, stable within a severity (preserves the detection order this file emits them in). */
function sortFindings(findings: BundledFileFinding[]): void {
	findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

/** The verdict forced by a set of findings: `reject` if any reject-finding, else `review` if any, else `safe`. */
function verdictFor(findings: readonly BundledFileFinding[]): BundledManifestVerdict {
	let worst = 0;
	for (const finding of findings) {
		worst = Math.max(worst, severityRank(finding.severity));
	}
	if (worst >= 2) {
		return "reject";
	}
	if (worst === 1) {
		return "review";
	}
	return "safe";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * PURE §5.AP.A leaf (b) bundled-file manifest validator. Validates the SHAPE of a skill's declared bundled files (given
 * as an INJECTED {@link BundledFileEntry} list — never enumerated from disk here) and returns a {@link BundledManifestResult}.
 * Deterministic and total: the same `(entries, options)` always yields the same result; no exception escapes and nothing
 * is opened, read, or executed.
 *
 * The verdict is the WORST severity across every finding on every entry:
 *   - any `reject` finding (path traversal, absolute / drive / UNC path, an invalid or empty entry) → `reject`;
 *   - otherwise any `review` finding (out-of-root prefix, backslash separator, control/zero-width char, an executable
 *     mode / script extension, an oversized path or file, a duplicate) → `review`;
 *   - no findings → `safe`.
 *
 * IMPORTANT (containment, not detection): `safe` means only "no known-bad shapes were found" and is NEVER a trust
 * assertion — a caller must still route the skill through the §5.AP.C hash-pinned opt-in + §5.L containment, and any
 * `scripts/*` entry (even a clean one) must NEVER be auto-executed (§5.AP.D). This validator is a NEGATIVE-only,
 * structural signal that quarantines the obviously-unsafe manifest; it does not bless the rest.
 *
 * @param entries The bundled-file entries, INJECTED (each `{ path, sizeBytes?, mode? }`). A non-array is treated as empty.
 * @param options Optional tuning — the recognised bundle roots and the path/file size budgets.
 */
export function validateBundledFileManifest(
	entries: readonly BundledFileEntry[],
	options: BundledManifestOptions = {},
): BundledManifestResult {
	const resolved: Required<BundledManifestOptions> = {
		bundleRoots: options.bundleRoots ?? DEFAULT_BUNDLE_ROOTS,
		maxPathChars: options.maxPathChars ?? DEFAULT_MAX_PATH_CHARS,
		maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
	};

	// Defensive: stay total even if a caller passes through untyped data — a non-array manifest scans as empty.
	const list: readonly unknown[] = Array.isArray(entries) ? entries : [];

	const seenPaths = new Set<string>();
	const reports: BundledFileEntryReport[] = [];
	const allFindings: BundledFileFinding[] = [];
	for (const entry of list) {
		const report = validateEntry(entry, resolved, seenPaths);
		reports.push(report);
		for (const finding of report.findings) {
			allFindings.push(finding);
		}
	}

	sortFindings(allFindings);

	const verdict = verdictFor(allFindings);
	const reason =
		allFindings.length === 0
			? `safe: ${reports.length} bundled file(s), no path-traversal / absolute-path / executable shapes found (absence of evidence, not a trust assertion)`
			: `${verdict}: ${allFindings.length} finding(s) across ${reports.length} entr${reports.length === 1 ? "y" : "ies"}, worst = ${allFindings[0].code}`;

	return { verdict, entries: reports, findings: allFindings, reason };
}
