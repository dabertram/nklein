// §dsh#31 slice B1 — the write-ahead injection log core: exit-diff capture + kind classification. The contract
// under test: every hook-added row is recorded (unknown kinds as "other", never dropped), pre-existing rows are
// not, and merged rows attribute by their embedded markers.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
	buildSessionInjectionRecords,
	classifyInjectionKind,
	diffInjectedMessages,
} from "../../../src/core/session-injection-log";
import {
	appendSessionInjectionRecords,
	readSessionInjectionRecords,
} from "../../../src/state/session-injection-log-store";

const msg = (id: string | undefined, role: string, content: string) => ({ id, role, content });

describe("classifyInjectionKind", () => {
	it("classifies by the injectors' structured id prefixes first", () => {
		expect(classifyInjectionKind(msg("kanban-drift-critic-3", "user", "x"))).toBe("drift_critic_note");
		expect(classifyInjectionKind(msg("kanban-stall-replan-9", "user", "x"))).toBe("stall_replan");
		expect(classifyInjectionKind(msg("kanban-focus-chain-rail-1", "user", "x"))).toBe("focus_chain_rail");
		expect(classifyInjectionKind(msg("kanban-tool-trust-5", "user", "x"))).toBe("tool_trust_guidance");
	});

	it("falls back to content markers, then 'other' — never drops", () => {
		expect(classifyInjectionKind(msg("merged-1", "user", "a\n[!Klein context focus brief]\nb"))).toBe("focus_brief");
		expect(classifyInjectionKind(msg(undefined, "user", "Do this now [!Klein repo map: compact]"))).toBe(
			"repo_map_rail",
		);
		expect(classifyInjectionKind(msg("x", "user", "Already attempted this task (do NOT repeat these)"))).toBe(
			"retry_note",
		);
		expect(classifyInjectionKind(msg("mystery", "user", "some new injector"))).toBe("other");
	});
});

describe("diffInjectedMessages", () => {
	const entry = [msg("m1", "system", "shell"), msg("m2", "user", "task")];

	it("returns only rows whose id was absent at entry (or that carry no id)", () => {
		const outgoing = [...entry, msg("kanban-drift-critic-0", "user", "note"), msg(undefined, "user", "anon")];
		const added = diffInjectedMessages(entry, outgoing);
		expect(added.map((m) => m.content)).toEqual(["note", "anon"]);
	});

	it("returns empty when the hook added nothing", () => {
		expect(diffInjectedMessages(entry, entry)).toHaveLength(0);
	});
});

describe("buildSessionInjectionRecords + store round-trip", () => {
	const root = mkdtempSync(join(tmpdir(), "session-injection-log-"));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	it("builds classified records and round-trips through the per-session store", async () => {
		const records = buildSessionInjectionRecords({
			sessionId: "task-9",
			entryMessages: [msg("m1", "user", "task")],
			outgoingMessages: [
				msg("m1", "user", "task"),
				msg("kanban-stall-replan-7", "user", "replan now"),
				msg("merged-2", "user", "x [!Klein context focus brief] y"),
			],
			recordedAt: "2026-08-17T14:00:00.000Z",
		});
		expect(records.map((record) => record.kind)).toEqual(["stall_replan", "focus_brief"]);
		await appendSessionInjectionRecords(records, { rootDir: root });
		const readBack = await readSessionInjectionRecords("task-9", { rootDir: root });
		expect(readBack).toHaveLength(2);
		expect(readBack[1]?.content).toContain("focus brief");
	});

	it("honors the explicit-off escape hatch", async () => {
		const records = buildSessionInjectionRecords({
			sessionId: "task-off",
			entryMessages: [],
			outgoingMessages: [msg("kanban-drift-critic-1", "user", "note")],
			recordedAt: "2026-08-17T14:00:00.000Z",
		});
		await appendSessionInjectionRecords(records, { rootDir: root, env: { NKLEIN_INJECTION_LOG: "0" } });
		expect(await readSessionInjectionRecords("task-off", { rootDir: root })).toHaveLength(0);
	});
});
