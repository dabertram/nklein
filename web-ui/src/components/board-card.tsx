import { Draggable } from "@hello-pangea/dnd";
import { getRuntimeAgentCatalogEntry, usesLegacyHostTaskWorkspace } from "@runtime-agent-catalog";
import { formatNKleinToolCallLabel } from "@runtime-nklein-tool-call-display";
import { buildTaskWorktreeDisplayPath } from "@runtime-task-worktree-path";
import {
	AlertCircle,
	AlertTriangle,
	Bot,
	Clipboard,
	GitBranch,
	Inbox,
	Link2,
	Pause,
	Pencil,
	Play,
	RotateCcw,
} from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	formatNKleinReasoningEffortLabel,
	formatNKleinSelectedModelButtonText,
	resolveNKleinModelDisplayName,
} from "@/components/detail-panels/nklein-model-picker-options";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ElementTooltip } from "@/components/ui/element-tooltip";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import type { RuntimeCardReview, RuntimeReviewRoundRecord, RuntimeTaskSessionSummary } from "@/runtime/types";
import { useTaskWorkspaceSnapshotValue } from "@/stores/workspace-metadata-store";
import type { BoardCard as BoardCardModel, BoardColumnId } from "@/types";
import { getTaskAutoReviewCancelButtonLabel } from "@/types";
import { formatPathForDisplay } from "@/utils/path-display";
import { useMeasure } from "@/utils/react-use";
import { hasReviewGitActionChanges } from "@/utils/review-git-actions";
import {
	clampTextWithInlineSuffix,
	getTaskPromptDescription,
	normalizePromptForDisplay,
	truncateTaskPromptLabel,
} from "@/utils/task-prompt";
import { DEFAULT_TEXT_MEASURE_FONT, measureTextWidth, readElementFontShorthand } from "@/utils/text-measure";

interface CardSessionActivity {
	dotColor: string;
	text: string;
}

interface ContextBudgetMiniStatus {
	percent: number;
	label: string;
	barClassName: string;
}

interface CardRoleBadge {
	label: string;
	tooltip: string;
	isActive: boolean;
}

function formatShortAge(timestamp: number | null | undefined): string | null {
	if (timestamp == null) {
		return null;
	}
	const elapsedMs = Math.max(0, Date.now() - timestamp);
	const seconds = Math.floor(elapsedMs / 1000);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours}h`;
	}
	const days = Math.floor(hours / 24);
	return `${days}d`;
}

function formatRunDuration(startedAt: number | null | undefined): string | null {
	if (startedAt == null) {
		return null;
	}
	const elapsedMs = Math.max(0, Date.now() - startedAt);
	const totalSeconds = Math.floor(elapsedMs / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	return `${minutes}m`;
}

function formatCompactTokenCount(tokens: number): string {
	if (tokens >= 1_000_000) {
		return `${Math.round(tokens / 100_000) / 10}m`;
	}
	if (tokens >= 1_000) {
		return `${Math.round(tokens / 100) / 10}k`;
	}
	return String(tokens);
}

function buildContextBudgetMiniStatus(summary: RuntimeTaskSessionSummary | undefined): ContextBudgetMiniStatus | null {
	const breakdown = summary?.contextBudgetBreakdown;
	if (!breakdown) {
		return null;
	}
	const percent = Math.min(
		100,
		Math.max(0, Math.round((breakdown.projectedTokens / breakdown.effectiveContextWindow) * 100)),
	);
	const barClassName =
		percent >= 90
			? "bg-status-red"
			: percent >= 75
				? "bg-status-orange"
				: percent >= 55
					? "bg-status-gold"
					: "bg-status-green";
	return {
		percent,
		label: `Ctx ${percent}%`,
		barClassName,
	};
}

function buildSessionTelemetryLine(summary: RuntimeTaskSessionSummary | undefined): string | null {
	if (!summary) {
		return null;
	}
	const parts: string[] = [];
	if (summary.latestUsage) {
		parts.push(
			`${formatCompactTokenCount(summary.latestUsage.inputTokens)} in/${formatCompactTokenCount(summary.latestUsage.outputTokens)} out`,
		);
		const elapsedSeconds = summary.startedAt
			? Math.max(1, Math.round((Date.now() - summary.startedAt) / 1000))
			: null;
		if (summary.state === "running" && elapsedSeconds) {
			const tokenRate = Math.round((summary.latestUsage.outputTokens / elapsedSeconds) * 10) / 10;
			if (Number.isFinite(tokenRate) && tokenRate > 0) {
				parts.push(`${tokenRate} tok/s`);
			}
		}
	}
	if (summary.latestTurnCheckpoint) {
		parts.push(`Turn ${summary.latestTurnCheckpoint.turn}`);
	}
	const runDuration = formatRunDuration(summary.startedAt);
	if (summary.state === "running" && runDuration) {
		parts.push(`Run ${runDuration}`);
	}
	const lastActivityAge = formatShortAge(summary.lastOutputAt);
	if (lastActivityAge) {
		parts.push(`Active ${lastActivityAge} ago`);
	}
	const tokenAge = formatShortAge(summary.lastTokenAt ?? null);
	if (tokenAge) {
		parts.push(`Token ${tokenAge} ago`);
	}
	if (summary.heartbeatStatus) {
		parts.push(`HB ${summary.heartbeatStatus}`);
	}
	return parts.length > 0 ? parts.join(" • ") : null;
}

function buildCardRoleBadge(card: BoardCardModel, summary: RuntimeTaskSessionSummary | undefined): CardRoleBadge {
	const roleLabel = card.startInPlanMode ? "Architect" : "Worker";
	const statusLabel =
		summary?.state === "running"
			? "working"
			: summary?.state === "queued"
				? "queued"
				: summary?.state === "paused" || summary?.paused === true
					? "paused"
					: null;
	const explicitModelOverride =
		card.nkleinSettings?.providerId || card.nkleinSettings?.modelId ? " Task model override is set." : "";
	return {
		label: statusLabel ? `${roleLabel} ${statusLabel}` : roleLabel,
		tooltip: card.startInPlanMode
			? `Architect role handles planning and decomposition starts.${explicitModelOverride}`
			: `Worker role handles implementation and execution starts.${explicitModelOverride}`,
		isActive: summary?.state === "running" || summary?.state === "queued" || summary?.state === "paused",
	};
}

/** §5.AX signature chrome: compact model badge target width (including the middle ellipsis). */
const MODEL_BADGE_MAX_CHARS = 20;

/**
 * Noise tokens that pad local model ids without identifying the model: quantization tags, packaging, and
 * instruct-suffixes. Stripped (rightmost first) before truncation so the badge keeps the DISCRIMINATING part —
 * the old 14-char middle-truncation rendered "mistralai/devstral-small-2-2512" as the gibberish "devstra…2-2512"
 * (David 2026-07-09: "not sure which model they show").
 */
const MODEL_BADGE_NOISE_TOKEN = /-(?:q\d[\w-]*|gguf|mlx|instruct|it|chat|\d{4})$|@\d+bit$/i;

/** Strip the provider prefix (`openai/gpt-5.5` → `gpt-5.5`) + noise suffixes, then middle-truncate as a last resort. */
function shortenModelIdForBadge(modelId: string): string {
	let shortId = modelId.split("/").pop()?.trim() || modelId.trim();
	while (shortId.length > MODEL_BADGE_MAX_CHARS && MODEL_BADGE_NOISE_TOKEN.test(shortId)) {
		shortId = shortId.replace(MODEL_BADGE_NOISE_TOKEN, "");
	}
	if (shortId.length <= MODEL_BADGE_MAX_CHARS) {
		return shortId;
	}
	const headLength = Math.ceil((MODEL_BADGE_MAX_CHARS - 1) / 2);
	const tailLength = MODEL_BADGE_MAX_CHARS - 1 - headLength;
	return `${shortId.slice(0, headLength)}…${shortId.slice(-tailLength)}`;
}

type ReviewLadderRungId = "bounce" | "escalate" | "park";
type ReviewLadderRungState = "done" | "now" | "pending";

interface ReviewLadderStatus {
	rungs: { id: ReviewLadderRungId; state: ReviewLadderRungState }[];
	title: string;
}

/**
 * §5.AX review-ladder chrome: escalation detection. The runner persists NO explicit "escalated" flag on the
 * card — the one-escalation-per-card guard is a server-memory Set, and an escalated round lands on
 * `card.review` as plain `status: "changes_requested"` with the triggering round APPENDED to `history`
 * (see runNKleinSecondOpinionReview / onEscalate). So the UI re-reads the stuck signatures that
 * decideReviewLoopAction escalates on, straight from the persisted round fingerprints:
 *  - identical loop — two rounds with the same non-null (feedbackFingerprint, workFingerprint) pair;
 *  - recurring feedback — the same non-null feedbackFingerprint on ≥3 change-request rounds;
 *  - stall — two consecutive rounds reviewing the same non-null workFingerprint.
 * (The round-limit stuck cause is not derivable client-side — maxRounds never reaches the card.)
 */
function hasReviewEscalationSignature(history: readonly RuntimeReviewRoundRecord[]): boolean {
	const changeRequests = history.filter((record) => record.verdict === "request_changes");
	const seenFingerprintPairs = new Set<string>();
	const feedbackFingerprintCounts = new Map<string, number>();
	for (const record of changeRequests) {
		if (record.feedbackFingerprint !== null && record.workFingerprint !== null) {
			const pair = `${record.feedbackFingerprint}\u0000${record.workFingerprint}`;
			if (seenFingerprintPairs.has(pair)) {
				return true;
			}
			seenFingerprintPairs.add(pair);
		}
		if (record.feedbackFingerprint !== null) {
			const count = (feedbackFingerprintCounts.get(record.feedbackFingerprint) ?? 0) + 1;
			if (count >= 3) {
				return true;
			}
			feedbackFingerprintCounts.set(record.feedbackFingerprint, count);
		}
	}
	for (let index = 1; index < history.length; index += 1) {
		const previous = history[index - 1];
		const current = history[index];
		if (previous?.workFingerprint != null && previous.workFingerprint === current?.workFingerprint) {
			return true;
		}
	}
	return false;
}

/** Derive the `bounce → escalate → park` ladder position from the persisted review. Null ⇒ no strip (happy path). */
function deriveReviewLadderStatus(review: RuntimeCardReview | undefined): ReviewLadderStatus | null {
	if (!review || review.status === "approved") {
		return null;
	}
	const isParked = review.status === "parked";
	const isEscalated = hasReviewEscalationSignature(review.history);
	const isBounced = review.round >= 1;
	const bounceState: ReviewLadderRungState = isBounced ? (isEscalated || isParked ? "done" : "now") : "pending";
	const escalateState: ReviewLadderRungState = isEscalated ? (isParked ? "done" : "now") : "pending";
	const parkState: ReviewLadderRungState = isParked ? "now" : "pending";
	const title = isParked
		? `Review ladder: parked for a human (round ${review.round})${review.parkedReason ? ` — ${review.parkedReason}` : ""}`
		: isEscalated
			? `Review ladder: stuck loop escalated to a stronger/different-lineage worker (round ${review.round})`
			: isBounced
				? `Review ladder: changes requested — bounced back to the worker (round ${review.round})`
				: `Review ladder: in review (round ${review.round})`;
	return {
		rungs: [
			{ id: "bounce", state: bounceState },
			{ id: "escalate", state: escalateState },
			{ id: "park", state: parkState },
		],
		title,
	};
}

const SESSION_ACTIVITY_COLOR = {
	thinking: "var(--color-status-blue)",
	success: "var(--color-status-green)",
	waiting: "var(--color-status-gold)",
	error: "var(--color-status-red)",
	warning: "var(--color-status-orange)",
	muted: "var(--color-text-tertiary)",
	secondary: "var(--color-text-secondary)",
} as const;

const DESCRIPTION_COLLAPSE_LINES = 3;
const DESCRIPTION_EXPANDED_MAX_LINES = 10;
const DESCRIPTION_EXPAND_LABEL = "See more";
const DESCRIPTION_COLLAPSE_LABEL = "Less";
const DESCRIPTION_COLLAPSE_SUFFIX = `… ${DESCRIPTION_EXPAND_LABEL}`;
const DESCRIPTION_EXPANDED_SUFFIX = `… ${DESCRIPTION_COLLAPSE_LABEL}`;

function reconstructTaskWorktreeDisplayPath(taskId: string, workspacePath: string | null | undefined): string | null {
	if (!workspacePath) {
		return null;
	}
	try {
		return buildTaskWorktreeDisplayPath(taskId, workspacePath);
	} catch {
		return null;
	}
}

function extractToolInputSummaryFromActivityText(activityText: string, toolName: string): string | null {
	const escapedToolName = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = activityText.match(
		new RegExp(`^(?:Using|Completed|Failed|Calling)\\s+${escapedToolName}(?::\\s*(.+))?$`),
	);
	if (!match) {
		return null;
	}
	const rawSummary = match[1]?.trim() ?? "";
	if (!rawSummary) {
		return null;
	}
	if (activityText.startsWith("Failed ")) {
		const [operationSummary] = rawSummary.split(": ");
		return operationSummary?.trim() || null;
	}
	return rawSummary;
}

function parseToolCallFromActivityText(
	activityText: string,
): { toolName: string; toolInputSummary: string | null } | null {
	const match = activityText.match(/^(?:Using|Completed|Failed|Calling)\s+([^:()]+?)(?::\s*(.+))?$/);
	if (!match?.[1]) {
		return null;
	}
	const toolName = match[1].trim();
	if (!toolName) {
		return null;
	}
	const rawSummary = match[2]?.trim() ?? "";
	if (!rawSummary) {
		return { toolName, toolInputSummary: null };
	}
	if (activityText.startsWith("Failed ")) {
		const [operationSummary] = rawSummary.split(": ");
		return {
			toolName,
			toolInputSummary: operationSummary?.trim() || null,
		};
	}
	return {
		toolName,
		toolInputSummary: rawSummary,
	};
}

function resolveToolCallLabel(
	activityText: string | undefined,
	toolName: string | null,
	toolInputSummary: string | null,
): string | null {
	if (toolName) {
		const parsedSummary = extractToolInputSummaryFromActivityText(activityText ?? "", toolName);
		if (!toolInputSummary && !parsedSummary) {
			return null;
		}
		return formatNKleinToolCallLabel(toolName, toolInputSummary ?? parsedSummary);
	}
	if (!activityText) {
		return null;
	}
	const parsed = parseToolCallFromActivityText(activityText);
	if (!parsed) {
		return null;
	}
	return formatNKleinToolCallLabel(parsed.toolName, parsed.toolInputSummary);
}

function isCardCreditLimitError(summary: RuntimeTaskSessionSummary | undefined): boolean {
	if (!summary) {
		return false;
	}
	if (summary.state !== "awaiting_review" && summary.state !== "failed" && summary.state !== "interrupted") {
		return false;
	}
	return summary.latestHookActivity?.notificationType === "credit_limit";
}

function getPlainLanguageIssueText(summary: RuntimeTaskSessionSummary): string | null {
	if (summary.state !== "awaiting_review" && summary.state !== "failed" && summary.state !== "interrupted") {
		return null;
	}
	const rawText = [
		summary.warningMessage,
		summary.latestHookActivity?.finalMessage,
		summary.latestHookActivity?.activityText,
	]
		.filter((value): value is string => Boolean(value?.trim()))
		.join(" ")
		.toLowerCase();
	if (!rawText) {
		return null;
	}
	if (rawText.includes("cloud models are disabled") || rawText.includes("cloud/paid provider")) {
		return "Paused: this card targets a cloud model. Choose an Ollama or LM Studio model, then continue.";
	}
	if (rawText.includes("larger than this model") || rawText.includes("context would overflow")) {
		return "Paused: the prompt is too large for this model. Shorten the message or switch to a larger context window.";
	}
	if (rawText.includes("shared endpoint") || rawText.includes("endpoint")) {
		return "Waiting: another card is using this local model endpoint. Let it finish or choose a different endpoint.";
	}
	if (rawText.includes("autonomous wall time")) {
		return "Paused: the autonomous time budget was reached. Review progress, then send a new instruction to continue.";
	}
	if (rawText.includes("same error") || rawText.includes("retry storms")) {
		return "Parked: the same failure repeated. Fix the cause shown in the transcript, then send a new message.";
	}
	if (rawText.includes("heartbeat was lost")) {
		return "Needs attention: the !Klein session heartbeat was lost. Review the transcript, then resume or mark interrupted.";
	}
	if (summary.state === "failed") {
		return "Parked: this card failed repeatedly. Open it for the error and next recovery step.";
	}
	if (summary.reviewReason === "error") {
		return "Paused: the agent hit an error. Open the card, fix the cause, then continue.";
	}
	return null;
}

/** The thinking-phase status text: the live reasoning snippet when one is streaming, else the generic label. */
function thinkingText(reasoningSnippet: string | null): string {
	return reasoningSnippet ? `Thinking: ${reasoningSnippet}` : "Thinking...";
}

function getCardSessionActivity(
	summary: RuntimeTaskSessionSummary | undefined,
	reasoningSnippet: string | null = null,
): CardSessionActivity | null {
	if (!summary) {
		return null;
	}
	if (isCardCreditLimitError(summary)) {
		return { dotColor: SESSION_ACTIVITY_COLOR.warning, text: "Out of credits" };
	}
	const plainIssueText = getPlainLanguageIssueText(summary);
	if (plainIssueText) {
		return {
			dotColor: summary.state === "failed" ? SESSION_ACTIVITY_COLOR.error : SESSION_ACTIVITY_COLOR.warning,
			text: plainIssueText,
		};
	}
	const hookActivity = summary.latestHookActivity;
	const activityText = hookActivity?.activityText?.trim();
	const toolName = hookActivity?.toolName?.trim() ?? null;
	const toolInputSummary = hookActivity?.toolInputSummary?.trim() ?? null;
	const finalMessage = hookActivity?.finalMessage?.trim();
	const hookEventName = hookActivity?.hookEventName?.trim() ?? null;
	if (summary.state === "awaiting_review" && finalMessage) {
		return { dotColor: SESSION_ACTIVITY_COLOR.success, text: finalMessage };
	}
	if (
		finalMessage &&
		!toolName &&
		(hookEventName === "assistant_delta" || hookEventName === "agent_end" || hookEventName === "turn_start")
	) {
		return {
			dotColor: summary.state === "running" ? SESSION_ACTIVITY_COLOR.thinking : SESSION_ACTIVITY_COLOR.success,
			text: finalMessage,
		};
	}
	if (activityText) {
		let dotColor: string =
			summary.state === "failed" ? SESSION_ACTIVITY_COLOR.error : SESSION_ACTIVITY_COLOR.thinking;
		let text = activityText;
		const toolCallLabel = resolveToolCallLabel(activityText, toolName, toolInputSummary);
		if (toolCallLabel) {
			if (text.startsWith("Failed ")) {
				dotColor = SESSION_ACTIVITY_COLOR.error;
			}
			return {
				dotColor,
				text: toolCallLabel,
			};
		}
		if (text.startsWith("Final: ")) {
			dotColor = SESSION_ACTIVITY_COLOR.success;
			text = text.slice(7);
		} else if (text.startsWith("Agent: ")) {
			text = text.slice(7);
		} else if (text.startsWith("Waiting for approval")) {
			dotColor = SESSION_ACTIVITY_COLOR.waiting;
		} else if (text.startsWith("Waiting for review")) {
			dotColor = SESSION_ACTIVITY_COLOR.success;
		} else if (text.startsWith("Failed ")) {
			dotColor = SESSION_ACTIVITY_COLOR.error;
		} else if (text === "Agent active" || text === "Working on task" || text.startsWith("Resumed")) {
			return { dotColor: SESSION_ACTIVITY_COLOR.thinking, text: thinkingText(reasoningSnippet) };
		}
		return { dotColor, text };
	}
	if (summary.state === "failed") {
		const failedText = finalMessage ?? activityText ?? "Task failed to start";
		return { dotColor: SESSION_ACTIVITY_COLOR.error, text: failedText };
	}
	if (summary.state === "awaiting_review") {
		return { dotColor: SESSION_ACTIVITY_COLOR.success, text: "Waiting for review" };
	}
	if (summary.state === "queued") {
		return { dotColor: SESSION_ACTIVITY_COLOR.waiting, text: "Queued — waiting for sandbox capacity" };
	}
	if (summary.state === "running") {
		return { dotColor: SESSION_ACTIVITY_COLOR.thinking, text: thinkingText(reasoningSnippet) };
	}
	return null;
}

export function BoardCard({
	card,
	index,
	columnId,
	sessionSummary,
	selected = false,
	onClick,
	onStart,
	onPauseTask,
	onResumeTask,
	onReplayTask,
	onDecompose,
	onSaveTitle,
	onCommit,
	onOpenPr,
	onCopyEvidence,
	onCancelAutomaticAction,
	isCommitLoading = false,
	isOpenPrLoading = false,
	isCopyEvidenceLoading = false,
	isReplayLoading = false,
	replayCardsEnabled = false,
	onDependencyPointerDown,
	onDependencyPointerEnter,
	isDependencySource = false,
	isDependencyTarget = false,
	isDependencyLinking = false,
	onManageDependencies,
	workspacePath,
	defaultNKleinModelId = null,
	defaultAgentId = null,
	pendingMailboxCount = 0,
	reasoningSnippet = null,
}: {
	card: BoardCardModel;
	index: number;
	columnId: BoardColumnId;
	sessionSummary?: RuntimeTaskSessionSummary;
	/** W3.4: pending §5.AU mailbox notes for this card (chat guidance waiting for its next start). 0 = no badge. */
	pendingMailboxCount?: number;
	/** §5.V: live reasoning-phase snippet (last thinking line) shown in the status line while the agent thinks. */
	reasoningSnippet?: string | null;
	selected?: boolean;
	onClick?: () => void;
	onStart?: (taskId: string) => void;
	onPauseTask?: (taskId: string) => void;
	onResumeTask?: (taskId: string) => void;
	onReplayTask?: (taskId: string) => void;
	onDecompose?: (taskId: string) => void;
	onMoveToTrash?: (taskId: string) => void;
	onRestoreFromTrash?: (taskId: string) => void;
	onSaveTitle?: (taskId: string, title: string) => void;
	onCommit?: (taskId: string) => void;
	onOpenPr?: (taskId: string) => void;
	onCopyEvidence?: (taskId: string) => void;
	onCancelAutomaticAction?: (taskId: string) => void;
	isCommitLoading?: boolean;
	isOpenPrLoading?: boolean;
	isCopyEvidenceLoading?: boolean;
	isMoveToTrashLoading?: boolean;
	isReplayLoading?: boolean;
	replayCardsEnabled?: boolean;
	onDependencyPointerDown?: (taskId: string, event: MouseEvent<HTMLElement>) => void;
	onDependencyPointerEnter?: (taskId: string) => void;
	isDependencySource?: boolean;
	isDependencyTarget?: boolean;
	isDependencyLinking?: boolean;
	/** Opens the DependencyPickerDialog for this card. Shown on hover for all non-trash cards. */
	onManageDependencies?: (taskId: string) => void;
	workspacePath?: string | null;
	defaultNKleinModelId?: string | null;
	/** The workspace's selected agent — the agent chip only shows when the card DIFFERS from it. */
	defaultAgentId?: string | null;
}): React.ReactElement {
	const [isHovered, setIsHovered] = useState(false);
	const [isEditingTitle, setIsEditingTitle] = useState(false);
	const [draftTitle, setDraftTitle] = useState(card.title);
	const titleInputRef = useRef<HTMLInputElement | null>(null);
	const titleEditCancelledRef = useRef(false);
	const [descriptionContainerRef, descriptionRect] = useMeasure<HTMLDivElement>();
	const descriptionRef = useRef<HTMLParagraphElement | null>(null);
	const [descriptionWidthFallback, setDescriptionWidthFallback] = useState(0);
	const [descriptionFont, setDescriptionFont] = useState(DEFAULT_TEXT_MEASURE_FONT);
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
	const reviewWorkspaceSnapshot = useTaskWorkspaceSnapshotValue(card.id);
	const isTrashCard = columnId === "trash";
	const isCompletedCard = columnId === "completed";
	const isFinishedCard = columnId === "review" || isCompletedCard || isTrashCard;
	const isPausedSession = sessionSummary?.paused === true || sessionSummary?.state === "paused";
	const isCardInteractive = !isTrashCard;
	const descriptionWidth = descriptionRect.width > 0 ? descriptionRect.width : descriptionWidthFallback;
	const rawSessionActivity = useMemo(
		() => getCardSessionActivity(sessionSummary, reasoningSnippet),
		[sessionSummary, reasoningSnippet],
	);
	const sessionTelemetryLine = useMemo(() => buildSessionTelemetryLine(sessionSummary), [sessionSummary]);
	const contextBudgetMiniStatus = useMemo(() => buildContextBudgetMiniStatus(sessionSummary), [sessionSummary]);
	const lastSessionActivityRef = useRef<CardSessionActivity | null>(null);
	const lastSessionActivityCardIdRef = useRef<string | null>(null);
	if (lastSessionActivityCardIdRef.current !== card.id) {
		lastSessionActivityCardIdRef.current = card.id;
		lastSessionActivityRef.current = null;
	}
	if (rawSessionActivity) {
		lastSessionActivityRef.current = rawSessionActivity;
	}
	const sessionActivity = rawSessionActivity ?? lastSessionActivityRef.current;
	const displayTitle = useMemo(
		() => normalizePromptForDisplay(card.title) || truncateTaskPromptLabel(card.prompt),
		[card.prompt, card.title],
	);
	const displayDescription = useMemo(
		() => getTaskPromptDescription(card.prompt, displayTitle),
		[card.prompt, displayTitle],
	);

	useLayoutEffect(() => {
		if (descriptionRect.width > 0 || !displayDescription) {
			return;
		}
		const nextWidth = descriptionRef.current?.parentElement?.getBoundingClientRect().width ?? 0;
		if (nextWidth > 0 && nextWidth !== descriptionWidthFallback) {
			setDescriptionWidthFallback(nextWidth);
		}
	}, [descriptionRect.width, descriptionWidthFallback, displayDescription]);

	useLayoutEffect(() => {
		setDescriptionFont(readElementFontShorthand(descriptionRef.current, DEFAULT_TEXT_MEASURE_FONT));
	}, [descriptionWidth, displayDescription]);

	useEffect(() => {
		setIsDescriptionExpanded(false);
	}, [card.id, displayDescription]);

	useEffect(() => {
		setDraftTitle(card.title);
		setIsEditingTitle(false);
	}, [card.id, card.title]);

	useEffect(() => {
		if (!isEditingTitle) {
			return;
		}
		window.requestAnimationFrame(() => {
			titleInputRef.current?.focus();
			titleInputRef.current?.select();
		});
	}, [isEditingTitle]);

	const stopEvent = (event: MouseEvent<HTMLElement>) => {
		event.preventDefault();
		event.stopPropagation();
	};

	const submitTitle = () => {
		if (titleEditCancelledRef.current) {
			titleEditCancelledRef.current = false;
			return;
		}
		setIsEditingTitle(false);
		if (!onSaveTitle) {
			return;
		}
		const trimmed = draftTitle.trim();
		if (trimmed === card.title) {
			return;
		}
		onSaveTitle(card.id, trimmed);
	};

	const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			titleInputRef.current?.blur();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			titleEditCancelledRef.current = true;
			setDraftTitle(card.title);
			setIsEditingTitle(false);
			titleInputRef.current?.blur();
		}
	};

	const isDescriptionMeasured = descriptionRect.width > 0;

	const descriptionDisplay = useMemo(() => {
		if (!displayDescription) {
			return {
				collapsed: { text: "", isTruncated: false },
				expanded: { text: "", isTruncated: false },
			};
		}
		if (descriptionWidth <= 0) {
			return {
				collapsed: { text: displayDescription, isTruncated: false },
				expanded: { text: displayDescription, isTruncated: false },
			};
		}
		const measure = (value: string) => measureTextWidth(value, descriptionFont);
		return {
			collapsed: clampTextWithInlineSuffix(displayDescription, {
				maxWidthPx: descriptionWidth,
				maxLines: DESCRIPTION_COLLAPSE_LINES,
				suffix: DESCRIPTION_COLLAPSE_SUFFIX,
				measureText: measure,
			}),
			expanded: clampTextWithInlineSuffix(displayDescription, {
				maxWidthPx: descriptionWidth,
				maxLines: DESCRIPTION_EXPANDED_MAX_LINES,
				suffix: DESCRIPTION_EXPANDED_SUFFIX,
				measureText: measure,
			}),
		};
	}, [descriptionFont, descriptionWidth, displayDescription]);

	const isCreditLimit = isCardCreditLimitError(sessionSummary);
	const renderStatusMarker = () => {
		if (isCreditLimit) {
			return <AlertTriangle size={12} className="text-status-orange" />;
		}
		if (columnId === "in_progress") {
			if (sessionSummary?.state === "failed") {
				return <AlertCircle size={12} className="text-status-red" />;
			}
			return <Spinner size={12} />;
		}
		return null;
	};
	const statusMarker = renderStatusMarker();
	const showWorkspaceStatus = columnId === "in_progress" || columnId === "review" || isTrashCard;
	const reviewWorkspacePath = reviewWorkspaceSnapshot
		? formatPathForDisplay(reviewWorkspaceSnapshot.path)
		: isTrashCard && usesLegacyHostTaskWorkspace(card.agentId)
			? reconstructTaskWorktreeDisplayPath(card.id, workspacePath)
			: null;
	const reviewRefLabel = reviewWorkspaceSnapshot?.branch ?? reviewWorkspaceSnapshot?.headCommit?.slice(0, 8) ?? "HEAD";
	const reviewChangeSummary = reviewWorkspaceSnapshot
		? reviewWorkspaceSnapshot.changedFiles == null
			? null
			: {
					filesLabel: `${reviewWorkspaceSnapshot.changedFiles} ${reviewWorkspaceSnapshot.changedFiles === 1 ? "file" : "files"}`,
					additions: reviewWorkspaceSnapshot.additions ?? 0,
					deletions: reviewWorkspaceSnapshot.deletions ?? 0,
				}
		: null;
	const showReviewGitActions =
		columnId === "review" &&
		hasReviewGitActionChanges({
			changedFiles: reviewWorkspaceSnapshot?.changedFiles,
			summary: sessionSummary,
		});
	const isAnyGitActionLoading = isCommitLoading || isOpenPrLoading;
	const canCopyEvidence = !isTrashCard && Boolean(onCopyEvidence);
	const cancelAutomaticActionLabel =
		!isTrashCard && card.autoReviewEnabled ? getTaskAutoReviewCancelButtonLabel(card.autoReviewMode) : null;
	// The agent chip marks a DIVERGENCE from the workspace's selected agent — repeating the default agent on
	// every card said nothing (live-found 2026-07-09: every card wore "!Klein · <default model>" while the violet
	// badge showed the same model again, so "which model is this?" had two truncated answers).
	const agentOverrideLabel = useMemo(
		() =>
			card.agentId && card.agentId !== defaultAgentId
				? (getRuntimeAgentCatalogEntry(card.agentId)?.label ?? card.agentId)
				: null,
		[card.agentId, defaultAgentId],
	);
	const modelOverrideLabel = useMemo(() => {
		const settings = card.nkleinSettings;
		if (settings === undefined) {
			return null;
		}
		const explicitReasoningLabel = settings.reasoningEffort
			? formatNKleinReasoningEffortLabel(settings.reasoningEffort)
			: null;
		if (settings.providerId && !settings.modelId) {
			const providerLabel = `Provider: ${settings.providerId}`;
			return explicitReasoningLabel ? `${providerLabel} (${explicitReasoningLabel})` : providerLabel;
		}
		if (!settings.modelId) {
			// No explicit model override: the violet ◈ badge carries the card's ACTUAL model — repeating the
			// global default's NAME here was pure duplication ("which model is this?" had two truncated answers).
			// Only an explicit reasoning-effort override still earns a chip; a bare/cleared settings object shows
			// nothing (the touched-vs-untouched nuance lives in the settings dialog, not on the card face).
			return explicitReasoningLabel ? `Default model (${explicitReasoningLabel})` : null;
		}
		const modelName = resolveNKleinModelDisplayName(settings.modelId);
		if (explicitReasoningLabel) {
			return `${modelName} (${explicitReasoningLabel})`;
		}
		return formatNKleinSelectedModelButtonText({
			modelName,
			reasoningEffort: "",
			showReasoningEffort: false,
		});
	}, [card.nkleinSettings]);
	const taskAgentSettingsLabel = useMemo(() => {
		const parts = [agentOverrideLabel, modelOverrideLabel].filter((value): value is string => Boolean(value));
		return parts.length > 0 ? parts.join(" · ") : null;
	}, [agentOverrideLabel, modelOverrideLabel]);
	const roleBadge = useMemo(() => buildCardRoleBadge(card, sessionSummary), [card, sessionSummary]);
	// §5.AX signature chrome: the live/last session model (violet accent-2 = the AI's identity) and the
	// review-ladder position. The session-activity dot above already carries the card's health signal.
	const sessionModelId = sessionSummary?.modelId ?? null;
	const reviewLadder = useMemo(() => deriveReviewLadderStatus(card.review), [card.review]);
	const blockedReason =
		card.blockedKind === "needs_decomposition"
			? (card.blockedReason ?? "This task needs to be decomposed before it can start.")
			: card.blockedKind === "local_model_required"
				? (card.blockedReason ?? "Configure a local !Klein model before starting this task.")
				: card.blockedKind === "agent_sandbox_unavailable"
					? (card.blockedReason ?? "Docker agent isolation must be ready before starting this task.")
					: null;
	const autoReviewNotice =
		card.autoReviewEnabled === true && card.autoReviewMessage
			? {
					status: card.autoReviewStatus ?? "failed",
					message: card.autoReviewMessage,
				}
			: null;

	const activeDescriptionDisplay = isDescriptionExpanded ? descriptionDisplay.expanded : descriptionDisplay.collapsed;

	return (
		<Draggable draggableId={card.id} index={index} isDragDisabled={false}>
			{(provided, snapshot) => {
				const isDragging = snapshot.isDragging;
				const draggableContent = (
					<div
						ref={provided.innerRef}
						{...provided.draggableProps}
						{...provided.dragHandleProps}
						className="kb-board-card-shell"
						data-task-id={card.id}
						data-column-id={columnId}
						data-selected={selected}
						onMouseDownCapture={(event) => {
							if (!isCardInteractive) {
								return;
							}
							if (isDependencyLinking) {
								event.preventDefault();
								event.stopPropagation();
								return;
							}
							if (!event.metaKey && !event.ctrlKey) {
								return;
							}
							const target = event.target as HTMLElement | null;
							if (target?.closest("button, a, input, textarea, [contenteditable='true']")) {
								return;
							}
							event.preventDefault();
							event.stopPropagation();
							onDependencyPointerDown?.(card.id, event);
						}}
						onClick={(event) => {
							if (!isCardInteractive) {
								return;
							}
							if (isDependencyLinking) {
								event.preventDefault();
								event.stopPropagation();
								return;
							}
							if (event.metaKey || event.ctrlKey) {
								return;
							}
							const target = event.target as HTMLElement | null;
							if (target?.closest("button, a, input, textarea, [contenteditable='true']")) {
								return;
							}
							if (!snapshot.isDragging && onClick) {
								onClick();
							}
						}}
						style={{
							...provided.draggableProps.style,
							marginBottom: 6,
							cursor: "grab",
						}}
						onMouseEnter={() => {
							setIsHovered(true);
							onDependencyPointerEnter?.(card.id);
						}}
						onMouseMove={() => {
							if (!isDependencyLinking) {
								return;
							}
							onDependencyPointerEnter?.(card.id);
						}}
						onMouseLeave={() => setIsHovered(false)}
					>
						<div
							className={cn(
								"rounded-md border border-border-bright bg-surface-2 p-2.5",
								isCardInteractive && "cursor-pointer hover:bg-surface-3 hover:border-border-bright",
								isDragging && "shadow-lg",
								isHovered && isCardInteractive && "bg-surface-3 border-border-bright",
								isDependencySource && "kb-board-card-dependency-source",
								isDependencyTarget && "kb-board-card-dependency-target",
							)}
						>
							<div className="flex items-center gap-2" style={{ minHeight: 24 }}>
								{statusMarker ? <div className="inline-flex items-center">{statusMarker}</div> : null}
								<div className="flex-1 min-w-0">
									{isEditingTitle ? (
										<input
											ref={titleInputRef}
											value={draftTitle}
											onChange={(event) => setDraftTitle(event.currentTarget.value)}
											onBlur={submitTitle}
											onKeyDown={handleTitleKeyDown}
											onMouseDown={(event) => {
												event.stopPropagation();
											}}
											className="h-7 w-full rounded-md border border-border-focus bg-surface-2 px-2 text-sm font-medium text-text-primary focus:outline-none"
										/>
									) : onSaveTitle ? (
										<div className="flex items-center gap-1 min-w-0">
											<p
												className={cn(
													"kb-line-clamp-1 m-0 min-w-0 font-medium text-sm",
													isTrashCard && "line-through text-text-tertiary",
												)}
											>
												{displayTitle}
											</p>
											<button
												type="button"
												aria-label="Edit task title"
												onMouseDown={stopEvent}
												onClick={(event) => {
													stopEvent(event);
													setDraftTitle(card.title);
													setIsEditingTitle(true);
												}}
												className={cn(
													"shrink-0 cursor-pointer rounded-sm p-0.5 text-text-tertiary hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
													isHovered ? "opacity-100" : "opacity-0",
												)}
											>
												<Pencil size={12} />
											</button>
										</div>
									) : (
										<p
											className={cn(
												"kb-line-clamp-1 m-0 font-medium text-sm",
												isTrashCard && "line-through text-text-tertiary",
											)}
										>
											{displayTitle}
										</p>
									)}
								</div>
								{canCopyEvidence ? (
									<Tooltip content="Create evidence bundle and copy agent prompt">
										<Button
											icon={isCopyEvidenceLoading ? <Spinner size={13} /> : <Clipboard size={13} />}
											variant="ghost"
											size="sm"
											disabled={isCopyEvidenceLoading}
											aria-label="Create task evidence"
											className="shrink-0"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onCopyEvidence?.(card.id);
											}}
										/>
									</Tooltip>
								) : null}
								{!isTrashCard && onManageDependencies ? (
									<Tooltip content="Manage dependencies">
										<Button
											icon={<Link2 size={13} />}
											variant="ghost"
											size="sm"
											aria-label="Manage dependencies"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onManageDependencies(card.id);
											}}
											className={cn(isHovered ? "opacity-100" : "opacity-0")}
										/>
									</Tooltip>
								) : null}
								{isPausedSession ? (
									<ElementTooltip id="board-card.resume" side="bottom">
										<Button
											icon={<Play size={14} />}
											variant="ghost"
											size="sm"
											aria-label="Resume task"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onResumeTask?.(card.id);
											}}
										/>
									</ElementTooltip>
								) : sessionSummary?.state === "running" ? (
									<ElementTooltip id="board-card.pause" side="bottom">
										<Button
											icon={<Pause size={14} />}
											variant="ghost"
											size="sm"
											aria-label="Pause task"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onPauseTask?.(card.id);
											}}
										/>
									</ElementTooltip>
								) : columnId === "backlog" || columnId === "planning" ? (
									<ElementTooltip id="board-card.start" side="bottom">
										<Button
											icon={<Play size={14} />}
											variant="ghost"
											size="sm"
											aria-label="Start task"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onStart?.(card.id);
											}}
										/>
									</ElementTooltip>
								) : isFinishedCard ? (
									replayCardsEnabled ? (
										<Button
											icon={isReplayLoading ? <Spinner size={13} /> : <RotateCcw size={13} />}
											variant="ghost"
											size="sm"
											disabled={isReplayLoading}
											aria-label="Replay task"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onReplayTask?.(card.id);
											}}
										/>
									) : null
								) : null}
							</div>
							{displayDescription ? (
								<div ref={descriptionContainerRef}>
									<p
										ref={descriptionRef}
										className={cn(
											"text-sm leading-[1.4]",
											isTrashCard ? "text-text-tertiary" : "text-text-secondary",
											!isDescriptionMeasured && !isDescriptionExpanded && "line-clamp-3",
										)}
										style={{
											margin: "2px 0 0",
										}}
									>
										{activeDescriptionDisplay.isTruncated
											? activeDescriptionDisplay.text
											: displayDescription}
										{activeDescriptionDisplay.isTruncated ? (
											<>
												{"… "}
												<button
													type="button"
													className="inline cursor-pointer rounded-sm text-text-tertiary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [font:inherit]"
													aria-expanded={isDescriptionExpanded}
													aria-label={
														isDescriptionExpanded
															? "Collapse task description"
															: "Expand task description"
													}
													onMouseDown={stopEvent}
													onClick={(event) => {
														stopEvent(event);
														setIsDescriptionExpanded(!isDescriptionExpanded);
													}}
												>
													{isDescriptionExpanded ? DESCRIPTION_COLLAPSE_LABEL : DESCRIPTION_EXPAND_LABEL}
												</button>
											</>
										) : isDescriptionExpanded && descriptionDisplay.collapsed.isTruncated ? (
											<>
												{" "}
												<button
													type="button"
													className="inline cursor-pointer rounded-sm text-text-tertiary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [font:inherit]"
													aria-expanded={isDescriptionExpanded}
													aria-label="Collapse task description"
													onMouseDown={stopEvent}
													onClick={(event) => {
														stopEvent(event);
														setIsDescriptionExpanded(false);
													}}
												>
													{DESCRIPTION_COLLAPSE_LABEL}
												</button>
											</>
										) : null}
									</p>
								</div>
							) : null}
							<div className="mt-1 flex flex-wrap items-center gap-1.5">
								<span
									title={roleBadge.tooltip}
									className={cn(
										"inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs",
										isTrashCard
											? "border-border bg-surface-1 text-text-tertiary"
											: roleBadge.isActive
												? "border-status-green/30 bg-status-green/10 text-status-green"
												: card.startInPlanMode
													? "border-status-purple/30 bg-status-purple/10 text-status-purple"
													: "border-border-bright bg-surface-1 text-text-secondary",
									)}
								>
									<Bot size={12} className="shrink-0" />
									<span className="truncate">{roleBadge.label}</span>
								</span>
								{/* §5.A paused-card UX: a clear paused-state chip (the resume button alone was easy to miss). */}
								{isPausedSession ? (
									<span
										title="Paused — press the resume button to re-queue this task"
										data-testid="card-paused-badge"
										className="inline-flex items-center gap-1 rounded-md border border-status-orange/30 bg-status-orange/10 px-1.5 py-0.5 text-xs text-status-orange"
									>
										<Pause size={12} className="shrink-0" />
										<span>Paused</span>
									</span>
								) : null}
								{taskAgentSettingsLabel ? (
									<span
										className={cn(
											"inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs",
											isTrashCard
												? "border-border text-text-tertiary bg-surface-1"
												: "border-status-blue/30 bg-status-blue/10 text-status-blue",
										)}
									>
										<Bot size={12} className="shrink-0" />
										<span className="truncate">{taskAgentSettingsLabel}</span>
									</span>
								) : null}
								{sessionModelId ? (
									<span
										title={`Session model: ${sessionModelId}`}
										data-model-badge
										className={cn(
											"inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] leading-4",
											isTrashCard
												? "border-border bg-surface-1 text-text-tertiary"
												: "border-accent-2/30 bg-accent-2/10 text-accent-2",
										)}
									>
										<span aria-hidden="true" className="shrink-0">
											◈
										</span>
										<span className="truncate">{shortenModelIdForBadge(sessionModelId)}</span>
									</span>
								) : null}
								{pendingMailboxCount > 0 ? (
									<span
										title={`${pendingMailboxCount} pending note${pendingMailboxCount === 1 ? "" : "s"} from chat — delivered when this card next starts`}
										data-testid="card-mailbox-badge"
										className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-xs text-accent"
									>
										<Inbox size={12} className="shrink-0" />
										<span className="tabular-nums">{pendingMailboxCount}</span>
									</span>
								) : null}
							</div>
							{reviewLadder ? (
								<div
									title={reviewLadder.title}
									data-review-ladder
									className="mt-1 flex flex-wrap items-center gap-1 font-mono text-[10px] leading-4 text-text-tertiary"
								>
									<span className="tracking-wide uppercase">ladder</span>
									{reviewLadder.rungs.map((rung) => (
										<span
											key={rung.id}
											data-rung={rung.id}
											data-rung-state={rung.state}
											className={cn(
												"rounded-sm border px-1 leading-4",
												rung.state === "now"
													? rung.id === "park"
														? "border-status-red/60 bg-status-red/10 text-status-red"
														: "border-accent/60 bg-accent/10 text-accent"
													: rung.state === "done"
														? "border-status-green/30 text-status-green/80"
														: "border-border text-text-tertiary",
											)}
										>
											{rung.id}
										</span>
									))}
								</div>
							) : null}
							{blockedReason ? (
								<div className="mt-2 flex items-start gap-1.5 rounded-md border border-status-orange/40 bg-status-orange/10 px-2 py-1.5 text-[11px] leading-snug text-status-orange">
									<AlertTriangle size={12} className="mt-0.5 shrink-0" />
									<div className="min-w-0 flex-1">
										<p className="m-0 min-w-0 whitespace-pre-line">{blockedReason}</p>
										{columnId === "backlog" && onDecompose ? (
											<div className="mt-1">
												<Button
													icon={<GitBranch size={12} />}
													variant="ghost"
													size="sm"
													onMouseDown={stopEvent}
													onClick={(event) => {
														stopEvent(event);
														onDecompose(card.id);
													}}
												>
													Decompose
												</Button>
											</div>
										) : null}
									</div>
								</div>
							) : null}
							{autoReviewNotice ? (
								<div
									className={cn(
										"mt-2 flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[11px] leading-snug",
										autoReviewNotice.status === "failed"
											? "border-status-orange/40 bg-status-orange/10 text-status-orange"
											: "border-status-blue/30 bg-status-blue/10 text-status-blue",
									)}
								>
									{autoReviewNotice.status === "failed" ? (
										<AlertTriangle size={12} className="mt-0.5 shrink-0" />
									) : (
										<Spinner size={12} className="mt-0.5 shrink-0" />
									)}
									<p className="m-0 min-w-0">{autoReviewNotice.message}</p>
								</div>
							) : null}
							{sessionActivity ? (
								<div
									className="flex gap-1.5 items-start mt-[6px]"
									style={{
										color: isTrashCard ? SESSION_ACTIVITY_COLOR.muted : undefined,
									}}
								>
									<span
										className="inline-block shrink-0 rounded-full"
										style={{
											width: 6,
											height: 6,
											backgroundColor: isTrashCard ? SESSION_ACTIVITY_COLOR.muted : sessionActivity.dotColor,
											marginTop: 4,
										}}
									/>
									<div className="min-w-0 flex-1">
										<p className="m-0 font-mono truncate" style={{ fontSize: 12 }}>
											{sessionActivity.text}
										</p>
										{sessionTelemetryLine ? (
											<p
												className="m-0 mt-0.5 font-mono truncate text-text-tertiary"
												style={{ fontSize: 10 }}
											>
												{sessionTelemetryLine}
											</p>
										) : null}
										{contextBudgetMiniStatus ? (
											<div className="mt-1 flex w-full flex-col gap-1">
												<span className="font-mono text-[10px] leading-none text-text-tertiary">
													{contextBudgetMiniStatus.label}
												</span>
												<div className="h-1.5 w-full overflow-hidden rounded-sm bg-surface-4">
													<div
														className={cn("h-full rounded-sm", contextBudgetMiniStatus.barClassName)}
														style={{ width: `${contextBudgetMiniStatus.percent}%` }}
													/>
												</div>
											</div>
										) : null}
									</div>
								</div>
							) : null}
							{showWorkspaceStatus && reviewWorkspacePath ? (
								<p
									className="font-mono"
									style={{
										margin: "4px 0 0",
										fontSize: 12,
										lineHeight: 1.4,
										whiteSpace: "normal",
										overflowWrap: "anywhere",
										color: isTrashCard ? SESSION_ACTIVITY_COLOR.muted : undefined,
									}}
								>
									{isTrashCard ? (
										<span
											style={{
												color: SESSION_ACTIVITY_COLOR.muted,
												textDecoration: "line-through",
											}}
										>
											{reviewWorkspacePath}
										</span>
									) : reviewWorkspaceSnapshot ? (
										<>
											<span style={{ color: SESSION_ACTIVITY_COLOR.secondary }}>{reviewWorkspacePath}</span>
											<GitBranch
												size={10}
												style={{
													display: "inline",
													color: SESSION_ACTIVITY_COLOR.secondary,
													margin: "0px 4px 2px",
													verticalAlign: "middle",
												}}
											/>
											<span style={{ color: SESSION_ACTIVITY_COLOR.secondary }}>{reviewRefLabel}</span>
											{reviewChangeSummary ? (
												<>
													<span style={{ color: SESSION_ACTIVITY_COLOR.muted }}> (</span>
													<span style={{ color: SESSION_ACTIVITY_COLOR.muted }}>
														{reviewChangeSummary.filesLabel}
													</span>
													<span className="text-status-green"> +{reviewChangeSummary.additions}</span>
													<span className="text-status-red"> -{reviewChangeSummary.deletions}</span>
													<span style={{ color: SESSION_ACTIVITY_COLOR.muted }}>)</span>
												</>
											) : null}
										</>
									) : null}
								</p>
							) : null}
							{showReviewGitActions ? (
								<div className="flex gap-1.5 mt-1.5">
									<Button
										variant="primary"
										size="sm"
										icon={isCommitLoading ? <Spinner size={12} /> : undefined}
										disabled={isAnyGitActionLoading}
										style={{ flex: "1 1 0" }}
										onMouseDown={stopEvent}
										onClick={(event) => {
											stopEvent(event);
											onCommit?.(card.id);
										}}
									>
										Commit
									</Button>
									<Button
										variant="primary"
										size="sm"
										icon={isOpenPrLoading ? <Spinner size={12} /> : undefined}
										disabled={isAnyGitActionLoading}
										style={{ flex: "1 1 0" }}
										onMouseDown={stopEvent}
										onClick={(event) => {
											stopEvent(event);
											onOpenPr?.(card.id);
										}}
									>
										Open PR
									</Button>
								</div>
							) : null}
							{cancelAutomaticActionLabel && onCancelAutomaticAction ? (
								<Button
									size="sm"
									fill
									style={{ marginTop: 12 }}
									onMouseDown={stopEvent}
									onClick={(event) => {
										stopEvent(event);
										onCancelAutomaticAction(card.id);
									}}
								>
									{cancelAutomaticActionLabel}
								</Button>
							) : null}
						</div>
					</div>
				);

				if (isDragging && typeof document !== "undefined") {
					return createPortal(draggableContent, document.body);
				}
				return draggableContent;
			}}
		</Draggable>
	);
}
