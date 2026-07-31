/**
 * `nklein dev edit-reliability` — P21.1 step 1: which models struggle to EDIT, from the ledger we already have.
 *
 * Aider's leaderboard shows a 2× swing from edit format alone on our target model class (Qwen2.5-Coder-32B:
 * 16.4% `whole` vs 8.0% `diff`). The routing payoff — weak model → whole-file edits — needs a measured signal
 * first, and this is the cut that needs no new instrumentation.
 *
 * ⚠️ **It is NOT Aider's "correct edit format %"**, and the output says so on every run. The ledger's
 * success/error flag cannot separate a malformed-diff FORMAT failure from a context mismatch or a missing file,
 * so this ranks *"struggles to edit"*. Format-specific attribution is P21.1 step 2 and needs the apply site to
 * tag the failure kind.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type { AgentLedgerEvent } from "../core/agent-attempt-ledger";
import { computeEditReliability, type EditReliabilityAttempt } from "../core/edit-reliability";
import { readAllAgentLedger } from "../state/agent-attempt-ledger-store";

export interface DevEditReliabilityOptions {
	/** Override the classified-call floor below which no rate is reported. */
	minCalls?: string;
	/** Comma-separated edit tool names, when the registered set has drifted. */
	tools?: string;
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

export async function runDevEditReliabilityCommand(options: DevEditReliabilityOptions = {}): Promise<void> {
	const events = await (options.readLedger
		? options.readLedger()
		: readAllAgentLedger({ rootDir: defaultLedgerRoot() })
	).catch(() => [] as AgentLedgerEvent[]);

	const attempts: EditReliabilityAttempt[] = events
		.filter((event): event is Extract<AgentLedgerEvent, { kind: "attempt" }> => event.kind === "attempt")
		.map((event) => ({
			modelId: event.modelId,
			toolCalls: event.toolCalls.map((call) => ({ name: call.name, outcome: call.outcome })),
		}));

	const parsedMin = Number(options.minCalls);
	const report = computeEditReliability({
		attempts,
		...(Number.isFinite(parsedMin) && parsedMin > 0 ? { minCalls: Math.trunc(parsedMin) } : {}),
		...(options.tools
			? {
					editToolNames: options.tools
						.split(",")
						.map((name) => name.trim())
						.filter(Boolean),
				}
			: {}),
	});

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ ...report, attemptsRead: attempts.length }, null, 2)}\n`);
		return;
	}

	process.stdout.write(`${attempts.length} attempt event(s) read.\n${report.summary}\n\n`);
	if (report.ranked.length > 0) {
		process.stdout.write("WORST FIRST:\n");
		for (const row of report.ranked) {
			const percent = ((row.reliability ?? 0) * 100).toFixed(1);
			process.stdout.write(
				`  ${percent.padStart(6)}%  ${row.modelId}  (${row.successes}/${row.classifiedCalls} edit calls` +
					`${row.unknownOutcome > 0 ? `, ${row.unknownOutcome} unrecorded` : ""})\n`,
			);
		}
	}
	for (const row of report.unmeasured) {
		// Printed rather than hidden: a model that never accumulated enough calls is a gap in the evidence, and
		// omitting it would make the measured list look like the whole fleet.
		process.stdout.write(
			`  [insufficient data] ${row.modelId} — ${row.classifiedCalls} classified` +
				`${row.unknownOutcome > 0 ? `, ${row.unknownOutcome} unrecorded` : ""}\n`,
		);
	}
}
