/**
 * Diagnostics for sandbox task-result patch capture (follow-up-6 §3.5).
 *
 * When a sandbox task's captured diff cannot be applied to the result branch, the failure was previously a
 * generic `Error` and the offending patch was deleted with the temp dir, so a review card showed only
 * "git apply ... task.patch failed: corrupt patch at line 53" with no way to inspect the artifact. This
 * module turns that into a typed, classified failure: it distinguishes a *corrupt/garbled patch* (a capture
 * problem) from a *patch that simply does not apply* against the base, and extracts the first failing file
 * and hunk so the card can point at the exact spot. The pure parsing here is unit-tested without git; the
 * artifact-preservation IO lives in `task-result-branches.ts`.
 */

export type TaskPatchCaptureFailureClassification =
	/** The diff itself is malformed (e.g. "corrupt patch at line N"); a capture/serialization problem. */
	| "corrupt_patch"
	/** A well-formed diff that does not apply against the base tree; closer to an agent/merge problem. */
	| "apply_failed";

export interface TaskPatchCaptureFailureDetails {
	classification: TaskPatchCaptureFailureClassification;
	gitError: string;
	/** 1-based line in the patch git reported as the failure point, when available. */
	failingLine: number | null;
	firstFailingFile: string | null;
	firstFailingHunkHeader: string | null;
}

export interface TaskPatchCaptureErrorInit extends TaskPatchCaptureFailureDetails {
	taskId: string;
	preservedPatchPath: string | null;
}

export class TaskPatchCaptureError extends Error {
	readonly taskId: string;
	readonly classification: TaskPatchCaptureFailureClassification;
	readonly gitError: string;
	readonly failingLine: number | null;
	readonly firstFailingFile: string | null;
	readonly firstFailingHunkHeader: string | null;
	readonly preservedPatchPath: string | null;

	constructor(init: TaskPatchCaptureErrorInit) {
		const location = init.firstFailingFile
			? ` in ${init.firstFailingFile}${init.firstFailingHunkHeader ? ` (${init.firstFailingHunkHeader})` : ""}`
			: "";
		super(
			`Sandbox task patch capture failed (${init.classification}) for ${init.taskId}${location}: ${init.gitError.trim()}`,
		);
		this.name = "TaskPatchCaptureError";
		this.taskId = init.taskId;
		this.classification = init.classification;
		this.gitError = init.gitError;
		this.failingLine = init.failingLine;
		this.firstFailingFile = init.firstFailingFile;
		this.firstFailingHunkHeader = init.firstFailingHunkHeader;
		this.preservedPatchPath = init.preservedPatchPath;
	}
}

export function isTaskPatchCaptureError(value: unknown): value is TaskPatchCaptureError {
	return value instanceof TaskPatchCaptureError;
}

const CORRUPT_PATCH_LINE_PATTERN = /corrupt patch at line (\d+)/i;
const PATCH_FAILED_FILE_PATTERN = /patch failed:\s*([^\s:]+(?:[^\s:][^:]*)?):(\d+)/i;
const DOES_NOT_APPLY_FILE_PATTERN = /(?:error:\s*)?([^\s:][^:]*?):\s*patch does not apply/i;
const WHILE_SEARCHING_FILE_PATTERN = /while searching for:[\s\S]*?\bin\s+([^\s]+)/i;

function extractPatchFileFromGitError(gitError: string): { file: string | null; line: number | null } {
	const patchFailed = gitError.match(PATCH_FAILED_FILE_PATTERN);
	if (patchFailed) {
		return { file: patchFailed[1].trim(), line: Number.parseInt(patchFailed[2], 10) };
	}
	const doesNotApply = gitError.match(DOES_NOT_APPLY_FILE_PATTERN);
	if (doesNotApply) {
		return { file: doesNotApply[1].trim(), line: null };
	}
	const whileSearching = gitError.match(WHILE_SEARCHING_FILE_PATTERN);
	if (whileSearching) {
		return { file: whileSearching[1].trim(), line: null };
	}
	return { file: null, line: null };
}

/** Returns the b-side path of the first `diff --git`/`+++` entry in the patch, when present. */
function firstPatchFile(patch: string): string | null {
	for (const line of patch.split("\n")) {
		const diffHeader = line.match(/^diff --git a\/.+ b\/(.+)$/);
		if (diffHeader) {
			return diffHeader[1].trim();
		}
		const plusHeader = line.match(/^\+\+\+ b\/(.+)$/);
		if (plusHeader) {
			return plusHeader[1].trim();
		}
	}
	return null;
}

/** Walks the patch tracking the active file/hunk, returning what is in effect at (1-based) `targetLine`. */
function locateFileAndHunk(
	patch: string,
	targetLine: number | null,
): { file: string | null; hunkHeader: string | null } {
	const lines = patch.split("\n");
	let currentFile: string | null = null;
	let currentHunk: string | null = null;
	let firstFile: string | null = null;
	let firstHunk: string | null = null;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const diffHeader = line.match(/^diff --git a\/.+ b\/(.+)$/);
		const plusHeader = line.match(/^\+\+\+ b\/(.+)$/);
		if (diffHeader) {
			currentFile = diffHeader[1].trim();
			currentHunk = null;
		} else if (plusHeader) {
			currentFile = plusHeader[1].trim();
		} else if (line.startsWith("@@")) {
			currentHunk = line.trim();
			if (!firstHunk) {
				firstHunk = currentHunk;
				firstFile = currentFile;
			}
		}
		if (targetLine !== null && index + 1 >= targetLine) {
			return { file: currentFile ?? firstFile, hunkHeader: currentHunk ?? firstHunk };
		}
	}
	return { file: firstFile ?? currentFile, hunkHeader: firstHunk ?? currentHunk };
}

export function classifyTaskPatchCaptureFailure(gitError: string, patch: string): TaskPatchCaptureFailureDetails {
	const corruptMatch = gitError.match(CORRUPT_PATCH_LINE_PATTERN);
	const fromError = extractPatchFileFromGitError(gitError);
	if (corruptMatch) {
		const failingLine = Number.parseInt(corruptMatch[1], 10);
		const located = locateFileAndHunk(patch, failingLine);
		return {
			classification: "corrupt_patch",
			gitError,
			failingLine: Number.isFinite(failingLine) ? failingLine : null,
			firstFailingFile: fromError.file ?? located.file ?? firstPatchFile(patch),
			firstFailingHunkHeader: located.hunkHeader,
		};
	}
	const located = locateFileAndHunk(patch, fromError.line);
	return {
		classification: "apply_failed",
		gitError,
		failingLine: fromError.line,
		firstFailingFile: fromError.file ?? located.file ?? firstPatchFile(patch),
		firstFailingHunkHeader: located.hunkHeader,
	};
}
