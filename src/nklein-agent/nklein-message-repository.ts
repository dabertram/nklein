// Stores the !Klein-side view of native NKlein chat state.
// It combines live in-memory updates with hydration from persisted SDK
// session artifacts so the rest of the backend can read one repository shape.
import type { RuntimeTaskImage, RuntimeTaskSessionSummary, RuntimeTaskTurnCheckpoint } from "../core/api-contract";
import type { NKleinPersistedTaskSessionSnapshot } from "./nklein-session-runtime";
import {
	cloneMessage,
	cloneSummary,
	createDefaultSummary,
	createMessage,
	createMessageWithMeta,
	finishToolCallMessage,
	type NKleinTaskMessage,
	type NKleinTaskSessionEntry,
	startToolCallMessage,
	updateSummary,
} from "./nklein-session-state";
import type { NKleinSdkPersistedMessage } from "./sdk-runtime-boundary";

/** P0.HEAP: what the repository currently holds, for the process-memory observation's retention gauges. */
export interface NKleinMessageRepositoryFootprint {
	/** Task entries held (live + settled, released transcripts included). */
	taskEntries: number;
	/** Entries whose transcript mirror was evicted by the retention budget (summary kept). */
	releasedTranscripts: number;
	/** Persisted transcripts hydrated for readers and cached (bounded LRU). */
	hydratedTranscripts: number;
	/** Messages held across every entry and hydrated cache. */
	transcriptMessages: number;
	/** UTF-16 code units of message content held (≈ 2 bytes each on the heap). */
	transcriptChars: number;
}

export interface NKleinMessageRepository {
	onSummary(listener: (summary: RuntimeTaskSessionSummary) => void): () => void;
	onMessage(listener: (taskId: string, message: NKleinTaskMessage) => void): () => void;
	setTaskEntry(taskId: string, entry: NKleinTaskSessionEntry): void;
	clearHydratedTaskMessages(taskId: string): void;
	/** P0.HEAP: drop EVERYTHING held for the task — entry, summary and hydrated cache. The persisted session remains. */
	forgetTask(taskId: string): void;
	getTaskEntry(taskId: string): NKleinTaskSessionEntry | null;
	getSummary(taskId: string): RuntimeTaskSessionSummary | null;
	listSummaries(): RuntimeTaskSessionSummary[];
	listMessages(taskId: string): NKleinTaskMessage[];
	hydrateTaskMessages(
		taskId: string,
		loadPersistedSession: () => Promise<NKleinPersistedTaskSessionSnapshot | null>,
	): Promise<NKleinTaskMessage[]>;
	emitSummary(summary: RuntimeTaskSessionSummary): void;
	emitMessage(taskId: string, message: NKleinTaskMessage): void;
	applyTurnCheckpoint(taskId: string, checkpoint: RuntimeTaskTurnCheckpoint): RuntimeTaskSessionSummary | null;
	getFootprint(): NKleinMessageRepositoryFootprint;
	dispose(): void;
}

export interface InMemoryNKleinMessageRepositoryOptions {
	/**
	 * How many SETTLED entries (failed / interrupted / idle sessions that are not in review and can only be re-driven
	 * from scratch) keep their transcript mirror in memory. Beyond it, the least-recently-updated settled transcripts
	 * are released; their summaries stay, and readers hydrate the persisted session on demand.
	 */
	maxSettledTranscripts?: number;
	/** How many hydrated persisted transcripts stay cached for readers (LRU). */
	maxHydratedTranscripts?: number;
}

export const DEFAULT_MAX_SETTLED_TRANSCRIPTS = 24;
export const DEFAULT_MAX_HYDRATED_TRANSCRIPTS = 8;

/**
 * Session states whose transcript mirror has no in-process reader left: the session ended without reaching review
 * (or was cleared). `awaiting_review` is deliberately NOT settled — the review pipeline reads the transcript as
 * delivery evidence, and a bounce resumes the same session — and neither is anything live.
 */
const SETTLED_SESSION_STATES: ReadonlySet<RuntimeTaskSessionSummary["state"]> = new Set([
	"failed",
	"interrupted",
	"idle",
]);

/**
 * Own the in-memory task entries plus summary and message fanout, so future SDK-backed hydration can slot in behind
 * one boundary.
 *
 * ── P0.HEAP (2026-09-07): THIS MAP WAS THE PROCESS-LIFETIME TRANSCRIPT STORE ──
 * `setTaskEntry` ran on every session start and NOTHING ever deleted an entry (only `dispose` cleared the map), so
 * every session's full transcript mirror — every tool output, every reasoning stream, every tool input held in
 * `toolInputByToolCallId` — stayed reachable until the process died. The server died at node's 4 GB default heap
 * limit 6 h into a factory run and again at a raised 24 GB limit 9.7 h into the next. The persisted SDK session is
 * the durable truth; this is a cache, and a cache has to be able to forget: `forgetTask` releases a task whose
 * card finished (driven by the board-liveness watchdog), and the settled-transcript budget bounds what failed /
 * interrupted sessions can hold regardless of whether anyone ever calls it ("expiry beats another release path").
 */
export class InMemoryNKleinMessageRepository implements NKleinMessageRepository {
	private readonly entries = new Map<string, NKleinTaskSessionEntry>();
	private readonly hydratedMessagesByTaskId = new Map<string, NKleinTaskMessage[]>();
	private readonly summaryListeners = new Set<(summary: RuntimeTaskSessionSummary) => void>();
	private readonly messageListeners = new Set<(taskId: string, message: NKleinTaskMessage) => void>();
	private readonly maxSettledTranscripts: number;
	private readonly maxHydratedTranscripts: number;

	constructor(options: InMemoryNKleinMessageRepositoryOptions = {}) {
		this.maxSettledTranscripts = Math.max(
			0,
			Math.trunc(options.maxSettledTranscripts ?? DEFAULT_MAX_SETTLED_TRANSCRIPTS),
		);
		this.maxHydratedTranscripts = Math.max(
			1,
			Math.trunc(options.maxHydratedTranscripts ?? DEFAULT_MAX_HYDRATED_TRANSCRIPTS),
		);
	}

	onSummary(listener: (summary: RuntimeTaskSessionSummary) => void): () => void {
		this.summaryListeners.add(listener);
		return () => {
			this.summaryListeners.delete(listener);
		};
	}

	onMessage(listener: (taskId: string, message: NKleinTaskMessage) => void): () => void {
		this.messageListeners.add(listener);
		return () => {
			this.messageListeners.delete(listener);
		};
	}

	setTaskEntry(taskId: string, entry: NKleinTaskSessionEntry): void {
		this.entries.set(taskId, entry);
		this.hydratedMessagesByTaskId.delete(taskId);
		this.releaseSettledTranscriptsBeyondBudget();
	}

	clearHydratedTaskMessages(taskId: string): void {
		this.hydratedMessagesByTaskId.delete(taskId);
	}

	forgetTask(taskId: string): void {
		this.entries.delete(taskId);
		this.hydratedMessagesByTaskId.delete(taskId);
	}

	getTaskEntry(taskId: string): NKleinTaskSessionEntry | null {
		return this.entries.get(taskId) ?? null;
	}

	getSummary(taskId: string): RuntimeTaskSessionSummary | null {
		const entry = this.entries.get(taskId);
		return entry ? cloneSummary(entry.summary) : null;
	}

	listSummaries(): RuntimeTaskSessionSummary[] {
		return Array.from(this.entries.values()).map((entry) => cloneSummary(entry.summary));
	}

	listMessages(taskId: string): NKleinTaskMessage[] {
		const entry = this.entries.get(taskId);
		if (entry && !entry.transcriptReleased) {
			return entry.messages.map((message) => cloneMessage(message));
		}
		const hydratedMessages = this.readHydratedMessages(taskId);
		return hydratedMessages ? hydratedMessages.map((message) => cloneMessage(message)) : [];
	}

	async hydrateTaskMessages(
		taskId: string,
		loadPersistedSession: () => Promise<NKleinPersistedTaskSessionSnapshot | null>,
	): Promise<NKleinTaskMessage[]> {
		const liveEntry = this.entries.get(taskId);
		if (liveEntry && !liveEntry.transcriptReleased) {
			return liveEntry.messages.map((message) => cloneMessage(message));
		}
		const cachedMessages = this.readHydratedMessages(taskId);
		if (cachedMessages) {
			return cachedMessages.map((message) => cloneMessage(message));
		}
		const persistedSession = await loadPersistedSession();
		if (!persistedSession) {
			return [];
		}
		const hydratedMessages = hydratePersistedSessionMessages(taskId, persistedSession.messages);
		this.cacheHydratedMessages(taskId, hydratedMessages);
		return hydratedMessages.map((message) => cloneMessage(message));
	}

	getFootprint(): NKleinMessageRepositoryFootprint {
		let releasedTranscripts = 0;
		let transcriptMessages = 0;
		let transcriptChars = 0;
		for (const entry of this.entries.values()) {
			if (entry.transcriptReleased) {
				releasedTranscripts += 1;
			}
			transcriptMessages += entry.messages.length;
			for (const message of entry.messages) {
				transcriptChars += message.content.length;
			}
		}
		for (const messages of this.hydratedMessagesByTaskId.values()) {
			transcriptMessages += messages.length;
			for (const message of messages) {
				transcriptChars += message.content.length;
			}
		}
		return {
			taskEntries: this.entries.size,
			releasedTranscripts,
			hydratedTranscripts: this.hydratedMessagesByTaskId.size,
			transcriptMessages,
			transcriptChars,
		};
	}

	/** LRU read: a hit moves the task to the newest position. */
	private readHydratedMessages(taskId: string): NKleinTaskMessage[] | null {
		const cached = this.hydratedMessagesByTaskId.get(taskId);
		if (!cached) {
			return null;
		}
		this.hydratedMessagesByTaskId.delete(taskId);
		this.hydratedMessagesByTaskId.set(taskId, cached);
		return cached;
	}

	private cacheHydratedMessages(taskId: string, messages: NKleinTaskMessage[]): void {
		this.hydratedMessagesByTaskId.delete(taskId);
		this.hydratedMessagesByTaskId.set(taskId, messages);
		while (this.hydratedMessagesByTaskId.size > this.maxHydratedTranscripts) {
			const oldest = this.hydratedMessagesByTaskId.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this.hydratedMessagesByTaskId.delete(oldest);
		}
	}

	/**
	 * Release the transcript mirrors of the least-recently-updated SETTLED entries beyond the budget. Runs on every
	 * session start, so the budget is enforced exactly when the map grows — never on the settling summary itself,
	 * because the failover path reads the just-failed transcript (originating task + latest tool evidence) to build
	 * the fresh model's carry prompt right after the terminal summary lands.
	 */
	private releaseSettledTranscriptsBeyondBudget(): void {
		const settled: NKleinTaskSessionEntry[] = [];
		for (const entry of this.entries.values()) {
			if (!entry.transcriptReleased && SETTLED_SESSION_STATES.has(entry.summary.state)) {
				settled.push(entry);
			}
		}
		if (settled.length <= this.maxSettledTranscripts) {
			return;
		}
		settled.sort((left, right) => left.summary.updatedAt - right.summary.updatedAt);
		for (const entry of settled.slice(0, settled.length - this.maxSettledTranscripts)) {
			releaseEntryTranscript(entry);
		}
	}

	emitSummary(summary: RuntimeTaskSessionSummary): void {
		const snapshot = cloneSummary(summary);
		// N21 (live-hit 2026-08-02, twice, two different warning texts): WRITE-THROUGH before fanout. This
		// method used to be fanout-only, so an emitted summary reached every listener but never the entry —
		// while `getSummary`/`updateSummary` read `entry.summary`. The two stores diverged for a ~350ms window
		// after each turn: the event adapter's terminal `awaiting_review` went to the board, the entry still
		// said `running` from turn start, and the next warning-only `updateSummary(entry, …)` spread the stale
		// state wholesale — RESURRECTING `running`, yanking the card out of review, and stamping the warning
		// text as the transition reason. Ordering-random, so live drains hit it and fast replay cells never
		// did. Owning the entries (this class's stated boundary) means the last EMITTED summary is the one a
		// reader gets back.
		const entry = this.entries.get(summary.taskId);
		if (entry) {
			entry.summary = cloneSummary(snapshot);
		}
		for (const listener of this.summaryListeners) {
			listener(snapshot);
		}
	}

	emitMessage(taskId: string, message: NKleinTaskMessage): void {
		const snapshot = cloneMessage(message);
		for (const listener of this.messageListeners) {
			listener(taskId, snapshot);
		}
	}

	applyTurnCheckpoint(taskId: string, checkpoint: RuntimeTaskTurnCheckpoint): RuntimeTaskSessionSummary | null {
		const entry = this.entries.get(taskId);
		if (!entry) {
			return null;
		}
		return updateSummary(entry, {
			latestTurnCheckpoint: checkpoint,
			previousTurnCheckpoint: entry.summary.latestTurnCheckpoint ?? null,
		});
	}

	dispose(): void {
		this.entries.clear();
		this.hydratedMessagesByTaskId.clear();
		this.summaryListeners.clear();
		this.messageListeners.clear();
	}
}

/** Drop an entry's transcript mirror in place; the summary and the entry identity survive. */
export function releaseEntryTranscript(entry: NKleinTaskSessionEntry): void {
	entry.messages = [];
	entry.activeAssistantMessageId = null;
	entry.activeReasoningMessageId = null;
	entry.toolMessageIdByToolCallId.clear();
	entry.toolInputByToolCallId.clear();
	entry.transcriptReleased = true;
}

export function createInMemoryNKleinMessageRepository(
	options: InMemoryNKleinMessageRepositoryOptions = {},
): NKleinMessageRepository {
	return new InMemoryNKleinMessageRepository(options);
}

export function createTaskEntryFromPersistedSession(
	taskId: string,
	messages: NKleinSdkPersistedMessage[],
	summaryPatch: Partial<RuntimeTaskSessionSummary> = {},
): NKleinTaskSessionEntry {
	const entry = createHydrationEntry(taskId);
	for (const message of messages) {
		hydratePersistedMessage(entry, taskId, message);
	}
	entry.summary = {
		...entry.summary,
		...summaryPatch,
		taskId,
		updatedAt: Date.now(),
	};
	return entry;
}

function hydratePersistedSessionMessages(taskId: string, messages: NKleinSdkPersistedMessage[]): NKleinTaskMessage[] {
	const entry = createHydrationEntry(taskId);
	for (const message of messages) {
		hydratePersistedMessage(entry, taskId, message);
	}
	return entry.messages.map((message) => cloneMessage(message));
}

function createHydrationEntry(taskId: string): NKleinTaskSessionEntry {
	return {
		summary: createDefaultSummary(taskId),
		messages: [],
		activeAssistantMessageId: null,
		activeReasoningMessageId: null,
		toolMessageIdByToolCallId: new Map<string, string>(),
		toolInputByToolCallId: new Map<string, unknown>(),
	};
}

function hydratePersistedMessage(
	entry: NKleinTaskSessionEntry,
	taskId: string,
	message: NKleinSdkPersistedMessage,
): void {
	const persistedMetadata =
		message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
			? message.metadata
			: null;
	const persistedDisplayRole =
		typeof persistedMetadata?.displayRole === "string" ? persistedMetadata.displayRole.trim().toLowerCase() : "";
	const persistedReason = typeof persistedMetadata?.reason === "string" ? persistedMetadata.reason.trim() : null;
	const persistedMessageKind = typeof persistedMetadata?.kind === "string" ? persistedMetadata.kind.trim() : null;
	const hydratedRole =
		persistedDisplayRole === "system" || persistedDisplayRole === "status"
			? (persistedDisplayRole as "system" | "status")
			: message.role;

	if (typeof message.content === "string") {
		appendPersistedTextMessage(
			entry,
			taskId,
			hydratedRole,
			message.content,
			persistedMetadata,
			persistedReason,
			persistedMessageKind,
		);
		return;
	}

	const textParts: string[] = [];
	const images: RuntimeTaskImage[] = [];
	const flushRichMessage = () => {
		if (textParts.length === 0 && images.length === 0) {
			return;
		}
		appendPersistedTextMessage(
			entry,
			taskId,
			hydratedRole,
			textParts.join("\n"),
			persistedMetadata,
			persistedReason,
			persistedMessageKind,
			images,
		);
		textParts.length = 0;
		images.length = 0;
	};

	for (const block of message.content) {
		if (block.type === "text") {
			textParts.push(block.text);
			continue;
		}
		if (block.type === "file") {
			textParts.push(`Attached file: ${block.path}`);
			continue;
		}
		if (block.type === "image") {
			if (typeof block.data === "string" && typeof block.mediaType === "string") {
				images.push({
					id: `${taskId}-image-${images.length}-${Date.now()}`,
					data: block.data,
					mimeType: block.mediaType,
				});
			} else if (typeof block.mediaType === "string") {
				textParts.push(`Attached image: ${block.mediaType}`);
			}
			continue;
		}

		flushRichMessage();

		if (block.type === "thinking") {
			appendPersistedReasoningMessage(entry, taskId, block.thinking);
			continue;
		}
		if (block.type === "redacted_thinking") {
			appendPersistedReasoningMessage(entry, taskId, "[redacted reasoning]");
			continue;
		}
		if (block.type === "tool_use") {
			startToolCallMessage(entry, taskId, {
				toolName: block.name,
				toolCallId: block.id,
				input: block.input,
			});
			continue;
		}
		if (block.type === "tool_result") {
			const resultText = stringifyPersistedToolResult(block.content);
			finishToolCallMessage(entry, taskId, {
				toolName: readHydratedToolName(entry, block.tool_use_id),
				toolCallId: block.tool_use_id,
				output: block.is_error ? undefined : resultText,
				error: block.is_error ? resultText : null,
				durationMs: null,
			});
		}
	}

	flushRichMessage();
}

function appendPersistedTextMessage(
	entry: NKleinTaskSessionEntry,
	taskId: string,
	role: "user" | "assistant" | "system" | "status",
	content: string,
	metadata?: Record<string, unknown> | null,
	reason?: string | null,
	messageKind?: string | null,
	images?: RuntimeTaskImage[],
): void {
	if (content.trim().length === 0 && (!images || images.length === 0)) {
		return;
	}
	const meta =
		metadata || reason || messageKind
			? {
					hookEventName: metadata ? "history_notice" : null,
					messageKind: messageKind ?? null,
					displayRole: typeof metadata?.displayRole === "string" ? metadata.displayRole : null,
					reason: reason ?? null,
				}
			: null;
	entry.messages.push(
		meta ? createMessageWithMeta(taskId, role, content, meta, images) : createMessage(taskId, role, content, images),
	);
}

function appendPersistedReasoningMessage(entry: NKleinTaskSessionEntry, taskId: string, content: string): void {
	if (content.trim().length === 0) {
		return;
	}
	entry.messages.push(
		createMessageWithMeta(taskId, "reasoning", content, {
			streamType: "reasoning",
		}),
	);
}

function stringifyPersistedToolResult(
	content: string | Array<{ type: string; text?: string; path?: string; mediaType?: string }>,
): string {
	if (typeof content === "string") {
		return content;
	}
	return content
		.map((block) => {
			if (block.type === "text" && typeof block.text === "string") {
				return block.text;
			}
			if (block.type === "file" && typeof block.path === "string") {
				return `Attached file: ${block.path}`;
			}
			if (block.type === "image" && typeof block.mediaType === "string") {
				return `Attached image: ${block.mediaType}`;
			}
			try {
				return JSON.stringify(block, null, 2);
			} catch {
				return String(block);
			}
		})
		.filter((part) => part.trim().length > 0)
		.join("\n");
}

function readHydratedToolName(entry: NKleinTaskSessionEntry, toolCallId: string): string | null {
	const messageId = entry.toolMessageIdByToolCallId.get(toolCallId);
	if (!messageId) {
		return null;
	}
	const existingMessage = entry.messages.find((message) => message.id === messageId);
	return existingMessage?.meta?.toolName ?? null;
}
