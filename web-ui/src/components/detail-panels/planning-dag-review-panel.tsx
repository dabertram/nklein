import { GitBranch } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import {
	buildPlanningDagNodes,
	formatDagModelLabel,
	getDagNodeToneClassName,
	isRevisedPlanningCard,
	parseComplexityFromPrompt,
	parseModelFitFromPrompt,
} from "@/components/detail-panels/planning-dag-model";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { BoardDependency, CardSelection } from "@/types";

/**
 * The card detail view's planning-DAG review panel, extracted from the oversized `card-detail-view.tsx` (todo §5.U).
 * Renders the selected card's dependency neighbourhood (built by `planning-dag-model`) as a grid of relation-coloured
 * nodes with per-card complexity / model-fit / likely-files markers, plus the "Approve for execution" action for a
 * plan-mode card awaiting approval. Renders nothing outside the planning lane unless the card has linked cards.
 */
export function PlanningDagReviewPanel({
	selection,
	dependencies,
	onApprovePlanningCard,
}: {
	selection: CardSelection;
	dependencies: readonly BoardDependency[];
	onApprovePlanningCard?: (taskId: string) => void;
}): React.ReactElement | null {
	const nodes = useMemo(() => buildPlanningDagNodes(selection, dependencies), [dependencies, selection]);
	if (selection.column.id !== "planning" && nodes.length <= 1) {
		return null;
	}
	const edgeCount = nodes.length - 1;
	const isWaitingForApproval = selection.column.id === "planning" && selection.card.startInPlanMode === true;
	return (
		<div className="border-b border-border bg-surface-1 px-3 py-2">
			<div className="mb-2 flex min-w-0 flex-wrap items-center gap-2 text-[12px] font-medium text-text-primary">
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<GitBranch size={14} className="shrink-0 text-text-secondary" />
					<span>Plan DAG</span>
					<span className="truncate text-text-tertiary">
						{edgeCount > 0 ? `${edgeCount} linked ${edgeCount === 1 ? "card" : "cards"}` : "No linked cards"}
					</span>
				</div>
				{selection.column.id === "planning" ? (
					isWaitingForApproval && onApprovePlanningCard ? (
						<Button
							type="button"
							variant="primary"
							size="sm"
							onClick={() => onApprovePlanningCard(selection.card.id)}
						>
							Approve for execution
						</Button>
					) : (
						<span className="shrink-0 text-[11px] text-status-green">Execution approved</span>
					)
				) : null}
			</div>
			<div className="grid grid-cols-1 gap-1.5 xl:grid-cols-3">
				{nodes.map((node) => {
					const complexity = parseComplexityFromPrompt(node.card.prompt);
					const modelFit = parseModelFitFromPrompt(node.card.prompt);
					const likelyFiles = node.card.filesLikelyTouched ?? [];
					return (
						<div
							key={`${node.relation}:${node.card.id}`}
							className={cn("min-w-0 rounded-md border px-2 py-1.5", getDagNodeToneClassName(node.relation))}
						>
							<div className="flex min-w-0 items-center gap-1.5">
								<span className="truncate text-[11px] font-medium text-text-primary">{node.card.title}</span>
								<span className="shrink-0 text-[11px] text-text-tertiary">{node.columnTitle}</span>
							</div>
							<div className="mt-1 truncate text-[11px] text-text-secondary">
								{node.relation === "selected"
									? "Selected card"
									: node.relation === "blocked-by"
										? "Blocked by prerequisite"
										: node.relation === "unblocks"
											? "Unblocks dependent"
											: "Linked plan card"}
							</div>
							<div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[11px] text-text-tertiary">
								{isRevisedPlanningCard(node.card) ? (
									<span className="text-status-purple">Revised plan</span>
								) : null}
								<span>{complexity === null ? "Complexity unknown" : `Complexity ${complexity}/100`}</span>
								<span
									className={
										complexity !== null && complexity <= 75 ? "text-status-green" : "text-status-orange"
									}
								>
									{complexity !== null && complexity <= 75 ? "Fit likely" : "Fit needs review"}
								</span>
								<span
									className={modelFit.tone === "done" ? "text-status-green" : "text-status-orange"}
									title={modelFit.detail}
								>
									{modelFit.label}
								</span>
								<span className="truncate">{formatDagModelLabel(node.card)}</span>
							</div>
							{likelyFiles.length > 0 ? (
								<div className="mt-1 truncate text-[11px] text-text-tertiary">
									{likelyFiles.slice(0, 3).join(", ")}
									{likelyFiles.length > 3 ? ` +${likelyFiles.length - 3}` : ""}
								</div>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}
