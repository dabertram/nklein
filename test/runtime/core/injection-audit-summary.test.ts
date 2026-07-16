import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectInjectionSpike, summarizeInjectionEvents } from "../../../src/core/injection-audit-summary";
import {
	appendInjectionEvents,
	readAllInjectionEvents,
	type StoredInjectionEvent,
} from "../../../src/state/injection-event-store";

const ev = (over: Partial<StoredInjectionEvent>): StoredInjectionEvent => ({
	surface: "web-research",
	source: "https://a",
	verdict: "block",
	worstFinding: "ignore_previous_instructions",
	at: 1,
	...over,
});

describe("summarizeInjectionEvents (Phase 7S / S11)", () => {
	it("aggregates per surface, worst-first, with distinct sources + top finding", () => {
		const summary = summarizeInjectionEvents([
			ev({ surface: "web-research", source: "https://a", verdict: "block" }),
			ev({ surface: "web-research", source: "https://b", verdict: "block" }),
			ev({ surface: "web-research", source: "https://a", verdict: "suspicious", worstFinding: "role_override" }),
			ev({ surface: "browse_url", source: "https://c", verdict: "suspicious" }),
		]);
		expect(summary.map((s) => s.surface)).toEqual(["web-research", "browse_url"]); // 2 blocked > 0 blocked
		const research = summary[0];
		expect(research).toMatchObject({ total: 3, blocked: 2, suspicious: 1, distinctSources: 2 });
		expect(research?.topFinding).toBe("ignore_previous_instructions"); // 2× vs role_override 1×
	});

	it("returns [] for no events", () => {
		expect(summarizeInjectionEvents([])).toEqual([]);
	});
});

describe("detectInjectionSpike (Phase 7S / S11 alerting)", () => {
	const NOW = 10_000_000;

	it("does not alert when recent blocks are below threshold", () => {
		const alert = detectInjectionSpike([ev({ at: NOW - 1_000 }), ev({ at: NOW - 2_000 })], { now: NOW });
		expect(alert.triggered).toBe(false);
		expect(alert.recentBlocks).toBe(2);
	});

	it("alerts on sustained volume: >= blockThreshold recent blocks", () => {
		const events = [ev({ at: NOW - 1_000 }), ev({ at: NOW - 2_000 }), ev({ at: NOW - 3_000 })];
		const alert = detectInjectionSpike(events, { now: NOW });
		expect(alert.triggered).toBe(true);
		expect(alert.recentBlocks).toBe(3);
		expect(alert.reason).toContain("possible active campaign");
	});

	it("alerts on coordination: many distinct sources even below the volume threshold", () => {
		const events = [
			ev({ at: NOW - 1_000, source: "https://a" }),
			ev({ at: NOW - 1_000, source: "https://b" }),
			ev({ at: NOW - 1_000, source: "https://c" }),
		];
		const alert = detectInjectionSpike(events, { now: NOW, blockThreshold: 99 });
		expect(alert.triggered).toBe(true);
		expect(alert.recentDistinctSources).toBe(3);
		expect(alert.reason).toContain("coordinated");
	});

	it("ignores events outside the window and suspicious (non-block) verdicts", () => {
		const events = [
			ev({ at: NOW - 1_000 }), // in-window block
			ev({ at: NOW - 10 * 60 * 1_000 }), // outside a 5m window
			ev({ at: NOW - 1_000, verdict: "suspicious" }), // in-window but not a block
		];
		const alert = detectInjectionSpike(events, { now: NOW, windowMs: 5 * 60 * 1_000 });
		expect(alert.recentBlocks).toBe(1);
		expect(alert.triggered).toBe(false);
	});

	it("reports per-surface recent block counts worst-first", () => {
		const events = [
			ev({ at: NOW - 1_000, surface: "web_search", source: "s1" }),
			ev({ at: NOW - 1_000, surface: "web_search", source: "s2" }),
			ev({ at: NOW - 1_000, surface: "browse_url", source: "s3" }),
		];
		const alert = detectInjectionSpike(events, { now: NOW });
		expect(alert.bySurface[0]).toEqual({ surface: "web_search", recentBlocks: 2 });
		expect(alert.bySurface[1]).toEqual({ surface: "browse_url", recentBlocks: 1 });
	});
});

describe("injection-event-store round-trip", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "kanban-inj-"));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("appends and reads back events; missing log reads empty", async () => {
		expect(await readAllInjectionEvents({ rootDir: root })).toEqual([]);
		await appendInjectionEvents([ev({}), ev({ source: "https://b" })], { rootDir: root });
		const read = await readAllInjectionEvents({ rootDir: root });
		expect(read).toHaveLength(2);
		expect(summarizeInjectionEvents(read)[0]?.blocked).toBe(2);
	});
});
