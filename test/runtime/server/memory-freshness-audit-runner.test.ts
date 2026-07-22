import { describe, expect, it, vi } from "vitest";
import type { AgentLedgerEvent, AgentTransitionEvent } from "../../../src/core/agent-attempt-ledger.js";
import {
	memoryFreshnessRuntimeStatus,
	runScheduledMemoryFreshnessAudit,
} from "../../../src/server/memory-freshness-audit-runner.js";

const DAY = 24 * 60 * 60 * 1000;
const config = { enabled: true, paused: false, cadenceMs: 7 * DAY, stalenessThresholdMs: 90 * DAY };

function harness(events: AgentLedgerEvent[] = []) {
	const appended: AgentTransitionEvent[] = [];
	const readNotes = vi.fn(async (root: string) => [{ id: root, title: root, updatedAt: 0, links: [] as string[] }]);
	return {
		appended,
		readNotes,
		deps: {
			readLedger: vi.fn(async () => events),
			readNotes,
			appendEvent: vi.fn(async (event: AgentTransitionEvent) => {
				appended.push(event);
			}),
		},
	};
}

describe("runScheduledMemoryFreshnessAudit", () => {
	it("checks disabled/paused policy before reading the ledger or note roots", async () => {
		for (const override of [{ enabled: false }, { paused: true }]) {
			const h = harness();
			const outcome = await runScheduledMemoryFreshnessAudit({
				config: { ...config, ...override },
				workspacePathHash: "ws",
				noteRoots: ["project", "global"],
				now: 100 * DAY,
				deps: h.deps,
			});
			expect(outcome.ran).toBe(false);
			expect(h.deps.readLedger).not.toHaveBeenCalled();
			expect(h.readNotes).not.toHaveBeenCalled();
		}
	});

	it("reads project and global notes once, audits, and retains the result when due", async () => {
		const h = harness();
		const outcome = await runScheduledMemoryFreshnessAudit({
			config,
			workspacePathHash: "ws",
			noteRoots: ["project", "global"],
			now: 100 * DAY,
			deps: h.deps,
		});
		expect(outcome.ran).toBe(true);
		expect(h.readNotes.mock.calls.map(([root]) => root)).toEqual(["project", "global"]);
		expect(h.appended).toHaveLength(1);
		if (outcome.ran) {
			expect(outcome.audit.notesAudited).toBe(2);
			expect(outcome.audit.totalFindings).toBe(4);
		}
	});

	it("uses retained ledger time to skip before any note scan", async () => {
		const first = harness();
		await runScheduledMemoryFreshnessAudit({
			config,
			workspacePathHash: "ws",
			noteRoots: ["project"],
			now: 100 * DAY,
			deps: first.deps,
		});
		const next = harness(first.appended);
		const outcome = await runScheduledMemoryFreshnessAudit({
			config,
			workspacePathHash: "ws",
			noteRoots: ["project"],
			now: 103 * DAY,
			deps: next.deps,
		});
		expect(outcome).toEqual({ ran: false, reason: "not_due", nextAuditAt: 107 * DAY });
		expect(next.readNotes).not.toHaveBeenCalled();
	});
});

it("projects last/next audit status from the durable event", async () => {
	const h = harness();
	await runScheduledMemoryFreshnessAudit({
		config,
		workspacePathHash: "ws",
		noteRoots: ["project"],
		now: 100 * DAY,
		deps: h.deps,
	});
	const status = memoryFreshnessRuntimeStatus({ config, events: h.appended });
	expect(status.lastAuditAt).toBe(100 * DAY);
	expect(status.nextAuditAt).toBe(107 * DAY);
	expect(status.audit?.topFindings.length).toBeGreaterThan(0);
});
