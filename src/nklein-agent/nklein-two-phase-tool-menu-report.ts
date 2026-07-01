/**
 * Operator-facing report for the §5.O two-phase phase-1 tool menu: the short {@link KANBAN_TASK_TOOL_CARDS} rendered as
 * the exact menu a small model is shown (via {@link buildPhaseOneToolMenu}), plus its token footprint. This is the first
 * real consumer of the authored cards — it lets an operator eyeball what the small-model tool interface actually says
 * (are the purpose / use-when / avoid-when lines accurate and helpful?) and how many tokens it costs, without touching
 * the live agent loop. Pure + deterministic; the `nklein dev tool-menu` command just prints it.
 *
 * NOTE: we deliberately do NOT claim a "tokens saved vs. full schemas" figure — the verbose native tool schemas live
 * inside the vendored SDK and aren't reachable from here, so any such number would understate the real narrowing. The
 * honest, inspectable signal is the menu text itself and its own token cost.
 */

import { KANBAN_TASK_TOOL_CARDS } from "../core/task-tool-cards";
import { buildPhaseOneToolMenu } from "../core/two-phase-tool-pick";
import { countKanbanTextTokens } from "./nklein-context-budgets";

export interface TwoPhaseToolMenuReport {
	/** The rendered phase-1 menu text a small model is shown. */
	menu: string;
	/** How many tools the menu offers. */
	toolCount: number;
	/** The menu's token footprint (same counter the context-budget path uses). */
	menuTokens: number;
}

/** Build the phase-1 tool-menu report for the authored kanban task tool cards. */
export function buildTwoPhaseToolMenuReport(): TwoPhaseToolMenuReport {
	const menu = buildPhaseOneToolMenu(KANBAN_TASK_TOOL_CARDS);
	return {
		menu,
		toolCount: KANBAN_TASK_TOOL_CARDS.length,
		menuTokens: countKanbanTextTokens(menu),
	};
}
