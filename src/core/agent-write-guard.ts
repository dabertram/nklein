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

const PROTECTED_TEST_PATH_PREFIXES = ["test/protected/"] as const;
const PROTECTED_TEST_FILES = new Set(["vitest.protected.config.ts"]);

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
