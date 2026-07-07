import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type { ModelCapabilityEntry } from "./model-capability-catalog";

/**
 * §5.AL / §5.AB decision #1 (David 2026-07-07): the model-capability catalog must be DATA-DRIVEN, not baked into
 * source — the local-model landscape churns weekly (Qwen 3.5→3.6 in months; new fine-tunes constantly), so a
 * hardcoded TS list ships stale. This module loads a USER-EDITABLE overlay file (`model-catalog-overlay.json` in the
 * runtime home) that {@link import("./model-capability-catalog").lookupModelCapability} consults BEFORE the shipped
 * catalog — so a user (or an llmfit-catalog pull, a future §5.AL leaf) can ADD a new model or OVERRIDE a shipped
 * verdict without a code change or rebuild. No model names get hardcoded in src/ that can't be superseded from data.
 *
 * The overlay mirrors {@link ModelCapabilityEntry} except `match` is a REGEX SOURCE string (compiled
 * case-insensitively at load — ids are matched lowercased). Parsing is TOLERANT: a bad entry is SKIPPED with a
 * reported error, never rejecting the whole file (the same corruption-tolerant posture as the runtime config loader),
 * so one typo can't blank a user's whole overlay.
 */

const overlayEntrySchema = z.object({
	family: z.string().min(1),
	/** Regex SOURCE (compiled with the `i` flag at load). */
	match: z.string().min(1),
	toolUse: z.enum(["TOOL_NATIVE", "TOOL_CAPABLE", "TOOL_WEAK", "TOOL_UNSUITABLE", "UNKNOWN"]),
	kind: z.enum(["instruct", "agentic", "code", "reasoning", "chat", "roleplay", "unknown"]),
	chaining: z.enum(["native", "via_force", "single_only", "fails", "unknown"]).optional(),
	synthesis: z.enum(["full", "weak", "unknown"]).optional(),
	structuredOutput: z.enum(["json_schema", "json_schema_deadend", "native_tool_call", "unknown"]).optional(),
	speed: z.enum(["fast", "medium", "slow", "unknown"]).optional(),
	sizeGb: z.number().positive().optional(),
	selfScaffolding: z.boolean().optional(),
	note: z.string().default(""),
	sources: z.array(z.string()).default([]),
	severityOverride: z.enum(["ok", "warn", "reject", "unknown"]).optional(),
	disqualifiers: z.array(z.string()).optional(),
	basis: z.enum(["research", "empirical", "both"]).default("research"),
	verified: z.boolean().optional(),
});

const overlayRootSchema = z.object({
	version: z.number().optional(),
	models: z.array(z.unknown()).default([]),
});

export interface ModelCatalogOverlayResult {
	/** The compiled, valid overlay entries (in file order — earlier wins, like the shipped catalog). */
	entries: ModelCapabilityEntry[];
	/** Human-readable reasons any entries (or the file) were skipped — surfaced to the operator, never silent. */
	errors: string[];
}

/** The default overlay path in the runtime home (sibling of the model registry). */
export function defaultModelCatalogOverlayPath(home: string): string {
	return join(resolveNkleinRuntimeHomePath(home), "model-catalog-overlay.json");
}

/**
 * Validate + compile a parsed overlay document into {@link ModelCapabilityEntry}s. Pure (no I/O). Tolerant: an entry
 * that fails the schema or carries an invalid `match` regex is skipped with a reported error; the rest still load.
 */
export function parseModelCatalogOverlay(raw: unknown): ModelCatalogOverlayResult {
	const root = overlayRootSchema.safeParse(raw);
	if (!root.success) {
		return {
			entries: [],
			errors: [
				`model-catalog-overlay: root invalid (expected { models: [...] }): ${root.error.issues[0]?.message ?? "schema mismatch"}`,
			],
		};
	}
	const entries: ModelCapabilityEntry[] = [];
	const errors: string[] = [];
	root.data.models.forEach((rawEntry, index) => {
		const parsed = overlayEntrySchema.safeParse(rawEntry);
		if (!parsed.success) {
			errors.push(
				`model-catalog-overlay: model[${index}] skipped — ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
			);
			return;
		}
		let match: RegExp;
		try {
			match = new RegExp(parsed.data.match, "i");
		} catch (error) {
			errors.push(
				`model-catalog-overlay: model[${index}] (${parsed.data.family}) skipped — invalid match regex: ${(error as Error).message}`,
			);
			return;
		}
		entries.push({ ...parsed.data, match } as ModelCapabilityEntry);
	});
	return { entries, errors };
}

/**
 * Load + parse the overlay file. A MISSING file is the normal case (no overlay configured) → empty, no error. An
 * unreadable or non-JSON file yields an empty overlay + a reported error (never throws — best-effort, like the config
 * loader). Compose with {@link import("./model-capability-catalog").registerModelCatalogOverlay} at startup.
 */
export async function loadModelCatalogOverlay(path: string): Promise<ModelCatalogOverlayResult> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { entries: [], errors: [] };
		}
		return { entries: [], errors: [`model-catalog-overlay: could not read ${path}: ${(error as Error).message}`] };
	}
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (error) {
		return { entries: [], errors: [`model-catalog-overlay: ${path} is not valid JSON: ${(error as Error).message}`] };
	}
	return parseModelCatalogOverlay(json);
}
