// Layout component for the native Cline chat panel.
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

import { ClineChatComposer } from "@/components/detail-panels/cline-chat-composer";
import { ClineChatMessageItem } from "@/components/detail-panels/cline-chat-message-item";
import {
	buildClineAgentModelPickerOptions,
	buildClineSelectedModelButtonText,
	getClineReasoningEnabledModelIds,
} from "@/components/detail-panels/cline-model-picker-options";
import {
	ClineModelRegistryPanel,
	findClineModelRegistryEntry,
	formatClineModelRegistryDisplay,
} from "@/components/detail-panels/cline-model-registry-panel";
import { ClineThinkingIndicator } from "@/components/detail-panels/cline-thinking-indicator";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { useClineChatPanelController } from "@/hooks/use-cline-chat-panel-controller";
import type { ClineChatActionResult } from "@/hooks/use-cline-chat-runtime-actions";
import type { ClineChatMessage } from "@/hooks/use-cline-chat-session";
import { useRuntimeSettingsClineController } from "@/hooks/use-runtime-settings-cline-controller";
import { fetchClineModelRegistry } from "@/runtime/runtime-config-query";
import type {
	RuntimeClineReasoningEffort,
	RuntimeClineTeamProgressEvent,
	RuntimeConfigResponse,
	RuntimeContextBudgetBreakdown,
	RuntimeTaskClineSettings,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionSummary,
} from "@/runtime/types";
import { useTrpcQuery } from "@/runtime/use-trpc-query";
import type { TaskImage } from "@/types";

const BOTTOM_LOCK_THRESHOLD_PX = 24;
const CLINE_BUY_CREDITS_URL = "https://app.cline.bot/";

function countClineDisplayTokens(text: string): number {
	return countTokens(text, { allowedSpecial: ALL_SPECIAL_TOKENS });
}

// Approximate token cost of the short summary the host substitutes for a compacted
// read_files result body (header + tool input recap + guidance lines).
const READ_FILES_COMPACTED_OVERHEAD_TOKENS = 64;

export { findClineModelRegistryEntry, formatClineModelRegistryDisplay };

function normalizeClineToolName(name: string | null | undefined): string {
	return typeof name === "string" ? name.toLowerCase().replace(/[^a-z]/g, "") : "";
}

function getClineMessageToolName(message: ClineChatMessage): string {
	const metaToolName = normalizeClineToolName(message.meta?.toolName);
	if (metaToolName) {
		return metaToolName;
	}
	const toolLine = message.content.split("\n").find((line) => line.startsWith("Tool:"));
	return toolLine ? normalizeClineToolName(toolLine.slice("Tool:".length)) : "";
}

function isClineFileReadToolName(name: string): boolean {
	return name === "readfiles" || name === "readlargefile";
}

/**
 * Estimates a message's contribution to the actual outbound model request.
 * Older `read_files` results are compacted by the Kanban host. The newest
 * successful result remains verbatim for the request that analyzes it.
 */
export function estimateClineRequestMessageTokens(
	message: ClineChatMessage,
	options: { retainReadFilesOutput?: boolean } = {},
): number {
	if (
		message.role !== "tool" ||
		!isClineFileReadToolName(getClineMessageToolName(message)) ||
		options.retainReadFilesOutput
	) {
		return countClineDisplayTokens(message.content);
	}
	const outputIndex = message.content.indexOf("\nOutput:");
	const retained = outputIndex >= 0 ? message.content.slice(0, outputIndex) : message.content;
	return countClineDisplayTokens(retained) + READ_FILES_COMPACTED_OVERHEAD_TOKENS;
}

function findLatestCompletedReadFilesMessageIndex(messages: readonly ClineChatMessage[]): number {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (
			message?.role === "tool" &&
			isClineFileReadToolName(getClineMessageToolName(message)) &&
			message.content.includes("\nOutput:")
		) {
			return index;
		}
	}
	return -1;
}

export function estimateClineRequestHistoryTokens(messages: readonly ClineChatMessage[]): number {
	const latestReadFilesMessageIndex = findLatestCompletedReadFilesMessageIndex(messages);
	return messages.reduce(
		(sum, message, index) =>
			sum +
			estimateClineRequestMessageTokens(message, {
				retainReadFilesOutput: index === latestReadFilesMessageIndex,
			}),
		0,
	);
}

export function formatClineContextBudgetDisplay(options: {
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

function ClineContextBudgetBar({ breakdown }: { breakdown: RuntimeContextBudgetBreakdown }): ReactElement {
	const segments = [
		{ label: "System", tokens: breakdown.systemPromptTokens, className: "bg-status-purple" },
		{ label: "Tools", tokens: breakdown.toolSchemaTokens, className: "bg-status-blue" },
		{ label: "Task", tokens: breakdown.taskPromptTokens, className: "bg-accent" },
		{ label: "User", tokens: breakdown.userMessageTokens, className: "bg-status-green" },
		{ label: "Files", tokens: breakdown.includedFileContentTokens, className: "bg-status-gold" },
		{ label: "History", tokens: breakdown.otherHistoryTokens, className: "bg-status-orange" },
		{ label: "Prompt reserve", tokens: breakdown.reservedPromptOverheadTokens, className: "bg-surface-4" },
		{ label: "Output reserve", tokens: breakdown.reservedOutputTokens, className: "bg-border-bright" },
	].filter((segment) => segment.tokens > 0);
	const percent = Math.min(
		100,
		Math.max(0, Math.round((breakdown.projectedTokens / breakdown.effectiveContextWindow) * 100)),
	);
	const toneClassName = getContextBudgetTone(breakdown.projectedTokens, breakdown.effectiveContextWindow);
	const summaryText = `${formatTokenCount(breakdown.projectedTokens)} / ${formatTokenCount(
		breakdown.effectiveContextWindow,
	)} tokens (${percent}%)`;
	return (
		<div
			className="flex min-w-[220px] max-w-full flex-col gap-1"
			role="group"
			aria-label={`Context budget ${summaryText}`}
		>
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
					{segments.map((segment) => {
						const width = Math.max(1, (segment.tokens / breakdown.effectiveContextWindow) * 100);
						return (
							<div
								key={segment.label}
								className={segment.className}
								style={{ width: `${width}%` }}
								title={`${segment.label}: ~${formatTokenCount(segment.tokens)} tokens`}
							/>
						);
					})}
				</div>
			</div>
		</div>
	);
}

export function formatClineCardContentDisplay(options: {
	taskTitle?: string | null;
	taskPrompt?: string | null;
}): string {
	const cardText = [options.taskTitle?.trim(), options.taskPrompt?.trim()].filter(Boolean).join("\n\n");
	const estimatedTokens = countClineDisplayTokens(cardText);
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

const CLARIFYING_OPTION_PATTERN = /^\s*(?:[-*]\s*)?(?:(?<id>[A-Z]|\d+)[).:-]\s+)?(?<label>.+?)(?:\s+-\s+.+)?$/i;

function normalizeClarifyingOptionLabel(label: string): string {
	return label
		.replace(/\*\*/g, "")
		.replace(/\s*\((?:recommended|default)\)\s*/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function extractClarifyingQuestionPrompt(
	messages: readonly ClineChatMessage[],
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

function formatCompactDuration(milliseconds: number): string {
	const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes <= 0) {
		return `${seconds}s`;
	}
	return `${minutes}m ${seconds}s`;
}

function getLatestUserMessageCreatedAt(messages: ClineChatMessage[]): number | null {
	const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
	return latestUserMessage?.createdAt ?? null;
}

function getLatestGeneratedTextForCurrentTurn(messages: ClineChatMessage[]): ClineChatMessage | null {
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

export function formatClineModelActivityDisplay(options: {
	summary: RuntimeTaskSessionSummary | null;
	messages: ClineChatMessage[];
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

const ClineCreditLimitNotice = React.memo(function ClineCreditLimitNotice() {
	return (
		<div className="mx-1 flex items-start gap-2 rounded-md border border-status-orange/40 bg-status-orange/10 px-3 py-2 text-xs text-status-orange">
			<AlertTriangle size={14} className="mt-0.5 shrink-0" />
			<p className="m-0 min-w-0">
				Out of Cline credits.{" "}
				<Link href={CLINE_BUY_CREDITS_URL} external>
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

const ClineTeamProgressStrip = React.memo(function ClineTeamProgressStrip({
	events,
	nowMs,
}: {
	events: RuntimeClineTeamProgressEvent[];
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

export interface ClineAgentChatPanelHandle {
	appendToDraft: (text: string) => void;
	sendText: (text: string) => Promise<void>;
}

export interface ClineAgentChatPanelProps {
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
	taskClineSettings?: RuntimeTaskClineSettings;
	taskHasExplicitClineSettings?: boolean;
	onClineSettingsSaved?: () => void;
	onTaskClineSettingsChanged?: (settings: {
		providerId: string;
		modelId: string;
		reasoningEffort: RuntimeClineReasoningEffort | "";
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
			reasoningEffort?: RuntimeClineReasoningEffort | null;
		},
	) => Promise<ClineChatActionResult>;
	onCancelTurn?: (taskId: string) => Promise<{ ok: boolean; message?: string }>;
	onLoadMessages?: (taskId: string) => Promise<ClineChatMessage[] | null>;
	incomingMessages?: ClineChatMessage[] | null;
	incomingMessage?: ClineChatMessage | null;
	teamProgress?: RuntimeClineTeamProgressEvent[];
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

export const ClineAgentChatPanel = React.forwardRef<ClineAgentChatPanelHandle, ClineAgentChatPanelProps>(
	function ClineAgentChatPanel(
		{
			taskId,
			summary,
			taskColumnId = "in_progress",
			defaultMode = "act",
			composerPlaceholder = "Ask Cline to add, edit, start, or link tasks",
			showComposerModeToggle = true,
			workspaceId = null,
			taskTitle = null,
			taskPrompt = null,
			runtimeConfig = null,
			taskClineSettings,
			taskHasExplicitClineSettings = false,
			onClineSettingsSaved,
			onTaskClineSettingsChanged,
			onSendMessage,
			onCancelTurn,
			onLoadMessages,
			incomingMessages,
			incomingMessage,
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
		const clineSettings = useRuntimeSettingsClineController({
			open: true,
			workspaceId,
			selectedAgentId: "cline",
			config: runtimeConfig,
			taskClineSettings,
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
		} = useClineChatPanelController({
			taskId,
			summary,
			taskColumnId,
			onSendMessage:
				onSendMessage === undefined
					? undefined
					: (sendTaskId, text, options) => {
							const providerId = clineSettings.providerId.trim();
							const modelId = clineSettings.modelId.trim();
							const hasLaunchSelection =
								providerId.length > 0 || modelId.length > 0 || clineSettings.reasoningEffort.length > 0;
							return onSendMessage(sendTaskId, text, {
								...options,
								...(providerId.length > 0 ? { providerId } : {}),
								...(modelId.length > 0 ? { modelId } : {}),
								...(hasLaunchSelection ? { reasoningEffort: clineSettings.reasoningEffort || null } : {}),
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
		const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
		const [isSavingModel, setIsSavingModel] = useState(false);
		const [isClearingChat, setIsClearingChat] = useState(false);
		const [isModelRegistryPanelOpen, setIsModelRegistryPanelOpen] = useState(false);
		const [nowMs, setNowMs] = useState(() => Date.now());
		const [contextScope, setContextScope] = useState<"full" | "smart" | "minimal" | "custom">(
			taskClineSettings?.contextScope ?? "smart",
		);
		const [timeoutMode, setTimeoutMode] = useState<"normal" | "long" | "extended" | "unlimited">(
			taskClineSettings?.timeoutMode ?? runtimeConfig?.agentTimeoutMode ?? "normal",
		);
		const isCreditLimitNoticeVisible = summary?.latestHookActivity?.notificationType === "credit_limit";
		const [mode, setMode] = useState<RuntimeTaskSessionMode>(() => {
			const persistedMode = modeByTaskIdRef.current.get(taskId);
			return persistedMode ?? summary?.mode ?? defaultMode;
		});
		const [draftImages, setDraftImages] = useState<TaskImage[]>([]);

		const modelPickerOptions = useMemo(
			() => buildClineAgentModelPickerOptions(clineSettings.providerId, clineSettings.providerModels),
			[clineSettings.providerId, clineSettings.providerModels],
		);
		const modelOptions = modelPickerOptions.options;

		const selectedModel = useMemo(
			() => clineSettings.providerModels.find((model) => model.id === clineSettings.modelId) ?? null,
			[clineSettings.modelId, clineSettings.providerModels],
		);
		const fetchSelectedWorkspaceModelRegistry = useCallback(
			async () => await fetchClineModelRegistry(workspaceId),
			[workspaceId],
		);
		const modelRegistryQuery = useTrpcQuery({
			enabled: clineSettings.providerId.trim().length > 0 && clineSettings.modelId.trim().length > 0,
			queryFn: fetchSelectedWorkspaceModelRegistry,
			retainDataOnError: true,
		});
		const modelRegistryEntries = modelRegistryQuery.data?.models ?? [];
		const selectedModelRegistryEntry = useMemo(
			() => findClineModelRegistryEntry(modelRegistryEntries, clineSettings.providerId, clineSettings.modelId),
			[clineSettings.modelId, clineSettings.providerId, modelRegistryEntries],
		);
		const modelRegistryText = useMemo(
			() => formatClineModelRegistryDisplay(selectedModelRegistryEntry),
			[selectedModelRegistryEntry],
		);
		const selectedEffectiveContextWindow =
			selectedModelRegistryEntry?.contextWindow.effective ?? selectedModel?.contextWindow ?? null;
		const reasoningEnabledModelIds = useMemo(
			() => getClineReasoningEnabledModelIds(clineSettings.providerModels),
			[clineSettings.providerModels],
		);

		const selectedModelButtonText = useMemo(
			() =>
				buildClineSelectedModelButtonText({
					modelOptions,
					selectedModelId: clineSettings.modelId,
					reasoningEffort: clineSettings.reasoningEffort,
					showReasoningEffort: clineSettings.selectedModelSupportsReasoningEffort,
					isModelLoading: clineSettings.isLoadingProviderModels,
					isModelSaving: isSavingModel,
				}),
			[
				clineSettings.isLoadingProviderModels,
				clineSettings.modelId,
				clineSettings.reasoningEffort,
				clineSettings.selectedModelSupportsReasoningEffort,
				isSavingModel,
				modelOptions,
			],
		);

		const panelError = composerError ?? error;
		const estimatedNextPromptTokens = useMemo(() => {
			if (summary?.state === "running") {
				return 0;
			}
			const draftTokens = countClineDisplayTokens(draft.trim());
			const imageOverheadTokens = draftImages.length * 1_200;
			const framingOverheadTokens = 1_200;
			return Math.max(1_200, draftTokens + imageOverheadTokens + framingOverheadTokens);
		}, [draft, draftImages.length, summary?.state]);
		const estimatedContextTokens = useMemo(() => {
			const historyTokens = estimateClineRequestHistoryTokens(messages);
			return historyTokens + estimatedNextPromptTokens;
		}, [estimatedNextPromptTokens, messages]);
		const estimatedContextBudget = useMemo(
			() =>
				formatClineContextBudgetDisplay({
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
			() => formatClineCardContentDisplay({ taskTitle, taskPrompt }),
			[taskPrompt, taskTitle],
		);
		const modelActivityText = useMemo(
			() =>
				formatClineModelActivityDisplay({
					summary,
					messages,
					nowMs,
					currentRequestContextText,
				}),
			[currentRequestContextText, summary, messages, nowMs],
		);
		const attachmentWarningMessage =
			draftImages.length > 0 && selectedModel?.supportsVision === false
				? "The selected Cline model may not accept image input. Choose a vision-capable model to use these images."
				: null;
		const clarifyingQuestionPrompt = useMemo(() => extractClarifyingQuestionPrompt(messages), [messages]);

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
			setNowMs(Date.now());
			const intervalId = window.setInterval(() => {
				setNowMs(Date.now());
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
			setContextScope(taskClineSettings?.contextScope ?? "smart");
			setTimeoutMode(taskClineSettings?.timeoutMode ?? runtimeConfig?.agentTimeoutMode ?? "normal");
		}, [
			defaultMode,
			runtimeConfig?.agentTimeoutMode,
			summary?.mode,
			taskClineSettings?.contextScope,
			taskClineSettings?.timeoutMode,
			taskId,
		]);

		const handleModeChange = useCallback(
			(nextMode: RuntimeTaskSessionMode) => {
				modeByTaskIdRef.current.set(taskId, nextMode);
				setMode(nextMode);
			},
			[taskId],
		);

		type PersistClineModelSettingsOverrides = {
			modelId?: string;
			reasoningEffort?: RuntimeClineReasoningEffort | "";
			contextScope?: "full" | "smart" | "minimal" | "custom";
			timeoutMode?: "normal" | "long" | "extended" | "unlimited";
		};

		const persistClineModelSettings = useCallback(
			async (overrides?: PersistClineModelSettingsOverrides): Promise<boolean> => {
				if (!workspaceId) {
					setComposerError("Select a workspace before choosing a Cline model.");
					return false;
				}
				if (clineSettings.providerId.trim().length === 0) {
					setComposerError("Choose a Cline provider in Settings before selecting a model.");
					return false;
				}
				setComposerError(null);
				setIsSavingModel(true);
				try {
					const nextModelId = overrides?.modelId ?? clineSettings.modelId;
					const nextReasoningEffort =
						overrides && "reasoningEffort" in overrides
							? overrides.reasoningEffort || ""
							: clineSettings.reasoningEffort;
					const nextContextScope = overrides?.contextScope ?? contextScope;
					const nextTimeoutMode = overrides?.timeoutMode ?? timeoutMode;
					if (taskHasExplicitClineSettings) {
						onTaskClineSettingsChanged?.({
							providerId: clineSettings.providerId,
							modelId: nextModelId,
							reasoningEffort: nextReasoningEffort,
							contextScope: nextContextScope,
							timeoutMode: nextTimeoutMode,
						});
						return true;
					}
					const result = await clineSettings.saveProviderSettings({
						modelId: nextModelId,
						reasoningEffort: nextReasoningEffort || null,
					});
					if (!result.ok) {
						setComposerError(result.message ?? "Could not save Cline model settings.");
						return false;
					}
					onClineSettingsSaved?.();
					return true;
				} finally {
					setIsSavingModel(false);
				}
			},
			[
				clineSettings,
				contextScope,
				onClineSettingsSaved,
				onTaskClineSettingsChanged,
				taskHasExplicitClineSettings,
				timeoutMode,
				workspaceId,
			],
		);

		const handleSelectModel = useCallback(
			(nextModelId: string) => {
				if (nextModelId.trim() === clineSettings.modelId.trim()) {
					return;
				}
				clineSettings.setModelId(nextModelId);
				void persistClineModelSettings({ modelId: nextModelId });
			},
			[clineSettings.modelId, clineSettings.setModelId, persistClineModelSettings],
		);

		const handleSelectReasoningEffort = useCallback(
			(nextReasoningEffort: RuntimeClineReasoningEffort | "") => {
				if (nextReasoningEffort === clineSettings.reasoningEffort) {
					return;
				}
				clineSettings.setReasoningEffort(nextReasoningEffort);
				void persistClineModelSettings({ reasoningEffort: nextReasoningEffort });
			},
			[clineSettings.reasoningEffort, clineSettings.setReasoningEffort, persistClineModelSettings],
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
				if (clineSettings.hasUnsavedChanges) {
					const saved = await persistClineModelSettings();
					if (!saved) {
						return;
					}
				}
				await handleSendText(text, mode);
			},
			[clineSettings.hasUnsavedChanges, handleSendText, isSavingModel, mode, persistClineModelSettings],
		);

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
			if (clineSettings.hasUnsavedChanges) {
				const saved = await persistClineModelSettings();
				if (!saved) {
					return;
				}
			}
			const sent = await handleSendDraft(mode, draftImages);
			if (sent) {
				setDraftImages([]);
			}
		}, [
			clineSettings.hasUnsavedChanges,
			draftImages,
			handleSendDraft,
			isSavingModel,
			mode,
			persistClineModelSettings,
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

		return (
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<div
					ref={scrollContainerRef}
					className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto px-2 py-3"
					onScroll={handleMessageListScroll}
				>
					{messages.map((message) => (
						<ClineChatMessageItem key={message.id} message={message} />
					))}
					<ClineTeamProgressStrip events={teamProgress} nowMs={nowMs} />
					{showAgentProgressIndicator ? <ClineThinkingIndicator /> : null}
					{isCreditLimitNoticeVisible ? <ClineCreditLimitNotice /> : null}
				</div>
				{panelError ? (
					<div className="border-t border-status-red/30 bg-status-red/10 px-2 py-2 text-xs text-status-red">
						{panelError}
					</div>
				) : null}
				<div className="px-2 pt-2">
					<div className="flex flex-wrap items-center gap-2">
						<div className="text-[11px] text-text-secondary">{cardContentText}</div>
						{modelActivityText ? <div className="text-[11px] text-text-tertiary">{modelActivityText}</div> : null}
						{modelRegistryText ? <div className="text-[11px] text-text-tertiary">{modelRegistryText}</div> : null}
						{summary?.contextBudgetBreakdown ? (
							<ClineContextBudgetBar breakdown={summary.contextBudgetBreakdown} />
						) : null}
						<div className="ml-auto flex flex-wrap items-center gap-2">
							<NativeSelect
								value={contextScope}
								onChange={(event) => {
									const nextValue = event.target.value as "full" | "smart" | "minimal" | "custom";
									setContextScope(nextValue);
									if (taskHasExplicitClineSettings) {
										void persistClineModelSettings({ contextScope: nextValue });
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
									if (taskHasExplicitClineSettings) {
										void persistClineModelSettings({ timeoutMode: nextValue });
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
						<ClineModelRegistryPanel
							entries={modelRegistryEntries}
							selectedProviderId={clineSettings.providerId}
							selectedModelId={clineSettings.modelId}
							nowMs={nowMs}
							isLoading={modelRegistryQuery.isLoading}
						/>
					) : null}
				</div>
				<div className="px-2 py-3">
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
					<ClineChatComposer
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
						selectedModelId={clineSettings.modelId}
						selectedModelButtonText={selectedModelButtonText}
						onSelectModel={handleSelectModel}
						reasoningEnabledModelIds={reasoningEnabledModelIds}
						selectedReasoningEffort={clineSettings.reasoningEffort}
						onSelectReasoningEffort={handleSelectReasoningEffort}
						isModelLoading={clineSettings.isLoadingProviderModels}
						isModelSaving={isSavingModel}
						modelPickerDisabled={isSavingModel || clineSettings.providerId.trim().length === 0}
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

ClineAgentChatPanel.displayName = "ClineAgentChatPanel";
