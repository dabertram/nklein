import type { BoardCard, BoardDependency, CardSelection } from "@/types";

/**
 * Pure model + formatters for the card detail view's planning-DAG review panel, extracted from the oversized
 * `card-detail-view.tsx` (todo §5.U). `buildPlanningDagNodes` walks the dependency graph out from the selected card
 * (BFS) and labels each reachable card's relation (selected / blocked-by / unblocks / related); the rest parse the
 * planning markers from a card prompt (complexity, backend-model fit), classify revised planning cards, and format
 * the per-node model label + tone. No JSX — pure functions over the board model.
 */

export interface PlanningDagNode {
	card: BoardCard;
	columnTitle: string;
	relation: "selected" | "blocked-by" | "unblocks" | "related";
}

export function parseComplexityFromPrompt(prompt: string): number | null {
	const match = prompt.match(/^Complexity:\s*(\d{1,3})\/100\s*$/im);
	if (!match) {
		return null;
	}
	const value = Number(match[1]);
	return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
}

export function parseModelFitFromPrompt(prompt: string): { label: string; detail: string; tone: "done" | "waiting" } {
	const match = prompt.match(/^Model fit:\s*(.+)$/im);
	const detail = match?.[1]?.trim() ?? null;
	if (!detail) {
		return {
			label: "Backend fit pending",
			detail: "No backend fit marker on this card",
			tone: "waiting",
		};
	}
	const normalizedDetail = detail.toLowerCase();
	if (
		normalizedDetail.startsWith("validated by !klein routing guard") ||
		normalizedDetail.startsWith("validated by kanban routing guard")
	) {
		return {
			label: "Backend fit validated",
			detail,
			tone: "done",
		};
	}
	return {
		label: "Backend fit starts later",
		detail,
		tone: "waiting",
	};
}

export function isRevisedPlanningCard(card: BoardCard): boolean {
	return (
		card.blockedKind === "needs_decomposition" ||
		card.title.startsWith("Integrate plan gap from ") ||
		card.title.startsWith("Resolve plan decision gap from ") ||
		card.title.startsWith("Resolve plan contradiction from ") ||
		card.title.startsWith("Split oversized plan gap from ")
	);
}

export function formatDagModelLabel(card: BoardCard): string {
	const providerId = card.nkleinSettings?.providerId?.trim();
	const modelId = card.nkleinSettings?.modelId?.trim();
	if (providerId && modelId) {
		return `${providerId} / ${modelId}`;
	}
	if (card.agentId === "nklein" || card.nkleinSettings) {
		return "!Klein local model";
	}
	return card.agentId ?? "Default agent";
}

export function getDagNodeToneClassName(relation: PlanningDagNode["relation"]): string {
	if (relation === "selected") {
		return "border-accent bg-accent/5";
	}
	if (relation === "blocked-by") {
		return "border-status-gold/40 bg-status-gold/5";
	}
	if (relation === "related") {
		return "border-border-bright bg-surface-0";
	}
	return "border-status-green/30 bg-status-green/5";
}

export function buildPlanningDagNodes(
	selection: CardSelection,
	dependencies: readonly BoardDependency[],
): PlanningDagNode[] {
	const cardsById = new Map(
		selection.allColumns.flatMap((column) =>
			column.cards.map((card) => [card.id, { card, columnTitle: column.title }]),
		),
	);
	const directPrerequisiteIds = new Set<string>();
	const directDependentIds = new Set<string>();
	const linkedByTaskId = new Map<string, Set<string>>();
	for (const dependency of dependencies) {
		if (dependency.fromTaskId === selection.card.id) {
			directPrerequisiteIds.add(dependency.toTaskId);
		}
		if (dependency.toTaskId === selection.card.id) {
			directDependentIds.add(dependency.fromTaskId);
		}
		for (const [left, right] of [
			[dependency.fromTaskId, dependency.toTaskId],
			[dependency.toTaskId, dependency.fromTaskId],
		] as const) {
			const linked = linkedByTaskId.get(left) ?? new Set<string>();
			linked.add(right);
			linkedByTaskId.set(left, linked);
		}
	}
	const orderedTaskIds: string[] = [];
	const visitedTaskIds = new Set<string>();
	const queue = [selection.card.id];
	for (let index = 0; index < queue.length; index += 1) {
		const taskId = queue[index];
		if (!taskId || visitedTaskIds.has(taskId)) {
			continue;
		}
		visitedTaskIds.add(taskId);
		if (cardsById.has(taskId)) {
			orderedTaskIds.push(taskId);
		}
		for (const linkedTaskId of linkedByTaskId.get(taskId) ?? []) {
			if (!visitedTaskIds.has(linkedTaskId)) {
				queue.push(linkedTaskId);
			}
		}
	}
	return orderedTaskIds.map((taskId) => {
		const cardEntry = cardsById.get(taskId);
		if (!cardEntry) {
			return { card: selection.card, columnTitle: selection.column.title, relation: "selected" };
		}
		return {
			...cardEntry,
			relation:
				taskId === selection.card.id
					? "selected"
					: directPrerequisiteIds.has(taskId)
						? "blocked-by"
						: directDependentIds.has(taskId)
							? "unblocks"
							: "related",
		};
	});
}
