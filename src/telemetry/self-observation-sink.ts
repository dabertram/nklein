import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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
	| "eval_score"
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
}

export interface SelfObservationSinkOptions {
	rootDir?: string;
	now?: () => number;
}

export interface SelfObservationSink {
	record(event: SelfObservationEventInput): Promise<void>;
	getLogPath(timestamp?: number): string;
}

const DEFAULT_SELF_OBSERVATION_ROOT = join(homedir(), ".cline", "kanban", "telemetry");
const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|bearer|cookie|password|secret|token)/i;
const SECRET_VALUE_PATTERN =
	/(sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_]{12,}|xox[baprs]-[a-z0-9-]{12,}|bearer\s+[a-z0-9._-]{12,})/gi;

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

function redactText(value: string): string {
	return value.replace(SECRET_VALUE_PATTERN, "[REDACTED]");
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
			SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactValue(entryValue),
		]);
		return Object.fromEntries(entries);
	}
	return value;
}

function normalizeEvent(input: SelfObservationEventInput, now: number): SelfObservationEventRecord {
	return {
		schemaVersion: 1,
		signal: input.signal,
		severity: input.severity,
		message: redactText(input.message.trim() || input.signal),
		taskId: normalizeOptionalString(input.taskId),
		runId: normalizeOptionalString(input.runId),
		providerId: normalizeOptionalString(input.providerId),
		modelId: normalizeOptionalString(input.modelId),
		workspacePath: normalizeOptionalString(input.workspacePath),
		metadata: input.metadata ? (redactValue(input.metadata) as Record<string, unknown>) : undefined,
		createdAt: input.createdAt ?? now,
	};
}

export function resolveSelfObservationLogPath(rootDir: string | undefined, timestamp: number): string {
	return join(resolveRootDir(rootDir), `${formatLogDate(timestamp)}.jsonl`);
}

export class LocalSelfObservationSink implements SelfObservationSink {
	private readonly rootDir: string;
	private readonly now: () => number;

	constructor(options: SelfObservationSinkOptions = {}) {
		this.rootDir = resolveRootDir(options.rootDir);
		this.now = options.now ?? Date.now;
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
