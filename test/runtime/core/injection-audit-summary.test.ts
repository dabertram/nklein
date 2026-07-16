import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { summarizeInjectionEvents } from "../../../src/core/injection-audit-summary";
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
