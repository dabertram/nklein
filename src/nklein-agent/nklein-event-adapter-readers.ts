// Pure per-kind narrowing of raw SDK session events into the typed shapes the event adapter dispatches on
// (extracted from nklein-event-adapter.ts, §5.U). Distinct from the coarser readers in
// nklein-sdk-event-readers.ts (those narrow to the union / a raw record): each reader here validates the
// discriminant `type` AND the payload fields it relies on (sessionId, chunk/stream, reason, status), returning
// null for anything malformed so the adapter ignores unexpected frames rather than throwing mid-stream.
import { asRecord } from "./nklein-value-guards";
import type { NKleinSdkAgentEvent, NKleinSdkSessionEvent } from "./sdk-runtime-boundary";

export type NKleinSdkChunkEvent = Extract<NKleinSdkSessionEvent, { type: "chunk" }>;
export type NKleinSdkHookEvent = Extract<NKleinSdkSessionEvent, { type: "hook" }>;
export type NKleinSdkEndedEvent = Extract<NKleinSdkSessionEvent, { type: "ended" }>;
export type NKleinSdkStatusEvent = Extract<NKleinSdkSessionEvent, { type: "status" }>;
export type RawNKleinSdkAgentEvent = NKleinSdkAgentEvent | (Record<string, unknown> & { type: string });

export function readAgentEvent(event: unknown): RawNKleinSdkAgentEvent | null {
	const record = asRecord(event);
	if (record?.type !== "agent_event") {
		return null;
	}
	const payload = asRecord(record.payload);
	if (!payload) {
		return null;
	}
	const agentEvent = asRecord(payload.event);
	if (!agentEvent || typeof agentEvent.type !== "string") {
		return null;
	}
	return agentEvent as unknown as RawNKleinSdkAgentEvent;
}

export function readChunkEvent(event: unknown): NKleinSdkChunkEvent | null {
	const record = asRecord(event);
	if (record?.type !== "chunk") {
		return null;
	}
	const payload = asRecord(record.payload);
	if (!payload || typeof payload.sessionId !== "string" || typeof payload.chunk !== "string") {
		return null;
	}
	if (payload.stream !== "stdout" && payload.stream !== "stderr" && payload.stream !== "agent") {
		return null;
	}
	return { type: "chunk", payload: payload as unknown as NKleinSdkChunkEvent["payload"] };
}

export function readHookEvent(event: unknown): NKleinSdkHookEvent | null {
	const record = asRecord(event);
	if (record?.type !== "hook") {
		return null;
	}
	const payload = asRecord(record.payload);
	if (!payload || typeof payload.sessionId !== "string") {
		return null;
	}
	return { type: "hook", payload: payload as unknown as NKleinSdkHookEvent["payload"] };
}

export function readEndedEvent(event: unknown): NKleinSdkEndedEvent | null {
	const record = asRecord(event);
	if (record?.type !== "ended") {
		return null;
	}
	const payload = asRecord(record.payload);
	if (!payload || typeof payload.sessionId !== "string" || typeof payload.reason !== "string") {
		return null;
	}
	return { type: "ended", payload: payload as unknown as NKleinSdkEndedEvent["payload"] };
}

export function readStatusEvent(event: unknown): NKleinSdkStatusEvent | null {
	const record = asRecord(event);
	if (record?.type !== "status") {
		return null;
	}
	const payload = asRecord(record.payload);
	if (!payload || typeof payload.sessionId !== "string" || typeof payload.status !== "string") {
		return null;
	}
	return { type: "status", payload: payload as NKleinSdkStatusEvent["payload"] };
}
