import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { resolveStableRoutingModelId } from "../state/runtime-id-model-key-map-store";

export type SelfObservationSeverity = "debug" | "info" | "warning" | "error";

export type SelfObservationSignal =
	| "runtime_error"
	| "provider_error"
	| "tool_error"
	| "context_overflow"
	| "verification_failed"
	| "slow_turn"
	| "budget_wall"
	| "repeated_read"
	| "tool_argument_error"
	| "task_abandoned"
	| "task_escalated"
	| "decomposition_rejected"
	| "plan_gap"
	| "eval_score"
	/** §5.AA/§5.AN: a model turn produced NEITHER a tool call NOR any text (empty) — a stall/truncation (e.g. a reasoning
	 *  model that burned its budget on reasoning_content before acting). Makes a previously-invisible swarm-path failure
	 *  countable. DETECTED by content-shape (no tool-call part + empty text); CLASSIFIED via the afterModel context's
	 *  finishReason through `deriveTruncationSignal` (metadata carries `finishReason`/`outcome`/`truncatedByStopReason`) so
	 *  a `max-tokens` truncation is distinguishable from a genuine stall and the swarm-path finishReason is now measurable. */
	| "model_stalled"
	| "custom";

export interface SelfObservationEventInput {
	signal: SelfObservationSignal;
	severity: SelfObservationSeverity;
	message: string;
	taskId?: string | null;
	runId?: string | null;
	providerId?: string | null;
	modelId?: string | null;
	workspacePath?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: number;
}

export interface SelfObservationEventRecord extends SelfObservationEventInput {
	schemaVersion: 1;
	createdAt: number;
	workspacePathHash?: string | null;
}

export interface SelfObservationSinkOptions {
	rootDir?: string;
	now?: () => number;
	retentionDays?: number;
}

export interface SelfObservationSink {
	record(event: SelfObservationEventInput): Promise<void>;
	getLogPath(timestamp?: number): string;
}

export interface ReadSelfObservationEventsOptions {
	rootDir?: string;
	taskId?: string | null;
	workspacePath?: string | null;
	limit?: number;
	now?: number;
}

const DEFAULT_SELF_OBSERVATION_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "telemetry");
const DEFAULT_RETENTION_DAYS = 30;
const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|bearer|cookie|password|secret|token)/i;
const PROMPT_KEY_PATTERN =
	/^(prompt|systemPrompt|userPrompt|assistantPrompt|spec|plan|summary|questionsMarkdown|decisionsMarkdown|revisionsMarkdown|transcript|messages|content)$/i;
const SECRET_VALUE_PATTERN =
	/(sk-[a-z0-9_-]{12,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[a-z0-9_]{12,}|xox[baprs]-[a-z0-9-]{12,}|bearer\s+[a-z0-9._-]{12,}|eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,})/gi;
const ABSOLUTE_PATH_PATTERN = /(?:^|[\s(["'])((?:\/[^\s"'()]+){2,}|[A-Za-z]:\\[^\s"'()]+(?:\\[^\s"'()]+)+)/g;

function resolveRootDir(rootDir?: string): string {
	return rootDir ?? DEFAULT_SELF_OBSERVATION_ROOT;
}

function formatLogDate(timestamp: number): string {
	return new Date(timestamp).toISOString().slice(0, 10);
}

function normalizeOptionalString(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? redactText(trimmed) : null;
}

function normalizeRawOptionalString(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function hashWorkspacePath(value: string | null): string | null {
	return value ? createHash("sha256").update(value).digest("hex") : null;
}

function redactPaths(value: string): string {
	return value.replace(ABSOLUTE_PATH_PATTERN, (match: string, path: string) => match.replace(path, "[REDACTED_PATH]"));
}

function redactText(value: string): string {
	return redactPaths(value.replace(SECRET_VALUE_PATTERN, "[REDACTED]"));
}

function redactValue(value: unknown): unknown {
	if (typeof value === "string") {
		return redactText(value);
	}
	if (Array.isArray(value)) {
		return value.map(redactValue);
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
			key,
			SECRET_KEY_PATTERN.test(key)
				? "[REDACTED]"
				: PROMPT_KEY_PATTERN.test(key)
					? "[REDACTED_TEXT]"
					: redactValue(entryValue),
		]);
		return Object.fromEntries(entries);
	}
	return value;
}

async function pruneOldLogs(rootDir: string, now: number, retentionDays: number): Promise<void> {
	if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
		return;
	}
	const cutoff = now - Math.trunc(retentionDays) * 24 * 60 * 60 * 1000;
	const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
	await Promise.all(
		entries
			.filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name))
			.filter((entry) => Date.parse(entry.name.slice(0, 10)) < cutoff)
			.map((entry) => unlink(join(rootDir, entry.name)).catch(() => undefined)),
	);
}

function normalizeEvent(input: SelfObservationEventInput, now: number): SelfObservationEventRecord {
	const rawWorkspacePath = normalizeRawOptionalString(input.workspacePath);
	return {
		schemaVersion: 1,
		signal: input.signal,
		severity: input.severity,
		message: redactText(input.message.trim() || input.signal),
		taskId: normalizeOptionalString(input.taskId),
		runId: normalizeOptionalString(input.runId),
		providerId: normalizeOptionalString(input.providerId),
		modelId: normalizeOptionalString(input.modelId),
		workspacePath: normalizeOptionalString(rawWorkspacePath),
		workspacePathHash: hashWorkspacePath(rawWorkspacePath),
		metadata: input.metadata ? (redactValue(input.metadata) as Record<string, unknown>) : undefined,
		createdAt: input.createdAt ?? now,
	};
}

export function resolveSelfObservationLogPath(rootDir: string | undefined, timestamp: number): string {
	return join(resolveRootDir(rootDir), `${formatLogDate(timestamp)}.jsonl`);
}

function isSelfObservationSignal(value: unknown): value is SelfObservationSignal {
	return (
		value === "runtime_error" ||
		value === "provider_error" ||
		value === "tool_error" ||
		value === "context_overflow" ||
		value === "verification_failed" ||
		value === "slow_turn" ||
		value === "budget_wall" ||
		value === "repeated_read" ||
		value === "tool_argument_error" ||
		value === "task_abandoned" ||
		value === "task_escalated" ||
		value === "decomposition_rejected" ||
		value === "plan_gap" ||
		value === "eval_score" ||
		value === "model_stalled" ||
		value === "custom"
	);
}

export function isSelfObservationSeverity(value: unknown): value is SelfObservationSeverity {
	return value === "debug" || value === "info" || value === "warning" || value === "error";
}

function parseSelfObservationEventRecord(line: string): SelfObservationEventRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}
	const record = parsed as Record<string, unknown>;
	if (
		record.schemaVersion !== 1 ||
		!isSelfObservationSignal(record.signal) ||
		!isSelfObservationSeverity(record.severity) ||
		typeof record.message !== "string" ||
		typeof record.createdAt !== "number"
	) {
		return null;
	}
	return {
		schemaVersion: 1,
		signal: record.signal,
		severity: record.severity,
		message: record.message,
		taskId: typeof record.taskId === "string" ? record.taskId : null,
		runId: typeof record.runId === "string" ? record.runId : null,
		providerId: typeof record.providerId === "string" ? record.providerId : null,
		modelId: typeof record.modelId === "string" ? record.modelId : null,
		workspacePath: typeof record.workspacePath === "string" ? record.workspacePath : null,
		workspacePathHash: typeof record.workspacePathHash === "string" ? record.workspacePathHash : null,
		metadata:
			record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
				? (record.metadata as Record<string, unknown>)
				: undefined,
		createdAt: record.createdAt,
	};
}

/**
 * Count observations per `metadata.category` across ALL log files — UNCAPPED by design.
 *
 * P15.1c live-found 2026-07-20: `readSelfObservationEvents` clamps to 500 events, and a single high-frequency
 * category (`board_liveness_watchdog_tick`) saturated that window completely — pushing every other category out
 * and making their counts read as zero. An audit asking "did this mechanism ever fire?" got the wrong answer for
 * every low-frequency mechanism in the system.
 *
 * Counting does not need the event objects, only the tally, so this streams the files and never truncates. That
 * is what makes a ZERO here mean "never recorded" rather than "pushed out of the window by something chattier".
 */
export async function countSelfObservationsByCategory(
	options: { rootDir?: string } = {},
): Promise<Map<string, number>> {
	const rootDir = resolveRootDir(options.rootDir);
	const counts = new Map<string, number>();
	const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
	const logFiles = entries
		.filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name))
		.map((entry) => entry.name);
	for (const file of logFiles) {
		const raw = await readFile(join(rootDir, file), "utf8").catch(() => "");
		for (const line of raw.split("\n")) {
			if (line.trim().length === 0) {
				continue;
			}
			try {
				const parsed = JSON.parse(line) as { metadata?: { category?: unknown } };
				const category = parsed.metadata?.category;
				if (typeof category === "string") {
					counts.set(category, (counts.get(category) ?? 0) + 1);
				}
			} catch {
				// A malformed line is skipped rather than aborting the tally — a truncated write at the tail of a
				// log must not make every count unavailable.
			}
		}
	}
	return counts;
}

export async function readSelfObservationEvents(
	options: ReadSelfObservationEventsOptions = {},
): Promise<SelfObservationEventRecord[]> {
	const rootDir = resolveRootDir(options.rootDir);
	const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 50)));
	const normalizedTaskId = normalizeOptionalString(options.taskId);
	const workspacePathHash = hashWorkspacePath(normalizeRawOptionalString(options.workspacePath));
	const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
	const logFiles = entries
		.filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name))
		.map((entry) => entry.name)
		.sort()
		.reverse();
	const events: SelfObservationEventRecord[] = [];
	for (const fileName of logFiles) {
		const text = await readFile(join(rootDir, fileName), "utf8").catch(() => "");
		const records = text
			.split("\n")
			.filter(Boolean)
			.map(parseSelfObservationEventRecord)
			.filter((record): record is SelfObservationEventRecord => record !== null)
			.filter((record) => !normalizedTaskId || record.taskId === normalizedTaskId)
			.filter((record) => !workspacePathHash || record.workspacePathHash === workspacePathHash)
			// F2.21 (David 2026-07-14): relabel each event's modelId to its STABLE identity so self-observation views
			// group by one model (no-op when the shared runtime-id→modelKey map has no entry for the id).
			.map((record) =>
				record.modelId
					? { ...record, modelId: resolveStableRoutingModelId(record.modelId).trim() || record.modelId }
					: record,
			)
			.sort((left, right) => right.createdAt - left.createdAt);
		events.push(...records);
		if (events.length >= limit) {
			return events.slice(0, limit);
		}
	}
	return events;
}

export class LocalSelfObservationSink implements SelfObservationSink {
	private readonly rootDir: string;
	private readonly now: () => number;
	private readonly retentionDays: number;

	constructor(options: SelfObservationSinkOptions = {}) {
		this.rootDir = resolveRootDir(options.rootDir);
		this.now = options.now ?? Date.now;
		this.retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
	}

	getLogPath(timestamp = this.now()): string {
		return resolveSelfObservationLogPath(this.rootDir, timestamp);
	}

	async record(event: SelfObservationEventInput): Promise<void> {
		const createdAt = event.createdAt ?? this.now();
		const logPath = this.getLogPath(createdAt);
		const record = normalizeEvent(event, createdAt);
		await mkdir(this.rootDir, { recursive: true });
		await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");
		await pruneOldLogs(this.rootDir, createdAt, this.retentionDays);
	}
}

let defaultSink: SelfObservationSink | null = null;

export function getDefaultSelfObservationSink(): SelfObservationSink {
	defaultSink ??= new LocalSelfObservationSink();
	return defaultSink;
}

export function resetDefaultSelfObservationSinkForTests(): void {
	defaultSink = null;
}

export function recordSelfObservation(event: SelfObservationEventInput): void {
	void getDefaultSelfObservationSink()
		.record(event)
		.catch(() => undefined);
}
