import { MessageSquare, MessageSquarePlus, PanelRightClose, Send, Trash2 } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
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
import { ResizeHandle } from "@/resize/resize-handle";
import { clampBetween } from "@/resize/resize-persistence";
import { CHAT_SIDEBAR_WIDTH_BOUNDS, useChatSidebarLayout } from "@/resize/use-chat-sidebar-layout";
import { useResizeDrag } from "@/resize/use-resize-drag";
import type {
	RuntimeChatMessage,
	RuntimeChatSession,
	RuntimeChatSessionRole,
	RuntimeChatSessionScope,
} from "@/runtime/types";
import { useChatData } from "./use-chat-data";

const ROLE_OPTIONS: ReadonlyArray<{ value: RuntimeChatSessionRole; label: string }> = [
	{ value: "planner_architect", label: "Planner / architect" },
	{ value: "reviewer", label: "Reviewer" },
	{ value: "debugger", label: "Debugger" },
	{ value: "researcher", label: "Researcher" },
	{ value: "system_operator", label: "System operator" },
];

// TODO(§5.M): The `host_access` option should be gated behind a global "allow host access" setting
// (not yet in runtimeConfigSchema) and ideally require a typed confirmation — it gives the agent
// full host filesystem + command access beyond any sandbox. For now it is shown unconditionally with
// a ⚠️ label to signal its power. Add the gate once the global toggle lands in the runtime config.
const SCOPE_OPTIONS: ReadonlyArray<{ value: RuntimeChatSessionScope; label: string }> = [
	{ value: "chat_only", label: "Chat only" },
	{ value: "project_sandboxed", label: "Current" },
	{ value: "all_projects", label: "All" },
	{ value: "host_access", label: "⚠️ Host" },
];

/** Scopes where the agent can run commands (not read-only). The risk toggle is only relevant here. */
const CAN_ACT_SCOPES = new Set<RuntimeChatSessionScope>(["project_sandboxed", "all_projects", "host_access"]);

// ─── Session metadata helpers ──────────────────────────────────────────────────

/**
 * Metadata derived from a chat session (and optionally from its loaded transcript) for display in
 * the session list. Token count is not available in the contract and is omitted rather than
 * estimated — it will be added once the backend exposes per-session usage totals.
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

	return { startedLabel, lastActivityLabel, messageCount };
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
	}) => void;
}): React.ReactElement {
	const [title, setTitle] = useState(session.title);
	const [goal, setGoal] = useState(session.goal ?? "");
	const [riskDialogOpen, setRiskDialogOpen] = useState(false);

	const showRiskToggle = CAN_ACT_SCOPES.has(session.scope);

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
					<div className="flex items-center gap-1.5 min-w-0">
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
					</div>
				) : null}
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

function MessageBubble({ message }: { message: RuntimeChatMessage }): React.ReactElement {
	if (message.role === "system") {
		return (
			<div data-testid="chat-message" data-role="system" className="text-[11px] text-text-tertiary italic px-2 py-1">
				{message.content}
			</div>
		);
	}
	const isUser = message.role === "user";
	return (
		<div
			data-testid="chat-message"
			data-role={message.role}
			className={cn("flex min-w-0", isUser ? "justify-end" : "justify-start")}
		>
			<div
				className={cn(
					"max-w-[80%] min-w-0 rounded-lg px-3 py-2 text-[13px] whitespace-pre-wrap break-words",
					isUser ? "bg-accent text-white" : "bg-surface-2 text-text-primary border border-border",
				)}
			>
				{message.content}
			</div>
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
function ChatPanel({ enabled, onCollapse }: { enabled: boolean; onCollapse: () => void }): React.ReactElement {
	const chat = useChatData(enabled);
	const [draft, setDraft] = useState("");
	const transcriptEndRef = useRef<HTMLDivElement | null>(null);
	const selectedSession = chat.sessions.find((session) => session.id === chat.selectedSessionId) ?? null;

	// Keep the latest message in view as the transcript grows and as the reply streams in.
	useEffect(() => {
		transcriptEndRef.current?.scrollIntoView({ block: "end" });
	}, [chat.transcript, chat.streamingText]);

	const handleSubmit = (event: FormEvent): void => {
		event.preventDefault();
		if (chat.sending || !chat.selectedSessionId) {
			return;
		}
		const message = draft;
		setDraft("");
		void chat.sendMessage(message);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
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
								className="flex-1 min-h-0 min-w-0 overflow-y-auto p-4 flex flex-col gap-3"
								data-testid="chat-transcript"
							>
								{chat.transcript.map((message) => (
									<MessageBubble key={message.id} message={message} />
								))}
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
								{/* The assistant reply as it streams; show a spinner until the first token lands. */}
								{chat.streamingText !== null ? (
									chat.streamingText.length === 0 ? (
										<div
											className="flex items-center gap-2 text-[12px] text-text-tertiary"
											data-testid="chat-streaming"
										>
											<Spinner size={14} /> Thinking…
										</div>
									) : (
										<MessageBubble
											message={{
												id: "streaming",
												role: "assistant",
												content: chat.streamingText,
												createdAt: 0,
											}}
										/>
									)
								) : null}
								<div ref={transcriptEndRef} />
							</div>
							<form
								onSubmit={handleSubmit}
								className="border-t border-border p-3 flex items-end gap-2 bg-surface-1 shrink-0 min-w-0"
							>
								<textarea
									data-testid="chat-composer-input"
									className="flex-1 min-w-0 resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus min-h-[40px] max-h-32"
									rows={1}
									placeholder="Message the local model…"
									value={draft}
									onChange={(event) => setDraft(event.target.value)}
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
export function ChatSidebar(): React.ReactElement {
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
				<ChatPanel enabled onCollapse={() => setCollapsed(true)} />
			</div>
		</aside>
	);
}
