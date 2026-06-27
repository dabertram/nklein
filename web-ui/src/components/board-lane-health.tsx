// §5.AG per-lane health indicator — a compact "needs attention" badge in a board column header showing how many of
// that lane's cards are risky or stuck. Derives from the same shared summarizeBoardHealth as the board-header rollup
// and the `nklein task health` CLI, so they all agree. Shows ONLY risky/stuck (healthy/done are implied by the lane +
// its card count, so surfacing them per-lane would be noise); renders nothing when a lane needs no attention.
import type { RuntimeTaskSessionSummary } from "@runtime-contract";
import { summarizeBoardHealth } from "@runtime-operator-board-health";
import { AlertTriangle, PauseCircle } from "lucide-react";
import type { BoardColumn } from "@/types";

interface BoardLaneHealthProps {
	column: BoardColumn;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
}

export function BoardLaneHealth({ column, taskSessions }: BoardLaneHealthProps) {
	const { counts } = summarizeBoardHealth({ columns: [column] }, taskSessions);
	if (counts.risky === 0 && counts.stuck === 0) {
		return null;
	}
	return (
		<span className="flex items-center gap-1.5 text-[11px]" role="group" aria-label="Lane attention">
			{counts.risky > 0 ? (
				<span className="flex items-center gap-0.5 text-status-red" title={`${counts.risky} risky`}>
					<AlertTriangle size={11} />
					<span className="tabular-nums">{counts.risky}</span>
				</span>
			) : null}
			{counts.stuck > 0 ? (
				<span className="flex items-center gap-0.5 text-status-orange" title={`${counts.stuck} stuck`}>
					<PauseCircle size={11} />
					<span className="tabular-nums">{counts.stuck}</span>
				</span>
			) : null}
		</span>
	);
}
