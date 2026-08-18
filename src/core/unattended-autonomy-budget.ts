/**
 * F3.38 — the WORKSPACE-level unattended autonomy budget. The F11 forensics showed a runtime consuming
 * model-hours on auto-started leaf cards with NO operator or driver interaction; the per-session autonomy
 * watchdog never tripped because each leaf session was short. This core bounds the WORKSPACE: when no
 * operator gesture (any workspace-scoped tRPC mutation) or driver call (external ingress) has touched a
 * workspace for the budget span, autonomous starts pause through the persisted pause set — the same loud,
 * resumable hold the auto-start failure guard uses. The default is deliberately generous: autonomy is the
 * product; the point is that "hours of silent burn nobody asked for" becomes impossible, not that autonomy
 * gets timid. Boot counts as attended (someone launched the runtime), so a fresh start always has the full
 * budget ahead of it.
 */

export const DEFAULT_UNATTENDED_AUTONOMY_BUDGET_HOURS = 12;

/**
 * Resolve the budget from the environment knob. `NKLEIN_UNATTENDED_AUTONOMY_HOURS` accepts a positive number
 * of hours; `0` / `off` disables the gate entirely; unset or unparsable uses the generous default.
 */
export function resolveUnattendedAutonomyBudgetMs(
	env: Record<string, string | undefined> = process.env,
): number | null {
	const raw = env.NKLEIN_UNATTENDED_AUTONOMY_HOURS?.trim().toLowerCase();
	if (raw === "0" || raw === "off" || raw === "false") {
		return null;
	}
	const hours = raw ? Number(raw) : Number.NaN;
	const effectiveHours = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_UNATTENDED_AUTONOMY_BUDGET_HOURS;
	return Math.round(effectiveHours * 3_600_000);
}

export type UnattendedAutonomyDecision =
	| { allow: true; unattendedMs: number }
	| { allow: false; unattendedMs: number; budgetMs: number };

export interface WorkspaceAttendedRegistry {
	/** Record an attended touch (operator mutation / driver ingress) for the workspace. */
	touch(workspaceId: string): void;
	/** Decide whether autonomous starts are still inside the budget. First sighting seeds "attended now". */
	decide(workspaceId: string): UnattendedAutonomyDecision;
	/** The last attended timestamp (diagnostics/tests); null when the workspace has never been seen. */
	lastAttendedAt(workspaceId: string): number | null;
}

export function createWorkspaceAttendedRegistry(input: {
	/** Null disables the gate: every decision allows. */
	budgetMs: number | null;
	now?: () => number;
}): WorkspaceAttendedRegistry {
	const now = input.now ?? Date.now;
	const lastAttendedByWorkspaceId = new Map<string, number>();
	return {
		touch(workspaceId: string): void {
			lastAttendedByWorkspaceId.set(workspaceId, now());
		},
		decide(workspaceId: string): UnattendedAutonomyDecision {
			const at = now();
			const lastAttendedAt = lastAttendedByWorkspaceId.get(workspaceId);
			if (lastAttendedAt === undefined) {
				// Boot/first-sighting counts as attended: the launch itself was a human act, and the budget
				// clock starts here rather than blocking a fresh runtime's very first sweep.
				lastAttendedByWorkspaceId.set(workspaceId, at);
				return { allow: true, unattendedMs: 0 };
			}
			const unattendedMs = Math.max(0, at - lastAttendedAt);
			if (input.budgetMs === null || unattendedMs <= input.budgetMs) {
				return { allow: true, unattendedMs };
			}
			return { allow: false, unattendedMs, budgetMs: input.budgetMs };
		},
		lastAttendedAt(workspaceId: string): number | null {
			return lastAttendedByWorkspaceId.get(workspaceId) ?? null;
		},
	};
}
