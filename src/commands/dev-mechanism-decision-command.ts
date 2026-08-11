import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type { AgentLedgerEvent } from "../core/agent-attempt-ledger";
import { buildMechanismDecision } from "../core/mechanism-decision-report";
import { joinOffTrackRemedyObservations, toOffTrackRemedyRecord } from "../core/off-track-remedy-observation-join";
import {
	buildTaskOutcomeIndex,
	joinToolGateObservations,
	type ToolGateObservationRecord,
} from "../core/tool-gate-observation-join";
import { joinToolTrustObservations, toToolTrustRecord } from "../core/tool-trust-observation-join";
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
	/** Injected in tests; defaults to the real telemetry read of the off-track remedy stream. */
	readRemedyObservations?: () => Promise<
		readonly { metadata?: Record<string, unknown> | undefined; taskId?: string | null }[]
	>;
	/** Injected in tests; defaults to the real telemetry read of the tool-trust stream. */
	readTrustObservations?: () => Promise<
		readonly { metadata?: Record<string, unknown> | undefined; taskId?: string | null }[]
	>;
}

const GATE_CATEGORY = "tool_catalog_gate_observation";
/** P18.4b: the second mechanism with a real counterfactual stream — the observe-only off-track remedy. */
const REMEDY_CATEGORY = "off_track_remedy_observed";
/** P15.3 mechanism #3: the F12.24 tool-trust shadow (recorded unconditionally; the flag gates the effect). */
const TRUST_CATEGORY = "tool_trust_decay";
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

	const remedyEvents = await (options.readRemedyObservations
		? options.readRemedyObservations()
		: readSelfObservationEvents({ category: REMEDY_CATEGORY, limit: OBSERVATION_READ_LIMIT }));
	const trustEvents = await (options.readTrustObservations
		? options.readTrustObservations()
		: readSelfObservationEvents({ category: TRUST_CATEGORY, limit: OBSERVATION_READ_LIMIT }));
	const outcomeByTaskId = buildTaskOutcomeIndex(ledger as never);
	const joined = joinToolGateObservations({
		records: events.map(toGateRecord),
		outcomeByTaskId,
	});
	const decision = buildMechanismDecision(joined.observations);
	const remedyJoined = joinOffTrackRemedyObservations({
		records: remedyEvents.map(toOffTrackRemedyRecord),
		outcomeByTaskId,
	});
	const remedyDecision = buildMechanismDecision(remedyJoined.observations);
	const trustJoined = joinToolTrustObservations({
		records: trustEvents.map(toToolTrustRecord),
		outcomeByTaskId,
	});
	const trustDecision = buildMechanismDecision(trustJoined.observations);
	// Hitting the reader's ceiling means the window is FULL, so there are probably older observations it never
	// returned. A verdict computed on a truncated sample looks exactly like one computed on all of it — and this
	// verdict's whole job is to license flipping a default. Saturation is therefore reported, not swallowed.
	const saturated = events.length >= OBSERVATION_READ_LIMIT;
	const remedySaturated = remedyEvents.length >= OBSERVATION_READ_LIMIT;
	const trustSaturated = trustEvents.length >= OBSERVATION_READ_LIMIT;

	if (options.json) {
		process.stdout.write(
			`${JSON.stringify(
				{
					mechanism: GATE_CATEGORY,
					join: joined,
					decision,
					readSaturated: saturated,
					mechanisms: [
						{ mechanism: GATE_CATEGORY, join: joined, decision, readSaturated: saturated },
						{
							mechanism: REMEDY_CATEGORY,
							join: remedyJoined,
							decision: remedyDecision,
							readSaturated: remedySaturated,
						},
						{
							mechanism: TRUST_CATEGORY,
							join: trustJoined,
							decision: trustDecision,
							readSaturated: trustSaturated,
						},
					],
				},
				null,
				2,
			)}\n`,
		);
		return;
	}

	const printDecision = (
		title: string,
		summary: string,
		verdict: ReturnType<typeof buildMechanismDecision>,
		wasSaturated: boolean,
	): void => {
		process.stdout.write(`Mechanism: ${title}\n`);
		process.stdout.write(`${summary}\n\n`);
		process.stdout.write(`VERDICT: ${verdict.verdict}\n`);
		process.stdout.write(
			`  observations ${verdict.observations} · disagreements ${verdict.disagreements} ` +
				`(${(verdict.disagreementRate * 100).toFixed(1)}%) · evaluable ${verdict.evaluable}\n`,
		);
		process.stdout.write(`  ${verdict.reason}\n`);
		if (wasSaturated) {
			process.stdout.write(
				`\n⚠️  READ SATURATED at ${OBSERVATION_READ_LIMIT} observations — older ones were not returned, so this\n` +
					"verdict rests on a TRUNCATED sample and must not be used to flip a default as-is.\n",
			);
		}
	};

	printDecision(`${GATE_CATEGORY} (F12.18 tool-catalog gate, record-only)`, joined.summary, decision, saturated);
	process.stdout.write("\n");
	printDecision(
		`${REMEDY_CATEGORY} (P18.4b off-track remedy, observe-only; actual = continue until the acting half ships)`,
		remedyJoined.summary,
		remedyDecision,
		remedySaturated,
	);
	process.stdout.write("\n");
	printDecision(
		`${TRUST_CATEGORY} (F12.24 tool-trust shadow — recorded unconditionally, the flag gates the effect)`,
		trustJoined.summary,
		trustDecision,
		trustSaturated,
	);
	if (decision.verdict === "insufficient_data" || remedyDecision.verdict === "insufficient_data") {
		// Said explicitly, because this verdict is the expected one for a long time and its meaning has changed
		// as join keys landed (gate: task id 2026-07-xx; remedy: task id 2026-08-11).
		process.stdout.write(
			"\ninsufficient_data is the DESIGNED answer below the evidence floor, not a failure. Both observation\n" +
				"streams now carry a task id, so more running can change it — before that, no volume could have.\n",
		);
	}
}
