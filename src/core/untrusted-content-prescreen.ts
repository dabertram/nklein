/**
 * Phase 7S / S4 — surface-agnostic injection PRE-SCREEN for ANY untrusted ingested content (web-fetch/research results,
 * repo file contents + filenames, GitHub issue/PR/comment text, MCP tool outputs — anything from outside the operator's
 * chat). It is the generalization of the skill-specific {@link screenSkillForInjection}: the SAME directive-override /
 * role-override / jailbreak / exfiltration / hidden-text heuristics, minus the skill-manifest checks, so every ingestion
 * point can cheaply flag the loud cases BEFORE the text reaches a model.
 *
 * This is a FILTER, not the primary defense — the structural instruction/data boundary (S2) is. A `block` verdict means
 * "quarantine + surface to the operator, do not feed a model verbatim"; `suspicious` means "fence + flag". PURE +
 * deterministic; reuses the {@link InjectionFinding} shape/codes so findings render uniformly with the skill screen.
 */

import type { InjectionFinding, InjectionFindingCode, InjectionSeverity } from "./skill-injection-prescreen.js";

export type UntrustedContentVerdict = "clean" | "suspicious" | "block";

export interface UntrustedContentScreenResult {
	verdict: UntrustedContentVerdict;
	/** Every hit, worst-severity first. */
	findings: InjectionFinding[];
	/** One-line rationale (e.g. "block: 2 finding(s), worst = ignore_previous_instructions"). */
	reason: string;
}

export interface UntrustedContentScreenOptions {
	/** Cap the scanned length (chars); content beyond is ignored for pattern scanning (default 50k). */
	maxScanChars?: number;
}

/** Surface-agnostic pattern rule (`i` applied by the scanner). */
interface ContentPatternRule {
	code: InjectionFindingCode;
	severity: InjectionSeverity;
	pattern: RegExp;
	message: string;
}

// Zero-width chars (ZWSP/ZWNJ/ZWJ/word-joiner/BOM) and bidi controls (LRE…RLO / isolates) used to hide/reorder injected
// text. Checked by CODEPOINT (not a regex character class) so the codepoints are explicit + lint-safe.
const ZERO_WIDTH_CODES = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);
const BIDI_CONTROL_CODES = new Set([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);

/** First index of any codepoint in `codes`, or -1. */
function findCodepoint(text: string, codes: ReadonlySet<number>): number {
	for (let i = 0; i < text.length; i += 1) {
		if (codes.has(text.charCodeAt(i))) {
			return i;
		}
	}
	return -1;
}

const CONTENT_PATTERNS: readonly ContentPatternRule[] = [
	{
		code: "ignore_previous_instructions",
		severity: "reject",
		pattern:
			/\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|your)\s+(?:instructions?|prompts?|context|messages?|rules?)\b/,
		message: "Content tries to override prior instructions ('ignore previous instructions').",
	},
	{
		code: "instruction_override",
		severity: "reject",
		pattern: /\boverride\s+(?:your\s+|the\s+|all\s+)?(?:guidelines?|safety|rules?|system\s+prompt|instructions?)\b/,
		message: "Content tries to override the model's guidelines / safety rules.",
	},
	{
		code: "role_override",
		severity: "reject",
		// A role marker at a line start OR spliced after sentence-end punctuation ("…report. Assistant: ignore…").
		pattern: /(?:^|\n|[.!?]\s)\s*(?:system|assistant|developer)\s*:/,
		message: "Content injects a fake role turn ('System:'/'Assistant:') to hijack the conversation.",
	},
	{
		code: "role_override",
		severity: "reject",
		pattern:
			/\byou\s+are\s+(?:now\s+)?(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:assistant|ai|system|model|agent)\b|\b(?:act|pretend)\s+(?:as|to\s+be)\s+(?:the\s+)?(?:assistant|system|dan)\b|\b(?:developer\s+mode|dan\s+mode|jailbreak|do\s+anything\s+now|unrestricted\s+mode)\b/,
		message: "Content asserts a new role/persona or a jailbreak (role override).",
	},
	{
		code: "instruction_override",
		severity: "review",
		pattern:
			/\b(?:you\s+must\s+(?:now\s+)?|your\s+(?:new\s+)?(?:task|job|goal)\s+is\s+(?:now\s+)?|from\s+now\s+on\s+you\s+(?:must|will|should))\b/,
		message: "Content issues an authoritative directive to the reader (task hijacking).",
	},
	{
		code: "data_exfiltration",
		severity: "reject",
		// The verb→URL gap allows a realistic object phrase ("send the contents of your .env and API keys to <url>");
		// widened from 40 after the S10 red-team corpus found a lure whose 43-char object phrase slipped the tighter bound.
		pattern: /\b(?:send|post|forward|upload|exfiltrate|leak|email|transmit)\b[\s\S]{0,80}?\bhttps?:\/\/[^\s<>"')]+/,
		message: "Content directs sending data to an external URL (exfiltration).",
	},
	{
		code: "hidden_html_comment",
		severity: "review",
		pattern: /<!--[\s\S]*?(?:ignore|system|assistant|instruction|you must)[\s\S]*?-->/,
		message: "Content hides a directive inside an HTML/markdown comment.",
	},
];

const SEVERITY_RANK: Record<InjectionSeverity, number> = { reject: 2, review: 1 };

function excerpt(text: string, index: number, length: number): string {
	const start = Math.max(0, index - 12);
	return text
		.slice(start, Math.min(text.length, index + length + 12))
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120);
}

/**
 * Screen untrusted content for injection/directive/hidden-text patterns. `block` when any `reject`-severity finding
 * fires; `suspicious` on `review`-only; `clean` when nothing matches. Findings are worst-severity first.
 */
export function screenUntrustedContent(
	text: string,
	options: UntrustedContentScreenOptions = {},
): UntrustedContentScreenResult {
	const findings: InjectionFinding[] = [];
	if (typeof text !== "string" || text.length === 0) {
		return { verdict: "clean", findings, reason: "clean: empty content" };
	}
	const maxScanChars = options.maxScanChars ?? 50_000;
	const scanned = text.length > maxScanChars ? text.slice(0, maxScanChars) : text;

	const zwIndex = findCodepoint(scanned, ZERO_WIDTH_CODES);
	if (zwIndex >= 0) {
		findings.push({
			code: "zero_width_unicode",
			severity: "reject",
			message: "Content contains zero-width / invisible unicode used to hide injected text.",
			evidence: `at index ${zwIndex}`,
		});
	}
	const bidiIndex = findCodepoint(scanned, BIDI_CONTROL_CODES);
	if (bidiIndex >= 0) {
		findings.push({
			code: "bidi_control_unicode",
			severity: "reject",
			message: "Content contains unicode bidi-control overrides (can visually reorder/hide text — Trojan Source).",
			evidence: `at index ${bidiIndex}`,
		});
	}

	for (const rule of CONTENT_PATTERNS) {
		const match = new RegExp(rule.pattern.source, "i").exec(scanned);
		if (match) {
			findings.push({
				code: rule.code,
				severity: rule.severity,
				message: rule.message,
				evidence: excerpt(scanned, match.index, match[0].length),
			});
		}
	}

	findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
	const worst = findings[0];
	if (!worst) {
		return { verdict: "clean", findings, reason: "clean: no injection patterns matched" };
	}
	const verdict: UntrustedContentVerdict = worst.severity === "reject" ? "block" : "suspicious";
	return { verdict, findings, reason: `${verdict}: ${findings.length} finding(s), worst = ${worst.code}` };
}
