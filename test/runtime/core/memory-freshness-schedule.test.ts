import { describe, expect, it } from "vitest";
import type { AuditableMemoryNote } from "../../../src/core/memory-freshness-audit.js";
import {
	buildMemoryFreshnessAuditRetentionEvent,
	MEMORY_FRESHNESS_AUDIT_DECISION,
	readLatestMemoryFreshnessAudit,
	runFreshnessAuditIfDue,
} from "../../../src/core/memory-freshness-schedule.js";

/** F5.2 — the pure scheduler gate + F1.26 ledger retention/read for the freshness audit. */

const DAY = 24 * 60 * 60 * 1000;
const config = { enabled: true, paused: false, cadenceMs: 7 * DAY, stalenessThresholdMs: 90 * DAY };
const notes: AuditableMemoryNote[] = [{ id: "a", title: "A", updatedAt: 0, links: [] }];

describe("runFreshnessAuditIfDue", () => {
	it("skips when disabled or paused BEFORE consulting the cadence", () => {
		const now = 100 * DAY;
		expect(runFreshnessAuditIfDue({ config: { ...config, enabled: false }, lastAuditAt: null, notes, now })).toEqual({
			ran: false,
			reason: "disabled",
		});
		expect(runFreshnessAuditIfDue({ config: { ...config, paused: true }, lastAuditAt: null, notes, now })).toEqual({
			ran: false,
			reason: "paused",
		});
	});

	it("skips as not_due within the cadence window and runs once it elapses", () => {
		const lastAuditAt = 100 * DAY;
		const tooSoon = runFreshnessAuditIfDue({ config, lastAuditAt, notes, now: lastAuditAt + 3 * DAY });
		expect(tooSoon).toEqual({ ran: false, reason: "not_due" });

		const due = runFreshnessAuditIfDue({ config, lastAuditAt, notes, now: lastAuditAt + 8 * DAY });
		expect(due.ran).toBe(true);
		if (due.ran) {
			// The single note is >90d stale and orphaned → surfaced by the composed audit.
			expect(due.result.summary.orphaned).toBe(1);
			expect(due.result.auditedAt).toBe(lastAuditAt + 8 * DAY);
		}
	});

	it("runs on first-ever call (lastAuditAt null)", () => {
		expect(runFreshnessAuditIfDue({ config, lastAuditAt: null, notes, now: 100 * DAY }).ran).toBe(true);
	});
});

describe("memory-freshness retention (build + read)", () => {
	it("round-trips the summary + run clock through a ledger transition event", () => {
		const run = runFreshnessAuditIfDue({ config, lastAuditAt: null, notes, now: 200 * DAY });
		if (!run.ran) throw new Error("expected a run");
		const event = buildMemoryFreshnessAuditRetentionEvent({ workspacePathHash: "ws", result: run.result });
		expect(event.kind).toBe("transition");
		expect(event.controllerDecision).toBe(MEMORY_FRESHNESS_AUDIT_DECISION);
		// recordedAt IS the audit clock, so the next gate reads an exact lastAuditAt.
		expect(event.recordedAt).toBe(200 * DAY);

		const retained = readLatestMemoryFreshnessAudit([event]);
		// The single note is >90d stale AND orphaned (no links), so both fire.
		expect(retained).toEqual({
			auditedAt: 200 * DAY,
			notesAudited: 1,
			summary: { stale: 1, orphaned: 1, broken_link: 0, duplicate_title: 0 },
			totalFindings: 2,
		});
	});

	it("returns the LATEST audit per workspace and ignores unrelated events", () => {
		const runAt = (now: number) => {
			const run = runFreshnessAuditIfDue({ config, lastAuditAt: null, notes, now });
			if (!run.ran) throw new Error("expected a run");
			return buildMemoryFreshnessAuditRetentionEvent({ workspacePathHash: "ws", result: run.result });
		};
		const older = runAt(100 * DAY);
		const newer = runAt(300 * DAY);
		const unrelated = { ...newer, controllerDecision: "something_else" };
		expect(readLatestMemoryFreshnessAudit([older, newer, unrelated])?.auditedAt).toBe(300 * DAY);
	});

	it("returns null when no audit has ever been retained", () => {
		expect(readLatestMemoryFreshnessAudit([])).toBeNull();
	});
});
