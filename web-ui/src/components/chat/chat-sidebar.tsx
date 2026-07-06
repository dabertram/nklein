import { Bot, MessageSquare, MessageSquarePlus, PanelRightClose, Send, Trash2 } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useRef, useState } from "react";
import type { ActivityTick } from "@/components/chat/board-activity-ticker";
import { type ChatCardCandidate, segmentChatMessage } from "@/components/chat/chat-card-references";
import {
	type ActiveMention,
	applyMention,
	filterMentionCandidates,
	getActiveMention,
	type MentionCandidate,
} from "@/components/chat/composer-mention";
import { StreamOverviewPanel } from "@/components/chat/stream-overview-panel";
import {
	type ChatMessageCardReferences,
	NKleinChatMessageItem,
} from "@/components/detail-panels/nklein-chat-message-item";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/dialog";
import { ElementTooltip } from "@/components/ui/element-tooltip";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { useStickyTranscript } from "@/hooks/use-sticky-transcript";
import { ResizeHandle } from "@/resize/resize-handle";
import { clampBetween } from "@/resize/resize-persistence";
import { CHAT_SIDEBAR_WIDTH_BOUNDS, useChatSidebarLayout } from "@/resize/use-chat-sidebar-layout";
import { useResizeDrag } from "@/resize/use-resize-drag";
import type {
	RuntimeChatAutonomousRunStatus,
	RuntimeChatAutonomousStopReason,
	RuntimeChatMessage,
	RuntimeChatSession,
	RuntimeChatSessionRole,
	RuntimeChatSessionScope,
} from "@/runtime/types";
import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";
import { useChatData } from "./use-chat-data";

const ROLE_OPTIONS: ReadonlyArray<{ value: RuntimeChatSessionRole; label: string }> = [
	{ value: "planner_architect", label: "Planner / architect" },
	{ value: "reviewer", label: "Reviewer" },
	{ value: "debugger", label: "Debugger" },
	{ value: "researcher", label: "Researcher" },
	{ value: "system_operator", label: "System operator" },
];

// The "can-act" scopes (project_sandboxed / all_projects / host_access) all let the agent run commands on the
// user's HOST machine (filesystem + shell), gated by the session-wide "I accept the risk" acknowledgement — they are
// NOT Docker-sandboxed. The labels say "(host)" so this is explicit; `host_access` is the most powerful (anywhere on
// the host) and keeps the ⚠️.
// TODO(§5.M): gate `host_access` behind a global "allow host access" setting (not yet in runtimeConfigSchema) +
// ideally a typed confirmation; for now it is shown unconditionally with the ⚠️.
const SCOPE_OPTIONS: ReadonlyArray<{ value: RuntimeChatSessionScope; label: string }> = [
	{ value: "chat_only", label: "Chat only" },
	{ value: "project_sandboxed", label: "Current (host)" },
	{ value: "all_projects", label: "All (host)" },
	{ value: "host_access", label: "⚠️ Host" },
];

/** Scopes where the agent can run commands (not read-only). The risk toggle is only relevant here. */
const CAN_ACT_SCOPES = new Set<RuntimeChatSessionScope>(["project_sandboxed", "all_projects", "host_access"]);

// §5.AE the user-selectable per-session skills (ids mirror the backend SKILL_REGISTRY). A skill's merged apiProfile
// (reasoning intensity / structured output / temperature) is folded into this session's model call.
const SKILL_OPTIONS: readonly { id: string; label: string; icon: string }[] = [
	{ id: "code_editing", label: "Code editing", icon: "✏️" },
	{ id: "planning", label: "Planning", icon: "🧭" },
	{ id: "review", label: "Review", icon: "🔍" },
	{ id: "web_retrieval", label: "Web retrieval", icon: "📚" },
];

// ─── Session metadata helpers ──────────────────────────────────────────────────

/**
 * Metadata derived from a chat session (and optionally from its loaded transcript) for display in
 * the session list — started/last-activity timestamps, message count, and the running token total
 * (§5.M: `session.totalTokensUsed`, accumulated server-side from each turn's `usage.total_tokens`).
 */
interface SessionMeta {
	/** ISO-ish short timestamp of when the session was created, e.g. "Jun 25 14:32". */
	startedLabel: string;
	/**
	 * ISO-ish short timestamp of the last activity (last message or session update), e.g. "Jun 25
	 * 15:01". Null when `updatedAt === createdAt` (no messages yet, nothing to differentiate).
	 */
	lastActivityLabel: string | null;
	/** Number of user+assistant messages in the transcript, or null when not yet loaded. */
	messageCount: number | null;
	/** Compact token-usage label (e.g. "3.4k tokens"), or null when none used / not the loaded session. */
	tokenLabel: string | null;
}

/** Compact token count: "512 tokens", "3.4k tokens", "1.2M tokens". */
function formatTokenCount(tokens: number): string {
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
	}
	if (tokens >= 1_000) {
		return `${(tokens / 1_000).toFixed(1)}k tokens`;
	}
	return `${tokens} tokens`;
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
};

function formatTimestamp(epochMs: number): string {
	return new Intl.DateTimeFormat(undefined, DATE_FORMAT).format(new Date(epochMs));
}

/**
 * Build display metadata for one session. Pass the loaded transcript messages for the selected
 * session; pass `null` for all others (we don't pre-load every session's transcript).
 */
function buildSessionMeta(session: RuntimeChatSession, messages: RuntimeChatMessage[] | null): SessionMeta {
	const startedLabel = formatTimestamp(session.createdAt);

	// Only show lastActivity when it's meaningfully different from createdAt (> 30 s apart).
	const lastActivityLabel = session.updatedAt - session.createdAt > 30_000 ? formatTimestamp(session.updatedAt) : null;

	const messageCount = messages !== null ? messages.filter((m) => m.role !== "system").length : null;

	// Token usage only for the loaded/selected session (messages !== null) and only once some has accrued.
	const tokenLabel =
		messages !== null && session.totalTokensUsed > 0 ? formatTokenCount(session.totalTokensUsed) : null;

	return { startedLabel, lastActivityLabel, messageCount, tokenLabel };
}

// ─── RiskAckConfirmDialog ──────────────────────────────────────────────────────

/**
 * Extra-confirmation AlertDialog shown before enabling `riskAcknowledged`. The user must explicitly
 * click "Allow unsafe commands" to proceed — cancel/escape leaves the flag false.
 */
function RiskAckConfirmDialog({
	open,
	onConfirm,
	onCancel,
}: {
	open: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}): React.ReactElement {
	return (
		<AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
			<AlertDialogHeader>
				<AlertDialogTitle>Allow unsafe commands?</AlertDialogTitle>
			</AlertDialogHeader>
			<AlertDialogBody>
				<AlertDialogDescription>
					Enabling this allows the agent to run potentially-destructive shell commands — such as{" "}
					<code className="bg-surface-2 px-1 rounded text-text-primary">rm</code>,{" "}
					<code className="bg-surface-2 px-1 rounded text-text-primary">npm install</code>, network requests, and
					other side-effecting operations — without per-command approval during this session.
				</AlertDialogDescription>
				<AlertDialogDescription>
					Only proceed if you trust the current session goal and accept responsibility for any changes the agent
					makes.
				</AlertDialogDescription>
			</AlertDialogBody>
			<AlertDialogFooter>
				<AlertDialogCancel asChild>
					<button
						type="button"
						className="h-7 px-3 rounded-md text-[12px] font-medium bg-surface-2 text-text-secondary border border-border hover:bg-surface-3 hover:text-text-primary transition-colors"
						onClick={onCancel}
					>
						Cancel
					</button>
				</AlertDialogCancel>
				<AlertDialogAction asChild>
					<button
						type="button"
						data-testid="risk-ack-confirm-button"
						className="h-7 px-3 rounded-md text-[12px] font-medium bg-status-red text-white hover:opacity-90 transition-opacity"
						onClick={onConfirm}
					>
						Allow unsafe commands
					</button>
				</AlertDialogAction>
			</AlertDialogFooter>
		</AlertDialog>
	);
}

// ─── SessionHeader ─────────────────────────────────────────────────────────────

/**
 * Editable header for the selected session: title + goal (commit on blur/Enter) and role + scope selects, all
 * wired to `updateSession`. Keyed by session id by the caller so its local draft state resets on session switch.
 */
function SessionHeader({
	session,
	onUpdate,
}: {
	session: RuntimeChatSession;
	onUpdate: (input: {
		id: string;
		title?: string;
		goal?: string | null;
		role?: RuntimeChatSessionRole;
		scope?: RuntimeChatSessionScope;
		riskAcknowledged?: boolean;
		browserEnabled?: boolean;
		feedbackMuted?: boolean;
		selectedSkillIds?: string[];
	}) => void;
}): React.ReactElement {
	const [title, setTitle] = useState(session.title);
	const [goal, setGoal] = useState(session.goal ?? "");
	const [riskDialogOpen, setRiskDialogOpen] = useState(false);

	// §5.AE: the skills the user can enable for this session. Their merged apiProfile is folded into the model call
	// (reasoning intensity / structured output / temperature). Selection is per session and free of scope gating —
	// skills shape the model call, not host permissions.
	const selectedSkillIds = session.selectedSkillIds ?? [];
	const handleSkillToggle = (skillId: string): void => {
		const next = selectedSkillIds.includes(skillId)
			? selectedSkillIds.filter((id) => id !== skillId)
			: [...selectedSkillIds, skillId];
		onUpdate({ id: session.id, selectedSkillIds: next });
	};

	// Both per-session opt-ins only do anything in a can-act scope (host actions are denied in chat-only), so the
	// toggles are shown together there. Browsing read-only pages is lower-risk than unsafe shell commands, so the
	// browser toggle flips immediately (no extra-confirmation dialog — unlike the unsafe-commands toggle).
	const showRiskToggle = CAN_ACT_SCOPES.has(session.scope);

	const handleBrowserToggle = (): void => {
		onUpdate({ id: session.id, browserEnabled: !session.browserEnabled });
	};

	// §5.AT: a chat that OWNS a project receives board→chat feedback (card outcomes / "needs you" ASKs); muting it
	// stops those posts. Only meaningful for an owning chat, so the toggle shows only when this chat owns a workspace.
	const ownsWorkspace = session.ownedWorkspaceId !== null && session.ownedWorkspaceId !== undefined;
	const handleFeedbackMuteToggle = (): void => {
		onUpdate({ id: session.id, feedbackMuted: !session.feedbackMuted });
	};

	const handleRiskToggle = (): void => {
		if (session.riskAcknowledged) {
			// Turning OFF is immediate — no confirmation needed.
			onUpdate({ id: session.id, riskAcknowledged: false });
		} else {
			// Turning ON requires an explicit confirmation dialog.
			setRiskDialogOpen(true);
		}
	};

	const handleRiskConfirm = (): void => {
		setRiskDialogOpen(false);
		onUpdate({ id: session.id, riskAcknowledged: true });
	};

	const handleRiskCancel = (): void => {
		setRiskDialogOpen(false);
	};

	return (
		<>
			<div className="border-b border-border px-4 py-2 bg-surface-1 flex flex-col gap-2 min-w-0">
				<input
					data-testid="chat-session-title"
					className="bg-transparent text-[14px] font-semibold text-text-primary focus:outline-none border-b border-transparent focus:border-border-focus w-full min-w-0"
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					onBlur={() =>
						title.trim() && title !== session.title && onUpdate({ id: session.id, title: title.trim() })
					}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.currentTarget.blur();
						}
					}}
				/>
				<div className="flex items-center gap-2 flex-wrap min-w-0">
					<NativeSelect
						size="sm"
						aria-label="Role"
						data-testid="chat-session-role"
						value={session.role}
						onChange={(event) => onUpdate({ id: session.id, role: event.target.value as RuntimeChatSessionRole })}
					>
						{ROLE_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</NativeSelect>
					<ElementTooltip id="chat.session-scope" side="bottom">
						<NativeSelect
							size="sm"
							aria-label="Scope"
							data-testid="chat-session-scope"
							value={session.scope}
							onChange={(event) =>
								onUpdate({ id: session.id, scope: event.target.value as RuntimeChatSessionScope })
							}
						>
							{SCOPE_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</NativeSelect>
					</ElementTooltip>
					<input
						data-testid="chat-session-goal"
						className="flex-1 min-w-0 h-7 rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus"
						placeholder="Session goal…"
						value={goal}
						onChange={(event) => setGoal(event.target.value)}
						onBlur={() =>
							goal !== (session.goal ?? "") && onUpdate({ id: session.id, goal: goal.trim() || null })
						}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.currentTarget.blur();
							}
						}}
					/>
				</div>
				{showRiskToggle ? (
					<div className="flex items-center gap-1.5 flex-wrap min-w-0">
						<button
							type="button"
							role="checkbox"
							aria-checked={session.riskAcknowledged}
							data-testid="chat-risk-ack-toggle"
							onClick={handleRiskToggle}
							className={cn(
								"flex items-center gap-1.5 text-[11px] rounded px-1.5 py-0.5 border transition-colors select-none cursor-pointer",
								session.riskAcknowledged
									? "border-status-orange text-status-orange bg-surface-2 hover:bg-surface-3"
									: "border-border text-text-tertiary bg-transparent hover:border-border-bright hover:text-text-secondary",
							)}
						>
							<span aria-hidden="true">⚠️</span>
							<span>{session.riskAcknowledged ? "Unsafe commands allowed" : "Allow unsafe commands"}</span>
						</button>
						<button
							type="button"
							role="checkbox"
							aria-checked={session.browserEnabled}
							data-testid="chat-browser-toggle"
							onClick={handleBrowserToggle}
							className={cn(
								"flex items-center gap-1.5 text-[11px] rounded px-1.5 py-0.5 border transition-colors select-none cursor-pointer",
								session.browserEnabled
									? "border-status-blue text-status-blue bg-surface-2 hover:bg-surface-3"
									: "border-border text-text-tertiary bg-transparent hover:border-border-bright hover:text-text-secondary",
							)}
						>
							<span aria-hidden="true">🌐</span>
							<span>{session.browserEnabled ? "Browser enabled" : "Enable browser"}</span>
						</button>
					</div>
				) : null}
				{ownsWorkspace ? (
					<button
						type="button"
						role="checkbox"
						aria-checked={session.feedbackMuted}
						data-testid="chat-feedback-mute-toggle"
						onClick={handleFeedbackMuteToggle}
						className={cn(
							"flex items-center gap-1.5 text-[11px] rounded px-1.5 py-0.5 border transition-colors select-none cursor-pointer self-start",
							session.feedbackMuted
								? "border-status-orange text-status-orange bg-surface-2 hover:bg-surface-3"
								: "border-border text-text-tertiary bg-transparent hover:border-border-bright hover:text-text-secondary",
						)}
					>
						<span aria-hidden="true">{session.feedbackMuted ? "🔕" : "🔔"}</span>
						<span>{session.feedbackMuted ? "Board updates muted" : "Mute board updates"}</span>
					</button>
				) : null}
				<div className="flex flex-wrap items-center gap-1.5" data-testid="chat-skill-selector">
					<span className="text-[11px] text-text-tertiary select-none">Skills:</span>
					{SKILL_OPTIONS.map((skill) => {
						const active = selectedSkillIds.includes(skill.id);
						return (
							<button
								key={skill.id}
								type="button"
								role="checkbox"
								aria-checked={active}
								data-testid={`chat-skill-${skill.id}`}
								onClick={() => handleSkillToggle(skill.id)}
								className={cn(
									"flex items-center gap-1.5 text-[11px] rounded px-1.5 py-0.5 border transition-colors select-none cursor-pointer",
									active
										? "border-status-blue text-status-blue bg-surface-2 hover:bg-surface-3"
										: "border-border text-text-tertiary bg-transparent hover:border-border-bright hover:text-text-secondary",
								)}
							>
								<span aria-hidden="true">{skill.icon}</span>
								<span>{skill.label}</span>
							</button>
						);
					})}
				</div>
			</div>
			<RiskAckConfirmDialog open={riskDialogOpen} onConfirm={handleRiskConfirm} onCancel={handleRiskCancel} />
		</>
	);
}

// ─── SessionRow ────────────────────────────────────────────────────────────────

function SessionRow({
	session,
	meta,
	selected,
	onSelect,
	onDelete,
}: {
	session: RuntimeChatSession;
	meta: SessionMeta;
	selected: boolean;
	onSelect: () => void;
	onDelete: () => void;
}): React.ReactElement {
	return (
		<div
			data-testid="chat-session-item"
			className={cn(
				"group flex items-start gap-2 px-2 py-2 rounded-md cursor-pointer text-[13px]",
				selected ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:bg-surface-2",
			)}
			onClick={onSelect}
		>
			<div className="flex-1 min-w-0 flex flex-col gap-0.5">
				{/* Title + role */}
				<div className="truncate font-medium leading-tight">{session.title}</div>
				<div className="text-[11px] text-text-tertiary truncate">{session.role.replace(/_/g, " ")}</div>
				{/* Metadata line: started timestamp + optional message count */}
				<div className="text-[10px] text-text-tertiary flex items-center gap-1.5 flex-wrap mt-0.5 leading-tight">
					<span className="truncate">Started {meta.startedLabel}</span>
					{meta.messageCount !== null && meta.messageCount > 0 ? (
						<>
							<span className="text-text-tertiary opacity-40">·</span>
							<span className="shrink-0">
								{meta.messageCount} msg{meta.messageCount !== 1 ? "s" : ""}
							</span>
						</>
					) : null}
					{meta.lastActivityLabel !== null ? (
						<>
							<span className="text-text-tertiary opacity-40">·</span>
							<span className="shrink-0 truncate">Last {meta.lastActivityLabel}</span>
						</>
					) : null}
					{meta.tokenLabel !== null ? (
						<>
							<span className="text-text-tertiary opacity-40">·</span>
							<span className="shrink-0 truncate">{meta.tokenLabel}</span>
						</>
					) : null}
				</div>
			</div>
			<ElementTooltip id="chat.delete-session" side="left">
				<button
					type="button"
					aria-label="Delete session"
					className="opacity-0 group-hover:opacity-100 p-1 rounded text-text-tertiary hover:text-status-red hover:bg-surface-3 shrink-0 mt-0.5"
					onClick={(event) => {
						event.stopPropagation();
						onDelete();
					}}
				>
					<Trash2 size={14} />
				</button>
			</ElementTooltip>
		</div>
	);
}

// ─── MessageBubble ─────────────────────────────────────────────────────────────

/**
 * W3.1: one main-chat transcript row rendered through the SHARED per-card renderer (`NKleinChatMessageItem`) —
 * markdown replies, collapsible tool/reasoning blocks (collapsed chips; the streaming block live-expands), and a
 * clickable "referenced cards" chip row under assistant replies. Board→chat bridge notes (`system`) keep the main
 * chat's slim centered line (they're frequent and read better as ambient ticks than boxed messages).
 */
function MessageBubble({
	message,
	boardCards = [],
	onOpenCard,
	durationMs = 0,
	timestampsCollapsed = true,
	onToggleTimestampsCollapsed = () => {},
}: {
	message: RuntimeChatMessage;
	boardCards?: readonly ChatCardCandidate[];
	onOpenCard?: (cardId: string) => void;
	durationMs?: number;
	timestampsCollapsed?: boolean;
	onToggleTimestampsCollapsed?: () => void;
}): React.ReactElement {
	if (message.role === "system") {
		return (
			<div data-testid="chat-message" data-role="system" className="text-[11px] text-text-tertiary italic px-2 py-1">
				{message.content}
			</div>
		);
	}
	const cardReferences: ChatMessageCardReferences | undefined =
		onOpenCard && boardCards.length > 0
			? {
					candidates: boardCards,
					onOpenCard,
					extractReferences: (content) =>
						segmentChatMessage(content, boardCards)
							.filter((segment): segment is Extract<typeof segment, { kind: "card" }> => segment.kind === "card")
							.map((segment) => ({ cardId: segment.cardId, label: segment.label })),
				}
			: undefined;
	return (
		<div data-testid="chat-message" data-role={message.role} className="min-w-0">
			<NKleinChatMessageItem
				message={message}
				durationMs={durationMs}
				timestampsCollapsed={timestampsCollapsed}
				onToggleTimestampsCollapsed={onToggleTimestampsCollapsed}
				{...(cardReferences ? { cardReferences } : {})}
			/>
		</div>
	);
}

/** §5.AU — human label for the sticky focus chip: resolve the card/stream title from the live board lists. */
function describeFocus(
	focus: { kind: "card" | "stream"; id: string },
	boardCards: readonly ChatCardCandidate[],
	boardStreams: readonly { id: string; title: string }[],
): string {
	if (focus.kind === "card") {
		const card = boardCards.find((candidate) => candidate.id === focus.id);
		return `card ${card?.title ?? focus.id}`;
	}
	const stream = boardStreams.find((candidate) => candidate.id === focus.id);
	return `#${stream?.title ?? focus.id}`;
}

/**
 * §5.BB — one board-activity tick interleaved in the transcript: a slim, centered system line ("Classify trends
 * → review · 12:03"). Clicking it opens the card in the main panel (same affordance as the message chips).
 */
function ActivityTickLine({
	tick,
	onOpenCard,
}: {
	tick: ActivityTick;
	onOpenCard?: (cardId: string) => void;
}): React.ReactElement {
	const time = new Date(tick.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	return (
		<div className="flex justify-center" data-testid="chat-activity-tick" data-kind={tick.kind}>
			<button
				type="button"
				onClick={onOpenCard ? () => onOpenCard(tick.cardId) : undefined}
				disabled={!onOpenCard}
				title="Open the card in the main panel"
				className={cn(
					"max-w-[92%] truncate rounded-full px-2.5 py-0.5 text-[11px] text-text-tertiary",
					onOpenCard ? "hover:bg-surface-2 hover:text-accent cursor-pointer" : "cursor-default",
				)}
			>
				◦ {tick.label} · {time}
			</button>
		</div>
	);
}

// ─── ChatPanel ─────────────────────────────────────────────────────────────────

/**
 * Board-independent chat surface (todo §5.M) — a dialog over the `chat` tRPC sub-router: a session list on the
 * left (create / select / delete), the selected session's transcript on the right, and a composer that sends a
 * turn to the local model. The reply streams in token-by-token over the SSE subscription (an optimistic user
 * bubble + a growing assistant bubble), then the persisted transcript replaces the placeholders. Styling follows
 * the design system (Tailwind tokens + UI primitives).
 */
function formatAutonomousStopReason(reason: RuntimeChatAutonomousStopReason | null): string {
	switch (reason) {
		case "completed":
			return "✓ Goal complete";
		case "paused_needs_user":
			return "⏸ Needs your input";
		case "budget_turns_exhausted":
			return "Turn budget reached";
		case "budget_wall_time_exhausted":
			return "Time budget reached";
		case "stalled_no_progress":
			return "Stopped — no progress";
		default:
			return "Stopped";
	}
}

/**
 * The "work autonomously" control (todo §5.0.1): a goal field + Start that kicks off a background autonomous run on the
 * selected session, plus a compact live status line (working / step progress, or the final stop reason). The run's
 * turns stream into the transcript above as the hook polls.
 */
function AutonomousRunBar({
	status,
	disabled,
	onStart,
}: {
	status: RuntimeChatAutonomousRunStatus | null;
	disabled: boolean;
	onStart: (goal: string) => void;
}): React.ReactElement {
	const [goal, setGoal] = useState("");
	const running = status?.running ?? false;
	const steps =
		status && status.planProgress.total > 0
			? ` · ${status.planProgress.done}/${status.planProgress.total} steps`
			: "";
	const start = (): void => {
		const trimmed = goal.trim();
		if (trimmed && !running) {
			onStart(trimmed);
		}
	};
	return (
		<div className="border-t border-border px-3 py-2 bg-surface-2 shrink-0 min-w-0 flex flex-col gap-1.5">
			<div className="flex items-center gap-2 min-w-0">
				<input
					data-testid="chat-autonomous-goal"
					className="flex-1 min-w-0 rounded-md border border-border bg-surface-1 px-2 py-1 text-[12px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus disabled:opacity-50"
					placeholder="Goal for autonomous work…"
					value={goal}
					onChange={(event) => setGoal(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							start();
						}
					}}
					disabled={disabled || running}
				/>
				<Button
					type="button"
					size="sm"
					icon={<Bot size={14} />}
					data-testid="chat-autonomous-start"
					onClick={start}
					disabled={disabled || running || goal.trim().length === 0}
				>
					{running ? "Working…" : "Auto"}
				</Button>
			</div>
			{status && (running || status.stopReason || status.finalText) ? (
				<div data-testid="chat-autonomous-status" className="text-[11px] text-text-secondary truncate">
					{running
						? `Working autonomously${steps}…`
						: `${formatAutonomousStopReason(status.stopReason)} · ${status.turns} turn${status.turns === 1 ? "" : "s"}${steps}`}
				</div>
			) : null}
		</div>
	);
}

function ChatPanel({
	enabled,
	onCollapse,
	boardCards = [],
	onOpenCard,
	activityTicks = [],
	boardStreams = [],
}: {
	enabled: boolean;
	onCollapse: () => void;
	boardCards?: readonly ChatCardCandidate[];
	onOpenCard?: (cardId: string) => void;
	/** §5.BB: live board-activity ticks interleaved into the transcript (chronological with the messages). */
	activityTicks?: readonly ActivityTick[];
	/** §5.BB: plan streams (id + display title) offered by the composer's @-mention popover. */
	boardStreams?: readonly { id: string; title: string }[];
}): React.ReactElement {
	const chat = useChatData(enabled);
	const [draft, setDraft] = useState("");
	// W3.1: per-message timestamp affordance — the SAME persisted preference as the per-card panel (one key,
	// both surfaces), so collapsing it in one place collapses it everywhere.
	const [timestampsCollapsed, setTimestampsCollapsed] = useState(
		() => readLocalStorageItem(LocalStorageKey.NKleinChatTimestampsCollapsed) === "true",
	);
	const toggleTimestampsCollapsed = (): void => {
		setTimestampsCollapsed((current) => {
			const next = !current;
			writeLocalStorageItem(LocalStorageKey.NKleinChatTimestampsCollapsed, String(next));
			return next;
		});
	};
	// §5.BB @-mention popover state: the token being typed (null = closed) + the highlighted row.
	const [mention, setMention] = useState<ActiveMention | null>(null);
	const [mentionIndex, setMentionIndex] = useState(0);
	const composerRef = useRef<HTMLTextAreaElement | null>(null);
	const transcriptEndRef = useRef<HTMLDivElement | null>(null);
	const transcriptContainerRef = useRef<HTMLDivElement | null>(null);
	const selectedSession = chat.sessions.find((session) => session.id === chat.selectedSessionId) ?? null;

	// §5.BB intuitive scrolling: follow live output only while the user is at the bottom — scrolling up detaches
	// (progress/details stay put at the reader's pace); the "↓ Follow" pill (or scrolling back down) re-attaches.
	// Use the NEWEST tick's timestamp (monotonic, always the last element) rather than the array length for the tick
	// term: once the feed saturates at its 60 cap the length stops changing, so a length-based version would stop
	// registering fresh ticks — the timestamp keeps growing per arrival, so the Follow pill / auto-scroll still fire.
	const latestTickAt = activityTicks.length > 0 ? (activityTicks[activityTicks.length - 1]?.at ?? 0) : 0;
	const sticky = useStickyTranscript({
		containerRef: transcriptContainerRef,
		contentVersion: chat.transcript.length * 100_000 + latestTickAt + (chat.streamingText?.length ?? 0),
		resetKey: chat.selectedSessionId,
	});

	// Interleave persisted messages and activity ticks chronologically (both carry epoch-ms timestamps). Messages
	// win ties so a reply never renders below a same-instant tick.
	const timelineItems: Array<{ at: number; message?: RuntimeChatMessage; tick?: ActivityTick }> = [
		...chat.transcript.map((message) => ({ at: message.createdAt, message })),
		...activityTicks.map((tick) => ({ at: tick.at, tick })),
	];
	timelineItems.sort((left, right) => left.at - right.at || (left.message ? -1 : 1));
	// W3.1 per-message duration (the timestamp tooltip's "took Xs"): the gap to the NEXT persisted message.
	const durationByMessageId = new Map<string, number>();
	for (let index = 0; index < chat.transcript.length; index += 1) {
		const current = chat.transcript[index];
		const next = chat.transcript[index + 1];
		if (current) {
			durationByMessageId.set(current.id, Math.max(0, (next?.createdAt ?? Date.now()) - current.createdAt));
		}
	}

	// §5.BB @-mentions: cards + streams the popover offers, filtered by what's typed after the "@".
	const mentionCandidates: MentionCandidate[] = [
		...boardCards.map((card) => ({ kind: "card" as const, id: card.id, title: card.title })),
		...boardStreams.map((stream) => ({ kind: "stream" as const, id: stream.id, title: stream.title })),
	];
	const mentionMatches = mention ? filterMentionCandidates(mention.query, mentionCandidates) : [];

	const refreshMention = (value: string, caret: number): void => {
		const active = getActiveMention(value, caret);
		setMention((current) => {
			if (current?.start !== active?.start) {
				setMentionIndex(0);
			}
			return active;
		});
	};

	const acceptMention = (candidate: MentionCandidate): void => {
		if (!mention) {
			return;
		}
		const caret = composerRef.current?.selectionStart ?? draft.length;
		const applied = applyMention(draft, mention, caret, candidate);
		setDraft(applied.next);
		setMention(null);
		requestAnimationFrame(() => {
			composerRef.current?.focus();
			composerRef.current?.setSelectionRange(applied.caret, applied.caret);
		});
	};

	const handleSubmit = (event: FormEvent): void => {
		event.preventDefault();
		if (chat.sending || !chat.selectedSessionId) {
			return;
		}
		const message = draft;
		setDraft("");
		setMention(null);
		void chat.sendMessage(message);
	};

	// §5.AU click-to-focus: clicking a stream in the overview appends its explicit `@stream:<id>` handle to the composer
	// draft (the resolver's rung-1 syntax), so the next message addresses that stream — the same handle the @-mention
	// popover inserts, just reached by click. Appended at the end with a separating space; the user then types + sends.
	const selectStream = (streamId: string): void => {
		setDraft((prev) => {
			const separator = prev.length === 0 || /\s$/.test(prev) ? "" : " ";
			return `${prev}${separator}@stream:${streamId} `;
		});
		requestAnimationFrame(() => composerRef.current?.focus());
	};

	// §5.AU item 9 — the needs_clarify picker: the user picks one of the ambiguous candidates; insert its explicit handle
	// (`@card:`/`@stream:` — an `answer` candidate is a card) into the draft so the re-send resolves unambiguously.
	const selectClarifyCandidate = (candidate: { kind: "card" | "stream" | "answer"; id: string }): void => {
		const prefix = candidate.kind === "stream" ? "@stream:" : "@card:";
		setDraft((prev) => {
			const separator = prev.length === 0 || /\s$/.test(prev) ? "" : " ";
			return `${prev}${separator}${prefix}${candidate.id} `;
		});
		chat.dismissClarify();
		requestAnimationFrame(() => composerRef.current?.focus());
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		// While the @-mention popover is open it owns the keyboard: arrows move, Enter/Tab pick, Esc closes.
		if (mention && mentionMatches.length > 0) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const step = event.key === "ArrowDown" ? 1 : -1;
				setMentionIndex((index) => (index + step + mentionMatches.length) % mentionMatches.length);
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				const picked = mentionMatches[Math.min(mentionIndex, mentionMatches.length - 1)];
				if (picked) {
					acceptMention(picked);
				}
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				setMention(null);
				return;
			}
		}
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			handleSubmit(event);
		}
	};

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col bg-surface-1 overflow-hidden">
			{/* Top bar */}
			<div className="flex items-center justify-between px-3 py-2 bg-surface-2 border-b border-border shrink-0 min-w-0">
				<div className="flex items-center gap-2 text-sm font-semibold text-text-primary min-w-0">
					<MessageSquare size={16} className="text-text-secondary shrink-0" />
					<span className="truncate">Chat</span>
				</div>
				<button
					type="button"
					aria-label="Collapse chat"
					title="Collapse chat"
					data-testid="chat-collapse-button"
					onClick={onCollapse}
					className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-3 shrink-0"
				>
					<PanelRightClose size={16} />
				</button>
			</div>

			{/* Body: session list + transcript */}
			<div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
				{/* Session list — responsive width: proportional to sidebar, bounded [160, 220] px */}
				<aside className="w-[38%] min-w-[160px] max-w-[220px] shrink-0 border-r border-border flex flex-col bg-surface-1 overflow-hidden">
					<div className="p-2 border-b border-border shrink-0">
						<Button
							size="sm"
							variant="default"
							fill
							icon={<MessageSquarePlus size={14} />}
							data-testid="chat-new-session"
							onClick={() => void chat.createSession({ title: "New chat" })}
						>
							New chat
						</Button>
					</div>
					<div className="flex-1 min-h-0 min-w-0 overflow-y-auto p-1">
						{chat.sessionsLoading && chat.sessions.length === 0 ? (
							<div className="flex justify-center p-4">
								<Spinner size={16} />
							</div>
						) : chat.sessions.length === 0 ? (
							<div className="text-[12px] text-text-tertiary text-center p-4">No chats yet.</div>
						) : (
							chat.sessions.map((session) => {
								const isSelected = session.id === chat.selectedSessionId;
								const meta = buildSessionMeta(session, isSelected ? chat.transcript : null);
								return (
									<SessionRow
										key={session.id}
										session={session}
										meta={meta}
										selected={isSelected}
										onSelect={() => chat.selectSession(session.id)}
										onDelete={() => void chat.deleteSession(session.id)}
									/>
								);
							})
						)}
					</div>
				</aside>

				{/* Transcript + composer */}
				<section className="flex-1 min-w-0 flex flex-col bg-surface-0 overflow-hidden">
					{chat.selectedSessionId === null ? (
						<div className="flex-1 flex items-center justify-center text-[13px] text-text-tertiary p-4 text-center">
							Select a chat or start a new one.
						</div>
					) : (
						<>
							{selectedSession ? (
								<SessionHeader
									key={selectedSession.id}
									session={selectedSession}
									onUpdate={chat.updateSession}
								/>
							) : null}
							<div
								ref={transcriptContainerRef}
								onScroll={sticky.handleScroll}
								className="flex-1 min-h-0 min-w-0 overflow-y-auto p-4 flex flex-col gap-3"
								data-testid="chat-transcript"
							>
								{timelineItems.map((item) =>
									item.message ? (
										<MessageBubble
											key={item.message.id}
											message={item.message}
											boardCards={boardCards}
											onOpenCard={onOpenCard}
											durationMs={durationByMessageId.get(item.message.id) ?? 0}
											timestampsCollapsed={timestampsCollapsed}
											onToggleTimestampsCollapsed={toggleTimestampsCollapsed}
										/>
									) : item.tick ? (
										<ActivityTickLine key={item.tick.id} tick={item.tick} onOpenCard={onOpenCard} />
									) : null,
								)}
								{/* Optimistic user bubble while the turn is in flight (before the transcript catches up). */}
								{chat.pendingUserText !== null ? (
									<MessageBubble
										message={{
											id: "pending-user",
											role: "user",
											content: chat.pendingUserText,
											createdAt: 0,
										}}
									/>
								) : null}
								{/* W3.1 live tool activity: what the agent is doing RIGHT NOW, while the turn runs. */}
								{chat.activeToolNames.length > 0 ? (
									<div className="flex flex-wrap items-center gap-1.5" data-testid="chat-active-tools">
										{chat.activeToolNames.map((toolName, index) => (
											<span
												key={`${toolName}-${index}`}
												className="inline-flex items-center gap-1.5 rounded-full border border-accent-2/35 bg-accent-2/10 px-2 py-0.5 text-[11px] text-accent-2"
											>
												<Spinner size={11} />
												{toolName}
											</span>
										))}
									</div>
								) : null}
								{/* The assistant reply as it streams; show a spinner until the first token lands. */}
								{chat.streamingText !== null ? (
									chat.streamingText.length === 0 && chat.activeToolNames.length === 0 ? (
										<div
											className="flex items-center gap-2 text-[12px] text-text-tertiary"
											data-testid="chat-streaming"
										>
											<Spinner size={14} /> Thinking…
										</div>
									) : chat.streamingText.length > 0 ? (
										<MessageBubble
											message={{
												id: "streaming",
												role: "assistant",
												content: chat.streamingText,
												createdAt: 0,
											}}
											boardCards={boardCards}
											onOpenCard={onOpenCard}
										/>
									) : null
								) : null}
								<div ref={transcriptEndRef} />
							</div>
							{!sticky.following ? (
								<div className="pointer-events-none relative">
									<button
										type="button"
										data-testid="chat-follow-pill"
										onClick={sticky.follow}
										className="pointer-events-auto absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-accent/40 bg-surface-1/95 px-3 py-1 text-[11.5px] text-accent shadow-lg hover:bg-surface-2"
									>
										↓ {sticky.newCount > 0 ? `${sticky.newCount} new · ` : ""}Follow
									</button>
								</div>
							) : null}
							<AutonomousRunBar
								status={chat.autonomousStatus}
								disabled={!chat.selectedSessionId}
								onStart={(goal) => void chat.startAutonomousRun(goal)}
							/>
							{/* §5.AU stream-overview surface: the owning project's epics at a glance (health · progress · running). */}
							<StreamOverviewPanel
								enabled={enabled && Boolean(selectedSession?.ownedWorkspaceId)}
								onSelectStream={selectStream}
							/>
							{/* §5.AU sticky-focus chip: who the next message addresses (set by an explicit @handle); ✕ = back to Goal. */}
							{selectedSession?.focus ? (
								<div
									data-testid="chat-focus-chip"
									className="flex items-center gap-1.5 border-t border-border bg-surface-1 px-3 py-1.5 text-[11.5px] text-text-secondary shrink-0"
								>
									<span className="text-text-tertiary">talking to</span>
									<span
										className={cn(
											"font-medium",
											selectedSession.focus.kind === "card" ? "text-accent" : "text-accent-2",
										)}
									>
										{describeFocus(selectedSession.focus, boardCards, boardStreams)}
									</span>
									<button
										type="button"
										aria-label="Clear focus (back to Goal)"
										title="Clear focus (back to Goal)"
										data-testid="chat-focus-clear"
										onClick={() => void chat.updateSession({ id: selectedSession.id, clearFocus: true })}
										className="ml-auto rounded px-1 text-text-tertiary hover:bg-surface-3 hover:text-text-primary"
									>
										✕
									</button>
								</div>
							) : null}
							{/* §5.AU item 9 needs_clarify picker: the message addressed >1 target; pick one (inserts its @handle). */}
							{chat.clarifyCandidates && chat.clarifyCandidates.length > 0 ? (
								<div
									data-testid="chat-clarify-picker"
									className="flex flex-col gap-1.5 border-t border-border bg-surface-1 px-3 py-2 shrink-0"
								>
									<div className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
										<span>Which did you mean?</span>
										<button
											type="button"
											aria-label="Dismiss"
											data-testid="chat-clarify-dismiss"
											onClick={() => chat.dismissClarify()}
											className="ml-auto rounded px-1 hover:bg-surface-3 hover:text-text-primary"
										>
											✕
										</button>
									</div>
									<div className="flex flex-wrap gap-1.5">
										{chat.clarifyCandidates.map((candidate) => (
											<button
												type="button"
												key={`${candidate.kind}:${candidate.id}`}
												data-testid={`chat-clarify-candidate-${candidate.id}`}
												onClick={() => selectClarifyCandidate(candidate)}
												className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11.5px] text-text-primary hover:border-border-bright hover:bg-surface-3"
											>
												{candidate.label}
											</button>
										))}
									</div>
								</div>
							) : null}
							<form
								onSubmit={handleSubmit}
								className="relative border-t border-border p-3 flex items-end gap-2 bg-surface-1 shrink-0 min-w-0"
							>
								{mention && mentionMatches.length > 0 ? (
									<div
										data-testid="chat-mention-popover"
										className="absolute bottom-full left-3 right-3 mb-1 overflow-hidden rounded-md border border-border bg-surface-1 shadow-lg"
									>
										{mentionMatches.map((candidate, index) => (
											<button
												key={`${candidate.kind}:${candidate.id}`}
												type="button"
												data-testid="chat-mention-option"
												onMouseDown={(event) => {
													// mousedown (not click) so the textarea never loses focus first
													event.preventDefault();
													acceptMention(candidate);
												}}
												onMouseEnter={() => setMentionIndex(index)}
												className={cn(
													"flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]",
													index === mentionIndex
														? "bg-surface-2 text-text-primary"
														: "text-text-secondary",
												)}
											>
												<span
													className={cn(
														"shrink-0 text-[10px] font-semibold uppercase",
														candidate.kind === "card" ? "text-accent" : "text-accent-2",
													)}
												>
													{candidate.kind === "card" ? "card" : "#"}
												</span>
												<span className="truncate">{candidate.title}</span>
												<span className="ml-auto shrink-0 truncate text-[10.5px] text-text-tertiary">
													{candidate.id}
												</span>
											</button>
										))}
									</div>
								) : null}
								<textarea
									ref={composerRef}
									data-testid="chat-composer-input"
									className="flex-1 min-w-0 resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus min-h-[40px] max-h-32"
									rows={1}
									placeholder="Message the local model… (@ targets a card or stream)"
									value={draft}
									onChange={(event) => {
										setDraft(event.target.value);
										refreshMention(
											event.target.value,
											event.target.selectionStart ?? event.target.value.length,
										);
									}}
									onSelect={(event) => {
										const target = event.currentTarget;
										refreshMention(target.value, target.selectionStart ?? target.value.length);
									}}
									onKeyDown={handleKeyDown}
								/>
								<Button
									type="submit"
									variant="primary"
									size="md"
									icon={<Send size={14} />}
									data-testid="chat-send-button"
									disabled={chat.sending || draft.trim().length === 0}
								>
									Send
								</Button>
							</form>
						</>
					)}
				</section>
			</div>

			{chat.capabilityNotice ? (
				<div
					className="px-3 py-2 text-[12px] text-status-amber border-t border-border bg-surface-1 shrink-0"
					data-testid="chat-capability-notice"
				>
					⚠️ {chat.capabilityNotice}
				</div>
			) : null}

			{chat.error ? (
				<div
					className="px-3 py-2 text-[12px] text-status-red border-t border-border bg-surface-1 shrink-0"
					data-testid="chat-error"
				>
					{chat.error}
				</div>
			) : null}
		</div>
	);
}

// ─── ChatSidebar ───────────────────────────────────────────────────────────────

/**
 * The board-independent chat as a **resizeable right sidebar** (todo §5.M) — a VS-Code-coding-agent-style rail.
 * Collapsed by default to a thin bar (expand button); when open it shows the full chat and can be dragged wider via
 * the handle on its left edge. Width + collapsed state persist (`useChatSidebarLayout`). Replaces the old modal.
 */
export function ChatSidebar({
	boardCards,
	onOpenCard,
	activityTicks,
	boardStreams,
}: {
	/** §5.BB: current board cards (id + title) so assistant messages render openable card chips. */
	boardCards?: readonly ChatCardCandidate[];
	/** Opens a referenced card in the MAIN PANEL (the chat is the steering wheel, the panel shows the detail). */
	onOpenCard?: (cardId: string) => void;
	/** §5.BB: live board-activity ticks to interleave into the transcript. */
	activityTicks?: readonly ActivityTick[];
	/** §5.BB: plan streams offered by the composer's @-mention popover. */
	boardStreams?: readonly { id: string; title: string }[];
} = {}): React.ReactElement {
	const { width, isCollapsed, setWidth, setCollapsed } = useChatSidebarLayout();
	const { startDrag } = useResizeDrag();

	if (isCollapsed) {
		return (
			<div className="flex h-full w-10 shrink-0 flex-col items-center border-l border-border bg-surface-1 py-2">
				<button
					type="button"
					aria-label="Open chat"
					title="Open chat"
					data-testid="open-chat-button"
					onClick={() => setCollapsed(false)}
					className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-3"
				>
					<MessageSquare size={18} />
				</button>
			</div>
		);
	}

	return (
		<aside className="flex h-full min-h-0 shrink-0 overflow-hidden" style={{ width }} data-testid="chat-sidebar">
			<ResizeHandle
				orientation="vertical"
				ariaLabel="Resize chat sidebar"
				onMouseDown={(event) =>
					startDrag(event, {
						axis: "x",
						cursor: "ew-resize",
						onMove: (pointerX) =>
							setWidth(
								clampBetween(
									window.innerWidth - pointerX,
									CHAT_SIDEBAR_WIDTH_BOUNDS.min,
									CHAT_SIDEBAR_WIDTH_BOUNDS.max,
								),
							),
					})
				}
			/>
			<div className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
				<ChatPanel
					enabled
					onCollapse={() => setCollapsed(true)}
					boardCards={boardCards}
					onOpenCard={onOpenCard}
					activityTicks={activityTicks}
					boardStreams={boardStreams}
				/>
			</div>
		</aside>
	);
}
