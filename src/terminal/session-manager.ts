// PTY-backed runtime for the workspace shell terminal (shell-on-task + project shell).
// It owns process lifecycle, terminal protocol filtering, and summary updates.
// (Terminal/CLI *agent* sessions were retired with the host-worktree subsystem, §5.A.)
import type { RuntimeTaskSessionState, RuntimeTaskSessionSummary } from "../core/api-contract";
import { PtySession } from "./pty-session";
import {
	createTerminalProtocolFilterState,
	disableOscColorQueryIntercept,
	filterTerminalProtocolOutput,
	type TerminalProtocolFilterState,
} from "./terminal-protocol-filter";
import type { TerminalSessionListener, TerminalSessionService } from "./terminal-session-service";
import { TerminalStateMirror } from "./terminal-state-mirror";

// TUI apps (Codex, OpenCode) can query OSC 10/11 before the browser terminal is attached
// and ready to answer. We intercept those startup probes during early PTY output, synthesize
// foreground/background color replies, then disable the filter once a live terminal listener
// has attached.
const OSC_FOREGROUND_QUERY_REPLY = "\u001b]10;rgb:e6e6/eded/f3f3\u001b\\";
const OSC_BACKGROUND_QUERY_REPLY = "\u001b]11;rgb:1717/1717/2121\u001b\\";

interface ActiveProcessState {
	session: PtySession;
	cols: number;
	rows: number;
	terminalProtocolFilter: TerminalProtocolFilterState;
}

interface SessionEntry {
	summary: RuntimeTaskSessionSummary;
	active: ActiveProcessState | null;
	terminalStateMirror: TerminalStateMirror | null;
	listenerIdCounter: number;
	listeners: Map<number, TerminalSessionListener>;
}

export interface StartShellSessionRequest {
	taskId: string;
	cwd: string;
	cols?: number;
	rows?: number;
	binary: string;
	args?: string[];
	env?: Record<string, string | undefined>;
}

function now(): number {
	return Date.now();
}

function createDefaultSummary(taskId: string): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "idle",
		agentId: null,
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: now(),
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		warningMessage: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

function cloneSummary(summary: RuntimeTaskSessionSummary): RuntimeTaskSessionSummary {
	return {
		...summary,
	};
}

function updateSummary(entry: SessionEntry, patch: Partial<RuntimeTaskSessionSummary>): RuntimeTaskSessionSummary {
	entry.summary = {
		...entry.summary,
		...patch,
		updatedAt: now(),
	};
	return entry.summary;
}

function isActiveState(state: RuntimeTaskSessionState): boolean {
	return state === "running" || state === "awaiting_review";
}

function formatShellSpawnFailure(binary: string, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const normalized = message.toLowerCase();
	if (normalized.includes("posix_spawnp failed") || normalized.includes("enoent")) {
		return `Failed to launch "${binary}". Command not found on this system.`;
	}
	return `Failed to launch "${binary}": ${message}`;
}

function buildTerminalEnvironment(
	...sources: Array<Record<string, string | undefined> | undefined>
): Record<string, string | undefined> {
	return {
		...process.env,
		...Object.assign({}, ...sources),
		COLORTERM: "truecolor",
		TERM: "xterm-256color",
		TERM_PROGRAM: "kanban",
	};
}

export class TerminalSessionManager implements TerminalSessionService {
	private readonly entries = new Map<string, SessionEntry>();
	private readonly summaryListeners = new Set<(summary: RuntimeTaskSessionSummary) => void>();

	private hasLiveOutputListener(entry: SessionEntry): boolean {
		for (const listener of entry.listeners.values()) {
			if (listener.onOutput) {
				return true;
			}
		}
		return false;
	}

	onSummary(listener: (summary: RuntimeTaskSessionSummary) => void): () => void {
		this.summaryListeners.add(listener);
		return () => {
			this.summaryListeners.delete(listener);
		};
	}

	hydrateFromRecord(record: Record<string, RuntimeTaskSessionSummary>): void {
		for (const [taskId, summary] of Object.entries(record)) {
			this.entries.set(taskId, {
				summary: cloneSummary(summary),
				active: null,
				terminalStateMirror: null,
				listenerIdCounter: 1,
				listeners: new Map(),
			});
		}
	}

	getSummary(taskId: string): RuntimeTaskSessionSummary | null {
		const entry = this.entries.get(taskId);
		return entry ? cloneSummary(entry.summary) : null;
	}

	listSummaries(): RuntimeTaskSessionSummary[] {
		return Array.from(this.entries.values()).map((entry) => cloneSummary(entry.summary));
	}

	attach(taskId: string, listener: TerminalSessionListener): (() => void) | null {
		const entry = this.ensureEntry(taskId);

		listener.onState?.(cloneSummary(entry.summary));
		if (entry.active && listener.onOutput) {
			disableOscColorQueryIntercept(entry.active.terminalProtocolFilter);
		}

		const listenerId = entry.listenerIdCounter;
		entry.listenerIdCounter += 1;
		entry.listeners.set(listenerId, listener);

		return () => {
			entry.listeners.delete(listenerId);
		};
	}

	async getRestoreSnapshot(taskId: string) {
		const entry = this.entries.get(taskId);
		if (!entry?.terminalStateMirror) {
			return null;
		}
		return await entry.terminalStateMirror.getSnapshot();
	}

	async startShellSession(request: StartShellSessionRequest): Promise<RuntimeTaskSessionSummary> {
		const entry = this.ensureEntry(request.taskId);
		if (entry.active && entry.summary.state === "running") {
			return cloneSummary(entry.summary);
		}

		if (entry.active) {
			entry.active.session.stop();
			entry.active = null;
		}
		entry.terminalStateMirror?.dispose();
		entry.terminalStateMirror = null;

		const cols = Number.isFinite(request.cols) && (request.cols ?? 0) > 0 ? Math.floor(request.cols ?? 0) : 120;
		const rows = Number.isFinite(request.rows) && (request.rows ?? 0) > 0 ? Math.floor(request.rows ?? 0) : 40;
		const terminalStateMirror = new TerminalStateMirror(cols, rows, {
			onInputResponse: (data) => {
				if (!entry.active || this.hasLiveOutputListener(entry)) {
					return;
				}
				entry.active.session.write(data);
			},
		});
		const env = buildTerminalEnvironment(request.env);

		let session: PtySession;
		try {
			session = PtySession.spawn({
				binary: request.binary,
				args: request.args ?? [],
				cwd: request.cwd,
				env,
				cols,
				rows,
				onData: (chunk) => {
					if (!entry.active) {
						return;
					}

					const filteredChunk = filterTerminalProtocolOutput(entry.active.terminalProtocolFilter, chunk, {
						onOsc10ForegroundQuery: () => entry.active?.session.write(OSC_FOREGROUND_QUERY_REPLY),
						onOsc11BackgroundQuery: () => entry.active?.session.write(OSC_BACKGROUND_QUERY_REPLY),
					});
					if (filteredChunk.byteLength === 0) {
						return;
					}
					entry.terminalStateMirror?.applyOutput(filteredChunk);
					updateSummary(entry, { lastOutputAt: now() });

					for (const taskListener of entry.listeners.values()) {
						taskListener.onOutput?.(filteredChunk);
					}
				},
				onExit: (event) => {
					const currentEntry = this.entries.get(request.taskId);
					if (!currentEntry) {
						return;
					}
					const currentActive = currentEntry.active;
					if (!currentActive) {
						return;
					}

					const summary = updateSummary(currentEntry, {
						state: currentActive.session.wasInterrupted() ? "interrupted" : "idle",
						reviewReason: currentActive.session.wasInterrupted() ? "interrupted" : null,
						exitCode: event.exitCode,
						pid: null,
					});

					for (const taskListener of currentEntry.listeners.values()) {
						taskListener.onState?.(cloneSummary(summary));
						taskListener.onExit?.(event.exitCode);
					}
					currentEntry.active = null;
					this.emitSummary(summary);
				},
			});
		} catch (error) {
			terminalStateMirror.dispose();
			const summary = updateSummary(entry, {
				state: "failed",
				agentId: null,
				workspacePath: request.cwd,
				pid: null,
				startedAt: null,
				lastOutputAt: null,
				reviewReason: "error",
				exitCode: null,
				lastHookAt: null,
				latestHookActivity: null,
				latestTurnCheckpoint: null,
				previousTurnCheckpoint: null,
			});
			this.emitSummary(summary);
			throw new Error(formatShellSpawnFailure(request.binary, error));
		}

		const active: ActiveProcessState = {
			session,
			cols,
			rows,
			terminalProtocolFilter: createTerminalProtocolFilterState({
				interceptOscColorQueries: true,
			}),
		};
		entry.active = active;
		entry.terminalStateMirror = terminalStateMirror;

		updateSummary(entry, {
			state: "running",
			agentId: null,
			workspacePath: request.cwd,
			pid: session.pid,
			startedAt: now(),
			lastOutputAt: null,
			reviewReason: null,
			exitCode: null,
			lastHookAt: null,
			latestHookActivity: null,
			warningMessage: null,
			latestTurnCheckpoint: null,
			previousTurnCheckpoint: null,
		});
		this.emitSummary(entry.summary);

		return cloneSummary(entry.summary);
	}

	recoverStaleSession(taskId: string): RuntimeTaskSessionSummary | null {
		const entry = this.entries.get(taskId);
		if (!entry) {
			return null;
		}
		if (entry.active || !isActiveState(entry.summary.state)) {
			return cloneSummary(entry.summary);
		}

		// Preserve agentId so the server can route to the correct agent type
		// (NKlein SDK vs terminal PTY) when a task is restored from trash.
		const summary = updateSummary(entry, {
			state: "idle",
			workspacePath: null,
			pid: null,
			startedAt: null,
			lastOutputAt: null,
			reviewReason: null,
			exitCode: null,
			lastHookAt: null,
			latestHookActivity: null,
			latestTurnCheckpoint: null,
			previousTurnCheckpoint: null,
		});

		for (const listener of entry.listeners.values()) {
			listener.onState?.(cloneSummary(summary));
		}
		this.emitSummary(summary);
		return cloneSummary(summary);
	}

	writeInput(taskId: string, data: Buffer): RuntimeTaskSessionSummary | null {
		const entry = this.entries.get(taskId);
		if (!entry?.active) {
			return null;
		}
		entry.active.session.write(data);
		return cloneSummary(entry.summary);
	}

	resize(taskId: string, cols: number, rows: number, pixelWidth?: number, pixelHeight?: number): boolean {
		const entry = this.entries.get(taskId);
		if (!entry?.active) {
			return false;
		}
		const safeCols = Math.max(1, Math.floor(cols));
		const safeRows = Math.max(1, Math.floor(rows));
		const safePixelWidth = Number.isFinite(pixelWidth ?? Number.NaN) ? Math.floor(pixelWidth as number) : undefined;
		const safePixelHeight = Number.isFinite(pixelHeight ?? Number.NaN)
			? Math.floor(pixelHeight as number)
			: undefined;
		const normalizedPixelWidth = safePixelWidth !== undefined && safePixelWidth > 0 ? safePixelWidth : undefined;
		const normalizedPixelHeight = safePixelHeight !== undefined && safePixelHeight > 0 ? safePixelHeight : undefined;
		entry.active.session.resize(safeCols, safeRows, normalizedPixelWidth, normalizedPixelHeight);
		entry.terminalStateMirror?.resize(safeCols, safeRows);
		entry.active.cols = safeCols;
		entry.active.rows = safeRows;
		return true;
	}

	pauseOutput(taskId: string): boolean {
		const entry = this.entries.get(taskId);
		if (!entry?.active) {
			return false;
		}
		entry.active.session.pause();
		return true;
	}

	resumeOutput(taskId: string): boolean {
		const entry = this.entries.get(taskId);
		if (!entry?.active) {
			return false;
		}
		entry.active.session.resume();
		return true;
	}

	stopTaskSession(taskId: string): RuntimeTaskSessionSummary | null {
		const entry = this.entries.get(taskId);
		if (!entry?.active) {
			return entry ? cloneSummary(entry.summary) : null;
		}
		entry.active.session.stop();
		return cloneSummary(entry.summary);
	}

	markInterruptedAndStopAll(): RuntimeTaskSessionSummary[] {
		const activeEntries = Array.from(this.entries.values()).filter((entry) => entry.active != null);
		for (const entry of activeEntries) {
			if (!entry.active) {
				continue;
			}
			entry.active.session.stop({ interrupted: true });
		}
		return activeEntries.map((entry) => cloneSummary(entry.summary));
	}

	private ensureEntry(taskId: string): SessionEntry {
		const existing = this.entries.get(taskId);
		if (existing) {
			return existing;
		}
		const created: SessionEntry = {
			summary: createDefaultSummary(taskId),
			active: null,
			terminalStateMirror: null,
			listenerIdCounter: 1,
			listeners: new Map(),
		};
		this.entries.set(taskId, created);
		return created;
	}

	private emitSummary(summary: RuntimeTaskSessionSummary): void {
		const snapshot = cloneSummary(summary);
		for (const listener of this.summaryListeners) {
			listener(snapshot);
		}
	}
}
