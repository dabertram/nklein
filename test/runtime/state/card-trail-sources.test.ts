import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CardTrail, TrailSourceStatus } from "../../../src/core/card-lifecycle-trail";
import { gatherCardTrail } from "../../../src/state/card-trail-sources";

/**
 * Coverage for a module the extended coverage audit found unexercised (2026-08-08).
 *
 * This is the reader half of `dev card-timeline` and the product UI — four on-disk sources merged into one
 * chronological trail. Its own header states the property that matters: **"this source had no events" and "this
 * source could not be read" are different facts**, and collapsing them makes a deleted log look like a quiet
 * card. That is absence-of-evidence standing in for evidence-of-absence, and a trail whose failure mode is
 * silence is exactly where it does the most damage — so it is pinned per source, in both directions.
 *
 * The second concentration is ORDER, because a chronological tool that orders wrongly has failed at the one
 * thing it exists for. The module carries a comment about a real defect found this way: ledger records stamp
 * `recordedAt`, and reading `at`/`createdAt` left 61 real events unclocked and sorted to the front.
 */
let home: string;

const CARD = "card-42";

function writeFileAt(relativePath: string, content: string): void {
	const full = join(home, relativePath);
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, content);
}

function telemetry(...records: Record<string, unknown>[]): void {
	writeFileAt(".nklein/nklein/telemetry/events.jsonl", records.map((record) => JSON.stringify(record)).join("\n"));
}

function ledger(...records: Record<string, unknown>[]): void {
	writeFileAt("ledger/attempts.jsonl", records.map((record) => JSON.stringify(record)).join("\n"));
}

function board(columns: { id: string; cards: { id: string; updatedAt?: number }[] }[], dependencies = []): void {
	writeFileAt(".nklein/nklein/workspaces/ws1/board.json", JSON.stringify({ columns, dependencies }));
}

function statusOf(trail: CardTrail, source: string): TrailSourceStatus | undefined {
	return trail.sourcesRead.find((status) => status.source === source);
}

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "nklein-card-trail-"));
});

afterEach(() => {
	rmSync(home, { force: true, recursive: true });
});

describe("source availability", () => {
	it("reports every source as UNAVAILABLE on an empty home, and marks the trail partial", async () => {
		// The headline property. With nothing on disk the honest answer is "I could not read any of this", not an
		// empty trail — an empty trail reads as "nothing happened to this card".
		const trail = await gatherCardTrail({ home, cardId: CARD });

		expect(trail.events).toEqual([]);
		expect(trail.partial).toBe(true);
		for (const source of ["observation", "ledger", "log"]) {
			expect(statusOf(trail, source)?.available, `${source} claimed to be available`).toBe(false);
			expect(statusOf(trail, source)?.note).toMatch(/absent/);
		}
	});

	it("distinguishes a PRESENT-but-quiet source from an ABSENT one", async () => {
		// The distinction stated in the module header, shown side by side: telemetry exists and holds nothing about
		// this card; the ledger directory does not exist at all. Both yield zero events, and they must not report
		// the same thing.
		telemetry({ createdAt: 1, message: "about another card", metadata: { taskId: "other-card" } });
		const trail = await gatherCardTrail({ home, cardId: CARD });

		expect(statusOf(trail, "observation")).toMatchObject({ available: true, eventCount: 0, note: "" });
		expect(statusOf(trail, "ledger")).toMatchObject({ available: false, eventCount: 0 });
	});

	it("is NOT partial once every source is readable", async () => {
		telemetry({ createdAt: 1, message: "x", metadata: { taskId: CARD } });
		ledger({ recordedAt: 2, taskId: CARD, event: "attempt" });
		writeFileAt("runtime.log", `[nklein] ${CARD} started\n`);
		board([{ id: "done", cards: [{ id: CARD, updatedAt: 3 }] }]);

		expect((await gatherCardTrail({ home, cardId: CARD })).partial).toBe(false);
	});

	it("calls a card missing from an EXISTING board 'not found', not 'board unavailable'", async () => {
		// A readable board that simply does not list the card is a real, trustworthy answer; conflating it with an
		// unreadable board would flag the whole trail as incomplete for no reason.
		board([{ id: "done", cards: [{ id: "someone-else" }] }]);
		const status = statusOf(await gatherCardTrail({ home, cardId: CARD }), "board");

		expect(status).toMatchObject({ available: true, eventCount: 0 });
		expect(status?.note).toMatch(/not found on any board/);
	});
});

describe("ledger reading", () => {
	it("clocks events from `recordedAt` — the field the ledger actually stamps", async () => {
		// The regression the module's own comment records: reading `at`/`createdAt` left every ledger event at 0,
		// which sorts them all to the FRONT. In a chronological tool that is not cosmetic — it is the wrong answer.
		ledger({ recordedAt: 5000, taskId: CARD, event: "attempt", outcome: "success" });
		const trail = await gatherCardTrail({ home, cardId: CARD });

		expect(trail.events).toHaveLength(1);
		expect(trail.events[0]?.at).toBe(5000);
	});

	it("orders ledger events by their real clock, not by file order", async () => {
		// The consequence made visible: written newest-first, they must come back oldest-first.
		ledger({ recordedAt: 900, taskId: CARD, event: "later" }, { recordedAt: 100, taskId: CARD, event: "earlier" });
		const trail = await gatherCardTrail({ home, cardId: CARD });

		expect(trail.events.map((event) => event.kind)).toEqual(["earlier", "later"]);
	});

	it("LIFTS an attempt's tool calls into the timeline instead of burying them in metadata", async () => {
		// "Which tool ran just before this went wrong" is among the commonest questions a stalled card raises, and
		// a tool call left nested inside an attempt blob is invisible to anyone scanning the trail.
		ledger({
			recordedAt: 100,
			taskId: CARD,
			event: "attempt",
			outcome: "success",
			toolCalls: [
				{ name: "read_file", outcome: "ok", filePaths: ["a.ts"] },
				{ name: "edit_file", outcome: "error" },
			],
		});
		const trail = await gatherCardTrail({ home, cardId: CARD });

		const toolCalls = trail.events.filter((event) => event.kind === "tool_call");
		expect(toolCalls).toHaveLength(2);
		expect(toolCalls[0]?.detail).toBe("read_file → ok (a.ts)");
		expect(toolCalls[1]?.detail).toBe("edit_file → error");
	});

	it("keeps tool calls AFTER their attempt and in their own order", async () => {
		// They share the attempt's timestamp because the ledger does not stamp each call; the fractional offset is
		// what stops a stable sort from scrambling a sequence the record does state.
		ledger({
			recordedAt: 100,
			taskId: CARD,
			event: "attempt",
			toolCalls: [{ name: "first" }, { name: "second" }, { name: "third" }],
		});
		const trail = await gatherCardTrail({ home, cardId: CARD });

		expect(trail.events.map((event) => event.kind)).toEqual(["attempt", "tool_call", "tool_call", "tool_call"]);
		expect(trail.events.slice(1).map((event) => event.detail.split(" ")[0])).toEqual(["first", "second", "third"]);
	});

	it("names a tool call's missing fields rather than rendering `undefined`", async () => {
		ledger({ recordedAt: 100, taskId: CARD, event: "attempt", toolCalls: [{}] });
		const trail = await gatherCardTrail({ home, cardId: CARD });

		expect(trail.events[1]?.detail).toBe("<unnamed> → <no outcome>");
	});

	it("caps the file list so one wide tool call cannot swamp the line", async () => {
		ledger({
			recordedAt: 100,
			taskId: CARD,
			event: "attempt",
			toolCalls: [{ name: "grep", outcome: "ok", filePaths: ["a", "b", "c", "d", "e"] }],
		});
		const trail = await gatherCardTrail({ home, cardId: CARD });

		expect(trail.events[1]?.detail).toBe("grep → ok (a, b, c)");
	});

	it("tolerates an attempt with NO tool calls, and a non-array toolCalls field", async () => {
		ledger(
			{ recordedAt: 100, taskId: CARD, event: "no-calls" },
			{ recordedAt: 200, taskId: CARD, event: "bad-shape", toolCalls: "not an array" },
		);
		const trail = await gatherCardTrail({ home, cardId: CARD });

		expect(trail.events.map((event) => event.kind)).toEqual(["no-calls", "bad-shape"]);
	});
});

describe("malformed input", () => {
	it("skips ONE bad line without losing the rest of the trail", async () => {
		// A trail is a forensic record; a single truncated write must not erase what surrounds it. This is the
		// difference between a partly-recovered history and no history.
		writeFileAt(
			"ledger/attempts.jsonl",
			[
				JSON.stringify({ recordedAt: 100, taskId: CARD, event: "before" }),
				`{"taskId":"${CARD}","truncated`,
				JSON.stringify({ recordedAt: 300, taskId: CARD, event: "after" }),
			].join("\n"),
		);
		const trail = await gatherCardTrail({ home, cardId: CARD });

		expect(trail.events.map((event) => event.kind)).toEqual(["before", "after"]);
		// The source is still AVAILABLE — it was read; only a line was unparseable.
		expect(statusOf(trail, "ledger")).toMatchObject({ available: true, eventCount: 2 });
	});

	it("survives an unparseable board.json", async () => {
		writeFileAt(".nklein/nklein/workspaces/ws1/board.json", "{ not json");
		await expect(gatherCardTrail({ home, cardId: CARD })).resolves.toBeDefined();
	});

	it("falls through a broken workspace to a later one that DOES list the card", async () => {
		// Boards are scanned per workspace, and one corrupt file must not hide a card recorded in the next.
		writeFileAt(".nklein/nklein/workspaces/aaa-broken/board.json", "{ not json");
		writeFileAt(
			".nklein/nklein/workspaces/zzz-good/board.json",
			JSON.stringify({ columns: [{ id: "done", cards: [{ id: CARD, updatedAt: 7 }] }] }),
		);
		const trail = await gatherCardTrail({ home, cardId: CARD });

		expect(trail.events.map((event) => event.kind)).toEqual(["final_lane"]);
		expect(trail.events[0]?.detail).toBe('card is in lane "done"');
	});
});

describe("runtime log", () => {
	it("sorts un-timestamped log lines LAST rather than inventing clock values", async () => {
		// The log carries no timestamps. Synthesising them would fabricate precision; placing them last keeps the
		// trail honest about what is actually ordered.
		ledger({ recordedAt: 10, taskId: CARD, event: "real-clock" });
		writeFileAt("runtime.log", `[nklein] ${CARD} line one\n[nklein] ${CARD} line two\n`);
		const trail = await gatherCardTrail({ home, cardId: CARD });

		expect(trail.events.map((event) => event.kind)).toEqual(["real-clock", "runtime_log", "runtime_log"]);
	});

	it("preserves LINE ORDER within the log, which is its only ordering information", async () => {
		writeFileAt("runtime.log", `[nklein] ${CARD} first\n[nklein] ${CARD} second\n[nklein] ${CARD} third\n`);
		const trail = await gatherCardTrail({ home, cardId: CARD });

		expect(trail.events.map((event) => event.detail)).toEqual([`${CARD} first`, `${CARD} second`, `${CARD} third`]);
		expect(trail.events.map((event) => event.metadata?.lineOrdinal)).toEqual([0, 1, 2]);
	});

	it("ignores log lines that do not mention the card", async () => {
		writeFileAt("runtime.log", `[nklein] other-card noise\n[nklein] ${CARD} mine\n`);
		const trail = await gatherCardTrail({ home, cardId: CARD });

		expect(trail.events).toHaveLength(1);
		expect(trail.events[0]?.detail).toBe(`${CARD} mine`);
	});
});

describe("board lane", () => {
	it("reports the card's lane and what is blocking it", async () => {
		writeFileAt(
			".nklein/nklein/workspaces/ws1/board.json",
			JSON.stringify({
				columns: [{ id: "blocked", cards: [{ id: CARD, updatedAt: 42 }] }],
				dependencies: [
					{ fromTaskId: CARD, toTaskId: "dep-1" },
					{ fromTaskId: CARD, toTaskId: "dep-2" },
					{ fromTaskId: "someone-else", toTaskId: "dep-3" },
				],
			}),
		);
		const trail = await gatherCardTrail({ home, cardId: CARD });

		expect(trail.events[0]?.metadata).toMatchObject({
			lane: "blocked",
			blockedBy: ["dep-1", "dep-2"],
			blockedByCount: 2,
		});
	});

	it("does not report a dependency edge pointing AT the card as blocking it", async () => {
		// `from` blocks on `to`; reading the edge backwards would report a card as blocked by its own dependents,
		// which inverts the answer to "why is this stuck".
		writeFileAt(
			".nklein/nklein/workspaces/ws1/board.json",
			JSON.stringify({
				columns: [{ id: "ready", cards: [{ id: CARD }] }],
				dependencies: [{ fromTaskId: "downstream", toTaskId: CARD }],
			}),
		);
		const trail = await gatherCardTrail({ home, cardId: CARD });

		expect(trail.events[0]?.metadata).toMatchObject({ blockedBy: [], blockedByCount: 0 });
	});
});

describe("observations", () => {
	it("prefers the metadata category over the raw signal for an event's kind", async () => {
		telemetry(
			{ createdAt: 1, message: "a", signal: "sig", metadata: { taskId: CARD, category: "cat" } },
			{ createdAt: 2, message: "b", signal: "sig", metadata: { taskId: CARD } },
		);
		const trail = await gatherCardTrail({ home, cardId: CARD });

		expect(trail.events.map((event) => event.kind)).toEqual(["cat", "sig"]);
	});

	it("keeps severity alongside the record's own metadata", async () => {
		telemetry({ createdAt: 1, message: "m", severity: "warn", metadata: { taskId: CARD, extra: "kept" } });
		const trail = await gatherCardTrail({ home, cardId: CARD });

		expect(trail.events[0]?.metadata).toMatchObject({ severity: "warn", extra: "kept" });
	});
});
