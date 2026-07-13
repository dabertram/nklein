import type {
	RuntimeBoardCard,
	RuntimeTaskEvidenceCapture,
	RuntimeWorkspaceChangesResponse,
} from "../../core/api-contract";

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
	capture: RuntimeTaskEvidenceCapture;
}): string {
	const instruction = (() => {
		switch (input.capture.status) {
			case "result_branch":
				return "Inspect summary.md, transcript/, diff.patch, and config-snapshot.json. Diagnose the issue, propose the smallest safe fix, and update the code/tests accordingly.";
			case "diff_failed":
				return "Inspect summary.md, transcript/, and config-snapshot.json for the diff-assembly error. Retry evidence collection before proposing code changes from this incomplete bundle.";
			case "capture_failed":
				return "Inspect summary.md, transcript/, and config-snapshot.json for the capture diagnostics. Recommend the smallest safe recovery or redrive; do not infer code changes from an absent diff.";
			case "evidence_failed":
				return "Evidence collection itself failed. Inspect summary.md and config-snapshot.json for diagnostics, then retry evidence collection before diagnosing or redriving the task.";
			case "capture_pending":
				return "Capture is still settling. Wait and collect evidence again before diagnosing the task result or proposing code changes.";
			case "no_changes":
				return "Inspect summary.md, transcript/, and config-snapshot.json to determine why the task produced no changes, then recommend whether and how to redrive it.";
			case "no_capture":
				return "Inspect summary.md, transcript/, and config-snapshot.json to diagnose why no result was captured, then recommend how to start or redrive the task.";
		}
	})();
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
		`Capture status: ${input.capture.status}`,
		`Recommended action: ${input.capture.action}`,
		`Capture detail: ${input.capture.message}`,
		`Result branch task id: ${input.capture.resultBranchTaskId}`,
		`Result commit: ${input.capture.resultCommit ?? "none"}`,
		"",
		instruction,
	].join("\n");
}
