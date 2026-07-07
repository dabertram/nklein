// §5.U cohesive extraction (2026-07-07): the per-session TOOL-APPROVAL wrapper lifted out of the 447-line
// InMemoryNKleinSessionRuntime.startTaskSession. It owns the read-serialization + read dedup guards (§2.6) AND the
// §5.B auto-promote-on-first-repo-write recovery — a self-contained collaborator (no `this`; all its Maps/Sets are
// wrapper-local). A factory so startTaskSession just wires it. Imports copied from the runtime file then pruned.
import { REPO_MAP_INVALIDATING_TOOL_NAMES } from "./nklein-context-focus-extension";
import type { getNKleinLargeFileWorkflow } from "./nklein-large-file-workflow";
import { promoteCardToImplementation } from "./nklein-promotion-tool";
import { buildReadFilesRequestFingerprint, buildReadFilesTargetKeys } from "./nklein-read-files-fingerprint";
import type { StartNKleinSessionRuntimeRequest } from "./nklein-session-runtime";
import type { NKleinSdkToolApprovalRequest, NKleinSdkToolApprovalResult } from "./sdk-runtime-boundary";

type RequestToolApproval = StartNKleinSessionRuntimeRequest["requestToolApproval"];

interface TaskToolApprovalWrapperDeps {
	baseRequestToolApproval: StartNKleinSessionRuntimeRequest["requestToolApproval"];
	largeFileWorkflow: ReturnType<typeof getNKleinLargeFileWorkflow>;
	taskId: string;
	hostWorkspaceRoot: string;
	onCardPromoted: StartNKleinSessionRuntimeRequest["onCardPromoted"];
}

export function createTaskToolApprovalWrapper(deps: TaskToolApprovalWrapperDeps): RequestToolApproval {
	const { baseRequestToolApproval, largeFileWorkflow, taskId, hostWorkspaceRoot, onCardPromoted } = deps;
	const fileReadToolByTurn = new Map<string, { toolName: string; toolCallId: string }>();
	const approvedReadFilesRequestFingerprints = new Set<string>();
	const successfulReadFilesTargetKeys = new Set<string>();
	const successfulFullReadFilesPaths = new Set<string>();
	// §5.B Increment C — one-shot guard so the auto-promote recovery mutates the board at most once per session.
	let autoPromoteSettled = false;
	const approvalTurnKey = (approvalRequest: NKleinSdkToolApprovalRequest): string =>
		[
			approvalRequest.sessionId,
			approvalRequest.agentId,
			approvalRequest.conversationId,
			approvalRequest.iteration,
		].join(":");
	return baseRequestToolApproval
		? async (approvalRequest: NKleinSdkToolApprovalRequest): Promise<NKleinSdkToolApprovalResult> => {
				const turnKey = approvalTurnKey(approvalRequest);
				const claimedFileReadTool = fileReadToolByTurn.get(turnKey);
				// follow-up-6 §2.6: only serialize additional *content-read* tools within a turn (so a batch
				// read cannot fan out into another big read). Harmless discovery (list_files / find_files /
				// get_file_size) and edits/commands after a read are allowed, and the rejection text tells the
				// model to proceed with the already-shown result rather than "wait" (which it misread as a stall).
				const isContentReadTool =
					approvalRequest.toolName === "read_files" || approvalRequest.toolName === "read_large_file";
				if (
					claimedFileReadTool &&
					claimedFileReadTool.toolCallId !== approvalRequest.toolCallId &&
					isContentReadTool
				) {
					return {
						approved: false,
						reason: `Blocked ${approvalRequest.toolName}: this assistant turn already started ${claimedFileReadTool.toolName}. This tool call was rejected and read nothing; continue with the ${claimedFileReadTool.toolName} result already shown, or start another read in a later model request.`,
					};
				}
				if (approvalRequest.toolName === "read_large_file") {
					const blockedReason = await largeFileWorkflow.getReadLargeFileBlockingReason();
					if (blockedReason) {
						return {
							approved: false,
							reason: blockedReason,
						};
					}
					const approval = await baseRequestToolApproval(approvalRequest);
					if (approval.approved) {
						fileReadToolByTurn.set(turnKey, {
							toolName: approvalRequest.toolName,
							toolCallId: approvalRequest.toolCallId,
						});
					}
					return approval;
				}
				if (approvalRequest.toolName === "read_files") {
					const blockedReason = await largeFileWorkflow.getReadFilesBlockingReason();
					if (blockedReason) {
						return {
							approved: false,
							reason: blockedReason,
						};
					}
					const readTargetKeys = buildReadFilesTargetKeys(approvalRequest.input);
					const readRequestFingerprint = buildReadFilesRequestFingerprint(readTargetKeys);
					const repeatedReadTargetKeys = readTargetKeys.filter(
						(key) =>
							successfulReadFilesTargetKeys.has(key.rangeKey) ||
							(key.fullFile && successfulFullReadFilesPaths.has(key.path)),
					);
					if (readTargetKeys.length > 0 && repeatedReadTargetKeys.length === readTargetKeys.length) {
						return {
							approved: false,
							reason: `Blocked read_files: this exact file content was already read successfully in this task. Use the file content already in context, read only a focused line range if verbatim text was compacted away, make the needed edit, or run the acceptance command. No duplicate file content was read.`,
						};
					}
					if (readRequestFingerprint && approvedReadFilesRequestFingerprints.has(readRequestFingerprint)) {
						return {
							approved: false,
							reason: `Blocked read_files: this exact read_files request was already approved in this task. Use the file content already in context if the read succeeded, adjust the paths or line ranges if it failed, make the needed edit, or run the acceptance command. No duplicate file content was read.`,
						};
					}
					const approval = await baseRequestToolApproval(approvalRequest);
					if (approval.approved) {
						fileReadToolByTurn.set(turnKey, {
							toolName: approvalRequest.toolName,
							toolCallId: approvalRequest.toolCallId,
						});
						if (readRequestFingerprint) {
							approvedReadFilesRequestFingerprints.add(readRequestFingerprint);
						}
						if (readTargetKeys.length === 1) {
							for (const key of readTargetKeys) {
								successfulReadFilesTargetKeys.add(key.rangeKey);
								if (key.fullFile) {
									successfulFullReadFilesPaths.add(key.path);
								}
							}
						}
					}
					return approval;
				}
				const approval = await baseRequestToolApproval(approvalRequest);
				if (approval.approved && REPO_MAP_INVALIDATING_TOOL_NAMES.has(approvalRequest.toolName)) {
					approvedReadFilesRequestFingerprints.clear();
					successfulReadFilesTargetKeys.clear();
					successfulFullReadFilesPaths.clear();
					// §5.B Increment C — auto-promote recovery. A work card starts in Planning/Refinement and is
					// meant to call begin_implementation before it edits. A weak local model may skip that and just
					// start writing files / running build commands. `onCardPromoted` is wired only for work-card
					// starts, so when such a card gets its FIRST approved repo-mutating tool, treat that as the start
					// of implementation and move it Planning → In Progress so the lane reflects reality (the same
					// parse-and-recover principle as narrated tool calls — don't rely on the weak model calling the
					// explicit tool). Best-effort + one-shot: a board-lock hiccup must never block the legitimate
					// write, and `promoteCardToImplementation` is idempotent (already-implementing is a no-op).
					if (onCardPromoted && !autoPromoteSettled) {
						autoPromoteSettled = true;
						try {
							await promoteCardToImplementation({
								workspacePath: hostWorkspaceRoot,
								taskId: taskId,
								onPromoted: onCardPromoted,
							});
						} catch {
							// Non-fatal: the explicit begin_implementation tool and the runtime lane reconcile remain
							// as fallbacks if this best-effort board mutation fails.
						}
					}
				}
				return approval;
			}
		: undefined;
}
