import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type { AgentLedgerEvent } from "../core/agent-attempt-ledger";
import { buildMechanismDecision } from "../core/mechanism-decision-report";
import {
	buildTaskOutcomeIndex,
	joinToolGateObservations,
	type ToolGateObservationRecord,
} from "../core/tool-gate-observation-join";
import { readAllAgentLedger } from "../state/agent-attempt-ledger-store";
import { readSelfObservationEvents } from "../telemetry/self-observation-sink";

/**
 * `nklein dev mechanism-decision` — P15.3's gate: is an observe-first mechanism right often enough to ENFORCE?
 *
 * P15.2 shipped `mechanism-decision-report` and nothing ever called it, so no verdict could be produced and the
 * default-flip campaign had no input. This is that caller, for the one mechanism with a real counterfactual stream:
 * the F12.18 tool-catalog gate.
 *
 * ── EXPECT "insufficient_data", AND READ IT CORRECTLY ──
 * The core is mostly about refusing to answer. Below 30 observations, or 12 evaluable disagreements, there is no
 * verdict — by design, because every Phase-12 mechanism shipped observe-first precisely so the flip would rest on
 * evidence rather than intuition. **A campaign that flips something on its first run has misread the tool.**
 *
 * The distinction this command prints, and the reason it exists at all: `insufficient_data` with `evaluable: 0`
 * used to mean the question was STRUCTURALLY unanswerable (observations carried no task id, so no outcome could
 * ever join). It now means only that not enough has accumulated — which more running fixes. Those two look
 * identical in a verdict and only one is worth waiting for.
 */

export interface DevMechanismDecisionOptions {
	json?: boolean;
	/** Injected in tests; defaults to the real telemetry read. */
	readObservations?: () => Promise<
		readonly { metadata?: Record<string, unknown> | undefined; taskId?: string | null }[]
	>;
	/** Injected in tests; defaults to the real ledger read. */
	readLedger?: () => Promise<AgentLedgerEvent[]>;
}

const GATE_CATEGORY = "tool_catalog_gate_observation";
/** The reader's hard maximum. Asking for less would silently narrow the evidence a FLIP decision rests on. */
const OBSERVATION_READ_LIMIT = 500;

function defaultLedgerRoot(): string {
	const override = process.env.NKLEIN_AGENT_LEDGER_ROOT?.trim();
	return override && override.length > 0
		? override
		: join(resolveNkleinRuntimeHomePath(homedir()), "agent-attempt-ledger");
}

/** Pull the fields the join needs out of a self-observation record's metadata bag. */
export function toGateRecord(event: {
	metadata?: Record<string, unknown> | undefined;
	taskId?: string | null;
}): ToolGateObservationRecord {
	const metadata = event.metadata ?? {};
	const numberOrNull = (value: unknown): number | null => (typeof value === "number" ? value : null);
	return {
		taskId: event.taskId ?? null,
		offered: numberOrNull(metadata.offered),
		wouldKeep: numberOrNull(metadata.wouldKeep),
		wouldDrop: numberOrNull(metadata.wouldDrop),
	};
}

export async function runDevMechanismDecisionCommand(options: DevMechanismDecisionOptions = {}): Promise<void> {
	// The reader defaults to 50 events and hard-caps at 500 (`self-observation-sink` ~398). The default alone sits
	// barely above the 30-observation floor, so it is raised deliberately rather than inherited.
	const events = await (options.readObservations
		? options.readObservations()
		: readSelfObservationEvents({ category: GATE_CATEGORY, limit: OBSERVATION_READ_LIMIT }));
	const ledger = await (options.readLedger
		? options.readLedger()
		: readAllAgentLedger({ rootDir: defaultLedgerRoot() }));

	const joined = joinToolGateObservations({
		records: events.map(toGateRecord),
		outcomeByTaskId: buildTaskOutcomeIndex(ledger as never),
	});
	const decision = buildMechanismDecision(joined.observations);
	// Hitting the reader's ceiling means the window is FULL, so there are probably older observations it never
	// returned. A verdict computed on a truncated sample looks exactly like one computed on all of it — and this
	// verdict's whole job is to license flipping a default. Saturation is therefore reported, not swallowed.
	const saturated = events.length >= OBSERVATION_READ_LIMIT;

	if (options.json) {
		process.stdout.write(
			`${JSON.stringify({ mechanism: GATE_CATEGORY, join: joined, decision, readSaturated: saturated }, null, 2)}\n`,
		);
		return;
	}

	process.stdout.write(`Mechanism: ${GATE_CATEGORY} (F12.18 tool-catalog gate, record-only)\n`);
	process.stdout.write(`${joined.summary}\n\n`);
	process.stdout.write(`VERDICT: ${decision.verdict}\n`);
	process.stdout.write(
		`  observations ${decision.observations} · disagreements ${decision.disagreements} ` +
			`(${(decision.disagreementRate * 100).toFixed(1)}%) · evaluable ${decision.evaluable}\n`,
	);
	process.stdout.write(`  ${decision.reason}\n`);
	if (saturated) {
		process.stdout.write(
			`\n⚠️  READ SATURATED at ${OBSERVATION_READ_LIMIT} observations — older ones were not returned, so this\n` +
				"verdict rests on a TRUNCATED sample and must not be used to flip a default as-is.\n",
		);
	}
	if (decision.verdict === "insufficient_data") {
		// Said explicitly, because this verdict is the expected one for a long time and its meaning changed today.
		process.stdout.write(
			"\nThis is the DESIGNED answer below the evidence floor, not a failure. Since the gate observation now\n" +
				"carries a task id, more running can change it — before that, no volume could have.\n",
		);
	}
}
