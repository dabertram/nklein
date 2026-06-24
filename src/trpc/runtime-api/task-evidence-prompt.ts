import type { RuntimeBoardCard, RuntimeWorkspaceChangesResponse } from "../../core/api-contract";

/**
 * Pure rendering of task-evidence text for `createRuntimeApi`, extracted from the oversized `runtime-api.ts`
 * (todo §5.U). Turns a workspace-changes snapshot into a bounded diff-evidence preview and builds the prompt block
 * that hands an evidence bundle to a diagnosing agent. No I/O — just string building over the response shapes.
 */

function truncateEvidenceText(value: string, maxChars: number): string {
	const normalized = value.trimEnd();
	if (normalized.length <= maxChars) {
		return normalized;
	}
	return `${normalized.slice(0, maxChars).trimEnd()}\n[truncated after ${maxChars.toLocaleString()} characters]`;
}

export function renderWorkspaceChangesEvidence(changes: RuntimeWorkspaceChangesResponse | null): string | null {
	if (!changes || changes.files.length === 0) {
		return null;
	}
	const sections: string[] = [];
	for (const file of changes.files.slice(0, 20)) {
		sections.push(
			[
				`diff --nklein ${file.path}`,
				`status: ${file.status}; additions: ${file.additions}; deletions: ${file.deletions}`,
				file.previousPath ? `previous: ${file.previousPath}` : null,
				file.oldText !== null ? "--- old" : null,
				file.oldText !== null ? truncateEvidenceText(file.oldText, 4_000) : null,
				file.newText !== null ? "+++ new" : null,
				file.newText !== null ? truncateEvidenceText(file.newText, 4_000) : null,
			]
				.filter((line): line is string => line !== null)
				.join("\n"),
		);
	}
	if (changes.files.length > 20) {
		sections.push(`[${changes.files.length - 20} additional changed files omitted from evidence preview]`);
	}
	return `${sections.join("\n\n")}\n`;
}

export function buildTaskEvidencePromptBlock(input: {
	task: RuntimeBoardCard;
	workspacePath: string;
	taskCwd: string;
	baseCommit: string | null;
	bundlePath: string;
	transcriptCount: number;
	changeCount: number;
}): string {
	return [
		"Here is evidence from a !Klein task.",
		"",
		`Evidence bundle: ${input.bundlePath}`,
		`Workspace: ${input.workspacePath}`,
		`Task workspace: ${input.taskCwd}`,
		`Task: ${input.task.title?.trim() || input.task.id} (${input.task.id})`,
		`Base ref: ${input.task.baseRef}`,
		`Base commit: ${input.baseCommit ?? "unknown"}`,
		`Transcript files: ${input.transcriptCount}`,
		`Changed files captured: ${input.changeCount}`,
		"",
		"Please inspect the files in the evidence bundle, especially summary.md, transcript/, diff.patch, and config-snapshot.json. Then diagnose the issue, propose the smallest safe fix, and update the code/tests accordingly.",
	].join("\n");
}
