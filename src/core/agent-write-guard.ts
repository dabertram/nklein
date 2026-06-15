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
