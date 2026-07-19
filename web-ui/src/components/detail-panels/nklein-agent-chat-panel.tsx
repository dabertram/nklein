// Layout component for the native NKlein chat panel.
// Rendering lives here, while session state and action wiring come from the
// controller hook so multiple surfaces can share the same behavior.

import { ALL_SPECIAL_TOKENS, countTokens } from "gpt-tokenizer";
import { AlertTriangle, GitBranch, Users } from "lucide-react";
import React, {
	type ReactElement,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { showAppToast } from "@/components/app-toaster";
import { NKleinChatComposer } from "@/components/detail-panels/nklein-chat-composer";
import { NKleinChatMessageItem } from "@/components/detail-panels/nklein-chat-message-item";
import {
	buildNKleinAgentModelPickerOptions,
	buildNKleinSelectedModelButtonText,
	getNKleinReasoningEnabledModelIds,
} from "@/components/detail-panels/nklein-model-picker-options";
import {
	filterRegistryEntriesToLoadedModels,
	findNKleinModelRegistryEntry,
	formatNKleinModelRegistryDisplay,
	NKleinModelRegistryPanel,
} from "@/components/detail-panels/nklein-model-registry-panel";
import { NKleinThinkingIndicator } from "@/components/detail-panels/nklein-thinking-indicator";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { useNKleinChatPanelController } from "@/hooks/use-nklein-chat-panel-controller";
import type { NKleinChatActionResult } from "@/hooks/use-nklein-chat-runtime-actions";
import type { NKleinChatMessage } from "@/hooks/use-nklein-chat-session";
import { useRuntimeSettingsNKleinController } from "@/hooks/use-runtime-settings-nklein-controller";
import { formatNKleinModelContextWindowLabel } from "@/runtime/nklein-context-window-policy";
import {
	fetchNKleinModelRegistry,
	pruneNKleinModelRegistry,
	removeNKleinModelRegistryEntry,
	saveNKleinModelContextWindowOverride,
	saveNKleinModelMaxConcurrentRequests,
} from "@/runtime/runtime-config-query";
import type {
	RuntimeConfigResponse,
	RuntimeContextBudgetBreakdown,
	RuntimeNKleinModelRegistryEntry,
	RuntimeNKleinReasoningEffort,
	RuntimeNKleinTeamProgressEvent,
	RuntimeProtectedTestApprovalPayload,
	RuntimeTaskNKleinSettings,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionSummary,
} from "@/runtime/types";
import { useTrpcQuery } from "@/runtime/use-trpc-query";
import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";
import type { TaskImage } from "@/types";

const BOTTOM_LOCK_THRESHOLD_PX = 24;
const NKLEIN_BUY_CREDITS_URL = "https://app.nklein.bot/";

function countNKleinDisplayTokens(text: string): number {
	return countTokens(text, { allowedSpecial: ALL_SPECIAL_TOKENS });
}

function readChatTimestampsCollapsedDefault(): boolean {
	return readLocalStorageItem(LocalStorageKey.NKleinChatTimestampsCollapsed) === "true";
}

// Approximate token cost of the short summary the host substitutes for a compacted
// read_files result body (header + tool input recap + guidance lines).
const READ_FILES_COMPACTED_OVERHEAD_TOKENS = 64;

export { findNKleinModelRegistryEntry, formatNKleinModelRegistryDisplay };

function normalizeNKleinToolName(name: string | null | undefined): string {
	return typeof name === "string" ? name.toLowerCase().replace(/[^a-z]/g, "") : "";
}

function getNKleinMessageToolName(message: NKleinChatMessage): string {
	const metaToolName = normalizeNKleinToolName(message.meta?.toolName);
	if (metaToolName) {
		return metaToolName;
	}
	const toolLine = message.content.split("\n").find((line) => line.startsWith("Tool:"));
	return toolLine ? normalizeNKleinToolName(toolLine.slice("Tool:".length)) : "";
}

function isNKleinFileReadToolName(name: string): boolean {
	return name === "readfiles" || name === "readlargefile";
}

/**
 * Estimates a message's contribution to the actual outbound model request.
 * Older `read_files` results are compacted by the !Klein host. The newest
 * successful result remains verbatim for the request that analyzes it.
 */
export function estimateNKleinRequestMessageTokens(
	message: NKleinChatMessage,
	options: { retainReadFilesOutput?: boolean } = {},
): number {
	if (
		message.role !== "tool" ||
		!isNKleinFileReadToolName(getNKleinMessageToolName(message)) ||
		options.retainReadFilesOutput
	) {
		return countNKleinDisplayTokens(message.content);
	}
	const outputIndex = message.content.indexOf("\nOutput:");
	const retained = outputIndex >= 0 ? message.content.slice(0, outputIndex) : message.content;
	return countNKleinDisplayTokens(retained) + READ_FILES_COMPACTED_OVERHEAD_TOKENS;
}

function findLatestCompletedReadFilesMessageIndex(messages: readonly NKleinChatMessage[]): number {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (
			message?.role === "tool" &&
			isNKleinFileReadToolName(getNKleinMessageToolName(message)) &&
			message.content.includes("\nOutput:")
		) {
			return index;
		}
	}
	return -1;
}

export function estimateNKleinRequestHistoryTokens(messages: readonly NKleinChatMessage[]): number {
	const latestReadFilesMessageIndex = findLatestCompletedReadFilesMessageIndex(messages);
	return messages.reduce(
		(sum, message, index) =>
			sum +
			estimateNKleinRequestMessageTokens(message, {
				retainReadFilesOutput: index === latestReadFilesMessageIndex,
			}),
		0,
	);
}

export function formatNKleinContextBudgetDisplay(options: {
	estimatedContextTokens: number;
	estimatedNextPromptTokens?: number;
	contextScope: "full" | "smart" | "minimal" | "custom";
	modelContextWindow?: number | null;
}): { limit: number; percent: number; text: string } {
	const modelContextWindow =
		typeof options.modelContextWindow === "number" &&
		Number.isFinite(options.modelContextWindow) &&
		options.modelContextWindow > 0
			? Math.trunc(options.modelContextWindow)
			: null;
	const smartScopeBudget = (() => {
		switch (options.contextScope) {
			case "full":
				return 200_000;
			case "minimal":
				return 80_000;
			case "custom":
				return 160_000;
			default:
				return 120_000;
		}
	})();
	const limit = modelContextWindow ?? smartScopeBudget;
	const rawPercent = limit <= 0 ? 0 : Math.round((options.estimatedContextTokens / limit) * 100);
	const percent = Math.max(0, rawPercent);
	const displayPercent = Math.min(100, percent);
	const limitText = modelContextWindow
		? `${Math.round(modelContextWindow / 1000)}k effective model window`
		: `${Math.round(smartScopeBudget / 1000)}k fallback working budget (model max unavailable)`;
	const overageTokens = Math.max(0, options.estimatedContextTokens - limit);
	const overageText = overageTokens > 0 ? ` · over by ~${Math.round(overageTokens / 1000)}k` : "";
	const budgetStateLabel =
		overageTokens > 0 ? "overflow" : percent >= 92 ? "critical" : percent >= 85 ? "warning" : "healthy";
	return {
		limit,
		percent: displayPercent,
		text: `estimated request ~${Math.round(options.estimatedContextTokens / 1000)}k tokens · ${limitText} (${displayPercent}%${overageText} · ${budgetStateLabel})`,
	};
}

function formatTokenCount(tokens: number): string {
	return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
}

function getContextBudgetTone(projectedTokens: number, effectiveContextWindow: number): string {
	if (projectedTokens >= effectiveContextWindow) {
		return "bg-status-red";
	}
	const ratio = effectiveContextWindow > 0 ? projectedTokens / effectiveContextWindow : 0;
	if (ratio >= 0.95) {
		return "bg-status-red";
	}
	if (ratio >= 0.85) {
		return "bg-status-orange";
	}
	if (ratio >= 0.7) {
		return "bg-status-gold";
	}
	return "bg-status-green";
}

function NKleinContextBudgetBar({ breakdown }: { breakdown: RuntimeContextBudgetBreakdown }): ReactElement {
	const effectiveContextWindow = Math.max(1, breakdown.effectiveContextWindow);
	const rawSegments = [
		{ label: "System", tokens: breakdown.systemPromptTokens, className: "bg-status-purple" },
		{ label: "Tools", tokens: breakdown.toolSchemaTokens, className: "bg-status-blue" },
		{ label: "Task", tokens: breakdown.taskPromptTokens, className: "bg-accent" },
		{ label: "User", tokens: breakdown.userMessageTokens, className: "bg-status-green" },
		{ label: "Files", tokens: breakdown.includedFileContentTokens, className: "bg-status-gold" },
		{ label: "History", tokens: breakdown.otherHistoryTokens, className: "bg-status-orange" },
		{ label: "Prompt reserve", tokens: breakdown.reservedPromptOverheadTokens, className: "bg-surface-4" },
		{ label: "Output reserve", tokens: breakdown.reservedOutputTokens, className: "bg-border-bright" },
	].filter((segment) => segment.tokens > 0);
	const rawSegmentPercentTotal = rawSegments.reduce(
		(total, segment) => total + (segment.tokens / effectiveContextWindow) * 100,
		0,
	);
	const visibleSegmentPercentTotal = Math.min(100, Math.max(0, rawSegmentPercentTotal));
	const segments = rawSegments.map((segment) => ({
		...segment,
		width:
			rawSegmentPercentTotal > 0
				? (segment.tokens / effectiveContextWindow / (rawSegmentPercentTotal / 100)) * visibleSegmentPercentTotal
				: 0,
	}));
	const percent = Math.min(
		100,
		Math.max(0, Math.round((breakdown.projectedTokens / breakdown.effectiveContextWindow) * 100)),
	);
	const toneClassName = getContextBudgetTone(breakdown.projectedTokens, breakdown.effectiveContextWindow);
	const summaryText = `${formatTokenCount(breakdown.projectedTokens)} / ${formatTokenCount(
		breakdown.effectiveContextWindow,
	)} tokens (${percent}%)`;
	return (
		<div className="flex w-full flex-col gap-1" role="group" aria-label={`Context budget ${summaryText}`}>
			<div className="flex items-center gap-2 text-[11px] text-text-tertiary">
				<span className="text-text-secondary">Context</span>
				<span>{summaryText}</span>
			</div>
			<div className="relative h-2 w-full overflow-hidden rounded-sm bg-surface-2">
				<div
					className={`absolute inset-y-0 left-0 opacity-20 ${toneClassName}`}
					style={{ width: `${percent}%` }}
					aria-hidden="true"
				/>
				<div className="relative flex h-full w-full">
					{segments.map((segment) => (
						<div
							key={segment.label}
							className={`flex-none ${segment.className}`}
							style={{ flexBasis: `${segment.width}%`, width: `${segment.width}%` }}
							title={`${segment.label}: ~${formatTokenCount(segment.tokens)} tokens`}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

export function formatNKleinCardContentDisplay(options: {
	taskTitle?: string | null;
	taskPrompt?: string | null;
}): string {
	const cardText = [options.taskTitle?.trim(), options.taskPrompt?.trim()].filter(Boolean).join("\n\n");
	const estimatedTokens = countNKleinDisplayTokens(cardText);
	return `Card content: ~${estimatedTokens.toLocaleString()} tokens`;
}

interface ClarifyingQuestionOption {
	id: string;
	label: string;
	responseText: string;
}

interface ClarifyingQuestionPrompt {
	question: string;
	options: ClarifyingQuestionOption[];
}

interface ProtectedTestApprovalPrompt {
	request: RuntimeProtectedTestApprovalPayload;
}

const CLARIFYING_OPTION_PATTERN = /^\s*(?:[-*]\s*)?(?:(?<id>[A-Z]|\d+)[).:-]\s+)?(?<label>.+?)(?:\s+-\s+.+)?$/i;

function normalizeClarifyingOptionLabel(label: string): string {
	return label
		.replace(/\*\*/g, "")
		.replace(/\s*\((?:recommended|default)\)\s*/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function extractClarifyingQuestionPrompt(
	messages: readonly NKleinChatMessage[],
): ClarifyingQuestionPrompt | null {
	const latestMessage = [...messages]
		.reverse()
		.find((message) => message.role !== "status" && message.role !== "reasoning");
	if (latestMessage?.role !== "assistant") {
		return null;
	}
	const lines = latestMessage.content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0 || !latestMessage.content.includes("?")) {
		return null;
	}
	const question = lines.find((line) => line.includes("?")) ?? lines[0] ?? "";
	const options = lines
		.map((line, index): ClarifyingQuestionOption | null => {
			const match = CLARIFYING_OPTION_PATTERN.exec(line);
			const label = match?.groups?.label ? normalizeClarifyingOptionLabel(match.groups.label) : "";
			if (!label || label.includes("?")) {
				return null;
			}
			const hasOptionMarker = Boolean(match?.groups?.id) || /^[-*]\s+/.test(line);
			if (!hasOptionMarker) {
				return null;
			}
			const id = match?.groups?.id?.toUpperCase() ?? String(index + 1);
			return {
				id,
				label,
				responseText: `Answer: ${id}. ${label}`,
			};
		})
		.filter((option): option is ClarifyingQuestionOption => option !== null)
		.slice(0, 5);
	if (options.length < 2) {
		return null;
	}
	return {
		question,
		options,
	};
}

function isProtectedTestApprovalPayload(value: unknown): value is RuntimeProtectedTestApprovalPayload {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record.intent === "string" &&
		typeof record.diff === "string" &&
		typeof record.reason === "string" &&
		typeof record.expectedEffects === "string"
	);
}

function findJsonObjectCandidates(text: string): string[] {
	const candidates: string[] = [];
	for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
		let depth = 0;
		let inString = false;
		let escaped = false;
		for (let index = start; index < text.length; index += 1) {
			const char = text[index];
			if (escaped) {
				escaped = false;
				continue;
			}
			if (char === "\\") {
				escaped = true;
				continue;
			}
			if (char === '"') {
				inString = !inString;
				continue;
			}
			if (inString) {
				continue;
			}
			if (char === "{") {
				depth += 1;
			} else if (char === "}") {
				depth -= 1;
				if (depth === 0) {
					candidates.push(text.slice(start, index + 1));
					break;
				}
			}
		}
	}
	return candidates;
}

export function extractProtectedTestApprovalPrompt(
	messages: readonly NKleinChatMessage[],
): ProtectedTestApprovalPrompt | null {
	const latestMessage = [...messages]
		.reverse()
		.find((message) => message.role !== "status" && message.role !== "reasoning");
	if (latestMessage?.role !== "assistant" && latestMessage?.role !== "tool") {
		return null;
	}
	const content = latestMessage.content;
	if (!content.includes("protected test suite") || !content.includes("expectedEffects")) {
		return null;
	}
	for (const candidate of findJsonObjectCandidates(content)) {
		try {
			const parsed = JSON.parse(candidate);
			if (isProtectedTestApprovalPayload(parsed)) {
				return { request: parsed };
			}
		} catch {}
	}
	return null;
}

function formatCompactDuration(milliseconds: number): string {
	const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes <= 0) {
		return `${seconds}s`;
	}
	return `${minutes}m ${seconds}s`;
}

function getLatestUserMessageCreatedAt(messages: NKleinChatMessage[]): number | null {
	const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
	return latestUserMessage?.createdAt ?? null;
}

function getLatestGeneratedTextForCurrentTurn(messages: NKleinChatMessage[]): NKleinChatMessage | null {
	const latestUserCreatedAt = getLatestUserMessageCreatedAt(messages);
	return (
		[...messages]
			.reverse()
			.find(
				(message) =>
					(message.role === "assistant" || message.role === "reasoning") &&
					message.content.trim().length > 0 &&
					(latestUserCreatedAt === null || message.createdAt >= latestUserCreatedAt),
			) ?? null
	);
}

export function formatNKleinModelActivityDisplay(options: {
	summary: RuntimeTaskSessionSummary | null;
	messages: NKleinChatMessage[];
	nowMs: number;
	currentRequestContextText?: string | null;
}): string | null {
	const summary = options.summary;
	const contextText = options.currentRequestContextText?.trim()
		? ` · ${options.currentRequestContextText.trim()}`
		: "";
	if (!summary) {
		return contextText ? `Model activity: idle${contextText}` : null;
	}
	if (summary.state !== "running") {
		if (!summary.lastTokenAt) {
			return contextText ? `Model activity: idle${contextText}` : null;
		}
		return `Model activity: idle · last response ${formatCompactDuration(options.nowMs - summary.lastTokenAt)} ago${contextText}`;
	}

	const latestUserCreatedAt = getLatestUserMessageCreatedAt(options.messages);
	const requestStartedAt = latestUserCreatedAt ?? summary.startedAt ?? summary.updatedAt;
	const requestAgeText = formatCompactDuration(options.nowMs - requestStartedAt);

	const latestGeneratedMessage = getLatestGeneratedTextForCurrentTurn(options.messages);
	if (!latestGeneratedMessage) {
		return `Model activity: waiting for response${contextText} · processing since ${requestAgeText}`;
	}

	return `Model activity: streaming${contextText} · processing since ${requestAgeText}`;
}

const NKleinCreditLimitNotice = React.memo(function NKleinCreditLimitNotice() {
	return (
		<div className="mx-1 flex items-start gap-2 rounded-md border border-status-orange/40 bg-status-orange/10 px-3 py-2 text-xs text-status-orange">
			<AlertTriangle size={14} className="mt-0.5 shrink-0" />
			<p className="m-0 min-w-0">
				Out of NKlein credits.{" "}
				<Link href={NKLEIN_BUY_CREDITS_URL} external>
					Buy more credits
				</Link>{" "}
				to continue.
			</p>
		</div>
	);
});

function formatTeamEventAge(nowMs: number, createdAt: number): string {
	return `${formatCompactDuration(nowMs - createdAt)} ago`;
}

function countDistinct(values: Array<string | null>): number {
	return new Set(values.filter((value): value is string => Boolean(value))).size;
}

const NKleinTeamProgressStrip = React.memo(function NKleinTeamProgressStrip({
	events,
	nowMs,
}: {
	events: RuntimeNKleinTeamProgressEvent[];
	nowMs: number;
}) {
	if (events.length === 0) {
		return null;
	}
	const latestEvent = events[events.length - 1];
	if (!latestEvent) {
		return null;
	}
	const agentCount = countDistinct(events.map((event) => event.agentId));
	const runCount = countDistinct(events.map((event) => event.runId));
	const latestLabel = [
		latestEvent.agentId,
		latestEvent.role,
		latestEvent.status,
		formatTeamEventAge(nowMs, latestEvent.createdAt),
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<div className="mx-1 flex min-w-0 items-center gap-2 rounded-md border border-border-bright bg-surface-2 px-2.5 py-2 text-xs text-text-secondary">
			<Users size={14} className="shrink-0 text-status-purple" />
			<div className="min-w-0 flex-1">
				<div className="truncate text-text-primary">{latestEvent.message}</div>
				<div className="mt-0.5 truncate text-[11px] text-text-tertiary">
					{latestEvent.teamName ? `${latestEvent.teamName} · ` : ""}
					{latestLabel}
				</div>
			</div>
			<div className="hidden shrink-0 items-center gap-1.5 text-[11px] text-text-tertiary sm:flex">
				{agentCount > 0 ? (
					<span className="inline-flex items-center gap-1 rounded-sm bg-surface-3 px-1.5 py-1">
						<Users size={12} />
						{agentCount}
					</span>
				) : null}
				{runCount > 0 ? (
					<span className="inline-flex items-center gap-1 rounded-sm bg-surface-3 px-1.5 py-1">
						<GitBranch size={12} />
						{runCount}
					</span>
				) : null}
			</div>
		</div>
	);
});

export interface NKleinAgentChatPanelHandle {
	appendToDraft: (text: string) => void;
	sendText: (text: string) => Promise<void>;
}

export interface NKleinAgentChatPanelProps {
	taskId: string;
	summary: RuntimeTaskSessionSummary | null;
	taskColumnId?: string;
	defaultMode?: RuntimeTaskSessionMode;
	composerPlaceholder?: string;
	showComposerModeToggle?: boolean;
	workspaceId?: string | null;
	taskTitle?: string | null;
	taskPrompt?: string | null;
	runtimeConfig?: RuntimeConfigResponse | null;
	taskNKleinSettings?: RuntimeTaskNKleinSettings;
	taskHasExplicitNKleinSettings?: boolean;
	onNKleinSettingsSaved?: () => void;
	onTaskNKleinSettingsChanged?: (settings: {
		providerId: string;
		modelId: string;
		reasoningEffort: RuntimeNKleinReasoningEffort | "";
		contextScope: "full" | "smart" | "minimal" | "custom";
		timeoutMode: "normal" | "long" | "extended" | "unlimited";
	}) => void;
	onSendMessage?: (
		taskId: string,
		text: string,
		options?: {
			mode?: RuntimeTaskSessionMode;
			images?: TaskImage[];
			providerId?: string;
			modelId?: string;
			reasoningEffort?: RuntimeNKleinReasoningEffort | null;
		},
	) => Promise<NKleinChatActionResult>;
	onCancelTurn?: (taskId: string) => Promise<{ ok: boolean; message?: string }>;
	onLoadMessages?: (taskId: string) => Promise<NKleinChatMessage[] | null>;
	onGrantProtectedTestApproval?: (
		taskId: string,
		approval: RuntimeProtectedTestApprovalPayload,
	) => Promise<NKleinChatActionResult>;
	incomingMessages?: NKleinChatMessage[] | null;
	incomingMessage?: NKleinChatMessage | null;
	nowMs?: number;
	teamProgress?: RuntimeNKleinTeamProgressEvent[];
	onCommit?: () => void;
	onOpenPr?: () => void;
	isCommitLoading?: boolean;
	isOpenPrLoading?: boolean;
	onMoveToTrash?: () => void;
	isMoveToTrashLoading?: boolean;
	moveToTrashButtonLabel?: string;
	moveToTrashButtonVariant?: "primary" | "danger";
	onCancelAutomaticAction?: () => void;
	cancelAutomaticActionLabel?: string | null;
	showMoveToTrash?: boolean;
}

export const NKleinAgentChatPanel = React.forwardRef<NKleinAgentChatPanelHandle, NKleinAgentChatPanelProps>(
	function NKleinAgentChatPanel(
		{
			taskId,
			summary,
			taskColumnId = "in_progress",
			defaultMode = "act",
			composerPlaceholder = "Ask !Klein to add, edit, start, or link tasks",
			showComposerModeToggle = true,
			workspaceId = null,
			taskTitle = null,
			taskPrompt = null,
			runtimeConfig = null,
			taskNKleinSettings,
			taskHasExplicitNKleinSettings = false,
			onNKleinSettingsSaved,
			onTaskNKleinSettingsChanged,
			onSendMessage,
			onCancelTurn,
			onLoadMessages,
			onGrantProtectedTestApproval,
			incomingMessages,
			incomingMessage,
			nowMs: nowMsOverride,
			teamProgress = [],
			onCommit,
			onOpenPr,
			isCommitLoading = false,
			isOpenPrLoading = false,
			onMoveToTrash,
			isMoveToTrashLoading = false,
			moveToTrashButtonLabel,
			moveToTrashButtonVariant,
			onCancelAutomaticAction,
			cancelAutomaticActionLabel,
			showMoveToTrash = false,
		},
		ref,
	): ReactElement {
		const nkleinSettings = useRuntimeSettingsNKleinController({
			open: true,
			workspaceId,
			selectedAgentId: "nklein",
			config: runtimeConfig,
			taskNKleinSettings,
		});
		const {
			draft,
			setDraft,
			messages,
			error,
			isSending,
			canSend,
			canCancel,
			showReviewActions,
			showAgentProgressIndicator,
			showActionFooter,
			showCancelAutomaticAction,
			handleSendText,
			handleSendDraft,
			handleCancelTurn,
		} = useNKleinChatPanelController({
			taskId,
			summary,
			taskColumnId,
			onSendMessage:
				onSendMessage === undefined
					? undefined
					: (sendTaskId, text, options) => {
							const providerId = nkleinSettings.providerId.trim();
							const modelId = nkleinSettings.modelId.trim();
							const hasLaunchSelection =
								providerId.length > 0 || modelId.length > 0 || nkleinSettings.reasoningEffort.length > 0;
							return onSendMessage(sendTaskId, text, {
								...options,
								...(providerId.length > 0 ? { providerId } : {}),
								...(modelId.length > 0 ? { modelId } : {}),
								...(hasLaunchSelection ? { reasoningEffort: nkleinSettings.reasoningEffort || null } : {}),
							});
						},
			onCancelTurn,
			onLoadMessages,
			incomingMessages,
			incomingMessage,
			onCommit,
			onOpenPr,
			onMoveToTrash,
			onCancelAutomaticAction,
			cancelAutomaticActionLabel,
			showMoveToTrash,
		});
		const effectiveMoveToTrashButtonLabel =
			moveToTrashButtonLabel ?? (taskColumnId === "review" ? "Move Card To Completed" : "Move Card To Trash");
		const effectiveMoveToTrashButtonVariant =
			moveToTrashButtonVariant ?? (taskColumnId === "review" ? "primary" : "danger");
		const scrollContainerRef = useRef<HTMLDivElement | null>(null);
		// TODO: Persist per-task mode immediately when toggled so page refresh restores unsent mode changes.
		const modeByTaskIdRef = useRef<Map<string, RuntimeTaskSessionMode>>(new Map());
		const [composerError, setComposerError] = useState<string | null>(null);
		const [isGrantingProtectedApproval, setIsGrantingProtectedApproval] = useState(false);
		const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
		const [isSavingModel, setIsSavingModel] = useState(false);
		const [isClearingChat, setIsClearingChat] = useState(false);
		const [isModelRegistryPanelOpen, setIsModelRegistryPanelOpen] = useState(false);
		const [tickerNowMs, setTickerNowMs] = useState(() => Date.now());
		const nowMs = nowMsOverride ?? tickerNowMs;
		const [timestampsCollapsed, setTimestampsCollapsed] = useState(readChatTimestampsCollapsedDefault);
		const [contextScope, setContextScope] = useState<"full" | "smart" | "minimal" | "custom">(
			taskNKleinSettings?.contextScope ?? "smart",
		);
		const [timeoutMode, setTimeoutMode] = useState<"normal" | "long" | "extended" | "unlimited">(
			taskNKleinSettings?.timeoutMode ?? runtimeConfig?.agentTimeoutMode ?? "normal",
		);
		const isCreditLimitNoticeVisible = summary?.latestHookActivity?.notificationType === "credit_limit";
		const [mode, setMode] = useState<RuntimeTaskSessionMode>(() => {
			const persistedMode = modeByTaskIdRef.current.get(taskId);
			return persistedMode ?? summary?.mode ?? defaultMode;
		});
		const [draftImages, setDraftImages] = useState<TaskImage[]>([]);

		const modelPickerOptions = useMemo(
			() => buildNKleinAgentModelPickerOptions(nkleinSettings.providerId, nkleinSettings.providerModels),
			[nkleinSettings.providerId, nkleinSettings.providerModels],
		);
		const modelOptions = modelPickerOptions.options;

		const selectedModel = useMemo(
			() => nkleinSettings.providerModels.find((model) => model.id === nkleinSettings.modelId) ?? null,
			[nkleinSettings.modelId, nkleinSettings.providerModels],
		);
		const fetchSelectedWorkspaceModelRegistry = useCallback(
			async () => await fetchNKleinModelRegistry(workspaceId),
			[workspaceId],
		);
		const modelRegistryQuery = useTrpcQuery({
			enabled: nkleinSettings.providerId.trim().length > 0 && nkleinSettings.modelId.trim().length > 0,
			queryFn: fetchSelectedWorkspaceModelRegistry,
			retainDataOnError: true,
		});
		const handleSaveModelContextWindowOverride = useCallback(
			async (entry: RuntimeNKleinModelRegistryEntry, contextWindow: number | null) => {
				await saveNKleinModelContextWindowOverride(workspaceId, {
					providerId: entry.providerId,
					modelId: entry.modelId,
					endpoint: entry.endpoint,
					contextWindow,
				});
				await modelRegistryQuery.refetch();
			},
			[modelRegistryQuery.refetch, workspaceId],
		);
		const handleSaveModelMaxConcurrentRequests = useCallback(
			async (entry: RuntimeNKleinModelRegistryEntry, maxConcurrentRequests: number | null) => {
				await saveNKleinModelMaxConcurrentRequests(workspaceId, {
					providerId: entry.providerId,
					modelId: entry.modelId,
					endpoint: entry.endpoint,
					maxConcurrentRequests,
				});
				await modelRegistryQuery.refetch();
			},
			[modelRegistryQuery.refetch, workspaceId],
		);
		const handleRemoveModelRegistryEntry = useCallback(
			async (entry: RuntimeNKleinModelRegistryEntry) => {
				const response = await removeNKleinModelRegistryEntry(workspaceId, { key: entry.key });
				await modelRegistryQuery.refetch();
				showAppToast({
					intent: response.removed ? "success" : "none",
					message: response.removed
						? `Removed model telemetry for ${entry.providerId}/${entry.modelId}.`
						: `Model telemetry for ${entry.providerId}/${entry.modelId} was already gone.`,
				});
			},
			[modelRegistryQuery.refetch, workspaceId],
		);
		const handlePruneModelRegistry = useCallback(async () => {
			const response = await pruneNKleinModelRegistry(workspaceId);
			await modelRegistryQuery.refetch();
			showAppToast({
				intent: "success",
				message: response.removed === 1 ? "Removed 1 stale model." : `Removed ${response.removed} stale models.`,
			});
		}, [modelRegistryQuery.refetch, workspaceId]);
		const modelRegistryEntries = modelRegistryQuery.data?.models ?? [];
		const visibleModelRegistryEntries = useMemo(
			() =>
				filterRegistryEntriesToLoadedModels(
					modelRegistryEntries,
					nkleinSettings.providerId,
					nkleinSettings.providerModels,
				),
			[nkleinSettings.providerId, nkleinSettings.providerModels, modelRegistryEntries],
		);
		const selectedModelRegistryEntry = useMemo(
			() =>
				findNKleinModelRegistryEntry(
					visibleModelRegistryEntries,
					nkleinSettings.providerId,
					nkleinSettings.modelId,
				),
			[nkleinSettings.modelId, nkleinSettings.providerId, visibleModelRegistryEntries],
		);
		const modelRegistryText = useMemo(
			() => formatNKleinModelRegistryDisplay(selectedModelRegistryEntry),
			[selectedModelRegistryEntry],
		);
		const selectedEffectiveContextWindow =
			selectedModelRegistryEntry?.contextWindow.effective ?? selectedModel?.contextWindow ?? null;
		const reasoningEnabledModelIds = useMemo(
			() => getNKleinReasoningEnabledModelIds(nkleinSettings.providerModels),
			[nkleinSettings.providerModels],
		);

		const selectedModelButtonText = useMemo(
			() =>
				buildNKleinSelectedModelButtonText({
					modelOptions,
					selectedModelId: nkleinSettings.modelId,
					reasoningEffort: nkleinSettings.reasoningEffort,
					showReasoningEffort: nkleinSettings.selectedModelSupportsReasoningEffort,
					isModelLoading: nkleinSettings.isLoadingProviderModels,
					isModelSaving: isSavingModel,
				}),
			[
				nkleinSettings.isLoadingProviderModels,
				nkleinSettings.modelId,
				nkleinSettings.reasoningEffort,
				nkleinSettings.selectedModelSupportsReasoningEffort,
				isSavingModel,
				modelOptions,
			],
		);

		const panelError = composerError ?? error;
		const estimatedNextPromptTokens = useMemo(() => {
			if (summary?.state === "running") {
				return 0;
			}
			const draftTokens = countNKleinDisplayTokens(draft.trim());
			const imageOverheadTokens = draftImages.length * 1_200;
			const framingOverheadTokens = 1_200;
			return Math.max(1_200, draftTokens + imageOverheadTokens + framingOverheadTokens);
		}, [draft, draftImages.length, summary?.state]);
		const estimatedContextTokens = useMemo(() => {
			const historyTokens = estimateNKleinRequestHistoryTokens(messages);
			return historyTokens + estimatedNextPromptTokens;
		}, [estimatedNextPromptTokens, messages]);
		const estimatedContextBudget = useMemo(
			() =>
				formatNKleinContextBudgetDisplay({
					estimatedContextTokens,
					estimatedNextPromptTokens,
					contextScope,
					modelContextWindow: selectedEffectiveContextWindow,
				}),
			[contextScope, estimatedContextTokens, estimatedNextPromptTokens, selectedEffectiveContextWindow],
		);
		const currentRequestContextText = useMemo(() => {
			const breakdown = summary?.contextBudgetBreakdown;
			if (!breakdown) {
				return estimatedContextBudget.text;
			}
			const percent = Math.min(
				100,
				Math.max(0, Math.round((breakdown.projectedTokens / breakdown.effectiveContextWindow) * 100)),
			);
			const overageTokens = Math.max(0, breakdown.projectedTokens - breakdown.effectiveContextWindow);
			const overageText = overageTokens > 0 ? ` · over by ~${formatTokenCount(overageTokens)}` : "";
			const stateLabel =
				overageTokens > 0 ? "overflow" : percent >= 95 ? "critical" : percent >= 85 ? "warning" : "healthy";
			return `request context ~${formatTokenCount(breakdown.projectedTokens)} tokens / ${formatTokenCount(
				breakdown.effectiveContextWindow,
			)} effective window (${percent}%${overageText} · ${stateLabel})`;
		}, [estimatedContextBudget.text, summary?.contextBudgetBreakdown]);
		const cardContentText = useMemo(
			() => formatNKleinCardContentDisplay({ taskTitle, taskPrompt }),
			[taskPrompt, taskTitle],
		);
		const modelActivityText = useMemo(
			() =>
				formatNKleinModelActivityDisplay({
					summary,
					messages,
					nowMs,
					currentRequestContextText,
				}),
			[currentRequestContextText, summary, messages, nowMs],
		);
		const attachmentWarningMessage =
			draftImages.length > 0 && selectedModel?.supportsVision === false
				? "The selected !Klein model may not accept image input. Choose a vision-capable model to use these images."
				: null;
		const clarifyingQuestionPrompt = useMemo(() => extractClarifyingQuestionPrompt(messages), [messages]);
		const protectedTestApprovalPrompt = useMemo(() => extractProtectedTestApprovalPrompt(messages), [messages]);

		const isPinnedToBottom = useCallback((container: HTMLDivElement): boolean => {
			const remainingDistance = container.scrollHeight - container.scrollTop - container.clientHeight;
			return remainingDistance <= BOTTOM_LOCK_THRESHOLD_PX;
		}, []);

		const handleMessageListScroll = useCallback(() => {
			const container = scrollContainerRef.current;
			if (!container) {
				return;
			}
			const nextIsAutoScrollEnabled = isPinnedToBottom(container);
			setIsAutoScrollEnabled((currentValue) =>
				currentValue === nextIsAutoScrollEnabled ? currentValue : nextIsAutoScrollEnabled,
			);
		}, [isPinnedToBottom]);

		useLayoutEffect(() => {
			const container = scrollContainerRef.current;
			if (!container || !isAutoScrollEnabled) {
				return;
			}
			container.scrollTop = container.scrollHeight;
		}, [
			isAutoScrollEnabled,
			messages,
			showAgentProgressIndicator,
			showActionFooter,
			showReviewActions,
			showCancelAutomaticAction,
		]);

		useEffect(() => {
			setComposerError(null);
		}, [taskId]);

		useEffect(() => {
			setIsAutoScrollEnabled(true);
		}, [taskId]);

		useEffect(() => {
			if (summary?.state !== "running") {
				return;
			}
			setTickerNowMs(Date.now());
			const intervalId = window.setInterval(() => {
				setTickerNowMs(Date.now());
			}, 1000);
			return () => {
				window.clearInterval(intervalId);
			};
		}, [summary?.state]);

		useEffect(() => {
			const persistedMode = modeByTaskIdRef.current.get(taskId);
			const nextMode = persistedMode ?? summary?.mode ?? defaultMode;
			modeByTaskIdRef.current.set(taskId, nextMode);
			setMode(nextMode);
			setDraftImages([]);
			setContextScope(taskNKleinSettings?.contextScope ?? "smart");
			setTimeoutMode(taskNKleinSettings?.timeoutMode ?? runtimeConfig?.agentTimeoutMode ?? "normal");
		}, [
			defaultMode,
			runtimeConfig?.agentTimeoutMode,
			summary?.mode,
			taskNKleinSettings?.contextScope,
			taskNKleinSettings?.timeoutMode,
			taskId,
		]);

		const handleModeChange = useCallback(
			(nextMode: RuntimeTaskSessionMode) => {
				modeByTaskIdRef.current.set(taskId, nextMode);
				setMode(nextMode);
			},
			[taskId],
		);

		type PersistNKleinModelSettingsOverrides = {
			modelId?: string;
			reasoningEffort?: RuntimeNKleinReasoningEffort | "";
			contextScope?: "full" | "smart" | "minimal" | "custom";
			timeoutMode?: "normal" | "long" | "extended" | "unlimited";
		};

		const persistNKleinModelSettings = useCallback(
			async (overrides?: PersistNKleinModelSettingsOverrides): Promise<boolean> => {
				if (!workspaceId) {
					setComposerError("Select a workspace before choosing a !Klein model.");
					return false;
				}
				if (nkleinSettings.providerId.trim().length === 0) {
					setComposerError("Choose a !Klein provider in Settings before selecting a model.");
					return false;
				}
				setComposerError(null);
				setIsSavingModel(true);
				try {
					const nextModelId = overrides?.modelId ?? nkleinSettings.modelId;
					const nextReasoningEffort =
						overrides && "reasoningEffort" in overrides
							? overrides.reasoningEffort || ""
							: nkleinSettings.reasoningEffort;
					const nextContextScope = overrides?.contextScope ?? contextScope;
					const nextTimeoutMode = overrides?.timeoutMode ?? timeoutMode;
					if (taskHasExplicitNKleinSettings) {
						onTaskNKleinSettingsChanged?.({
							providerId: nkleinSettings.providerId,
							modelId: nextModelId,
							reasoningEffort: nextReasoningEffort,
							contextScope: nextContextScope,
							timeoutMode: nextTimeoutMode,
						});
						return true;
					}
					const result = await nkleinSettings.saveProviderSettings({
						modelId: nextModelId,
						reasoningEffort: nextReasoningEffort || null,
					});
					if (!result.ok) {
						setComposerError(result.message ?? "Could not save !Klein model settings.");
						return false;
					}
					onNKleinSettingsSaved?.();
					return true;
				} finally {
					setIsSavingModel(false);
				}
			},
			[
				nkleinSettings,
				contextScope,
				onNKleinSettingsSaved,
				onTaskNKleinSettingsChanged,
				taskHasExplicitNKleinSettings,
				timeoutMode,
				workspaceId,
			],
		);

		const handleSelectModel = useCallback(
			(nextModelId: string) => {
				if (nextModelId.trim() === nkleinSettings.modelId.trim()) {
					return;
				}
				nkleinSettings.setModelId(nextModelId);
				void persistNKleinModelSettings({ modelId: nextModelId });
			},
			[nkleinSettings.modelId, nkleinSettings.setModelId, persistNKleinModelSettings],
		);

		const handleSelectReasoningEffort = useCallback(
			(nextReasoningEffort: RuntimeNKleinReasoningEffort | "") => {
				if (nextReasoningEffort === nkleinSettings.reasoningEffort) {
					return;
				}
				nkleinSettings.setReasoningEffort(nextReasoningEffort);
				void persistNKleinModelSettings({ reasoningEffort: nextReasoningEffort });
			},
			[nkleinSettings.reasoningEffort, nkleinSettings.setReasoningEffort, persistNKleinModelSettings],
		);

		const handleAppendToDraft = useCallback(
			(text: string) => {
				const trimmed = text.trim();
				if (trimmed.length === 0) {
					return;
				}
				if (draft.trim().length === 0) {
					setDraft(trimmed);
					return;
				}
				setDraft(`${draft.trimEnd()}\n\n${trimmed}`);
			},
			[draft, setDraft],
		);

		const handleSendComposerText = useCallback(
			async (text: string): Promise<void> => {
				if (isSavingModel) {
					return;
				}
				if (nkleinSettings.hasUnsavedChanges) {
					const saved = await persistNKleinModelSettings();
					if (!saved) {
						return;
					}
				}
				await handleSendText(text, mode);
			},
			[nkleinSettings.hasUnsavedChanges, handleSendText, isSavingModel, mode, persistNKleinModelSettings],
		);
		const handleGrantProtectedTestApproval = useCallback(async () => {
			if (!protectedTestApprovalPrompt || !onGrantProtectedTestApproval) {
				return;
			}
			setIsGrantingProtectedApproval(true);
			setComposerError(null);
			try {
				const granted = await onGrantProtectedTestApproval(taskId, protectedTestApprovalPrompt.request);
				if (!granted.ok) {
					setComposerError(granted.message ?? "Could not approve protected-test edit.");
					return;
				}
				await handleSendComposerText(
					[
						"Approved this exact protected-test edit.",
						"Retry the same edit once. Do not change any other protected test path without asking again.",
					].join(" "),
				);
			} finally {
				setIsGrantingProtectedApproval(false);
			}
		}, [handleSendComposerText, onGrantProtectedTestApproval, protectedTestApprovalPrompt, taskId]);

		useImperativeHandle(
			ref,
			() => ({
				appendToDraft: handleAppendToDraft,
				sendText: handleSendComposerText,
			}),
			[handleAppendToDraft, handleSendComposerText],
		);

		const handleComposerSend = useCallback(async () => {
			if (isSavingModel) {
				return;
			}
			if (nkleinSettings.hasUnsavedChanges) {
				const saved = await persistNKleinModelSettings();
				if (!saved) {
					return;
				}
			}
			const sent = await handleSendDraft(mode, draftImages);
			if (sent) {
				setDraftImages([]);
			}
		}, [
			nkleinSettings.hasUnsavedChanges,
			draftImages,
			handleSendDraft,
			isSavingModel,
			mode,
			persistNKleinModelSettings,
		]);

		const handleClearChat = useCallback(
			async (includeSummary: boolean) => {
				if (isClearingChat || isSending) {
					return;
				}
				setComposerError(null);
				setIsClearingChat(true);
				try {
					if (includeSummary) {
						const summarized = await handleSendText(
							"Summarize this task conversation into key decisions, modified files, open risks, and exact next steps in 8-12 bullets.",
							"plan",
						);
						if (!summarized) {
							setComposerError("Could not summarize chat before clearing.");
							return;
						}
					}
					const cleared = await handleSendText("/clear", "act");
					if (!cleared) {
						setComposerError("Could not clear chat history.");
					}
				} finally {
					setIsClearingChat(false);
				}
			},
			[handleSendText, isClearingChat, isSending],
		);

		const handleToggleTimestampsCollapsed = useCallback(() => {
			setTimestampsCollapsed((current) => {
				const next = !current;
				writeLocalStorageItem(LocalStorageKey.NKleinChatTimestampsCollapsed, String(next));
				return next;
			});
		}, []);

		return (
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<div
					ref={scrollContainerRef}
					className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto px-2 py-3"
					onScroll={handleMessageListScroll}
				>
					{messages.map((message, index) => {
						const nextMessage = messages[index + 1];
						const durationMs = Math.max(0, (nextMessage?.createdAt ?? nowMs) - message.createdAt);
						return (
							<NKleinChatMessageItem
								key={message.id}
								message={message}
								durationMs={durationMs}
								timestampsCollapsed={timestampsCollapsed}
								onToggleTimestampsCollapsed={handleToggleTimestampsCollapsed}
							/>
						);
					})}
					<NKleinTeamProgressStrip events={teamProgress} nowMs={nowMs} />
					{showAgentProgressIndicator ? <NKleinThinkingIndicator /> : null}
					{isCreditLimitNoticeVisible ? <NKleinCreditLimitNotice /> : null}
				</div>
				{panelError ? (
					<div className="border-t border-status-red/30 bg-status-red/10 px-2 py-2 text-xs text-status-red">
						{panelError}
					</div>
				) : null}
				{summary?.contextBudgetBreakdown ? (
					<div className="w-full px-2 pt-2">
						<NKleinContextBudgetBar breakdown={summary.contextBudgetBreakdown} />
					</div>
				) : null}
				{summary?.state === "running" && (summary.pendingPromptCount ?? 0) > 0 ? (
					<div className="px-2 pt-2">
						<div
							className="inline-flex items-center gap-1 rounded-full border border-border-primary bg-surface-secondary px-2 py-0.5 text-[11px] text-text-secondary"
							title="Input waiting on the running session — steer notes land before the next model iteration; queued notes wait for the current input to drain."
						>
							<span className="font-medium">Pending input</span>
							<span>
								{summary.pendingPromptCount} queued
								{(summary.pendingSteerCount ?? 0) > 0 ? ` · ${summary.pendingSteerCount} steer` : ""}
							</span>
						</div>
					</div>
				) : null}
				<div className="px-2 pt-2">
					<div className="flex flex-wrap items-center gap-2">
						<div className="text-[11px] text-text-secondary">{cardContentText}</div>
						{modelActivityText ? <div className="text-[11px] text-text-tertiary">{modelActivityText}</div> : null}
						{modelRegistryText ? <div className="text-[11px] text-text-tertiary">{modelRegistryText}</div> : null}
						<div className="ml-auto flex flex-wrap items-center gap-2">
							<NativeSelect
								value={contextScope}
								onChange={(event) => {
									const nextValue = event.target.value as "full" | "smart" | "minimal" | "custom";
									setContextScope(nextValue);
									if (taskHasExplicitNKleinSettings) {
										void persistNKleinModelSettings({ contextScope: nextValue });
									}
								}}
								disabled={isSavingModel || isClearingChat}
							>
								<option value="full">Context: Full</option>
								<option value="smart">Context: Smart</option>
								<option value="minimal">Context: Minimal</option>
								<option value="custom">Context: Custom</option>
							</NativeSelect>
							<NativeSelect
								value={timeoutMode}
								onChange={(event) => {
									const nextValue = event.target.value as "normal" | "long" | "extended" | "unlimited";
									setTimeoutMode(nextValue);
									if (taskHasExplicitNKleinSettings) {
										void persistNKleinModelSettings({ timeoutMode: nextValue });
									}
								}}
								disabled={isSavingModel || isClearingChat}
							>
								<option value="normal">Timeout: Normal</option>
								<option value="long">Timeout: Long</option>
								<option value="extended">Timeout: Extended</option>
								<option value="unlimited">Timeout: Unlimited</option>
							</NativeSelect>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									void handleClearChat(false);
								}}
								disabled={isClearingChat || isSending}
							>
								Clear Chat
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									void handleClearChat(true);
								}}
								disabled={isClearingChat || isSending}
							>
								Clear Chat + Summarize
							</Button>
							<Button
								variant={isModelRegistryPanelOpen ? "default" : "ghost"}
								size="sm"
								onClick={() => {
									setIsModelRegistryPanelOpen((currentValue) => !currentValue);
								}}
							>
								Telemetry
							</Button>
						</div>
					</div>
					{isModelRegistryPanelOpen ? (
						<>
							{selectedModel ? (
								<p className="mx-2 mt-2 mb-0 text-[12px] text-text-secondary">
									Selected loaded model (live): {formatNKleinModelContextWindowLabel(selectedModel)}
								</p>
							) : (
								<p className="mx-2 mt-2 mb-0 text-[12px] text-text-tertiary">
									Selected model is not currently loaded in LM Studio.
								</p>
							)}
							<NKleinModelRegistryPanel
								entries={visibleModelRegistryEntries}
								fleetSuggestions={modelRegistryQuery.data?.fleetSuggestions ?? []}
								selectedProviderId={nkleinSettings.providerId}
								selectedModelId={nkleinSettings.modelId}
								nowMs={nowMs}
								isLoading={modelRegistryQuery.isLoading}
								onContextWindowOverrideSave={handleSaveModelContextWindowOverride}
								onMaxConcurrentRequestsSave={handleSaveModelMaxConcurrentRequests}
								onRemoveEntry={handleRemoveModelRegistryEntry}
								onPruneStale={handlePruneModelRegistry}
							/>
						</>
					) : null}
				</div>
				<div className="px-2 py-3">
					{protectedTestApprovalPrompt && onGrantProtectedTestApproval ? (
						<div className="mb-2 rounded-lg border border-status-orange/40 bg-status-orange/5 px-2 py-2">
							<div className="mb-1 text-xs font-medium text-text-primary">Protected test edit approval</div>
							<div className="mb-2 text-xs text-text-secondary">
								{protectedTestApprovalPrompt.request.intent}
							</div>
							<div className="mb-2 grid gap-1 text-[11px] text-text-tertiary">
								<div>{protectedTestApprovalPrompt.request.reason}</div>
								<div>{protectedTestApprovalPrompt.request.expectedEffects}</div>
							</div>
							<Button
								variant="primary"
								size="sm"
								disabled={isGrantingProtectedApproval || isSending}
								onClick={() => {
									void handleGrantProtectedTestApproval();
								}}
							>
								{isGrantingProtectedApproval ? "Approving..." : "Approve Exact Edit"}
							</Button>
						</div>
					) : null}
					{clarifyingQuestionPrompt ? (
						<div className="mb-2 rounded-lg border border-border bg-surface-1 px-2 py-2">
							<div className="mb-2 text-xs text-text-secondary">{clarifyingQuestionPrompt.question}</div>
							<div className="flex flex-wrap gap-2">
								{clarifyingQuestionPrompt.options.map((option) => (
									<Button
										key={option.id}
										variant="ghost"
										size="sm"
										disabled={isSavingModel || isSending}
										onClick={() => {
											void handleSendComposerText(option.responseText);
										}}
									>
										{option.label}
									</Button>
								))}
							</div>
						</div>
					) : null}
					<NKleinChatComposer
						taskId={taskId}
						draft={draft}
						onDraftChange={setDraft}
						images={draftImages}
						onImagesChange={setDraftImages}
						placeholder={composerPlaceholder}
						mode={mode}
						onModeChange={handleModeChange}
						showModeToggle={showComposerModeToggle}
						canSend={canSend}
						canCancel={canCancel}
						onSend={handleComposerSend}
						onCancel={handleCancelTurn}
						modelOptions={modelOptions}
						recommendedModelIds={modelPickerOptions.recommendedModelIds}
						pinSelectedModelToTop={modelPickerOptions.shouldPinSelectedModelToTop}
						selectedModelId={nkleinSettings.modelId}
						selectedModelButtonText={selectedModelButtonText}
						onSelectModel={handleSelectModel}
						reasoningEnabledModelIds={reasoningEnabledModelIds}
						selectedReasoningEffort={nkleinSettings.reasoningEffort}
						onSelectReasoningEffort={handleSelectReasoningEffort}
						isModelLoading={nkleinSettings.isLoadingProviderModels}
						isModelSaving={isSavingModel}
						modelPickerDisabled={isSavingModel || nkleinSettings.providerId.trim().length === 0}
						isSending={isSavingModel || isSending}
						warningMessage={summary?.warningMessage ?? null}
						attachmentWarningMessage={attachmentWarningMessage}
						workspaceId={workspaceId}
					/>
				</div>
				{showActionFooter ? (
					<div className="flex flex-col gap-2 px-3 pb-3">
						{showReviewActions ? (
							<div className="flex gap-2">
								<Button
									variant="primary"
									size="sm"
									fill
									disabled={isCommitLoading || isOpenPrLoading}
									onClick={onCommit}
								>
									{isCommitLoading ? "..." : "Commit"}
								</Button>
								<Button
									variant="primary"
									size="sm"
									fill
									disabled={isCommitLoading || isOpenPrLoading}
									onClick={onOpenPr}
								>
									{isOpenPrLoading ? "..." : "Open PR"}
								</Button>
							</div>
						) : null}
						{cancelAutomaticActionLabel && onCancelAutomaticAction ? (
							<Button variant="default" fill onClick={onCancelAutomaticAction}>
								{cancelAutomaticActionLabel}
							</Button>
						) : null}
						<Button
							variant={effectiveMoveToTrashButtonVariant}
							fill
							disabled={isMoveToTrashLoading}
							onClick={onMoveToTrash}
						>
							{isMoveToTrashLoading ? <Spinner size={14} /> : effectiveMoveToTrashButtonLabel}
						</Button>
					</div>
				) : null}
			</div>
		);
	},
);

NKleinAgentChatPanel.displayName = "NKleinAgentChatPanel";
