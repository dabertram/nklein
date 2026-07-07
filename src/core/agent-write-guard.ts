export const DEFAULT_MAX_AGENT_WRITABLE_FILE_LINES = 1000;

export function normalizeMaxAgentWritableFileLines(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
		return Math.trunc(value);
	}
	return DEFAULT_MAX_AGENT_WRITABLE_FILE_LINES;
}

export function countTextLines(text: string): number {
	if (text.length === 0) {
		return 0;
	}
	return text.split("\n").length;
}

/**
 * `maxAgentWritableFileLines` is a SOFT target (the push-against point), NOT a hard wall — a write may exceed it when a
 * single larger file is genuinely more cohesive than splitting (that legitimately happens; still avoid it when
 * reasonable). The write tool only hard-BLOCKS at a much larger backstop = soft × this multiplier, to catch runaway or
 * accidental huge writes (a model dumping tens of thousands of lines is almost never intended). At 4× the default
 * 1000-line soft target the hard backstop is 4000 lines.
 */
export const HARD_WRITE_BACKSTOP_MULTIPLIER = 4;

/** The hard block ceiling (soft target × the backstop multiplier). Below it, over-target writes are allowed + nudged. */
export function resolveHardWriteBackstopLines(softTargetLines: unknown): number {
	return normalizeMaxAgentWritableFileLines(softTargetLines) * HARD_WRITE_BACKSTOP_MULTIPLIER;
}

/**
 * Soft "getting large" nudge threshold as a fraction of the soft target. Fires a proactive split nudge well before the
 * soft target so the agent decomposes a growing file EARLY (the file-size discipline David set as a standing !Klein
 * target). At 0.6× the default 1000-line soft target that's 600 lines — high enough not to nag ordinary files.
 */
export const LARGE_FILE_WRITE_NUDGE_RATIO = 0.6;

/**
 * Build a "keep files small — split this" nudge to append to a successful write, but ONLY when a just-written file is
 * getting large. Two tiers: files past the soft target get a STRONG (but allowed) over-target message; files merely
 * approaching it (>= 0.6× soft target) get a gentle early-split nudge. Returns null when every file is comfortably
 * small, so ordinary writes pay zero extra tokens (the sweet spot: extend the prompt only when it matters). Pure.
 */
export function buildLargeFileWriteNudge(
	written: ReadonlyArray<{ path: string; lines: number }>,
	maxFileLines: number,
): string | null {
	const soft = normalizeMaxAgentWritableFileLines(maxFileLines);
	const approaching = Math.max(1, Math.round(soft * LARGE_FILE_WRITE_NUDGE_RATIO));
	const large = written.filter((file) => file.lines >= approaching).sort((a, b) => b.lines - a.lines);
	if (large.length === 0) {
		return null;
	}
	const list = large.map((file) => `${file.path} (${file.lines} lines)`).join(", ");
	const plural = large.length === 1 ? "is" : "are";
	if (large.some((file) => file.lines > soft)) {
		return (
			`${list} ${plural} OVER the ${soft}-line soft target (allowed, but push back on it). ` +
			"Splitting into cohesive modules is strongly preferred — keep a single file this large only when it is genuinely more cohesive than the split (e.g. one generated artifact or data table). Otherwise pull a class, helper group, or type block out into its own module now."
		);
	}
	return (
		`Keep files small: ${list} ${plural} getting large (>= ${approaching} of the ${soft}-line soft target). ` +
		"Before it grows further, split a cohesive piece (a class, a related helper group, a config or type block) into its own module so no file becomes a large monolith."
	);
}

export interface AgentWriteSecretFinding {
	label: string;
}

export interface ProtectedTestApprovalRequest {
	intent: string;
	diff: string;
	reason: string;
	expectedEffects: string;
}

const PROTECTED_TEST_PATH_PREFIXES = ["test/protected/"] as const;
const PROTECTED_TEST_FILES = new Set(["vitest.protected.config.ts"]);
const MAX_PROTECTED_TEST_APPROVAL_FIELD_CHARS = 1_200;

export function findProtectedTestPath(path: string): string | null {
	const normalized = path.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
	if (!normalized) {
		return null;
	}
	if (PROTECTED_TEST_FILES.has(normalized)) {
		return normalized;
	}
	for (const prefix of PROTECTED_TEST_PATH_PREFIXES) {
		if (normalized === prefix.slice(0, -1) || normalized.startsWith(prefix)) {
			return normalized;
		}
	}
	return null;
}

function truncateProtectedApprovalField(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length <= MAX_PROTECTED_TEST_APPROVAL_FIELD_CHARS) {
		return trimmed;
	}
	return `${trimmed.slice(0, MAX_PROTECTED_TEST_APPROVAL_FIELD_CHARS).trimEnd()}\n[truncated]`;
}

export function buildProtectedTestApprovalRequest(input: {
	toolName: string;
	path: string;
	diff?: string | null;
	reason?: string | null;
	expectedEffects?: string | null;
}): ProtectedTestApprovalRequest {
	return {
		intent: `Change protected test suite path ${input.path} via ${input.toolName}.`,
		diff: truncateProtectedApprovalField(input.diff?.trim() ? input.diff : "(diff unavailable from tool input)"),
		reason: truncateProtectedApprovalField(
			input.reason?.trim()
				? input.reason
				: "The agent attempted to edit a protected test path. Default policy is deny until a human approves this exact edit.",
		),
		expectedEffects: truncateProtectedApprovalField(
			input.expectedEffects?.trim()
				? input.expectedEffects
				: "Protected-suite behavior may change. Approval should be granted only after reviewing the exact edit and confirming it does not weaken the guardrail.",
		),
	};
}

export function formatProtectedTestBlockReason(input: {
	toolName: string;
	path: string;
	diff?: string | null;
	reason?: string | null;
	expectedEffects?: string | null;
}): string {
	const request = buildProtectedTestApprovalRequest(input);
	return [
		`Blocked ${input.toolName}: ${input.path} is part of the protected test suite.`,
		"Default is deny. To request a one-edit human approval, ask the user through ask_followup_question with this exact JSON payload:",
		JSON.stringify(request),
	].join(" ");
}

const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
	{
		label: "private key block",
		pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----/u,
	},
	{
		label: "Anthropic API key",
		pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/u,
	},
	{
		label: "OpenAI-style API key",
		pattern: /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}\b/u,
	},
	{
		label: "GitHub token",
		pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/u,
	},
	{
		label: "AWS access key id",
		pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
	},
	{
		label: "long credential assignment",
		pattern:
			/\b(?:api[_-]?key|authorization|bearer|cookie|password|secret|token)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{24,}/iu,
	},
];

export function findPotentialSecretInText(text: string): AgentWriteSecretFinding | null {
	for (const { label, pattern } of SECRET_PATTERNS) {
		if (pattern.test(text)) {
			return { label };
		}
	}
	return null;
}
