import { MessageSquarePlus, Send, Trash2 } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { ElementTooltip } from "@/components/ui/element-tooltip";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
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

const SCOPE_OPTIONS: ReadonlyArray<{ value: RuntimeChatSessionScope; label: string }> = [
	{ value: "project_sandboxed", label: "Project (sandboxed)" },
	{ value: "all_projects", label: "All projects" },
	{ value: "host_access", label: "Host access" },
];

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
	}) => void;
}): React.ReactElement {
	const [title, setTitle] = useState(session.title);
	const [goal, setGoal] = useState(session.goal ?? "");

	return (
		<div className="border-b border-border px-4 py-2 bg-surface-1 flex flex-col gap-2">
			<input
				data-testid="chat-session-title"
				className="bg-transparent text-[14px] font-semibold text-text-primary focus:outline-none border-b border-transparent focus:border-border-focus"
				value={title}
				onChange={(event) => setTitle(event.target.value)}
				onBlur={() => title.trim() && title !== session.title && onUpdate({ id: session.id, title: title.trim() })}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.currentTarget.blur();
					}
				}}
			/>
			<div className="flex items-center gap-2 flex-wrap">
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
				<NativeSelect
					size="sm"
					aria-label="Scope"
					data-testid="chat-session-scope"
					value={session.scope}
					onChange={(event) => onUpdate({ id: session.id, scope: event.target.value as RuntimeChatSessionScope })}
				>
					{SCOPE_OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</NativeSelect>
				<input
					data-testid="chat-session-goal"
					className="flex-1 min-w-40 h-7 rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus"
					placeholder="Session goal (kept in focus across turns)…"
					value={goal}
					onChange={(event) => setGoal(event.target.value)}
					onBlur={() => goal !== (session.goal ?? "") && onUpdate({ id: session.id, goal: goal.trim() || null })}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.currentTarget.blur();
						}
					}}
				/>
			</div>
		</div>
	);
}

/**
 * Board-independent chat surface (todo §5.M) — a dialog over the `chat` tRPC sub-router: a session list on the
 * left (create / select / delete), the selected session's transcript on the right, and a composer that sends a
 * turn to the local model. The reply streams in token-by-token over the SSE subscription (an optimistic user
 * bubble + a growing assistant bubble), then the persisted transcript replaces the placeholders. Styling follows
 * the design system (Tailwind tokens + UI primitives).
 */

function SessionRow({
	session,
	selected,
	onSelect,
	onDelete,
}: {
	session: RuntimeChatSession;
	selected: boolean;
	onSelect: () => void;
	onDelete: () => void;
}): React.ReactElement {
	return (
		<div
			data-testid="chat-session-item"
			className={cn(
				"group flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer text-[13px]",
				selected ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:bg-surface-2",
			)}
			onClick={onSelect}
		>
			<div className="flex-1 min-w-0">
				<div className="truncate">{session.title}</div>
				<div className="text-[11px] text-text-tertiary truncate">{session.role.replace(/_/g, " ")}</div>
			</div>
			<ElementTooltip id="chat.delete-session" side="left">
				<button
					type="button"
					aria-label="Delete session"
					className="opacity-0 group-hover:opacity-100 p-1 rounded text-text-tertiary hover:text-status-red hover:bg-surface-3"
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
			className={cn("flex", isUser ? "justify-end" : "justify-start")}
		>
			<div
				className={cn(
					"max-w-[80%] rounded-lg px-3 py-2 text-[13px] whitespace-pre-wrap break-words",
					isUser ? "bg-accent text-white" : "bg-surface-2 text-text-primary border border-border",
				)}
			>
				{message.content}
			</div>
		</div>
	);
}

export function ChatDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}): React.ReactElement {
	const chat = useChatData(open);
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
		<Dialog open={open} onOpenChange={onOpenChange} contentClassName="max-w-6xl h-[80vh]">
			<DialogHeader title="Chat" icon={<MessageSquarePlus size={16} />} />
			<div className="flex flex-1 min-h-0">
				{/* Session list */}
				<aside className="w-60 shrink-0 border-r border-border flex flex-col bg-surface-1">
					<div className="p-2 border-b border-border">
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
					<div className="flex-1 min-h-0 overflow-y-auto p-1">
						{chat.sessionsLoading && chat.sessions.length === 0 ? (
							<div className="flex justify-center p-4">
								<Spinner size={16} />
							</div>
						) : chat.sessions.length === 0 ? (
							<div className="text-[12px] text-text-tertiary text-center p-4">No chats yet.</div>
						) : (
							chat.sessions.map((session) => (
								<SessionRow
									key={session.id}
									session={session}
									selected={session.id === chat.selectedSessionId}
									onSelect={() => chat.selectSession(session.id)}
									onDelete={() => void chat.deleteSession(session.id)}
								/>
							))
						)}
					</div>
				</aside>

				{/* Transcript + composer */}
				<section className="flex-1 min-w-0 flex flex-col bg-surface-0">
					{chat.selectedSessionId === null ? (
						<div className="flex-1 flex items-center justify-center text-[13px] text-text-tertiary">
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
								className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3"
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
								className="border-t border-border p-3 flex items-end gap-2 bg-surface-1"
							>
								<textarea
									data-testid="chat-composer-input"
									className="flex-1 resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus min-h-[40px] max-h-32"
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
					className="px-3 py-2 text-[12px] text-status-red border-t border-border bg-surface-1"
					data-testid="chat-error"
				>
					{chat.error}
				</div>
			) : null}
		</Dialog>
	);
}
