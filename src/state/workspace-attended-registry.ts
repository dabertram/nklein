/**
 * F3.38 — the process-wide attended-touch registry singleton. In-memory by design: a runtime restart is
 * itself an attended act (the registry re-seeds each workspace on first sighting), so persistence would only
 * carry staleness across boots. Touch points: the workspace-scoped tRPC MUTATION middleware (operator
 * gestures — queries deliberately do not count, or an abandoned polling dashboard would defeat the budget)
 * and the external-ingress facade (A2A/ACP driver calls).
 */

import { createWorkspaceAttendedRegistry, resolveUnattendedAutonomyBudgetMs } from "../core/unattended-autonomy-budget";

const registry = createWorkspaceAttendedRegistry({ budgetMs: resolveUnattendedAutonomyBudgetMs() });

/** Record an operator gesture / driver call for the workspace. */
export function touchWorkspaceAttended(workspaceId: string): void {
	registry.touch(workspaceId);
}

/** Decide whether autonomous starts are still inside the workspace's unattended budget. */
export function decideWorkspaceUnattendedAutonomy(workspaceId: string) {
	return registry.decide(workspaceId);
}
