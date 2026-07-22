/**
 * F5.2b effectful freshness rail. Basic Memory's durable source of truth is the mounted Markdown tree, so the host
 * scheduler reads that tree through the already-injected note reader instead of starting a write-capable MCP server
 * merely to enumerate files. The cadence is checked from the workspace ledger BEFORE touching either note root.
 */

import type { AgentLedgerEvent, AgentTransitionEvent } from "../core/agent-attempt-ledger.js";
import type { AuditableMemoryNote } from "../core/memory-freshness-audit.js";
import { shouldRunFreshnessAudit } from "../core/memory-freshness-audit.js";
import {
	buildMemoryFreshnessAuditRetentionEvent,
	type RetainedMemoryFreshnessAudit,
	readLatestMemoryFreshnessAudit,
	runMemoryAuditPass,
} from "../core/memory-freshness-schedule.js";

export interface ScheduledMemoryFreshnessConfig {
	readonly enabled: boolean;
	readonly paused: boolean;
	readonly cadenceMs: number;
	readonly stalenessThresholdMs: number;
}

export interface MemoryFreshnessAuditRuntimeDeps {
	readLedger(workspacePathHash: string): Promise<AgentLedgerEvent[]>;
	readNotes(rootDir: string): Promise<AuditableMemoryNote[]>;
	appendEvent(event: AgentTransitionEvent): Promise<void>;
}

export type ScheduledMemoryFreshnessOutcome =
	| { readonly ran: false; readonly reason: "disabled" | "paused" }
	| { readonly ran: false; readonly reason: "not_due"; readonly nextAuditAt: number }
	| { readonly ran: true; readonly audit: RetainedMemoryFreshnessAudit };

/** Run at most one due audit and durably retain its bounded operator summary. */
export async function runScheduledMemoryFreshnessAudit(input: {
	readonly config: ScheduledMemoryFreshnessConfig;
	readonly workspacePathHash: string;
	readonly noteRoots: readonly string[];
	readonly now: number;
	readonly deps: MemoryFreshnessAuditRuntimeDeps;
}): Promise<ScheduledMemoryFreshnessOutcome> {
	if (!input.config.enabled) return { ran: false, reason: "disabled" };
	if (input.config.paused) return { ran: false, reason: "paused" };

	const events = await input.deps.readLedger(input.workspacePathHash);
	const latest = readLatestMemoryFreshnessAudit(events);
	if (
		!shouldRunFreshnessAudit(
			latest?.auditedAt ?? null,
			{ cadenceMs: input.config.cadenceMs, stalenessThresholdMs: input.config.stalenessThresholdMs },
			input.now,
		)
	) {
		return {
			ran: false,
			reason: "not_due",
			nextAuditAt: (latest?.auditedAt ?? input.now) + input.config.cadenceMs,
		};
	}

	const notes = (await Promise.all(input.noteRoots.map((root) => input.deps.readNotes(root)))).flat();
	const pass = runMemoryAuditPass({
		config: input.config,
		lastAuditAt: latest?.auditedAt ?? null,
		notes,
		now: input.now,
	});
	if (!pass.freshness.ran) {
		return pass.freshness.reason === "not_due"
			? { ran: false, reason: "not_due", nextAuditAt: input.now + input.config.cadenceMs }
			: { ran: false, reason: pass.freshness.reason };
	}
	const event = buildMemoryFreshnessAuditRetentionEvent({
		workspacePathHash: input.workspacePathHash,
		result: pass.freshness.result,
	});
	await input.deps.appendEvent(event);
	const audit = readLatestMemoryFreshnessAudit([event]);
	if (!audit) throw new Error("Memory freshness retention event could not be read back.");
	return { ran: true, audit };
}

export interface MemoryFreshnessRuntimeStatus {
	readonly enabled: boolean;
	readonly paused: boolean;
	readonly lastAuditAt: number | null;
	readonly nextAuditAt: number | null;
	readonly audit: RetainedMemoryFreshnessAudit | null;
}

/** Fold persisted config + ledger evidence for the Settings status surface without rescanning the corpus. */
export function memoryFreshnessRuntimeStatus(input: {
	readonly config: ScheduledMemoryFreshnessConfig;
	readonly events: readonly AgentLedgerEvent[];
}): MemoryFreshnessRuntimeStatus {
	const audit = readLatestMemoryFreshnessAudit(input.events);
	return {
		enabled: input.config.enabled,
		paused: input.config.paused,
		lastAuditAt: audit?.auditedAt ?? null,
		nextAuditAt: audit ? audit.auditedAt + input.config.cadenceMs : null,
		audit,
	};
}
