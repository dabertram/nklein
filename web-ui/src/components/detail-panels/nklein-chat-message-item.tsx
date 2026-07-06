import * as Collapsible from "@radix-ui/react-collapsible";
import { Brain, ChevronDown, ChevronRight, Clock, XCircle } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { DecompositionGraphView } from "@/components/detail-panels/decomposition-graph-view";
import {
	formatToolInputForDisplay,
	getToolDisplay,
	hasFailedToolOutput,
	parseToolMessageContent,
	parseToolOutput,
} from "@/components/detail-panels/nklein-chat-message-utils";
import { NKleinMarkdownContent } from "@/components/detail-panels/nklein-markdown-content";
import { TaskImageStrip } from "@/components/task-image-strip";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import type { NKleinChatMessage } from "@/hooks/use-nklein-chat-session";

const MESSAGE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
});

const MESSAGE_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
});

function formatMessageDuration(durationMs: number): string {
	const normalizedMs = Math.max(0, Math.round(durationMs));
	if (normalizedMs < 1000) {
		return `${normalizedMs}ms`;
	}
	const totalSeconds = Math.round(normalizedMs / 100) / 10;
	if (totalSeconds < 60) {
		return `${totalSeconds.toFixed(totalSeconds >= 10 ? 0 : 1)}s`;
	}
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = Math.round(totalSeconds % 60);
	return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function MessageTimestampControl({
	createdAt,
	durationMs,
	collapsed,
	onToggle,
}: {
	createdAt: number;
	durationMs: number;
	collapsed: boolean;
	onToggle: () => void;
}): ReactElement {
	const date = new Date(createdAt);
	const timeLabel = MESSAGE_TIME_FORMATTER.format(date);
	const tooltipContent = `${MESSAGE_DATE_TIME_FORMATTER.format(date)} · took ${formatMessageDuration(durationMs)}`;
	return (
		<Tooltip content={tooltipContent}>
			<button
				type="button"
				aria-label={collapsed ? "Show message timestamps" : "Collapse message timestamps"}
				title={tooltipContent}
				onClick={onToggle}
				className="absolute top-0.5 right-1 z-10 cursor-pointer text-[10px] leading-none text-text-tertiary hover:text-text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
			>
				{collapsed ? <Clock size={11} /> : timeLabel}
			</button>
		</Tooltip>
	);
}

function ToolMessageBlock({ message }: { message: NKleinChatMessage }): ReactElement {
	const parsed = useMemo(() => parseToolMessageContent(message.content), [message.content]);
	const isRunning = message.meta?.hookEventName === "tool_call_start";
	const toolOutputFailed = useMemo(() => hasFailedToolOutput(parsed.output), [parsed.output]);
	const hasError = Boolean(parsed.error) || toolOutputFailed;
	const isDecomposition = parsed.toolName === "decompose_project";
	// Decomposition calls render their proposed task-graph DAG inline, so default them open — the graph is the point of
	// the message (and on a failed graph it shows the user *what* the agent proposed, errors and all).
	const [expanded, setExpanded] = useState(isDecomposition);

	const toolDisplay = useMemo(
		() => getToolDisplay(parsed.toolName, parsed.input, parsed.output),
		[parsed.toolName, parsed.input, parsed.output],
	);
	const toolOutput = useMemo(() => (parsed.output ? parseToolOutput(parsed.output) : null), [parsed.output]);
	const fullInput = useMemo(
		() => formatToolInputForDisplay(parsed.toolName, parsed.input),
		[parsed.toolName, parsed.input],
	);
	const hasExpandableContent = Boolean(parsed.output || parsed.error || fullInput);

	return (
		<div className="w-full">
			<button
				type="button"
				onClick={hasExpandableContent ? () => setExpanded((e) => !e) : undefined}
				className={cn(
					"group flex w-full items-center gap-1.5 rounded px-1.5 py-0 text-left text-sm",
					hasExpandableContent && "cursor-pointer",
				)}
			>
				{isRunning ? (
					<Spinner size={14} className="shrink-0" />
				) : hasError ? (
					<XCircle size={14} className="shrink-0 text-status-red" aria-label="Tool failed" role="img" />
				) : null}
				<span
					className={cn(
						"shrink-0 font-semibold group-hover:text-text-primary",
						expanded ? "text-text-primary" : "text-text-secondary",
					)}
				>
					{toolDisplay.toolName}
				</span>
				{toolDisplay.inputSummary ? (
					<span
						className={cn(
							"min-w-0 truncate group-hover:text-text-secondary",
							expanded ? "text-text-secondary" : "text-text-tertiary",
						)}
					>
						{toolDisplay.inputSummary}
					</span>
				) : null}
				{hasExpandableContent ? (
					<span
						className={cn(
							"shrink-0 group-hover:text-text-secondary",
							expanded ? "text-text-secondary" : "text-text-tertiary",
						)}
					>
						{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
					</span>
				) : null}
			</button>

			{expanded ? (
				<div className="mt-1 space-y-1.5 pr-1.5 pl-[24px] pb-1">
					{/* Proposed decomposition task-graph DAG (todo §5.B) — rendered for failures too. */}
					{isDecomposition ? <DecompositionGraphView input={parsed.input} hasError={hasError} /> : null}

					{/* Full tool input (e.g. complete run_commands commands) */}
					{fullInput ? (
						<div>
							<div className="mb-0.5 text-xs text-text-tertiary">Command</div>
							<pre className="max-h-60 overflow-auto rounded bg-surface-0 px-2 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-all text-text-primary">
								{fullInput}
							</pre>
						</div>
					) : null}

					{/* Parsed ToolOperationResult output */}
					{toolOutput ? (
						toolOutput.results.map((result, i) => (
							<div key={i}>
								{toolOutput.results.length > 1 ? (
									<div className="mb-0.5 truncate text-xs text-text-tertiary">{result.query}</div>
								) : null}
								{result.error ? (
									<pre className="max-h-60 overflow-auto rounded bg-status-red/5 px-2 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-all text-status-red">
										{result.error}
									</pre>
								) : null}
								{result.content ? (
									<pre className="max-h-60 overflow-auto rounded bg-surface-0 px-2 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-all text-text-primary">
										{result.content}
									</pre>
								) : null}
							</div>
						))
					) : parsed.output ? (
						/* Fallback for non-ToolOperationResult output (skills, ask_question, MCP tools) */
						<div>
							<div className="mb-0.5 text-xs text-text-tertiary">Output</div>
							<pre className="max-h-60 overflow-auto rounded bg-surface-0 px-2 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-all text-text-primary">
								{parsed.output}
							</pre>
						</div>
					) : null}

					{/* Tool-level error (SDK crash/timeout, separate from per-result errors) */}
					{parsed.error ? (
						<div>
							<div className="mb-0.5 text-xs text-status-red">Error</div>
							<pre className="max-h-60 overflow-auto rounded bg-status-red/5 px-2 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-all text-status-red">
								{parsed.error}
							</pre>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function ReasoningMessageBlock({ message }: { message: NKleinChatMessage }): ReactElement {
	const isStreaming = message.meta?.hookEventName === "reasoning_delta";
	const [expanded, setExpanded] = useState(isStreaming);
	const wasStreamingRef = useRef(isStreaming);

	useEffect(() => {
		if (wasStreamingRef.current && !isStreaming) {
			setExpanded(false);
		}
		wasStreamingRef.current = isStreaming;
	}, [isStreaming]);

	return (
		<Collapsible.Root open={expanded} onOpenChange={setExpanded} className="w-full">
			<Collapsible.Trigger asChild>
				<button
					type="button"
					className="group flex w-full cursor-pointer items-center gap-1.5 rounded px-1.5 py-0 text-left text-sm"
				>
					<Brain size={14} className="shrink-0 text-text-tertiary" />
					<span
						className={cn(
							"shrink-0 font-semibold group-hover:text-text-secondary",
							expanded ? "text-text-secondary" : "text-text-tertiary",
						)}
					>
						Reasoning
					</span>
					<span
						className={cn(
							"shrink-0 group-hover:text-text-tertiary",
							expanded ? "text-text-tertiary" : "text-text-tertiary/60",
						)}
					>
						{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
					</span>
				</button>
			</Collapsible.Trigger>
			<Collapsible.Content className="overflow-hidden data-[state=closed]:animate-[kb-collapsible-up_200ms_ease-out] data-[state=open]:animate-[kb-collapsible-down_200ms_ease-out]">
				<div className="mt-1 w-full px-1.5 text-sm italic whitespace-pre-wrap break-words text-text-tertiary">
					{message.content}
				</div>
			</Collapsible.Content>
		</Collapsible.Root>
	);
}

function SystemPromptMessageBlock({ message }: { message: NKleinChatMessage }): ReactElement {
	const [expanded, setExpanded] = useState(false);
	return (
		<Collapsible.Root open={expanded} onOpenChange={setExpanded} className="w-full">
			<Collapsible.Trigger asChild>
				<button
					type="button"
					className="group flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs text-text-tertiary hover:text-text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
				>
					<span className="font-semibold">{expanded ? "Hide system prompt" : "Show system prompt"}</span>
					<span>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
				</button>
			</Collapsible.Trigger>
			<Collapsible.Content className="overflow-hidden data-[state=closed]:animate-[kb-collapsible-up_200ms_ease-out] data-[state=open]:animate-[kb-collapsible-down_200ms_ease-out]">
				<pre className="mt-1 max-h-80 overflow-auto rounded border border-border bg-surface-0 px-2 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-words text-text-secondary">
					{message.content}
				</pre>
			</Collapsible.Content>
		</Collapsible.Root>
	);
}

/** W3.1 (main chat): board-card candidates for the referenced-cards chip row under an assistant reply. */
export interface ChatMessageCardReferences {
	candidates: readonly { id: string; title: string }[];
	onOpenCard: (cardId: string) => void;
	/** Extract the referenced card ids+labels from a message's text (the main chat's segmentation core). */
	extractReferences: (content: string) => readonly { cardId: string; label: string }[];
}

/** The clickable "referenced cards" chip row under an assistant reply (main chat, W3.1). */
function CardReferenceRow({
	content,
	references,
}: {
	content: string;
	references: ChatMessageCardReferences;
}): ReactElement | null {
	const chips = useMemo(() => {
		const seen = new Map<string, string>();
		for (const reference of references.extractReferences(content)) {
			if (!seen.has(reference.cardId)) {
				seen.set(reference.cardId, reference.label);
			}
		}
		return [...seen.entries()];
	}, [content, references]);
	if (chips.length === 0) {
		return null;
	}
	return (
		<div className="mt-1.5 flex flex-wrap gap-1">
			{chips.map(([cardId, label]) => (
				<button
					key={cardId}
					type="button"
					data-testid="chat-card-chip"
					title="Open this card in the main panel"
					onClick={() => references.onOpenCard(cardId)}
					className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-accent/35 bg-accent/10 px-1.5 text-[12px] leading-5 text-accent hover:bg-accent/20"
				>
					{label}
					<span aria-hidden className="text-[10px] opacity-70">
						↗
					</span>
				</button>
			))}
		</div>
	);
}

export function NKleinChatMessageItem({
	message,
	durationMs,
	timestampsCollapsed,
	onToggleTimestampsCollapsed,
	cardReferences,
}: {
	message: NKleinChatMessage;
	durationMs: number;
	timestampsCollapsed: boolean;
	onToggleTimestampsCollapsed: () => void;
	/** W3.1 (main chat): when provided, assistant replies get a clickable "referenced cards" chip row. */
	cardReferences?: ChatMessageCardReferences;
}): ReactElement {
	const timestamp = (
		<MessageTimestampControl
			createdAt={message.createdAt}
			durationMs={durationMs}
			collapsed={timestampsCollapsed}
			onToggle={onToggleTimestampsCollapsed}
		/>
	);
	if (message.role === "tool") {
		return (
			<div className="relative w-full pr-12">
				{timestamp}
				<ToolMessageBlock message={message} />
			</div>
		);
	}
	if (message.role === "reasoning") {
		return (
			<div className="relative w-full pr-12">
				{timestamp}
				<ReasoningMessageBlock message={message} />
			</div>
		);
	}
	if (message.role === "system" && message.meta?.messageKind === "system_prompt") {
		return (
			<div className="relative w-full pr-12">
				{timestamp}
				<SystemPromptMessageBlock message={message} />
			</div>
		);
	}
	if (message.role === "user") {
		const hasText = message.content.trim().length > 0;
		const hasImages = Boolean(message.images && message.images.length > 0);
		return (
			<div className="relative ml-auto max-w-[85%] rounded-md border border-accent/20 bg-accent/10 py-2 pr-12 pl-3 text-sm text-text-primary">
				{timestamp}
				{hasText ? <div className="whitespace-pre-wrap break-words">{message.content}</div> : null}
				{hasImages ? (
					<TaskImageStrip images={message.images ?? []} className={hasText ? "mt-2" : undefined} />
				) : null}
			</div>
		);
	}
	if (message.role === "assistant") {
		const normalizedAssistantContent = message.content.replace(/^\n+/, "");
		return (
			<div className="relative min-w-0 w-full px-1.5 pr-12 text-sm text-text-primary">
				{timestamp}
				<NKleinMarkdownContent content={normalizedAssistantContent} />
				{cardReferences ? (
					<CardReferenceRow content={normalizedAssistantContent} references={cardReferences} />
				) : null}
			</div>
		);
	}
	const label = message.role === "status" ? "Status" : "System";
	return (
		<div className="relative max-w-[85%] rounded-md border border-border bg-surface-3/70 py-2 pr-12 pl-3 text-sm whitespace-pre-wrap break-all text-text-secondary">
			{timestamp}
			<div className="mb-1 text-xs uppercase tracking-wide text-text-tertiary">{label}</div>
			{message.content}
		</div>
	);
}
