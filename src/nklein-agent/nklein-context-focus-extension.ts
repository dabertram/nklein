// The "kanban-context-focus" SDK runtime extension: the beforeModel/afterModel/afterTool hooks that keep a small
// local model oriented and on-plan across turns — compact repo-map orientation (host-side, workspace-relative), the
// agent's own focus-chain re-anchor (§5.N), the opt-in immutable-GOAL re-anchor (§5.AD), the opt-in two-phase tool
// narrowing (§5.O), narrated-tool-call recovery + stall/truncation self-observation, and the large-file workflow.
// Extracted verbatim from nklein-session-runtime.ts (§5.U decomposition) so the runtime module owns lifecycle, not
// the extension's mechanics. The per-session re-anchor state lives here behind small accessors the runtime calls on
// focus-chain update / session end / dispose.

import { deriveTruncationSignal } from "../core/completion-stop-reason";
import { detectEditThrashing, extractFileEditsFromToolInput, type FileEditRecord } from "../core/edit-thrash-detector";
import { isTruthyEnv } from "../core/env-flag";
import type { FocusChain } from "../core/focus-chain";
import { mergeConsecutiveSameRoleSdkMessages } from "../core/normalize-system-first";
import { assessProgressStall, type TurnProgressRecord } from "../core/progress-stall-detector";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { getWorkspaceChanges } from "../workspace/get-workspace-changes";
import { buildKanbanContextPressurePolicy } from "./nklein-context-budgets";
import { focusKanbanReadFilesForNextRequest } from "./nklein-context-focus-policy";
import { reanchorFocusChainMessages } from "./nklein-focus-chain-rail";
import { getNKleinLargeFileWorkflow } from "./nklein-large-file-workflow";
import { forgetLiveTaskUsage, recordLiveTaskUsage } from "./nklein-live-usage-registry";
import { recoverNarratedToolCalls } from "./nklein-narrated-tool-call";
import { buildNKleinRepoMap, type RepoMapFactsCacheEntry } from "./nklein-repo-map";
import {
	collectRepoMapPersonalizationText,
	createRepoMapRailMessage,
	REPO_MAP_RAIL_MESSAGE_KIND,
} from "./nklein-repo-map-rail-messages";
import { reviewNKleinAfterModelCompletion } from "./nklein-self-review-hook";
import type { AgentAfterToolContext, AgentBeforeModelContext, AgentBeforeModelResult } from "./sdk-agent-types";
import type { NKleinSdkStartSessionInput } from "./sdk-runtime-boundary";
import { decideTaskReanchorForRequest } from "./task-reanchor-before-model";
import { latestStepText, narrowToolsForStep } from "./two-phase-before-model";
import type { TwoPhasePickModelCaller } from "./two-phase-tool-runner";

type NKleinSdkLocalRuntimeOptions = NonNullable<NKleinSdkStartSessionInput["localRuntime"]>;
export type NKleinSdkRuntimeExtension = NonNullable<NKleinSdkLocalRuntimeOptions["extensions"]>[number];

export const REPO_MAP_INVALIDATING_TOOL_NAMES = new Set([
	"apply_patch",
	"bash",
	"edit_file",
	"editor",
	"execute_command",
	"replace_in_file",
	"terminal",
	"write_file",
	"write_files",
	"write_to_file",
]);

/**
 * Latest focus chain (todo §5.N) per live session, captured when the agent calls `update_focus_chain`. The
 * beforeModel hook re-anchors it into each request so a small model stays on its own plan across turns and after
 * context compaction (the chain is otherwise only present as the tool call/result, which compaction can drop).
 */
const focusChainBySessionId = new Map<string, FocusChain>();
/** F12.15 edit-thrash watch: bounded per-session write-tool edit history + the files already flagged. */
const EDIT_THRASH_HISTORY_CAP = 40;
const editHistoryBySessionId = new Map<string, FileEditRecord[]>();
// F12.22 progress-stall watch (record-only): per-session recent tool-call progress records (call-granular — the
// afterTool hook has no turn boundary; a 12-call window approximates the 4-turn semantic) + the once-per-session flag.
const progressRecordsBySessionId = new Map<string, TurnProgressRecord[]>();
const progressStallFlaggedSessionIds = new Set<string>();
// F12.19 read-before-write watch (record-only): per-session paths the agent has READ (or written — its own write
// counts as knowing the content) + the once-per-session+path flag for ungrounded writes.
const readPathsBySessionId = new Map<string, Set<string>>();
const ungroundedWriteFlaggedBySessionId = new Map<string, Set<string>>();
const PROGRESS_RECORD_CAP = 24;
const PROGRESS_STALL_CALL_WINDOW = 12;
const editThrashFlaggedBySessionId = new Map<string, Set<string>>();

/**
 * §5.AD opt-in GOAL re-anchor (gated by NKLEIN_GOAL_REANCHOR): the turn at which the immutable top-level goal was last
 * re-injected, per session, so the cadence gate fires every N turns. Untouched (and this whole feature inert) when the
 * flag is off ⇒ byte-identical default. Cleared alongside the focus chain on session end/reset.
 */
const goalReanchorLastTurnBySessionId = new Map<string, number>();

/** Env-gated (NKLEIN_GOAL_REANCHOR) turn cadence for the opt-in immutable-goal re-anchor; sane default when unset. */
const GOAL_REANCHOR_EVERY_N_TURNS = 6;
// F12.21: under DISTRESS (edit-thrash or progress-stall flagged this session) the goal re-anchor tightens — a
// circling model needs re-grounding sooner than the calm cadence; the flags live in this file's own watch maps.
const GOAL_REANCHOR_DISTRESS_EVERY_N_TURNS = 3;

export function doesNKleinToolInvalidateRepoMap(context: AgentAfterToolContext): boolean {
	if (context.result.isError === true) {
		return false;
	}
	return REPO_MAP_INVALIDATING_TOOL_NAMES.has(context.toolCall.toolName.trim().toLowerCase());
}

async function appendRepoMapBeforeModel(
	context: AgentBeforeModelContext,
	_workspacePath: string,
	contextWindow: number | null | undefined,
	baseResult: AgentBeforeModelResult | null | undefined,
	getCachedRepoMap: (personalizationText: string) => Promise<string | null>,
): Promise<AgentBeforeModelResult | undefined> {
	if (baseResult?.stop) {
		return baseResult;
	}
	const messages = baseResult?.messages ?? context.request.messages;
	const repoMap = await getCachedRepoMap(collectRepoMapPersonalizationText(messages));
	if (!repoMap) {
		return baseResult ?? undefined;
	}
	const alreadyInjected = messages.some((message) => message.metadata?.kind === REPO_MAP_RAIL_MESSAGE_KIND);
	if (alreadyInjected) {
		return baseResult ?? undefined;
	}
	return {
		...baseResult,
		messages: [
			createRepoMapRailMessage(
				[
					"[!Klein repo map: compact codebase orientation]",
					"Workspace root: .",
					"Use workspace-relative paths for file tools; host absolute paths are not valid inside the agent sandbox.",
					`Context window: ${contextWindow ?? "unknown"} tokens`,
					repoMap,
					"Use this map to choose focused read_files calls; prefer symbol-level navigation over whole-file reading.",
				].join("\n"),
			),
			...messages,
		],
	};
}

export function createKanbanContextFocusExtension(
	sessionId: string,
	// The agent-perceived (sandbox) cwd. Used only for the large-file workflow's per-session state key; under
	// strict isolation that workflow is inert anyway (the agent's real read_large_file is the sandbox-proxied tool).
	agentPerceivedCwd: string,
	// The HOST project root, used for the trusted-runtime *orientation* reads (repo map + git changes) that the
	// runtime builds host-side and injects as context. These render WORKSPACE-RELATIVE paths only (no host leak).
	// It must be the host path, not the sandbox cwd (`/workspaces/<taskId>` does not exist on the host, which left
	// the repo map silently empty under isolation). It reflects the live project, not the sandbox baseRef checkout —
	// acceptable for codebase orientation.
	orientationWorkspacePath: string,
	contextWindow?: number | null,
	// §5.O opt-in two-phase tool narrowing: when supplied (only when NKLEIN_TWO_PHASE_TOOL_PICK is set), beforeModel runs a
	// phase-1 pick over the offered tools and narrows the request's tools to it. Undefined ⇒ inert (byte-identical default).
	twoPhasePickCaller?: TwoPhasePickModelCaller,
): NKleinSdkRuntimeExtension {
	const largeFileWorkflow = getNKleinLargeFileWorkflow(sessionId, agentPerceivedCwd);
	let cachedRepoMap: { key: string; value: Promise<string | null> } | null = null;
	let lastOfferedToolNames: readonly string[] = [];
	const contextPressure = buildKanbanContextPressurePolicy({ contextWindow });
	// F12.67: the per-session facts cache makes personalization-key rebuilds INCREMENTAL — unchanged files reuse
	// their parsed facts (Merkle-style content-hash check inside buildNKleinRepoMap); only edited files re-parse.
	const repoMapFactsCache = new Map<string, RepoMapFactsCacheEntry>();
	const getCachedRepoMap = async (personalizationText: string) => {
		const cacheKey = personalizationText;
		if (cachedRepoMap?.key !== cacheKey) {
			cachedRepoMap = {
				key: cacheKey,
				value: buildNKleinRepoMap({
					workspacePath: orientationWorkspacePath,
					tokenBudget: contextPressure.repoMapTokenBudget,
					personalizationText,
					factsCache: repoMapFactsCache,
				})
					.then((repoMap) => (repoMap.symbols.length > 0 ? repoMap.rendered : null))
					.catch(() => null),
			};
		}
		return await cachedRepoMap.value;
	};
	const hasChangedFiles = async (): Promise<boolean | null> => {
		try {
			const changes = await getWorkspaceChanges(orientationWorkspacePath);
			return changes.files.length > 0;
		} catch {
			return null;
		}
	};
	return {
		name: "kanban-context-focus",
		manifest: {
			capabilities: ["messageBuilders", "hooks"],
		},
		hooks: {
			async beforeModel(context) {
				// F12.40: stamp the SDK's run-cumulative usage into the live registry (one Map write per model call)
				// so the autonomy-budget watchdog can see what a RUNNING card has spent — the summary only learns
				// usage at run end. Defensive: odd runtimes/fakes may omit the snapshot.
				const snapshotUsage = context.snapshot?.usage;
				if (snapshotUsage && typeof snapshotUsage.inputTokens === "number") {
					recordLiveTaskUsage(sessionId, {
						inputTokens: snapshotUsage.inputTokens,
						outputTokens: snapshotUsage.outputTokens,
					});
				}
				const result = await appendRepoMapBeforeModel(
					context,
					agentPerceivedCwd,
					contextWindow,
					await largeFileWorkflow.beforeModel(context),
					getCachedRepoMap,
				);
				if (result?.stop) {
					return result;
				}
				// Re-anchor the agent's own focus chain (todo §5.N) into this request so a small model stays on its
				// plan across turns and after compaction. No-op when there is no chain (and no stale rail to strip).
				const baseMessages = result?.messages ?? context.request.messages;
				const messages = reanchorFocusChainMessages(baseMessages, focusChainBySessionId.get(sessionId) ?? null);
				let finalResult = messages === baseMessages ? result : { ...result, messages };
				// Section 5.AD opt-in immutable-GOAL re-anchor (gated by NKLEIN_GOAL_REANCHOR; default OFF = byte-identical):
				// every N turns, re-inject the ORIGINAL top-level task near the end of the context so a drifting model is
				// reminded of the goal. Distinct from the focus-chain re-anchor above (which re-projects the agent's OWN
				// plan). Pure decision over the current messages; only appends when the cadence gate fires AND a goal exists.
				if (isTruthyEnv(process.env.NKLEIN_GOAL_REANCHOR)) {
					const currentMessages = finalResult?.messages ?? baseMessages;
					// F12.21 event-driven tightening: a session flagged by the thrash/stall watches re-anchors at the
					// distress cadence instead of waiting out the calm one (loop research: re-ground BEFORE nudging).
					const inDistress =
						progressStallFlaggedSessionIds.has(sessionId) ||
						(editThrashFlaggedBySessionId.get(sessionId)?.size ?? 0) > 0;
					const reanchor = decideTaskReanchorForRequest({
						messages: currentMessages,
						turnCount: context.snapshot.iteration,
						lastReanchorTurn: goalReanchorLastTurnBySessionId.get(sessionId) ?? null,
						everyNTurns: inDistress ? GOAL_REANCHOR_DISTRESS_EVERY_N_TURNS : GOAL_REANCHOR_EVERY_N_TURNS,
					});
					if (reanchor.appended) {
						goalReanchorLastTurnBySessionId.set(
							sessionId,
							reanchor.nextLastReanchorTurn ?? context.snapshot.iteration,
						);
						finalResult = { ...(finalResult ?? {}), messages: reanchor.messages };
					}
				}
				// §5.O opt-in two-phase tool narrowing (inert without a caller ⇒ byte-identical default): run a phase-1 pick
				// over the offered tools and narrow the request's tools to it. Catch-guarded — any failure leaves the turn
				// unchanged, so the ON path can only help (a narrowed set) or no-op, never break the turn.
				if (twoPhasePickCaller) {
					const offeredTools = (context.request as unknown as { tools?: { name: string }[] }).tools ?? [];
					const step = latestStepText(
						context.request.messages as unknown as { role?: string; content?: unknown }[],
					);
					if (offeredTools.length >= 2 && step) {
						const narrowed = await narrowToolsForStep({
							tools: offeredTools,
							step,
							callModel: twoPhasePickCaller,
						}).catch(() => offeredTools);
						if (narrowed.length !== offeredTools.length) {
							finalResult = { ...(finalResult ?? {}), tools: narrowed } as typeof finalResult;
						}
					}
				}
				lastOfferedToolNames = (finalResult?.tools ?? context.request.tools).map((tool) => tool.name);
				// §5.AA recover-in-!Klein (live-found 2026-07-17): the hooks above may leave ADJACENT same-role user
				// messages (the context-focus brief lands as its own user turn ahead of the task's user turn), and
				// Mistral-family Jinja templates hard-500 the whole request ("conversation roles must alternate…",
				// ministral-3 engine 500). Normalize at the hook's EXIT so every insertion above — and any pre-existing
				// adjacency — merges in one model-agnostic place. No-op (same array back) for already-alternating turns.
				const outgoing = finalResult?.messages ?? context.request.messages;
				const normalized = mergeConsecutiveSameRoleSdkMessages(outgoing);
				if (normalized !== outgoing) {
					finalResult = { ...(finalResult ?? {}), messages: normalized };
				}
				return finalResult;
			},
			async afterModel(context) {
				// Robustness over teaching: if a weak model narrated its tool call as `<tool_call>` text instead of a
				// structured call, parse it and append a real tool-call part so the loop executes it (this hook runs
				// before the loop extracts tool calls from the message). A recovered call means the turn is NOT a
				// completion, so skip the synthesis/self-review completion hooks and let the loop dispatch the tool.
				const recoveredToolCalls = recoverNarratedToolCalls(context.assistantMessage, {
					offeredToolNames: lastOfferedToolNames,
				});
				if (recoveredToolCalls.length > 0) {
					recordSelfObservation({
						signal: "tool_argument_error",
						severity: "info",
						message: `!Klein recovered ${recoveredToolCalls.length} tool call(s) the model emitted as <tool_call> text instead of a structured tool call.`,
						workspacePath: agentPerceivedCwd,
						metadata: {
							category: "narrated_tool_call_recovered",
							toolNames: recoveredToolCalls.map((part) => part.toolName),
							sessionId,
						},
					});
					return undefined;
				}
				// §5.AA/§5.AN: surface a STALLED turn — neither a (recovered) tool call NOR any text — on the swarm path,
				// where it was previously invisible (the SDK abstracts the truncation finishReason away, so detect by
				// content-shape instead). A reasoning model that burns its budget on reasoning_content emits exactly this
				// (live-grounded). Observational only (returns nothing); makes stalls countable so the §5.AA recovery
				// (proactive thinking-control / budget bump) can be decided + measured on real swarm evidence.
				{
					const hasToolCallPart = context.assistantMessage.content.some((part) => part.type === "tool-call");
					const assistantTextLength = context.assistantMessage.content
						.filter((part) => part.type === "text")
						.reduce((total, part) => total + ((part as { text?: string }).text?.trim().length ?? 0), 0);
					if (!hasToolCallPart && assistantTextLength === 0) {
						// §5.AA classification (was "content-shape only"): the SDK DOES surface a finishReason on the
						// afterModel context, so classify the empty turn via the SAME centralized `deriveTruncationSignal`
						// the chat ladder uses — a `max-tokens` stop (or a starved reasoning budget) is a TRUNCATION (fixed by a
						// bigger budget), distinct from a genuine empty stall. Recording the raw finishReason + the derived
						// outcome makes the swarm-path truth MEASURABLE (resolving whether the finishReason is reliable here)
						// and gives the future turn-level recovery a real `truncated` signal to act on. Still observation-only.
						const truncation = deriveTruncationSignal({ rawReason: context.finishReason });
						recordSelfObservation({
							signal: "model_stalled",
							severity: "warning",
							message: truncation.truncatedByStopReason
								? `Model turn truncated (${context.finishReason}) with no tool call and no text — raise the token budget.`
								: "Model turn produced no tool call and no text (stall/truncation) — likely budget exhausted on reasoning.",
							workspacePath: agentPerceivedCwd,
							metadata: {
								category: "model_stalled",
								sessionId,
								finishReason: context.finishReason,
								outcome: truncation.outcome,
								truncatedByStopReason: truncation.truncatedByStopReason,
							},
						});
					}
				}
				const largeFileControl = await largeFileWorkflow.afterModel(context);
				return (
					largeFileControl ??
					reviewNKleinAfterModelCompletion(context, { hasChangedFiles: await hasChangedFiles() })
				);
			},
			afterTool(context) {
				if (doesNKleinToolInvalidateRepoMap(context)) {
					cachedRepoMap = null;
				}
				// F12.15 edit-thrash watch (record-only): fingerprint each write-tool edit's resulting content; when a
				// file's states OSCILLATE (edit → revert → re-edit) record a self-observation once per session+file.
				// The turn-loop guard can't see this (different tool INPUTS each time); PRM watches reads/hand-offs.
				const edits = extractFileEditsFromToolInput(context.tool.name, context.input);
				// F12.19 (record-only): track READ paths; a WRITE to an existing-session-unknown path is the classic
				// "editing imagined content" hazard — observe once per session+path (mtime staleness needs fs access
				// the hook doesn't have; the never-read half is the high-yield signal).
				const knownPaths = readPathsBySessionId.get(sessionId) ?? new Set<string>();
				if (/^read_files?$|^read_large_file$/i.test(context.tool.name)) {
					const record =
						context.input && typeof context.input === "object" ? (context.input as Record<string, unknown>) : {};
					const rawPaths = Array.isArray(record.paths) ? record.paths : [record.path ?? record.file_path];
					for (const raw of rawPaths) {
						if (typeof raw === "string" && raw.trim()) {
							knownPaths.add(raw.trim());
						}
					}
					readPathsBySessionId.set(sessionId, knownPaths);
				}
				if (edits.length > 0) {
					const flaggedWrites = ungroundedWriteFlaggedBySessionId.get(sessionId) ?? new Set<string>();
					for (const edit of edits) {
						if (!knownPaths.has(edit.path) && !flaggedWrites.has(edit.path)) {
							flaggedWrites.add(edit.path);
							recordSelfObservation({
								signal: "custom",
								severity: "info",
								message: `Write to ${edit.path} with no prior read this session — edits may target imagined content (or it is a new file).`,
								taskId: sessionId,
								metadata: { category: "write_grounding", path: edit.path },
							});
						}
						knownPaths.add(edit.path);
					}
					readPathsBySessionId.set(sessionId, knownPaths);
					ungroundedWriteFlaggedBySessionId.set(sessionId, flaggedWrites);
				}
				if (edits.length > 0) {
					const history = editHistoryBySessionId.get(sessionId) ?? [];
					history.push(...edits);
					if (history.length > EDIT_THRASH_HISTORY_CAP) {
						history.splice(0, history.length - EDIT_THRASH_HISTORY_CAP);
					}
					editHistoryBySessionId.set(sessionId, history);
					const assessment = detectEditThrashing(history);
					if (assessment.thrashing) {
						const flagged = editThrashFlaggedBySessionId.get(sessionId) ?? new Set<string>();
						for (const finding of assessment.findings) {
							if (finding.verdict !== "thrashing" || flagged.has(finding.path)) {
								continue;
							}
							flagged.add(finding.path);
							recordSelfObservation({
								signal: "custom",
								severity: "warning",
								message: `Edit thrashing on ${finding.path}: ${finding.reason}`,
								taskId: sessionId,
								metadata: { category: "edit_thrash", path: finding.path, oscillations: finding.oscillations },
							});
						}
						editThrashFlaggedBySessionId.set(sessionId, flagged);
					}
				}
				// F12.22 progress-stall consult (record-only): fingerprint this call's progress facts; a full window of
				// identical no-write fingerprints = the session is circling (varied reads included) — record once.
				const focusStep = getCurrentFocusStepForSession(sessionId);
				const records = progressRecordsBySessionId.get(sessionId) ?? [];
				records.push({
					filesWritten: edits.map((edit) => edit.path),
					focusStep,
					ranVerification: /run_command/i.test(context.tool.name),
				});
				if (records.length > PROGRESS_RECORD_CAP) {
					records.splice(0, records.length - PROGRESS_RECORD_CAP);
				}
				progressRecordsBySessionId.set(sessionId, records);
				if (!progressStallFlaggedSessionIds.has(sessionId)) {
					const stall = assessProgressStall(records, { windowTurns: PROGRESS_STALL_CALL_WINDOW });
					if (stall.stalled) {
						progressStallFlaggedSessionIds.add(sessionId);
						recordSelfObservation({
							signal: "custom",
							severity: "warning",
							message: `Progress stall for ${sessionId}: ${stall.reason}`,
							taskId: sessionId,
							metadata: { category: "progress_stall", unchangedCalls: stall.unchangedTurns },
						});
					}
				}
				return undefined;
			},
		},
		setup(api) {
			api.registerMessageBuilder({
				name: "kanban-read-files-focus",
				build(messages) {
					return focusKanbanReadFilesForNextRequest(messages) ?? messages;
				},
			});
		},
	};
}

/** Runtime hook: capture the agent's latest focus chain for beforeModel re-anchoring (called on `update_focus_chain`). */
export function recordSessionFocusChain(sessionId: string, chain: FocusChain): void {
	focusChainBySessionId.set(sessionId, chain);
}

/** Runtime hook: forget one session's re-anchor state (focus chain + goal cadence) on session end/reset. */
/** F12.22: the session's CURRENT focus-chain step text (null when no chain / no current step). */
function getCurrentFocusStepForSession(sessionId: string): string | null {
	const chain = focusChainBySessionId.get(sessionId);
	const current = chain?.steps.find((step) => step.status === "in_progress");
	return current?.text ?? null;
}

export function forgetSessionFocusState(sessionId: string): void {
	editHistoryBySessionId.delete(sessionId);
	editThrashFlaggedBySessionId.delete(sessionId);
	progressRecordsBySessionId.delete(sessionId);
	progressStallFlaggedSessionIds.delete(sessionId);
	readPathsBySessionId.delete(sessionId);
	ungroundedWriteFlaggedBySessionId.delete(sessionId);
	forgetLiveTaskUsage(sessionId);
	focusChainBySessionId.delete(sessionId);
	goalReanchorLastTurnBySessionId.delete(sessionId);
}

/** Runtime hook: drop all sessions' re-anchor state on runtime dispose. */
export function clearAllSessionFocusState(): void {
	focusChainBySessionId.clear();
	goalReanchorLastTurnBySessionId.clear();
}
