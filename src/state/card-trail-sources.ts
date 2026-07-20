/**
 * Gather one card's trail from every per-card source on disk. EFFECTFUL; the judging lives in
 * `card-lifecycle-trail.ts`.
 *
 * Extracted from `dev card-timeline` so the CLI and the product UI share ONE gatherer. N17's rule applies to
 * readers as much as to writers: two implementations of "what happened to this card" would drift, and the day
 * they disagree is the day neither can be trusted. A trail's failure mode is silence, so a second reader that
 * quietly misses a source is worse than no second reader at all.
 *
 * Every source reports its own availability. "This source had no events" and "this source could not be read"
 * are different facts, and only one of them means the trail is trustworthy — collapsing them makes a deleted log
 * look like a quiet card.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCardTrail, type CardTrail, type TrailEvent, type TrailSourceStatus } from "../core/card-lifecycle-trail";

async function readObservations(home: string, cardId: string): Promise<[TrailEvent[], TrailSourceStatus]> {
	const dir = join(home, ".nklein", "nklein", "telemetry");
	const files = await readdir(dir).catch(() => null);
	if (files === null) {
		return [[], { source: "observation", available: false, eventCount: 0, note: "telemetry directory absent" }];
	}
	const events: TrailEvent[] = [];
	for (const file of files.filter((name) => name.endsWith(".jsonl"))) {
		const text = await readFile(join(dir, file), "utf8").catch(() => "");
		for (const line of text.split("\n")) {
			if (!line.includes(cardId)) {
				continue;
			}
			try {
				const record = JSON.parse(line) as {
					createdAt?: number;
					message?: string;
					signal?: string;
					severity?: string;
					metadata?: Record<string, unknown> | null;
				};
				events.push({
					at: record.createdAt ?? 0,
					source: "observation",
					kind: String(record.metadata?.category ?? record.signal ?? "observation"),
					detail: record.message ?? "",
					// Verbatim: over-covering is the point, and the field that matters is rarely the one anticipated.
					metadata: { severity: record.severity, ...(record.metadata ?? {}) },
				});
			} catch {
				// A malformed record is skipped, never fatal — one bad line must not erase the rest of the trail.
			}
		}
	}
	return [events, { source: "observation", available: true, eventCount: events.length, note: "" }];
}

async function readLedger(home: string, cardId: string): Promise<[TrailEvent[], TrailSourceStatus]> {
	const dir = join(home, "ledger");
	const files = await readdir(dir).catch(() => null);
	if (files === null) {
		return [[], { source: "ledger", available: false, eventCount: 0, note: "ledger directory absent" }];
	}
	const events: TrailEvent[] = [];
	for (const file of files.filter((name) => name.endsWith(".jsonl"))) {
		const text = await readFile(join(dir, file), "utf8").catch(() => "");
		for (const line of text.split("\n")) {
			if (!line.includes(cardId)) {
				continue;
			}
			try {
				const record = JSON.parse(line) as Record<string, unknown>;
				// The ledger stamps `recordedAt`; reading `at`/`createdAt` left every ledger event unclocked and
				// sorted to the front — found by running this against a real card, where 61 events rendered with
				// "(no timestamp)". An unclocked event in a CHRONOLOGICAL tool is not a cosmetic defect: it puts
				// the events in the wrong order, which is the one thing the tool is for.
				const at = Number(record.recordedAt ?? record.at ?? record.createdAt ?? 0);
				events.push({
					at,
					source: "ledger",
					kind: String(record.event ?? record.kind ?? "ledger"),
					detail: String(record.outcome ?? record.reason ?? record.strategy ?? record.kind ?? ""),
					metadata: record,
				});

				// An `attempt` record carries its TOOL CALLS in an array. Left inside metadata they are effectively
				// invisible: a reader scanning a timeline sees "attempt: success" and has to open a nested blob to
				// learn what the agent actually DID. Interleaving them is the difference between a trail that records
				// tool use and one that shows it — and "which tool ran just before this went wrong" is among the
				// commonest questions a stalled card raises.
				//
				// They share the attempt's timestamp (the ledger does not stamp each call), so a fractional offset
				// preserves their ORDER within the attempt without inventing precision the record does not have.
				const toolCalls = Array.isArray(record.toolCalls) ? record.toolCalls : [];
				toolCalls.forEach((call, index) => {
					const toolCall = call as { name?: string; outcome?: string; filePaths?: string[] };
					events.push({
						at: at + (index + 1) / 1000,
						source: "ledger",
						kind: "tool_call",
						detail: `${toolCall.name ?? "<unnamed>"} → ${toolCall.outcome ?? "<no outcome>"}${
							toolCall.filePaths?.length ? ` (${toolCall.filePaths.slice(0, 3).join(", ")})` : ""
						}`,
						metadata: toolCall as Record<string, unknown>,
					});
				});
			} catch {
				// skip
			}
		}
	}
	return [events, { source: "ledger", available: true, eventCount: events.length, note: "" }];
}

async function readRuntimeLog(home: string, cardId: string): Promise<[TrailEvent[], TrailSourceStatus]> {
	const text = await readFile(join(home, "runtime.log"), "utf8").catch(() => null);
	if (text === null) {
		return [[], { source: "log", available: false, eventCount: 0, note: "runtime.log absent" }];
	}
	// The runtime log carries no timestamps, so line ORDER is the only ordering information it has. Synthesising
	// clock values would fabricate precision; instead they sort after timestamped events, and the ordinal is
	// preserved so the sequence within the log is exact.
	const events = text
		.split("\n")
		.filter((line) => line.includes(cardId))
		.map((line, index) => ({
			at: Number.MAX_SAFE_INTEGER - 1_000_000 + index,
			source: "log" as const,
			kind: "runtime_log",
			detail: line.replace(/^\[nklein\]\s*/, "").trim(),
			metadata: { lineOrdinal: index, note: "runtime.log has no timestamps — ordered by line, shown last" },
		}));
	return [events, { source: "log", available: true, eventCount: events.length, note: "" }];
}

async function readBoardLane(home: string, cardId: string): Promise<[TrailEvent[], TrailSourceStatus]> {
	const dir = join(home, ".nklein", "nklein", "workspaces");
	const entries = await readdir(dir).catch(() => null);
	if (entries === null) {
		return [[], { source: "board", available: false, eventCount: 0, note: "workspaces directory absent" }];
	}
	for (const entry of entries) {
		const raw = await readFile(join(dir, entry, "board.json"), "utf8").catch(() => "");
		if (!raw) {
			continue;
		}
		try {
			const board = JSON.parse(raw) as {
				columns?: { id: string; cards?: { id: string; updatedAt?: number }[] }[];
				dependencies?: { fromTaskId: string; toTaskId: string }[];
			};
			for (const column of board.columns ?? []) {
				for (const card of column.cards ?? []) {
					if (card.id !== cardId) {
						continue;
					}
					const blockedBy = (board.dependencies ?? [])
						.filter((edge) => edge.fromTaskId === cardId)
						.map((edge) => edge.toTaskId);
					return [
						[
							{
								at: card.updatedAt ?? 0,
								source: "board",
								kind: "final_lane",
								detail: `card is in lane "${column.id}"`,
								metadata: { lane: column.id, blockedBy, blockedByCount: blockedBy.length },
							},
						],
						{ source: "board", available: true, eventCount: 1, note: "" },
					];
				}
			}
		} catch {
			// try the next workspace
		}
	}
	return [[], { source: "board", available: true, eventCount: 0, note: "card not found on any board" }];
}

/** Read every source and build the merged trail for one card. */
export async function gatherCardTrail(input: { home: string; cardId: string }): Promise<CardTrail> {
	const [observations, ledger, log, board] = await Promise.all([
		readObservations(input.home, input.cardId),
		readLedger(input.home, input.cardId),
		readRuntimeLog(input.home, input.cardId),
		readBoardLane(input.home, input.cardId),
	]);
	return buildCardTrail({
		cardId: input.cardId,
		events: [...observations[0], ...ledger[0], ...log[0], ...board[0]],
		sourcesRead: [observations[1], ledger[1], log[1], board[1]],
	});
}
