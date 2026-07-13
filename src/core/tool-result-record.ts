import { createHash } from "node:crypto";
import type { AgentLedgerEvent } from "./agent-attempt-ledger.js";
import { selectAttempts } from "./agent-attempt-ledger.js";

/**
 * F1.16 (§5.AF) — per-tool idempotency identity + durable result evidence, the substrate the F1.17 replay policies
 * (`reuse` / `simulate` / `skip` / `reconfirm`) decide over.
 *
 * Three pieces, all pure:
 *  1. **Identity** — {@link deriveToolCallIdempotencyKey}: the stable key of ONE logical tool execution — which
 *     run/card, which tool, which exact input (the content-complete input fingerprint), and which OCCURRENCE (the
 *     n-th deliberate repeat of an identical call is a different execution — a `run_commands` retry is not the
 *     same event as its first firing). Deterministic sha256 over a canonical serialization: the same logical call
 *     derives the same key on every machine and every replay, and any identity change changes the key.
 *  2. **Evidence** — {@link hashToolResultContent}: the durable content hash of what the tool RETURNED, recorded
 *     on the attempt event's per-tool-call detail (`AttemptToolCall.resultHash`), so a replay can verify "the
 *     recorded execution produced THIS result" without re-running the side effect or storing the full payload.
 *  3. **Lookup** — {@link findRecordedToolCallResult}: the replay/resume read over the ledger — has this exact
 *     logical call already executed, and what did it produce? A hit means the side effect must NOT be repeated
 *     (at-most-once); the caller's replay policy decides whether to reuse the evidence, skip, or reconfirm.
 */

function stableSerialize(value: unknown): string {
	if (value === null || value === undefined) {
		return "null";
	}
	if (typeof value !== "object") {
		return JSON.stringify(value) ?? "null";
	}
	if (Array.isArray(value)) {
		return `[${value.map(stableSerialize).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}

/** Durable content hash of a tool's result payload (canonical, key-order-independent). */
export function hashToolResultContent(content: unknown): string {
	return createHash("sha256").update(stableSerialize(content)).digest("hex").slice(0, 32);
}

export interface ToolCallIdentity {
	/** The run this call belongs to (usually the taskId; a chat turn's session id for chat flows). */
	workflowId: string;
	taskId: string;
	toolName: string;
	/** The content-complete input fingerprint (`computeNKleinToolInputFingerprint`); null = an empty-input call. */
	inputFingerprint: string | null;
	/** 0-based index among calls with the SAME (toolName, inputFingerprint) in this task — deliberate repeats differ. */
	occurrence: number;
}

/** The stable idempotency key of one logical tool execution. */
export function deriveToolCallIdempotencyKey(identity: ToolCallIdentity): string {
	return createHash("sha256")
		.update(
			stableSerialize({
				workflowId: identity.workflowId,
				taskId: identity.taskId,
				toolName: identity.toolName,
				inputFingerprint: identity.inputFingerprint,
				occurrence: identity.occurrence,
			}),
		)
		.digest("hex")
		.slice(0, 32);
}

export interface RecordedToolCallResult {
	toolName: string;
	inputFingerprint: string | null;
	occurrence: number;
	outcome: string | null;
	resultHash: string | null;
	/** When the attempt that recorded this call landed. */
	recordedAt: number;
}

/**
 * The replay/resume lookup: every recorded execution of (taskId, toolName, inputFingerprint) across the task's
 * ledger attempts, in occurrence order. A non-empty answer means the call already ran — at-most-once demands the
 * side effect not be repeated blindly; the F1.17 policy layer decides reuse/skip/reconfirm over this evidence.
 */
export function findRecordedToolCallResult(
	events: readonly AgentLedgerEvent[],
	query: { taskId: string; toolName: string; inputFingerprint: string | null },
): RecordedToolCallResult[] {
	const results: RecordedToolCallResult[] = [];
	const attempts = selectAttempts(events)
		.filter((attempt) => attempt.taskId === query.taskId)
		.sort((left, right) => left.recordedAt - right.recordedAt);
	let occurrence = 0;
	for (const attempt of attempts) {
		for (const call of attempt.toolCalls) {
			if (call.name !== query.toolName || (call.fingerprint ?? null) !== query.inputFingerprint) {
				continue;
			}
			results.push({
				toolName: call.name,
				inputFingerprint: call.fingerprint ?? null,
				occurrence,
				outcome: call.outcome ?? null,
				resultHash: call.resultHash ?? null,
				recordedAt: attempt.recordedAt,
			});
			occurrence += 1;
		}
	}
	return results;
}
