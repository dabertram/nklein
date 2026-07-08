/**
 * SKILL.md injection PRE-SCREEN (todo §5.AP.E — the deterministic, NON-LLM safety scan that adds ZERO prompt-exposure) —
 * PURE, deterministic decision core.
 *
 * WHAT: given a parsed community skill (its already-validated {@link ParsedSkillManifest} + its markdown `body`, both
 * INJECTED as plain values — never read from disk / network / a model), statically scan the text for the markers that
 * distinguish a hostile skill from a benign one, and return a single discriminated verdict:
 *   `{ verdict: "safe" | "review" | "reject", findings, reason }`.
 * The scan flags (a) prompt-injection / jailbreak phrasing in the body ("ignore previous instructions", role-override,
 * "you are now …"), (b) exfiltration / data-egress asks ("send … to http…", "POST your … to", secret-access phrasing),
 * (c) hidden / obfuscated content that a human reviewer's eyes would miss (zero-width & bidi-control unicode, homoglyph
 * mixing, embedded HTML comments, long base64 / hex blobs), and (d) declared-capability OVER-REACH — the manifest's
 * `allowed-tools` asking for tools OUTSIDE a caller-supplied allowed set (composing with the §5.L capability surface).
 * Each hit is a typed {@link InjectionFinding} with a machine-stable {@link InjectionFindingCode}, a severity, and a
 * short evidence excerpt; the overall verdict is the worst severity present.
 *
 * WHY (§5.AP is "containment, not detection"): the researched verdict for a skills marketplace is that you can NEVER
 * classify a skill as *safe* — an LLM classifier is itself injectable, and 84.2% of malicious payloads hide in the
 * SKILL.md natural-language TEXT, not in code, so code scanners structurally miss them. This module is therefore
 * deliberately NOT a "safe/unsafe" oracle: it DETECTS-FOR-CONTAINMENT. A `reject`/`review` verdict routes the skill to
 * quarantine / a human gate (§5.AP.C opt-in, §5.L containment); a `safe` verdict is only the ABSENCE of known-bad
 * markers and is never a trust assertion (containment, not this scan, is what actually protects the operator). It is
 * the one "checking" step that is safely pure — no prompt is ever fed to a model here, dissolving the recursion the
 * user flagged. It runs AFTER {@link ParsedSkillManifest structural parsing} (skill-md-parse.ts) and BEFORE the fuzzier
 * higher-risk stages, so malformed input never reaches it. It never executes, fetches, or edits anything.
 *
 * Kept pure + data-driven (regex/table-driven, no closures over I/O) to mirror `taint-labels.ts` /
 * `tool-capability-manifest.ts` / `skill-md-parse.ts`, so the whole verdict is unit-testable without a live runtime or
 * fixture files. Composition: it imports {@link ParsedSkillManifest} by TYPE from skill-md-parse.ts and does not modify
 * it; the over-reach check accepts the allowed tool set as an INJECTED argument rather than reaching into a §5.L module,
 * keeping this core dependency-free and total.
 */

import type { ParsedSkillManifest } from "./skill-md-parse";

// ---------------------------------------------------------------------------
// Verdict + finding shape
// ---------------------------------------------------------------------------

/**
 * The screen verdict, ordered by escalation. A `reject` finding forces `reject`; otherwise any `review` finding forces
 * `review`; a clean scan is `safe`. NOTE: `safe` means only "no known-bad markers were found" — it is the absence of
 * evidence, never an assertion of trust (see the WHY note; containment, not this scan, protects the operator).
 */
export type SkillScreenVerdict = "safe" | "review" | "reject";

/** The severity a single finding contributes; maps 1:1 onto the verdict it forces. */
export type InjectionSeverity = "review" | "reject";

/**
 * Machine-stable finding codes (a quarantine record / UI can branch on these without string-matching the message).
 * Every finding emits exactly one. Grouped by the four scan families described in the file header.
 */
export type InjectionFindingCode =
	// (a) prompt-injection / jailbreak phrasing
	/** "ignore/disregard/forget … previous/prior/above instructions" and close variants. */
	| "ignore_previous_instructions"
	/** Role-override / persona-reset ("you are now …", "act as …", "pretend you are …", "developer mode"). */
	| "role_override"
	/** Attempt to reveal or restate the system/developer prompt ("print your system prompt", "reveal your rules"). */
	| "system_prompt_probe"
	/** Instruction-hierarchy override phrasing ("ignore all rules", "override your guidelines/safety"). */
	| "instruction_override"
	// (b) exfiltration / egress / secret access
	/** Egress ask: "send/POST/upload/exfiltrate … to <url/host/email>". */
	| "data_exfiltration"
	/** Secret / credential access phrasing ("read the .env", "your API key", "~/.ssh", "access token"). */
	| "secret_access"
	/** A hardcoded URL / IP endpoint embedded in the body (an egress destination a scanner should surface). */
	| "embedded_endpoint"
	// (c) hidden / obfuscated content
	/** Zero-width / invisible unicode (ZWSP/ZWNJ/ZWJ/word-joiner/BOM) — text a human reviewer cannot see. */
	| "zero_width_unicode"
	/** Unicode bidi-control overrides (RLO/LRO/PDF/isolates) — can visually reorder / hide text (Trojan Source). */
	| "bidi_control_unicode"
	/** Homoglyph mixing: Latin words interleaved with confusable Cyrillic/Greek letters to evade text matching. */
	| "homoglyph_mixing"
	/** An embedded HTML comment (`<!-- … -->`) — a classic place to hide instructions from a rendered preview. */
	| "hidden_html_comment"
	/** A long base64 / hex blob — opaque payload a reviewer cannot read and a text scan cannot see through. */
	| "opaque_blob"
	// (d) declared-capability over-reach + size limits
	/** `allowed-tools` requests a tool OUTSIDE the caller-supplied allowed set (least-privilege over-reach). */
	| "capability_overreach"
	/** The body exceeds the configured size budget (oversized skills dilute review + hide payloads). */
	| "oversized_body";

/** A single pre-screen hit: what was flagged, how bad it is, and a short excerpt of the offending text. */
export interface InjectionFinding {
	/** Machine-stable classification of the hit. */
	code: InjectionFindingCode;
	/** The severity this finding contributes to the overall verdict. */
	severity: InjectionSeverity;
	/** Human-readable one-line explanation (safe to show a reviewer; never contains the whole body). */
	message: string;
	/** A short, trimmed excerpt of the matched text (bounded length) so a reviewer can locate it. */
	evidence: string;
}

/** The discriminated screen result: a verdict, every finding (worst first), and a one-line human summary. */
export interface SkillScreenResult {
	verdict: SkillScreenVerdict;
	findings: InjectionFinding[];
	/** A one-line rationale summarising the verdict (e.g. "reject: 2 finding(s), worst = data_exfiltration"). */
	reason: string;
}

/** Tunable knobs for the pre-screen. All optional; defaults are conservative and match the §5.AP.E intent. */
export interface SkillScreenOptions {
	/**
	 * The set of tool names the host is willing to grant (the §5.L / §5.AP.D least-privilege allowed set). When
	 * provided, any manifest `allowed-tools` entry NOT in this set raises a `capability_overreach` finding. When
	 * OMITTED, the over-reach check is skipped (there is no baseline to compare against — undeclared ≠ "allow all").
	 * Comparison is case-sensitive and exact, matching how a capability gate keys on tool identifiers.
	 */
	allowedToolBaseline?: readonly string[];
	/**
	 * Maximum body length (characters) before an `oversized_body` finding is raised. Oversized skills dilute human
	 * review and are a place to bury payloads. Defaults to {@link DEFAULT_MAX_BODY_CHARS}.
	 */
	maxBodyChars?: number;
	/**
	 * Minimum run length of base64/hex-looking characters before it is flagged as an `opaque_blob`. Defaults to
	 * {@link DEFAULT_MIN_BLOB_CHARS} — long enough to skip ordinary long words / hashes-in-prose but catch real blobs.
	 */
	minBlobChars?: number;
}

/** Default body-size budget (chars). Generous enough for a real skill, tight enough to flag a payload-stuffed one. */
export const DEFAULT_MAX_BODY_CHARS = 20_000;

/** Default opaque-blob threshold (chars of contiguous base64/hex). */
export const DEFAULT_MIN_BLOB_CHARS = 200;

/** Max characters of matched text kept in {@link InjectionFinding.evidence}. */
const EVIDENCE_MAX = 80;

// ---------------------------------------------------------------------------
// Detection tables (data-driven — each entry is one phrasing family)
// ---------------------------------------------------------------------------

/** One text-pattern rule: a regex, the code+severity it raises, and a human message. `g`+`i` flags assumed by scanner. */
interface PatternRule {
	code: InjectionFindingCode;
	severity: InjectionSeverity;
	pattern: RegExp;
	message: string;
}

/**
 * The natural-language / egress pattern table. Ordered by family (matching {@link InjectionFindingCode} groups). Each
 * regex is authored WITHOUT the global flag here; the scanner clones it with `gi` so a single rule can match repeatedly
 * and case-insensitively. Patterns are intentionally phrase-anchored (not single keywords) to keep false-positives low
 * while still catching the documented attack phrasings.
 */
const TEXT_RULES: readonly PatternRule[] = [
	// (a) prompt-injection / jailbreak phrasing --------------------------------------------------------------------
	{
		code: "ignore_previous_instructions",
		severity: "reject",
		pattern:
			/\b(?:ignore|disregard|forget|discard)\b[^.\n]{0,40}?\b(?:previous|prior|earlier|above|all)\b[^.\n]{0,20}?\b(?:instruction|prompt|direction|context|rule)s?\b/,
		message: "Body attempts to override prior instructions ('ignore previous instructions').",
	},
	{
		code: "role_override",
		severity: "reject",
		pattern:
			/\b(?:you\s+are\s+now|from\s+now\s+on\s+you\s+are|act\s+as|pretend\s+(?:to\s+be|you\s+are)|roleplay\s+as|you\s+must\s+now\s+act)\b/,
		message: "Body attempts a role/persona override ('you are now …', 'act as …').",
	},
	{
		code: "role_override",
		severity: "reject",
		pattern: /\b(?:developer\s+mode|dan\s+mode|jailbreak|do\s+anything\s+now|unrestricted\s+mode)\b/,
		message: "Body invokes a known jailbreak persona ('developer mode', 'DAN', 'do anything now').",
	},
	{
		code: "system_prompt_probe",
		severity: "reject",
		pattern:
			/\b(?:print|reveal|repeat|show|output|display|reproduce|leak)\b[^.\n]{0,30}?\b(?:system|developer|initial|hidden)\b[^.\n]{0,10}?\b(?:prompt|instruction|message|rule)s?\b/,
		message: "Body attempts to extract the system/developer prompt.",
	},
	{
		code: "instruction_override",
		severity: "reject",
		pattern:
			/\b(?:override|bypass|ignore|disable|turn\s+off|circumvent)\b[^.\n]{0,30}?\b(?:safety|guardrail|guideline|policy|policies|restriction|filter|rule)s?\b/,
		message: "Body attempts to override safety guidelines/guardrails.",
	},
	// (b) exfiltration / egress / secret access --------------------------------------------------------------------
	{
		code: "data_exfiltration",
		severity: "reject",
		pattern:
			/\b(?:send|post|upload|exfiltrate|transmit|forward|leak|email|curl|fetch|wget)\b[^.\n]{0,60}?\b(?:to|https?:\/\/|@|api|server|endpoint|webhook|bucket)\b/,
		message: "Body asks to send/upload data to an external destination (exfiltration).",
	},
	{
		code: "secret_access",
		severity: "reject",
		pattern:
			/\b(?:read|open|cat|dump|print|exfiltrate|steal|access|collect)\b[^.\n]{0,40}?(?:\.env\b|\benv\s+(?:file|var)|\bsecret|\bcredential|\bapi[_\s-]?key|\baccess[_\s-]?token|\bpassword|~\/\.ssh|\bprivate[_\s-]?key)/,
		message: "Body asks to access secrets/credentials (.env, API keys, SSH keys).",
	},
	{
		code: "embedded_endpoint",
		severity: "review",
		pattern: /\bhttps?:\/\/[^\s<>"')]+/,
		message: "Body embeds a hardcoded URL endpoint (potential egress destination).",
	},
	// (c) hidden / obfuscated content ------------------------------------------------------------------------------
	{
		code: "hidden_html_comment",
		severity: "review",
		pattern: /<!--[\s\S]*?-->/,
		message: "Body contains an HTML comment — a common place to hide instructions from a rendered preview.",
	},
];

/**
 * Invisible / zero-width code points that carry no glyph — text a human reviewer literally cannot see: the zero-width
 * space (U+200B), non-joiner (U+200C), joiner (U+200D), word joiner (U+2060), and a BOM/ZWNBSP (U+FEFF) appearing
 * mid-body (a leading BOM is stripped by the parser, so any survivor here is embedded). Written as an ALTERNATION of
 * explicit `\u` escapes — not a character class — so the pattern is self-documenting, copy-paste-safe, and does not
 * trip biome's misleading-character-class rule (a ZWJ inside a `[…]` class can silently compose emoji). Matching ANY
 * one is a `review` finding.
 */
const ZERO_WIDTH_RE = /​|‌|‍|⁠|﻿/;

/**
 * Unicode bidirectional-control overrides (LRE/RLE/PDF/LRO/RLO = U+202A–U+202E; LRI/RLI/FSI/PDI = U+2066–U+2069). These
 * can visually reorder or hide source text (the "Trojan Source" class). Presence is a `review` finding regardless of
 * surrounding text.
 */
const BIDI_CONTROL_RE = /[‪-‮⁦-⁩]/;

/** Latin-letter class + a "confusable" Cyrillic/Greek class, used together to detect homoglyph mixing within one word. */
const LATIN_LETTER = /[A-Za-z]/;
const CONFUSABLE_LETTER = /[Ѐ-ӿͰ-Ͽ]/; // Cyrillic + Greek blocks

// ---------------------------------------------------------------------------
// Scan helpers (pure)
// ---------------------------------------------------------------------------

/** Trim + collapse whitespace in a matched fragment and bound it to {@link EVIDENCE_MAX} for a tidy evidence excerpt. */
function excerpt(match: string): string {
	const collapsed = match.replace(/\s+/g, " ").trim();
	return collapsed.length > EVIDENCE_MAX ? `${collapsed.slice(0, EVIDENCE_MAX)}…` : collapsed;
}

/** Run every {@link TEXT_RULES} entry over `body`, emitting a finding per rule that matches at least once. */
function scanTextRules(body: string, findings: InjectionFinding[]): void {
	for (const rule of TEXT_RULES) {
		const re = new RegExp(rule.pattern.source, "gi");
		const match = re.exec(body);
		if (match !== null) {
			findings.push({
				code: rule.code,
				severity: rule.severity,
				message: rule.message,
				evidence: excerpt(match[0]),
			});
		}
	}
}

/** Emit findings for invisible / bidi-control unicode present anywhere in `body`. */
function scanHiddenUnicode(body: string, findings: InjectionFinding[]): void {
	if (ZERO_WIDTH_RE.test(body)) {
		findings.push({
			code: "zero_width_unicode",
			severity: "review",
			message: "Body contains zero-width / invisible unicode — text a human reviewer cannot see.",
			evidence: "<zero-width character(s)>",
		});
	}
	if (BIDI_CONTROL_RE.test(body)) {
		findings.push({
			code: "bidi_control_unicode",
			severity: "review",
			message: "Body contains bidirectional-control unicode that can visually reorder/hide text (Trojan Source).",
			evidence: "<bidi-control character(s)>",
		});
	}
}

/**
 * Detect homoglyph mixing: a single whitespace-delimited token that contains BOTH an ASCII Latin letter and a
 * confusable Cyrillic/Greek letter (e.g. "pａ​ѕѕword"). Legitimately-multilingual prose separates scripts into distinct
 * words, so only intra-token mixing is flagged — that is the evasion technique, not ordinary non-English text.
 */
function scanHomoglyphMixing(body: string, findings: InjectionFinding[]): void {
	for (const token of body.split(/\s+/)) {
		if (token.length > 1 && LATIN_LETTER.test(token) && CONFUSABLE_LETTER.test(token)) {
			findings.push({
				code: "homoglyph_mixing",
				severity: "review",
				message: "A word mixes Latin with confusable Cyrillic/Greek letters (homoglyph evasion).",
				evidence: excerpt(token),
			});
			return; // one representative finding is enough to route to review
		}
	}
}

/**
 * Detect a long contiguous base64/hex-looking run — an opaque blob a reviewer cannot read and a text scan cannot see
 * through. Uses `minBlobChars` as the threshold so ordinary long words / short hashes in prose do not trip it.
 */
function scanOpaqueBlob(body: string, minBlobChars: number, findings: InjectionFinding[]): void {
	const re = new RegExp(`[A-Za-z0-9+/=_-]{${minBlobChars},}`, "g");
	const match = re.exec(body);
	if (match !== null) {
		findings.push({
			code: "opaque_blob",
			severity: "review",
			message: `Body contains an opaque base64/hex-like blob (≥${minBlobChars} chars) that cannot be reviewed as text.`,
			evidence: excerpt(match[0]),
		});
	}
}

/**
 * Compare the manifest's declared `allowedTools` against the caller-supplied baseline. Any declared tool NOT in the
 * baseline is capability OVER-REACH (the skill asks for more power than the host grants). Emits one finding per
 * over-reaching tool. Skipped entirely when no baseline is supplied or the manifest declares no tools.
 */
function scanCapabilityOverreach(
	manifest: ParsedSkillManifest,
	baseline: readonly string[] | undefined,
	findings: InjectionFinding[],
): void {
	if (baseline === undefined || manifest.allowedTools === undefined) {
		return;
	}
	const allowed = new Set(baseline);
	for (const tool of manifest.allowedTools) {
		if (!allowed.has(tool)) {
			findings.push({
				code: "capability_overreach",
				severity: "review",
				message: `Declared tool '${tool}' is outside the host's allowed set (capability over-reach).`,
				evidence: excerpt(tool),
			});
		}
	}
}

/** Emit an `oversized_body` finding when the body exceeds the configured character budget. */
function scanBodySize(body: string, maxBodyChars: number, findings: InjectionFinding[]): void {
	if (body.length > maxBodyChars) {
		findings.push({
			code: "oversized_body",
			severity: "review",
			message: `Body is ${body.length} chars, exceeding the ${maxBodyChars}-char review budget.`,
			evidence: `<${body.length} chars>`,
		});
	}
}

// ---------------------------------------------------------------------------
// Verdict assembly
// ---------------------------------------------------------------------------

/** Rank a severity for "worst-of" comparison (higher = worse). */
function severityRank(severity: InjectionSeverity): number {
	return severity === "reject" ? 2 : 1;
}

/** The verdict forced by a set of findings: `reject` if any reject-finding, else `review` if any, else `safe`. */
function verdictFor(findings: readonly InjectionFinding[]): SkillScreenVerdict {
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
 * PURE §5.AP.E injection pre-screen. Statically scans an already-parsed community skill and returns a
 * {@link SkillScreenResult}. Deterministic and total: the same `(manifest, body, options)` always yields the same
 * result; no exception escapes and nothing is executed / fetched / read from disk.
 *
 * The verdict is the WORST severity across every finding:
 *   - any `reject` finding (injection / jailbreak / exfiltration / secret-access phrasing) → `reject`;
 *   - otherwise any `review` finding (hidden unicode, embedded endpoint/HTML comment, opaque blob, capability
 *     over-reach, oversized body) → `review`;
 *   - no findings → `safe`.
 *
 * IMPORTANT (containment, not detection): `safe` means only "no known-bad markers were found" and is NEVER a trust
 * assertion — a caller must still route the skill through the §5.AP.C hash-pinned opt-in + §5.L containment. This scan
 * is a NEGATIVE-only signal that quarantines the obviously-hostile; it does not bless the rest.
 *
 * @param manifest The validated frontmatter from {@link parseSkillMd} (imported by type; never mutated here).
 * @param body     The skill's markdown body text, INJECTED as a string (the parser already split it from frontmatter).
 * @param options  Optional tuning — the §5.L allowed-tool baseline for over-reach, size + blob thresholds.
 */
/**
 * Content-only injection scan for UNTRUSTED FETCHED TEXT (web pages, MCP payloads) — the §5.L taint scanner whose
 * findings land on `RetrievedEvidence.promptInjectionRiskFlags`. Reuses the SAME text rules as the skill prescreen
 * (imperative-override phrases, egress lures, hidden unicode, homoglyph mixing, opaque blobs) but skips the
 * manifest/capability checks that only make sense for skills. Returns flag strings (rule ids), empty = no findings.
 */
export function scanContentInjectionRisk(text: string, options: { minBlobChars?: number } = {}): string[] {
	const findings: InjectionFinding[] = [];
	const body = typeof text === "string" ? text : "";
	scanTextRules(body, findings);
	scanHiddenUnicode(body, findings);
	scanHomoglyphMixing(body, findings);
	scanOpaqueBlob(body, options.minBlobChars ?? DEFAULT_MIN_BLOB_CHARS, findings);
	return findings.map((finding) => finding.code);
}

export function prescreenSkillInjection(
	manifest: ParsedSkillManifest,
	body: string,
	options: SkillScreenOptions = {},
): SkillScreenResult {
	const maxBodyChars = options.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS;
	const minBlobChars = options.minBlobChars ?? DEFAULT_MIN_BLOB_CHARS;

	const findings: InjectionFinding[] = [];

	// Guard against a non-string body defensively (the type says string, but this core is a safety boundary and must
	// stay total even if a caller passes through untyped data). A non-string body scans as empty text.
	const text = typeof body === "string" ? body : "";

	// (a)+(b)+(embedded HTML) natural-language / egress rules, then (c) hidden-content scans, then (d) manifest checks.
	scanTextRules(text, findings);
	scanHiddenUnicode(text, findings);
	scanHomoglyphMixing(text, findings);
	scanOpaqueBlob(text, minBlobChars, findings);
	scanCapabilityOverreach(manifest, options.allowedToolBaseline, findings);
	scanBodySize(text, maxBodyChars, findings);

	// Sort worst-first (stable within a severity, preserving detection order) for a tidy, deterministic record.
	findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

	const verdict = verdictFor(findings);
	const reason =
		findings.length === 0
			? "safe: no injection / exfiltration / obfuscation markers found (absence of evidence, not a trust assertion)"
			: `${verdict}: ${findings.length} finding(s), worst = ${findings[0].code}`;

	return { verdict, findings, reason };
}
