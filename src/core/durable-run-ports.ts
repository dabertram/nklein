/**
 * The durable-run PORTS factory (todo §5.AF; the C3 hot-path wiring seam) — builds a {@link DurableRunPorts} for the
 * {@link DurableRunController} from injected store effects, so the live wiring is a one-liner and stays unit-testable.
 *
 * This is the thin, dependency-injected bridge between the pure controller and the real runtime stores: `appendLog` maps
 * each durable-log entry to a `scheduler` ledger event (via {@link durableLogEntryToSchedulerEvent}) and appends it;
 * `dispatch` enqueues the card's session start; `now`/`mintWorkerId` default to the wall clock + a uuid. The runtime
 * supplies the two real effects (`appendEvent` = the ledger store's append, `enqueueStart` = the task-start queue) and a
 * per-run {@link DurableLedgerEnvelope}; boot-replay scopes the ledger to this run via {@link readDurableSchedulerLog}'s
 * `workflowId` filter. Kept out of the controller so the controller has zero store imports (testable in isolation).
 */

import { randomUUID } from "node:crypto";
import type { AgentSchedulerEvent } from "./agent-attempt-ledger";
import type { DurableDispatch, DurableRunPorts } from "./durable-run-controller";
import { type DurableLedgerEnvelope, durableLogEntryToSchedulerEvent } from "./durable-scheduler-ledger";

export interface LedgerDurableRunPortDeps {
	/** Per-run envelope (workflowId + workspacePathHash + role) stamped onto every persisted scheduler event. */
	envelope: DurableLedgerEnvelope;
	/** Durably append one mapped `scheduler` ledger event (e.g. `appendAgentLedgerEvent`). Awaited before dispatch. */
	appendEvent: (event: AgentSchedulerEvent) => void | Promise<void>;
	/** Start running a leased card (enqueue its session start onto the runtime task-start queue). */
	enqueueStart: (dispatch: DurableDispatch) => void;
	/** Wall clock; defaults to `Date.now`. Injectable for tests / deterministic replay. */
	now?: () => number;
	/** Worker-id mint; defaults to a uuid. */
	mintWorkerId?: () => string;
}

/**
 * Build the controller's ports from the runtime's store effects. `appendLog` maps the entry through the ledger adapter
 * then appends (the controller awaits it before dispatching — persist-before-side-effect); `dispatch` forwards to the
 * task-start enqueue.
 */
export function createLedgerDurableRunPorts(deps: LedgerDurableRunPortDeps): DurableRunPorts {
	return {
		now: deps.now ?? (() => Date.now()),
		mintWorkerId: deps.mintWorkerId ?? (() => randomUUID()),
		appendLog: (entry) => deps.appendEvent(durableLogEntryToSchedulerEvent(entry, deps.envelope)),
		dispatch: deps.enqueueStart,
	};
}
