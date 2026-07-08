import type { AgentLedgerEvent } from "./agent-attempt-ledger";
import { buildTaskEscalationReport } from "./agent-attempt-ledger";
import { buildStucknessSignalsFromLedger } from "./agent-ledger-projections";
import { type AgentStucknessThresholds, decideEscalationAction, type EscalationAction } from "./agent-stuckness";

/**
 * §5.AG Layer-1 automatic escalation, planned at the terminal-redrive seam (the #24 dead-card one-shot restart is the
 * moment !Klein re-attempts a failed card anyway — the cheapest correct place to also switch models). Pure glue over
 * the three existing cores: stuckness signals from the §5.AF ledger, models tried from the escalation report, and the
 * `decideEscalationAction` ladder (continue while transient · best UNTRIED loaded model when hard-stuck · user only
 * when every loaded model has been tried). NEVER loads a model — `availableModelIds` is the already-loaded set.
 */
export interface PlanTerminalRedriveEscalationInput {
	/** The workspace's §5.AF ledger events (the caller scopes the read). */
	events: readonly AgentLedgerEvent[];
	taskId: string;
	/** Currently LOADED model keys, best-fit first (the next untried one is picked). */
	availableModelIds: readonly string[];
	thresholds?: AgentStucknessThresholds;
}

/** Normalize a model identity for tried-vs-available comparison: a full `provider:model:endpoint` registry key and a
 *  plain loaded id (what `/api/v0/models` lists) must compare equal on the MODEL component. */
function modelComponent(id: string): string {
	const parts = id.split(":");
	return (parts.length >= 2 ? parts[1] : parts[0])?.trim().toLowerCase() ?? "";
}

export function planTerminalRedriveEscalation(input: PlanTerminalRedriveEscalationInput): EscalationAction {
	const signals = buildStucknessSignalsFromLedger(input.events, input.taskId);
	const report = buildTaskEscalationReport(input.events, input.taskId);
	const triedComponents = new Set(report.modelsTried.map(modelComponent));
	const decided = decideEscalationAction({
		signals,
		triedModelIds: input.availableModelIds.filter((id) => triedComponents.has(modelComponent(id))),
		availableModelIds: input.availableModelIds,
		...(input.thresholds ? { thresholds: input.thresholds } : {}),
	});
	return decided;
}
