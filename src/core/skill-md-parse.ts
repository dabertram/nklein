/**
 * SKILL.md parser + manifest validator (todo §5.AP.A — align the §5.AE skill system to the open SKILL.md standard) —
 * PURE, deterministic decision core.
 *
 * WHAT: given the raw text of a community `SKILL.md` file as an INJECTED string, split its YAML frontmatter from its
 * markdown body, parse the frontmatter, and STRICTLY validate the manifest against the agentskills.io open standard
 * (`name` / `description` required; `license` / `compatibility` / `allowed-tools` / `version` / `metadata` optional and
 * shape-checked). Returns a discriminated result — `{ ok: true, manifest, body }` with a fully-typed
 * {@link ParsedSkillManifest}, or `{ ok: false, errors }` with precise, human-readable rejection reasons (the
 * `skills-ref validate` mirror the section calls for). NEVER executes, fetches, or touches the filesystem.
 *
 * WHY (§5.AP is "containment, not detection"): before an untrusted community skill can be screened, pinned, or gated
 * by the existing §5.L containment, it must first be turned from opaque text into a STRUCTURED, well-formedness-checked
 * object — and that structuring step is the one part of the pipeline that is safely pure (no prompt exposure, no I/O).
 * A malformed / mis-shaped manifest is rejected here deterministically (structural gate) BEFORE any of the fuzzier,
 * higher-risk stages (the §5.AP.E injection pre-screen, the §5.AP.C hash-pinned opt-in, §5.L capability gating) ever
 * run. In particular {@link ParsedSkillManifest.allowedTools} is the declared least-privilege capability surface that a
 * downstream §5.L / §5.AP.D containment check compares against an allowed set — so parsing it into a clean `string[]`
 * (and rejecting a mis-typed `allowed-tools`) is load-bearing for that later safety decision.
 *
 * Kept pure + data-driven (no closures, no I/O, no `yaml` file-reads) to mirror `skill-registry.ts` / `taint-labels.ts`
 * / `tool-capability-manifest.ts`, so the parse+validate contract is unit-testable without a live runtime or fixture
 * files. It does NOT scan the body for injection markers (that is the separate §5.AP.E pre-screen), and it does NOT
 * decide trust/allow (that is §5.L over the parsed {@link ParsedSkillManifest.allowedTools}). It only answers: "is this
 * a well-formed SKILL.md, and if so what does it structurally declare?"
 */

import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Structured manifest shape (the parsed, validated frontmatter)
// ---------------------------------------------------------------------------

/**
 * A fully-parsed, validated SKILL.md manifest — the frontmatter after well-formedness checks. Optional standard fields
 * are only present when the source declared them with a valid shape; unknown frontmatter keys are preserved verbatim in
 * {@link extra} (neither rejected nor trusted) so a downstream stage can inspect them without this parser having to
 * know the full evolving spec.
 */
export interface ParsedSkillManifest {
	/** REQUIRED. The skill's stable identifier/name (non-empty after trim). */
	name: string;
	/** REQUIRED. Human-readable description of what the skill does (non-empty after trim). */
	description: string;
	/** OPTIONAL. SPDX-ish license string, when declared. */
	license?: string;
	/** OPTIONAL. Semantic version string, when declared. */
	version?: string;
	/** OPTIONAL. Free-form compatibility declaration (e.g. host/product constraints), when declared. */
	compatibility?: string;
	/**
	 * OPTIONAL. The declared least-privilege tool allowlist (`allowed-tools`) as a de-duplicated, order-preserving,
	 * trimmed `string[]`. Absent (not `[]`) when the field was not declared — the two mean different things to a §5.L
	 * containment check (undeclared vs. explicitly-empty). This is the capability surface §5.AP.D / §5.L gate against.
	 */
	allowedTools?: string[];
	/** Any frontmatter keys outside the recognised standard fields, preserved verbatim (never trusted, never dropped). */
	extra: Readonly<Record<string, unknown>>;
}

/** A single, human-readable validation failure with a machine-stable {@link SkillParseErrorCode}. */
export interface SkillParseError {
	code: SkillParseErrorCode;
	message: string;
}

/**
 * Machine-stable rejection codes (a downstream UI / quarantine record can branch on these without string-matching the
 * message). Every rejection path emits exactly one of these.
 */
export type SkillParseErrorCode =
	/** The input was not a string, or was empty / whitespace-only. */
	| "empty_input"
	/** No frontmatter block was found (the file did not open with a `---` fence). */
	| "missing_frontmatter"
	/** A frontmatter block was opened with `---` but never closed with a second `---`. */
	| "unterminated_frontmatter"
	/** The frontmatter body failed to parse as YAML. */
	| "invalid_yaml"
	/** The frontmatter parsed to something other than a key/value mapping (a scalar, a list, or null). */
	| "frontmatter_not_mapping"
	/** A required field (`name` / `description`) is missing, empty, or not a string. */
	| "missing_required_field"
	/** A recognised field is present but has the wrong type/shape (e.g. `allowed-tools` is not a list of strings). */
	| "invalid_field_shape";

/** The discriminated parse result: a structured manifest + body on success, or a list of precise errors on failure. */
export type SkillParseResult =
	| { ok: true; manifest: ParsedSkillManifest; body: string }
	| { ok: false; errors: SkillParseError[] };

// ---------------------------------------------------------------------------
// Frontmatter splitting
// ---------------------------------------------------------------------------

/** The recognised standard frontmatter keys — everything else lands in {@link ParsedSkillManifest.extra}. */
const STANDARD_KEYS = new Set(["name", "description", "license", "version", "compatibility", "allowed-tools"]);

/** A `---` (or `----…`) fence line, allowing trailing whitespace but nothing else. */
const FENCE = /^-{3,}\s*$/;

/**
 * Split a SKILL.md document into its raw frontmatter text and body. Returns `null` for either a missing open fence or
 * an unterminated block (the caller maps each to a distinct error code). The open fence MUST be the first line — a
 * leading UTF-8 BOM is tolerated, but arbitrary leading blank lines are not (that would let a `---` mid-document be
 * mistaken for frontmatter). Line endings (`\n` / `\r\n`) are normalised for the split; the returned body preserves
 * its original text from just after the closing fence.
 */
function splitFrontmatter(text: string): { frontmatter: string; body: string } | "missing" | "unterminated" {
	// Tolerate a leading BOM without treating it as content.
	const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	const lines = withoutBom.split(/\r?\n/);
	if (lines.length === 0 || !FENCE.test(lines[0])) {
		return "missing";
	}
	for (let i = 1; i < lines.length; i++) {
		if (FENCE.test(lines[i])) {
			const frontmatter = lines.slice(1, i).join("\n");
			const body = lines.slice(i + 1).join("\n");
			return { frontmatter, body };
		}
	}
	return "unterminated";
}

// ---------------------------------------------------------------------------
// Field validation helpers
// ---------------------------------------------------------------------------

/** A non-empty (after trim) string, else `null`. Coerces nothing — a number/boolean `name` is NOT a valid name. */
function nonEmptyString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/**
 * Validate + normalise an `allowed-tools` frontmatter value into a de-duplicated, order-preserving, trimmed `string[]`.
 * Returns `{ tools }` on success or `{ error }` describing the exact shape problem. Accepts ONLY a YAML list of
 * non-empty strings — a bare string, a mapping, or a list containing a non-string / blank entry is rejected (a
 * mis-typed capability surface must fail the structural gate, never be silently coerced, since §5.L gates on it).
 */
function validateAllowedTools(value: unknown): { tools: string[] } | { error: string } {
	if (!Array.isArray(value)) {
		return { error: "`allowed-tools` must be a list of tool-name strings." };
	}
	const tools: string[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < value.length; i++) {
		const name = nonEmptyString(value[i]);
		if (name === null) {
			return { error: `\`allowed-tools[${i}]\` must be a non-empty string.` };
		}
		if (!seen.has(name)) {
			seen.add(name);
			tools.push(name);
		}
	}
	return { tools };
}

/**
 * Validate + normalise an OPTIONAL scalar string field (`license` / `version` / `compatibility`). Absent (`undefined`
 * / `null`) is fine and yields `{ value: undefined }`; a present-but-non-string or blank value is a shape error.
 */
function optionalScalar(fieldName: string, raw: unknown): { value: string | undefined } | { error: string } {
	if (raw === undefined || raw === null) {
		return { value: undefined };
	}
	const str = nonEmptyString(raw);
	if (str === null) {
		return { error: `\`${fieldName}\` must be a non-empty string when present.` };
	}
	return { value: str };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse + STRICTLY validate the raw text of a `SKILL.md` file (INJECTED as a string — this function never reads the
 * filesystem). On success returns the structured {@link ParsedSkillManifest} plus the markdown `body`; on failure
 * returns EVERY validation error found (missing/mis-shaped fields are all collected, not just the first) so a caller
 * can surface a complete rejection rationale.
 *
 * Validation order (each stage short-circuits the ones below it, because they cannot meaningfully run):
 *   1. non-empty string input                         → `empty_input`
 *   2. an opening `---` fence exists                   → `missing_frontmatter`
 *   3. a closing `---` fence exists                    → `unterminated_frontmatter`
 *   4. the frontmatter is valid YAML                   → `invalid_yaml`
 *   5. the frontmatter is a key/value mapping          → `frontmatter_not_mapping`
 *   6. field-level checks (collected together)         → `missing_required_field` / `invalid_field_shape`
 *
 * Deterministic and total: the same input always yields the same result; no exception escapes (a `yaml` parse error is
 * caught and mapped to `invalid_yaml`).
 */
export function parseSkillMd(text: unknown): SkillParseResult {
	if (typeof text !== "string" || text.trim().length === 0) {
		return {
			ok: false,
			errors: [{ code: "empty_input", message: "SKILL.md content must be a non-empty string." }],
		};
	}

	const split = splitFrontmatter(text);
	if (split === "missing") {
		return {
			ok: false,
			errors: [
				{
					code: "missing_frontmatter",
					message: "SKILL.md must begin with a `---` YAML frontmatter fence on its first line.",
				},
			],
		};
	}
	if (split === "unterminated") {
		return {
			ok: false,
			errors: [
				{
					code: "unterminated_frontmatter",
					message: "The `---` frontmatter block was opened but never closed with a second `---` fence.",
				},
			],
		};
	}

	let parsed: unknown;
	try {
		parsed = parseYaml(split.frontmatter);
	} catch (err) {
		const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
		return {
			ok: false,
			errors: [{ code: "invalid_yaml", message: `Frontmatter is not valid YAML: ${detail}` }],
		};
	}

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {
			ok: false,
			errors: [
				{
					code: "frontmatter_not_mapping",
					message: "Frontmatter must be a mapping of fields (key: value), not a scalar or list.",
				},
			],
		};
	}

	const fm = parsed as Record<string, unknown>;
	const errors: SkillParseError[] = [];

	// Required fields.
	const name = nonEmptyString(fm.name);
	if (name === null) {
		errors.push({
			code: "missing_required_field",
			message: "`name` is required and must be a non-empty string.",
		});
	}
	const description = nonEmptyString(fm.description);
	if (description === null) {
		errors.push({
			code: "missing_required_field",
			message: "`description` is required and must be a non-empty string.",
		});
	}

	// Optional scalar fields.
	const license = optionalScalar("license", fm.license);
	if ("error" in license) {
		errors.push({ code: "invalid_field_shape", message: license.error });
	}
	const version = optionalScalar("version", fm.version);
	if ("error" in version) {
		errors.push({ code: "invalid_field_shape", message: version.error });
	}
	const compatibility = optionalScalar("compatibility", fm.compatibility);
	if ("error" in compatibility) {
		errors.push({ code: "invalid_field_shape", message: compatibility.error });
	}

	// Optional allowed-tools (the capability surface).
	let allowedTools: string[] | undefined;
	const rawAllowed = fm["allowed-tools"];
	if (rawAllowed !== undefined && rawAllowed !== null) {
		const result = validateAllowedTools(rawAllowed);
		if ("error" in result) {
			errors.push({ code: "invalid_field_shape", message: result.error });
		} else {
			allowedTools = result.tools;
		}
	}

	if (errors.length > 0) {
		return { ok: false, errors };
	}

	// Preserve any non-standard keys verbatim (neither trusted nor dropped).
	const extra: Record<string, unknown> = {};
	for (const key of Object.keys(fm)) {
		if (!STANDARD_KEYS.has(key)) {
			extra[key] = fm[key];
		}
	}

	// `name`/`description` are non-null here (errors would have short-circuited otherwise); the casts are safe.
	const manifest: ParsedSkillManifest = {
		name: name as string,
		description: description as string,
		extra,
	};
	if ("value" in license && license.value !== undefined) {
		manifest.license = license.value;
	}
	if ("value" in version && version.value !== undefined) {
		manifest.version = version.value;
	}
	if ("value" in compatibility && compatibility.value !== undefined) {
		manifest.compatibility = compatibility.value;
	}
	if (allowedTools !== undefined) {
		manifest.allowedTools = allowedTools;
	}

	return { ok: true, manifest, body: split.body };
}
