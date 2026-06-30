/**
 * Shared telemetry value-normalizers — previously copy-pasted across `model-performance-stats` /
 * `knowledge-tool-usage-stats` / `knowledge-tool-decomposition-signal`. Pure.
 *
 * NOTE: `self-observation-sink` deliberately keeps its OWN `normalizeOptionalString` that additionally REDACTS the text
 * (it persists free-form observation strings) — that redaction is intentional, so it is NOT consolidated here.
 */
import type { RuntimeModelPerformanceRole } from "../core/api-contract";

/** Trim a maybe-string to a non-empty value, or `null` (no redaction — see the module note). */
export function normalizeOptionalString(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/** Coerce a raw role string to one of the three performance roles, or `null`. */
export function normalizeRole(value: string | null | undefined): RuntimeModelPerformanceRole | null {
	const normalized = normalizeOptionalString(value)?.toLowerCase();
	if (normalized === "architect" || normalized === "worker" || normalized === "reviewer") {
		return normalized;
	}
	return null;
}

/** Canonicalize a tool name for telemetry grouping: lowercase, runs of non-alphanumerics → `_`, strip edge `_`. */
export function normalizeToolName(toolName: string): string {
	return toolName
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}
