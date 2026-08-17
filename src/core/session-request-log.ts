/**
 * §dsh#31 — "MODEL-VISIBLE MEANS LOGGED", architecture A (observe-first): the append-only SESSION REQUEST LOG.
 *
 * DeepSeek Harness's invariant is that anything reaching a model request is reconstructable from an append-only
 * session log. !Klein's recon (2026-08-17, blueprint in todo §dsh) found the opposite today: every `beforeModel`
 * injection (repo-map rail, focus/goal re-anchors, drift-critic note, stall replan, tool-trust reminder) lives in
 * in-memory Maps and appears in NO persisted file, `.messages.json` is an overwrite snapshot (not a journal), and
 * the decorator chain rewrites requests below every persistence point.
 *
 * This module is the PURE core of slice A: one record per outbound model request, written at the two choke
 * points (the SDK modelWrapper and LocalLlmClient.buildBody), plus a DIVERGENCE AUDIT that measures how far the
 * durable session state is from what the model actually saw. A (record + measure) deliberately precedes B
 * (making the injectors log-sourced): the audit tells us which injections diverge in practice before any
 * behavior changes. Effects (file IO) live in src/state/session-request-log-store.ts.
 */

import { createHash } from "node:crypto";
import { z } from "zod";

/** One message as it went to the wire — role + content text (multi-part content is flattened by the tap). */
export const sessionRequestWireMessageSchema = z.object({
	role: z.string(),
	content: z.string(),
});
export type SessionRequestWireMessage = z.infer<typeof sessionRequestWireMessageSchema>;

export const sessionRequestSourceSchema = z.enum([
	/** The SDK session seam: nklein-session-runtime modelWrapper wrapping `base` (innermost = final request). */
	"sdk_model_wrapper",
	/** The direct-call seam: LocalLlmClient.buildBody (consult, packaging, compression, chat adapter, …). */
	"local_llm_client",
]);
export type SessionRequestSource = z.infer<typeof sessionRequestSourceSchema>;

export const sessionRequestRecordSchema = z.object({
	schemaVersion: z.literal(1),
	/** The session this request belongs to; direct calls use a synthetic scope like `consult:<taskId>`. */
	sessionId: z.string().min(1),
	/** Which choke point recorded it. */
	source: sessionRequestSourceSchema,
	/** Free-form purpose label from the tap ("worker_turn", "consult", "packaging_transcribe", …). */
	purpose: z.string(),
	modelId: z.string(),
	recordedAt: z.string(),
	/** The system prompt if the wire carried one out-of-band of messages[] (OpenAI-style first system row stays in messages). */
	systemPrompt: z.string().optional(),
	/** Verbatim wire messages, in order. */
	messages: z.array(sessionRequestWireMessageSchema),
	/** Tool NAMES offered (schemas are bulky and reconstructable from code by name). */
	toolNames: z.array(z.string()).optional(),
	/** Canonical hash of `messages` (see hashWireMessages) for cheap equality without re-reading bodies. */
	messagesSha256: z.string(),
});
export type SessionRequestRecord = z.infer<typeof sessionRequestRecordSchema>;

/**
 * Stable content hash over (role, content) pairs. Length-prefixed framing: a separator-based scheme lets
 * message boundaries slide (or forces control bytes into source), and a boundary collision here would make two
 * DIFFERENT wire histories read "equal" - exactly the false-green this log exists to kill.
 */
export function hashWireMessages(messages: readonly SessionRequestWireMessage[]): string {
	const hash = createHash("sha256");
	for (const message of messages) {
		hash.update(`${Buffer.byteLength(message.role, "utf8")}:`);
		hash.update(message.role);
		hash.update(`${Buffer.byteLength(message.content, "utf8")}:`);
		hash.update(message.content);
	}
	return hash.digest("hex");
}

export function buildSessionRequestRecord(input: {
	sessionId: string;
	source: SessionRequestSource;
	purpose: string;
	modelId: string;
	recordedAt: string;
	systemPrompt?: string;
	messages: readonly SessionRequestWireMessage[];
	toolNames?: readonly string[];
}): SessionRequestRecord {
	return sessionRequestRecordSchema.parse({
		schemaVersion: 1,
		sessionId: input.sessionId,
		source: input.source,
		purpose: input.purpose,
		modelId: input.modelId,
		recordedAt: input.recordedAt,
		...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
		messages: [...input.messages],
		...(input.toolNames ? { toolNames: [...input.toolNames] } : {}),
		messagesSha256: hashWireMessages(input.messages),
	});
}

/** A wire message that has no counterpart in the durable state (or vice versa). */
export interface DivergentMessage {
	role: string;
	/** First 160 chars — for display. */
	contentPreview: string;
	/** The full divergent content — the injection-log match must run on whole strings (a truncated preview
	 *  fails containment in BOTH directions once a rail is merged into a larger wire row). */
	content: string;
}

/**
 * The audit verdict for ONE request against the durable session state that supposedly explains it.
 *
 * Matching is by exact (role, content) multiset — order changes alone are reported via `orderChanged` rather
 * than as divergence, because several legitimate normalizers (mergeSystemMessagesFirst) reorder without
 * changing content.
 */
export interface RequestDivergenceReport {
	matchedCount: number;
	/** Reached the model but absent from the durable state — the unlogged-injection measure. */
	onlyOnWire: DivergentMessage[];
	/** In the durable state but not sent — truncation/compaction/filtering measure. */
	onlyInDurable: DivergentMessage[];
	/** True when the matched set is identical but sequence differs. */
	orderChanged: boolean;
	/** Convenience verdict: no divergence in either direction. */
	reconstructable: boolean;
}

function messageKey(message: SessionRequestWireMessage): string {
	return `${message.role.length}:${message.role}:${message.content}`;
}

function toDivergent(message: SessionRequestWireMessage): DivergentMessage {
	return { role: message.role, contentPreview: message.content.slice(0, 160), content: message.content };
}

/** Measure how far the durable state is from the wire — the heart of the slice-A audit. PURE. */
export function computeRequestDivergence(
	wireMessages: readonly SessionRequestWireMessage[],
	durableMessages: readonly SessionRequestWireMessage[],
): RequestDivergenceReport {
	const durableCounts = new Map<string, number>();
	for (const message of durableMessages) {
		const key = messageKey(message);
		durableCounts.set(key, (durableCounts.get(key) ?? 0) + 1);
	}
	const onlyOnWire: DivergentMessage[] = [];
	let matchedCount = 0;
	for (const message of wireMessages) {
		const key = messageKey(message);
		const available = durableCounts.get(key) ?? 0;
		if (available > 0) {
			durableCounts.set(key, available - 1);
			matchedCount += 1;
		} else {
			onlyOnWire.push(toDivergent(message));
		}
	}
	const onlyInDurable: DivergentMessage[] = [];
	for (const message of durableMessages) {
		const key = messageKey(message);
		const remaining = durableCounts.get(key) ?? 0;
		if (remaining > 0) {
			durableCounts.set(key, remaining - 1);
			onlyInDurable.push(toDivergent(message));
		}
	}
	const sameMultiset = onlyOnWire.length === 0 && onlyInDurable.length === 0;
	const sameOrder =
		sameMultiset &&
		wireMessages.length === durableMessages.length &&
		wireMessages.every((message, index) => {
			const other = durableMessages[index];
			return other !== undefined && messageKey(message) === messageKey(other);
		});
	return {
		matchedCount,
		onlyOnWire,
		onlyInDurable,
		orderChanged: sameMultiset && !sameOrder,
		reconstructable: sameMultiset,
	};
}

/** Aggregate divergence over a session's request records — the per-session audit rollup. PURE. */
export interface SessionDivergenceSummary {
	requestCount: number;
	reconstructableCount: number;
	requestsWithWireOnly: number;
	requestsWithDurableOnly: number;
	/** Distinct wire-only previews (deduped, capped) — names the actual unlogged injectors. */
	wireOnlySamples: DivergentMessage[];
}

export function summarizeSessionDivergence(reports: readonly RequestDivergenceReport[]): SessionDivergenceSummary {
	const samples = new Map<string, DivergentMessage>();
	let reconstructableCount = 0;
	let requestsWithWireOnly = 0;
	let requestsWithDurableOnly = 0;
	for (const report of reports) {
		if (report.reconstructable) {
			reconstructableCount += 1;
		}
		if (report.onlyOnWire.length > 0) {
			requestsWithWireOnly += 1;
		}
		if (report.onlyInDurable.length > 0) {
			requestsWithDurableOnly += 1;
		}
		for (const divergent of report.onlyOnWire) {
			const key = `${divergent.role.length}:${divergent.role}:${divergent.contentPreview}`;
			if (!samples.has(key) && samples.size < 24) {
				samples.set(key, divergent);
			}
		}
	}
	return {
		requestCount: reports.length,
		reconstructableCount,
		requestsWithWireOnly,
		requestsWithDurableOnly,
		wireOnlySamples: [...samples.values()],
	};
}
