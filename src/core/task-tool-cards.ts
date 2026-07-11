/**
 * Authored {@link ToolCard}s for the kanban task tool set (§5.O — small-model output robustness). These are the terse,
 * token-frugal descriptors the small-model tool interface shows *instead of* each tool's verbose native schema: the
 * two-phase picker (`two-phase-tool-pick.ts`) chooses over these cards first, then only the selected tool's full schema
 * is revealed. Keeping the cards here — beside the {@link ToolCard} shape — means the authored data and its consumers
 * (the picker, the small-model prompt) share one source of truth.
 *
 * SCOPE: one card per tool !Klein explicitly offers via `createKanbanToolPolicies()` (the workspace-scoped file tools).
 * The model is *also* offered the native SDK tools (run_commands / fetch_web / search) — those are owned + described by
 * the vendored SDK, so they are intentionally NOT re-carded here (no !Klein enumeration to keep them in sync with). A
 * unit test pins `KANBAN_TASK_TOOL_CARDS` to the exact `createKanbanToolPolicies()` key set, so adding or removing a
 * kanban tool fails the gate until its card is authored — "one card per existing tool" stays true by construction.
 */

import type { ToolCard } from "./tool-card";

/**
 * The kanban task tools, each as a short card (name · one-line purpose · use-when · terse args · avoid-when). Order
 * mirrors `createKanbanToolPolicies()` for readability; the card set (not the order) is what the parity test pins.
 */
export const KANBAN_TASK_TOOL_CARDS: readonly ToolCard[] = [
	{
		name: "find_files",
		purpose: "Find files by glob/name pattern under the workspace.",
		useWhen: "You need a file but don't know its exact path.",
		args: "pattern (glob); optional path (root to search).",
		avoidWhen: "You already know the exact path — read it directly instead.",
	},
	{
		name: "list_files",
		purpose: "List the entries of a single directory.",
		useWhen: "You want to see a directory's contents before choosing a file.",
		args: "path (directory); optional recursive.",
		avoidWhen: "Searching by name across the tree — use find_files.",
	},
	{
		name: "get_file_size",
		purpose: "Report a file's size (bytes / approx tokens) without reading it.",
		useWhen: "Before reading an unfamiliar file, to pick read_files vs read_large_file.",
		args: "path (file).",
		avoidWhen: "The file is already known to be small — just read it.",
	},
	{
		name: "read_files",
		purpose: "Read one or more text/image files, or an inclusive line range.",
		useWhen: "You know the path(s) and need the contents; batch several you'll need together.",
		args: "paths (absolute); optional start_line/end_line for a range.",
		avoidWhen: "The file is too large (read_files refuses it) — use read_large_file.",
	},
	{
		name: "read_large_file",
		purpose: "Read a large file in managed chunks with coverage tracking and synthesis.",
		useWhen: "read_files rejected a file as too large, or you must scan a big file end-to-end.",
		args: "path (absolute); the tool advances the chunk cursor itself.",
		avoidWhen: "A small file or a known narrow range — use read_files with a line range.",
	},
	{
		name: "write_file",
		purpose: "Create or fully overwrite a single file with complete contents.",
		useWhen: "Creating a new file, or wholesale-replacing a small file.",
		args: "path (absolute); content (the full file text).",
		avoidWhen: "Changing a few lines of an existing file — use editor or apply_patch.",
	},
	{
		name: "write_files",
		purpose: "Create or overwrite several whole files in one call.",
		useWhen: "You must write multiple complete files together.",
		args: "files: [{ path, content }].",
		avoidWhen: "A targeted edit to one existing file — use editor.",
	},
	{
		name: "editor",
		purpose: "Make a controlled edit to an existing text file (insert or replace lines).",
		useWhen: "Changing part of a file you've read; insert at, or replace, specific lines.",
		args: "path; new_text; optional insert_line (omit to replace the matched region).",
		avoidWhen: "Creating a brand-new file — use write_file.",
	},
	{
		name: "apply_patch",
		purpose: "Apply a unified-diff patch (with context lines) to existing file(s).",
		useWhen: "You have a diff-shaped change and the exact surrounding context lines.",
		args: "patch (unified diff including context).",
		avoidWhen: "You don't have exact context lines — use editor for a line-addressed edit.",
	},
	{
		name: "edit_file",
		purpose: "Edit an existing file with lenient search/replace blocks (token-cheap).",
		useWhen: "Changing regions of a file you've read — send just the changed snippets.",
		args: "path; edits: [{ search, replace }] (or insert_line + new_text).",
		avoidWhen: "Creating a new file — use write_file.",
	},
];

/** Look up a kanban task tool card by its exact tool name, or `undefined` when there is no card for that name. */
export function kanbanTaskToolCardByName(name: string): ToolCard | undefined {
	return KANBAN_TASK_TOOL_CARDS.find((card) => card.name === name);
}
