/**
 * `nklein dev ledger-fields` — which attempt-ledger fields are carrying data, and which are silently dead.
 *
 * The attempt ledger is the evidence substrate for fitness, routing, the §5.Z matrix and Phase 15's flip campaign.
 * A field nobody populates does not fail: its projection returns a clean empty result. This surfaces the ones that
 * are structurally incapable of producing a number, and — as importantly — refuses to call an emptiness a defect
 * when the design requires it.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type { AgentLedgerEvent } from "../core/agent-attempt-ledger";
import { auditLedgerFields, type LedgerFieldStatus } from "../core/ledger-field-audit";
import { readAllAgentLedger } from "../state/agent-attempt-ledger-store";

export interface DevLedgerFieldsOptions {
	json?: boolean;
	/** Injected in tests; defaults to the real ledger read. */
	readLedger?: () => Promise<AgentLedgerEvent[]>;
}

function defaultLedgerRoot(): string {
	const override = process.env.NKLEIN_AGENT_LEDGER_ROOT?.trim();
	return override && override.length > 0
		? override
		: join(resolveNkleinRuntimeHomePath(homedir()), "agent-attempt-ledger");
}

/** Actionable first, then the ones whose emptiness is explained, so the signal is not buried in the noise. */
const STATUS_ORDER: Record<LedgerFieldStatus, number> = {
	silent: 0,
	partial: 1,
	undeclared: 2,
	unknown_enablement: 3,
	too_new_to_judge: 3,
	healthy: 4,
	sparse_as_expected: 5,
	correctly_empty: 6,
};

export async function runDevLedgerFieldsCommand(options: DevLedgerFieldsOptions = {}): Promise<void> {
	const events = await (options.readLedger
		? options.readLedger()
		: readAllAgentLedger({ rootDir: defaultLedgerRoot() })
	).catch(() => [] as AgentLedgerEvent[]);

	const attempts = events.filter((event) => event.kind === "attempt") as unknown as Record<string, unknown>[];
	// `enabledFlags` deliberately NOT taken from the current process env: it proves what is on NOW, and these
	// events were written by other processes on other days. Unknown is the honest input.
	const report = auditLedgerFields({ attempts, enabledFlags: null });

	if (options.json) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		return;
	}

	process.stdout.write(`${report.summary}\n\n`);
	for (const finding of [...report.findings].sort(
		(left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || left.field.localeCompare(right.field),
	)) {
		const marker = finding.status === "silent" ? "🔴" : finding.status === "partial" ? "⚠️ " : "  ";
		process.stdout.write(
			`${marker} ${finding.status.toUpperCase().padEnd(20)} ${finding.field.padEnd(20)} ${finding.populated}/${finding.total}\n`,
		);
		if (finding.status === "silent" || finding.status === "undeclared") {
			process.stdout.write(`     ${finding.detail}\n`);
		}
	}
	// Exit non-zero only on the actionable class: an explained emptiness must never fail a script, or the check
	// gets ignored exactly like a linter that cries wolf.
	process.exitCode = report.findings.some((finding) => finding.status === "silent") ? 1 : 0;
}
