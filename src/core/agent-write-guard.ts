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
