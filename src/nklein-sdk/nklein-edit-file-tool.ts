import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { AgentTool } from "@nklein/shared";
import {
	countTextLines,
	findPotentialSecretInText,
	findProtectedTestPath,
	formatProtectedTestBlockReason,
	normalizeMaxAgentWritableFileLines,
} from "../core/agent-write-guard";
import { lockedFileSystem } from "../fs/locked-file-system";
import { applySearchReplaceBlocks, type SearchReplaceBlock } from "./nklein-fuzzy-edit";
import { repairJsonStringValue } from "./nklein-tool-argument-repair";

/**
 * `edit_file` — a token-efficient, lenient search/replace edit tool for small/quantized local models.
 *
 * Unlike whole-file rewrites (`write_files`), this sends only the changed regions, which fits small context
 * windows; unlike a strict patch applier, it uses `nklein-fuzzy-edit`'s fallback ladder so an almost-right
 * search block still lands instead of looping the model. It reuses the same write guards as `write_files`
 * (protected test paths, secret scanning, per-file line limit) and reports the applied match strategy plus a
 * corrective hint on failure (the reflection signal weak models need).
 */

interface EditFileBlockInput extends SearchReplaceBlock {}

export interface EditFileRequest {
	path: string;
	edits: EditFileBlockInput[];
}

function toEditBlock(value: unknown): SearchReplaceBlock | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value as Record<string, unknown>;
	// Accept the common field-name variants small models emit.
	const search =
		typeof record.search === "string"
			? record.search
			: typeof record.search_text === "string"
				? record.search_text
				: typeof record.old === "string"
					? record.old
					: typeof record.old_string === "string"
						? record.old_string
						: null;
	const replace =
		typeof record.replace === "string"
			? record.replace
			: typeof record.replace_text === "string"
				? record.replace_text
				: typeof record.new === "string"
					? record.new
					: typeof record.new_string === "string"
						? record.new_string
						: null;
	if (search === null || replace === null) {
		return null;
	}
	return { search, replace };
}

export function parseEditFileRequest(input: unknown): EditFileRequest | null {
	if (!input || typeof input !== "object") {
		return null;
	}
	const record = input as Record<string, unknown>;
	const rawPath =
		typeof record.path === "string" ? record.path : typeof record.file_path === "string" ? record.file_path : "";
	const path = rawPath.trim();
	if (!path) {
		return null;
	}
	// Allow a single {search,replace} at the top level or an `edits` array.
	const rawEdits = repairJsonStringValue(record.edits);
	const editValues = Array.isArray(rawEdits) ? rawEdits : [record];
	const edits = editValues.map(toEditBlock);
	if (edits.length === 0 || edits.some((edit) => edit === null)) {
		return null;
	}
	return { path, edits: edits as SearchReplaceBlock[] };
}

function resolveWritablePath(workspacePath: string, rawPath: string): string {
	return isAbsolute(rawPath) ? rawPath : resolve(workspacePath, rawPath);
}

export function createEditFileTool(options: { workspacePath: string; maxFileLines?: number | null }): AgentTool {
	const maxFileLines = normalizeMaxAgentWritableFileLines(options.maxFileLines);
	return {
		name: "edit_file",
		description:
			"Edit an existing text file with one or more search/replace blocks instead of rewriting it. Each edit has a `search` (exact current text, copied verbatim including indentation) and a `replace`. Matching is lenient (tolerates indentation and small differences) and far cheaper than rewriting the whole file. Use `...` on its own line inside a search/replace to elide unchanged middle sections.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Absolute or workspace-relative path to the file to edit." },
				edits: {
					type: "array",
					description: "One or more search/replace blocks applied in order.",
					items: {
						type: "object",
						properties: {
							search: { type: "string", description: "Exact current text to find, copied verbatim." },
							replace: { type: "string", description: "Replacement text." },
						},
						required: ["search", "replace"],
						additionalProperties: false,
					},
				},
			},
			required: ["path", "edits"],
			additionalProperties: false,
		},
		async execute(input) {
			const request = parseEditFileRequest(input);
			if (!request) {
				throw new Error("edit_file requires a path and one or more { search, replace } edits.");
			}
			const protectedPath = findProtectedTestPath(request.path);
			if (protectedPath) {
				throw new Error(
					formatProtectedTestBlockReason({
						toolName: "edit_file",
						path: protectedPath,
						diff: request.edits.map((edit) => `- ${edit.search}\n+ ${edit.replace}`).join("\n"),
						reason: "edit_file attempted to modify a protected test-suite file.",
						expectedEffects: "The protected test-suite file would be edited.",
					}),
				);
			}
			const absolutePath = resolveWritablePath(options.workspacePath, request.path);
			let original: string;
			try {
				original = await readFile(absolutePath, "utf8");
			} catch {
				throw new Error(
					`Blocked edit_file: ${request.path} could not be read. Use write_file to create a new file, or read the file first to confirm its path.`,
				);
			}

			const applied = applySearchReplaceBlocks(original, request.edits);
			if (!applied.ok) {
				const similarityHint =
					typeof applied.bestSimilarity === "number"
						? ` Closest match was ${(applied.bestSimilarity * 100).toFixed(0)}% similar.`
						: "";
				throw new Error(
					`Blocked edit_file: edit block ${(applied.failedBlockIndex ?? 0) + 1} did not match ${request.path}.${similarityHint} ${
						applied.reason ?? ""
					}`.trim(),
				);
			}
			if (applied.content === original) {
				return {
					path: request.path,
					changed: false,
					instruction: "edit_file made no change (replacement equals the original). Continue with the next step.",
				};
			}

			const lineCount = countTextLines(applied.content);
			if (lineCount > maxFileLines) {
				throw new Error(
					`Blocked edit_file: the edit would grow ${request.path} to ${lineCount} lines, exceeding the ${maxFileLines}-line file limit.`,
				);
			}
			const secretFinding = findPotentialSecretInText(applied.content);
			if (secretFinding) {
				throw new Error(
					`Blocked edit_file: potential ${secretFinding.label} detected in ${request.path}. Remove the secret or store it in the runtime's configured secret store before retrying.`,
				);
			}

			await lockedFileSystem.writeTextFileAtomic(absolutePath, applied.content);
			return {
				path: request.path,
				changed: true,
				strategies: applied.appliedStrategies,
				instruction: `Applied ${request.edits.length} edit${
					request.edits.length === 1 ? "" : "s"
				} to ${request.path} (${applied.appliedStrategies.join(", ")}). Continue from the edited file; do not repeat this edit.`,
			};
		},
	};
}
