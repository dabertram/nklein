// §dsh#31 slice A — the pure session-request-log core: record building, canonical hashing, and the
// divergence audit that measures durable-state vs wire (the "model-visible means logged" gap meter).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
	buildSessionRequestRecord,
	computeRequestDivergence,
	hashWireMessages,
	type SessionRequestWireMessage,
	summarizeSessionDivergence,
} from "../../../src/core/session-request-log";
import {
	appendSessionRequestRecord,
	listSessionRequestLogSessions,
	readSessionRequestRecords,
	sessionRequestLogPath,
} from "../../../src/state/session-request-log-store";

const msg = (role: string, content: string): SessionRequestWireMessage => ({ role, content });

describe("hashWireMessages", () => {
	it("is stable across array identity and sensitive to role/content", () => {
		const a = [msg("system", "s"), msg("user", "hello")];
		expect(hashWireMessages(a)).toBe(hashWireMessages([...a.map((m) => ({ ...m }))]));
		expect(hashWireMessages(a)).not.toBe(hashWireMessages([msg("system", "s"), msg("user", "hello!")]));
		expect(hashWireMessages(a)).not.toBe(hashWireMessages([msg("user", "s"), msg("system", "hello")]));
	});

	it("does not collapse boundary-ambiguous pairs", () => {
		// (role="user", content="ab") vs (role="usera", content="b") must hash differently.
		expect(hashWireMessages([msg("user", "ab")])).not.toBe(hashWireMessages([msg("usera", "b")]));
	});
});

describe("computeRequestDivergence", () => {
	const durable = [msg("system", "shell"), msg("user", "do the task"), msg("assistant", "ok")];

	it("reports full reconstruction when wire equals durable", () => {
		const report = computeRequestDivergence(durable, durable);
		expect(report.reconstructable).toBe(true);
		expect(report.matchedCount).toBe(3);
		expect(report.orderChanged).toBe(false);
	});

	it("names wire-only injections (the unlogged-injector measure)", () => {
		const wire = [...durable, msg("user", "[!Klein context focus brief] stay on target")];
		const report = computeRequestDivergence(wire, durable);
		expect(report.reconstructable).toBe(false);
		expect(report.onlyOnWire).toHaveLength(1);
		expect(report.onlyOnWire[0]?.contentPreview).toContain("focus brief");
		expect(report.onlyInDurable).toHaveLength(0);
	});

	it("names durable-only rows (truncation/compaction measure) and counts duplicates correctly", () => {
		const wire = [msg("user", "same"), msg("user", "same")];
		const durableWithTriple = [msg("user", "same"), msg("user", "same"), msg("user", "same")];
		const report = computeRequestDivergence(wire, durableWithTriple);
		expect(report.matchedCount).toBe(2);
		expect(report.onlyInDurable).toHaveLength(1);
		expect(report.onlyOnWire).toHaveLength(0);
	});

	it("treats pure reordering as orderChanged, not divergence", () => {
		const wire = [durable[1], durable[0], durable[2]] as SessionRequestWireMessage[];
		const report = computeRequestDivergence(wire, durable);
		expect(report.reconstructable).toBe(true);
		expect(report.orderChanged).toBe(true);
	});
});

describe("summarizeSessionDivergence", () => {
	it("rolls up counts and dedupes wire-only samples", () => {
		const clean = computeRequestDivergence([msg("user", "a")], [msg("user", "a")]);
		const injected = computeRequestDivergence([msg("user", "a"), msg("user", "[rail] x")], [msg("user", "a")]);
		const summary = summarizeSessionDivergence([clean, injected, injected]);
		expect(summary.requestCount).toBe(3);
		expect(summary.reconstructableCount).toBe(1);
		expect(summary.requestsWithWireOnly).toBe(2);
		expect(summary.wireOnlySamples).toHaveLength(1);
	});
});

describe("session-request-log store", () => {
	const root = mkdtempSync(join(tmpdir(), "session-request-log-"));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	const record = buildSessionRequestRecord({
		sessionId: "consult:task-1",
		source: "local_llm_client",
		purpose: "consult",
		modelId: "qwen3.8-27b-mlx",
		recordedAt: "2026-08-17T08:00:00.000Z",
		messages: [msg("user", "should I split this card?")],
		toolNames: ["read_files"],
	});

	it("is a no-op while the observe-first gate is closed", async () => {
		await appendSessionRequestRecord(record, { rootDir: root, env: {} });
		expect(await readSessionRequestRecords("consult:task-1", { rootDir: root })).toHaveLength(0);
	});

	it("appends, sanitizes the file name, and reads back verbatim when enabled", async () => {
		const env = { NKLEIN_SESSION_REQUEST_LOG: "1" };
		await appendSessionRequestRecord(record, { rootDir: root, env });
		await appendSessionRequestRecord(record, { rootDir: root, env });
		const records = await readSessionRequestRecords("consult:task-1", { rootDir: root });
		expect(records).toHaveLength(2);
		expect(records[0]?.messagesSha256).toBe(hashWireMessages(record.messages));
		expect(sessionRequestLogPath("consult:task-1", root)).not.toContain(":");
		expect(await listSessionRequestLogSessions({ rootDir: root })).toEqual(["consult_task-1"]);
	});
});
