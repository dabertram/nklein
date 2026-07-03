import { readFile } from "node:fs/promises";
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
import { assertRealToolPathWithinRoot, confineToolPath } from "./nklein-tool-path-containment";
import type { AgentTool } from "./sdk-agent-types";

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
	/** #38 (run37 live): the insert-at-line idiom (`insert_line` + `new_text`) models carry over from other
	 * ecosystems' editor tools — 6 pre-rejections abandoned 3 workers in one run. One-based boundary line;
	 * `text` is inserted BEFORE it (lineCount+1 appends at EOF). */
	insert?: { line: number; text: string };
	/** #42 (run42): `new_text` alone = replace the whole file's content (the SDK editor's create/replace idiom). */
	replaceAll?: string;
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
						: typeof record.old_text === "string"
							? record.old_text
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
						: typeof record.new_text === "string"
							? record.new_text
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
	// #38: the insert-at-line idiom takes precedence when no search text was given — `insert_line` (or
	// insertLine/line) plus new_text/text inserts BEFORE that one-based line. run42 (#42): models also send
	// the line as a NUMERIC STRING ("42") — coerce it rather than pre-reject the call.
	const insertLineRaw = record.insert_line ?? record.insertLine ?? record.line;
	const insertLine =
		typeof insertLineRaw === "number" && Number.isFinite(insertLineRaw)
			? Math.trunc(insertLineRaw)
			: typeof insertLineRaw === "string" && /^\d+$/.test(insertLineRaw.trim())
				? Number.parseInt(insertLineRaw.trim(), 10)
				: null;
	const insertText =
		typeof record.new_text === "string" ? record.new_text : typeof record.text === "string" ? record.text : null;
	const hasSearchField = [record.search, record.search_text, record.old, record.old_string, record.old_text].some(
		(value) => typeof value === "string",
	);
	if (insertLine !== null && insertText !== null && !hasSearchField) {
		return { path, edits: [], insert: { line: insertLine, text: insertText } };
	}
	// run42 (#42): `{path, new_text}` with NO search and NO line = the whole-file-replace idiom (the SDK editor's
	// "create/replace" semantics). Honor it as a full-content replacement through the same write guards.
	if (insertText !== null && !hasSearchField && insertLineRaw === undefined) {
		return { path, edits: [], replaceAll: insertText };
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

export function createEditFileTool(options: { workspacePath: string; maxFileLines?: number | null }): AgentTool {
	const maxFileLines = normalizeMaxAgentWritableFileLines(options.maxFileLines);
	return {
		name: "edit_file",
		description:
			"Edit an existing text file with one or more search/replace blocks instead of rewriting it. Each edit has a `search` (exact current text, copied verbatim including indentation) and a `replace`. Matching is lenient (tolerates indentation and small differences) and far cheaper than rewriting the whole file. Use `...` on its own line inside a search/replace to elide unchanged middle sections.",
		// LENIENT boundary (#38, the §5.BD law): the executor's parser already tolerates field-name variants
		// and now the insert-at-line idiom — the boundary must never pre-reject what execute can normalize.
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
						required: [],
						additionalProperties: true,
					},
				},
				insert_line: {
					type: ["number", "string", "null"],
					description:
						"Alternative to `edits`: one-based line to insert `new_text` BEFORE (line_count + 1 appends at EOF).",
				},
				new_text: {
					type: ["string", "null"],
					description: "The text to insert when `insert_line` is provided.",
				},
			},
			required: ["path"],
			additionalProperties: true,
		},
		async execute(input) {
			const request = parseEditFileRequest(input);
			if (!request) {
				throw new Error(
					"edit_file requires a path plus either `edits: [{ search, replace }]` blocks or `insert_line` (one-based) with `new_text` to insert before that line.",
				);
			}
			const protectedPath = findProtectedTestPath(request.path);
			if (protectedPath) {
				throw new Error(
					formatProtectedTestBlockReason({
						toolName: "edit_file",
						path: protectedPath,
						diff:
							request.replaceAll !== undefined
								? `+ (replace whole file) ${request.replaceAll.slice(0, 200)}`
								: request.insert
									? `+ (insert before line ${request.insert.line}) ${request.insert.text}`
									: request.edits.map((edit) => `- ${edit.search}\n+ ${edit.replace}`).join("\n"),
						reason: "edit_file attempted to modify a protected test-suite file.",
						expectedEffects: "The protected test-suite file would be edited.",
					}),
				);
			}
			const contained = confineToolPath(options.workspacePath, request.path);
			if (!contained.ok) {
				throw new Error(`Blocked edit_file: ${contained.message}`);
			}
			const real = await assertRealToolPathWithinRoot(
				contained.matchedRoot,
				contained.absolutePath,
				contained.relativePath,
			);
			if (!real.ok) {
				throw new Error(`Blocked edit_file: ${real.message}`);
			}
			const absolutePath = contained.absolutePath;
			let original: string;
			try {
				original = await readFile(absolutePath, "utf8");
			} catch {
				throw new Error(
					`Blocked edit_file: ${request.path} could not be read. Use write_file to create a new file, or read the file first to confirm its path.`,
				);
			}

			let applied: { content: string; appliedStrategies: string[] };
			if (request.replaceAll !== undefined) {
				// #42: whole-file replacement — same guards (protected paths, containment, line limit, secrets).
				applied = { content: request.replaceAll, appliedStrategies: ["replace-all"] };
			} else if (request.insert) {
				// #38: insert-at-line — clamp the one-based boundary into [1, lineCount+1] and splice the text in.
				const lines = original.split("\n");
				const boundary = Math.min(Math.max(1, request.insert.line), lines.length + 1);
				const insertedLines = request.insert.text.replace(/\n$/u, "").split("\n");
				lines.splice(boundary - 1, 0, ...insertedLines);
				applied = { content: lines.join("\n"), appliedStrategies: [`insert@${boundary}`] };
			} else {
				const replaced = applySearchReplaceBlocks(original, request.edits);
				if (!replaced.ok) {
					const similarityHint =
						typeof replaced.bestSimilarity === "number"
							? ` Closest match was ${(replaced.bestSimilarity * 100).toFixed(0)}% similar.`
							: "";
					throw new Error(
						`Blocked edit_file: edit block ${(replaced.failedBlockIndex ?? 0) + 1} did not match ${request.path}.${similarityHint} ${
							replaced.reason ?? ""
						}`.trim(),
					);
				}
				applied = { content: replaced.content, appliedStrategies: replaced.appliedStrategies };
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
				instruction: `Applied ${request.replaceAll !== undefined ? "the full-file replacement" : request.insert ? "the insert" : `${request.edits.length} edit${request.edits.length === 1 ? "" : "s"}`} to ${request.path} (${applied.appliedStrategies.join(", ")}). Continue from the edited file; do not repeat this edit.`,
			};
		},
	};
}
