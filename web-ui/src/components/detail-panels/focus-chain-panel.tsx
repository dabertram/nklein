import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { RuntimeFocusChain } from "@/runtime/types";
import type { BoardCard, CardSelection } from "@/types";

/**
 * The card detail view's focus-chain panel (todo §5.N), extracted from the oversized `card-detail-view.tsx` (§5.U).
 * Renders an agent's focus chain as a live todo list on the card; when `onUpdate` is provided the user can edit it
 * (cycle a step's status, reorder, delete, or add) and edits persist through the board's normal save flow. Read-only
 * when `onUpdate` is absent. Self-contained: drives only the `selection` card + the `onUpdate` callback.
 */

const FOCUS_CHAIN_STATUS_META: Record<
	RuntimeFocusChain["steps"][number]["status"],
	{ mark: string; className: string }
> = {
	done: { mark: "✓", className: "text-status-green" },
	in_progress: { mark: "▸", className: "text-status-blue" },
	pending: { mark: "○", className: "text-text-tertiary" },
	skipped: { mark: "–", className: "text-text-tertiary" },
};

const FOCUS_CHAIN_STATUS_CYCLE: RuntimeFocusChain["steps"][number]["status"][] = [
	"pending",
	"in_progress",
	"done",
	"skipped",
];

/** Compact per-step duration (todo §5.N timing): "12s" / "3m" / "1h 4m". */
function formatFocusChainStepDuration(durationMs: number): string {
	const seconds = Math.max(0, Math.round(durationMs / 1000));
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}

export function FocusChainPanel({
	selection,
	onUpdate,
}: {
	selection: CardSelection;
	onUpdate?: (taskId: string, focusChain: BoardCard["focusChain"] | null) => void;
}): React.ReactElement | null {
	const [newStepText, setNewStepText] = useState("");
	const chain = selection.card.focusChain;
	const steps = chain?.steps ?? [];
	const editable = Boolean(onUpdate);
	if (steps.length === 0 && !editable) {
		return null;
	}
	const taskId = selection.card.id;
	const completed = steps.filter((step) => step.status === "done" || step.status === "skipped").length;
	const emit = (nextSteps: RuntimeFocusChain["steps"]): void => {
		onUpdate?.(taskId, nextSteps.length > 0 ? { steps: nextSteps, updatedAt: Date.now() } : null);
	};
	const cycleStatus = (index: number): void => {
		const current = steps[index];
		if (!current) {
			return;
		}
		const nextIndex = (FOCUS_CHAIN_STATUS_CYCLE.indexOf(current.status) + 1) % FOCUS_CHAIN_STATUS_CYCLE.length;
		const next = FOCUS_CHAIN_STATUS_CYCLE[nextIndex] ?? "pending";
		emit(steps.map((step, i) => (i === index ? { ...step, status: next } : step)));
	};
	const deleteStep = (index: number): void => emit(steps.filter((_, i) => i !== index));
	const moveStep = (index: number, delta: number): void => {
		const target = index + delta;
		if (target < 0 || target >= steps.length) {
			return;
		}
		const next = [...steps];
		const [moved] = next.splice(index, 1);
		if (!moved) {
			return;
		}
		next.splice(target, 0, moved);
		emit(next);
	};
	const addStep = (): void => {
		const text = newStepText.trim();
		if (!text) {
			return;
		}
		emit([...steps, { text, status: "pending" }]);
		setNewStepText("");
	};
	return (
		<div className="rounded-lg border border-border bg-surface-1 px-4 py-3">
			<div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-text-secondary">
				<span>Focus chain</span>
				<span className="font-normal text-text-tertiary">
					{completed}/{steps.length}
				</span>
			</div>
			<ul className="mt-2 flex list-none flex-col gap-1 p-0">
				{steps.map((step, index) => {
					const meta = FOCUS_CHAIN_STATUS_META[step.status];
					return (
						<li key={`${index}-${step.text}`} className="group flex items-start gap-2 text-[13px]">
							{editable ? (
								<button
									type="button"
									onClick={() => cycleStatus(index)}
									className={cn("mt-px cursor-pointer", meta.className)}
									title="Cycle status (pending → in progress → done → skipped)"
									aria-label={`Cycle status for step ${index + 1}`}
								>
									{meta.mark}
								</button>
							) : (
								<span className={cn("mt-px", meta.className)}>{meta.mark}</span>
							)}
							<span
								className={cn(
									"flex-1 text-text-primary",
									step.status === "skipped" && "text-text-tertiary line-through",
									step.status === "in_progress" && "font-medium",
								)}
							>
								{step.text}
								{step.startedAt !== undefined && step.completedAt !== undefined ? (
									<span className="ml-1.5 text-[11px] text-text-tertiary">
										{formatFocusChainStepDuration(step.completedAt - step.startedAt)}
									</span>
								) : null}
							</span>
							{editable ? (
								<span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
									<button
										type="button"
										onClick={() => moveStep(index, -1)}
										disabled={index === 0}
										className="text-text-tertiary hover:text-text-primary disabled:opacity-30"
										aria-label={`Move step ${index + 1} up`}
									>
										▲
									</button>
									<button
										type="button"
										onClick={() => moveStep(index, 1)}
										disabled={index === steps.length - 1}
										className="text-text-tertiary hover:text-text-primary disabled:opacity-30"
										aria-label={`Move step ${index + 1} down`}
									>
										▼
									</button>
									<button
										type="button"
										onClick={() => deleteStep(index)}
										className="text-text-tertiary hover:text-status-red"
										aria-label={`Delete step ${index + 1}`}
									>
										×
									</button>
								</span>
							) : null}
						</li>
					);
				})}
			</ul>
			{editable ? (
				<div className="mt-2 flex items-center gap-2">
					<input
						value={newStepText}
						onChange={(event) => setNewStepText(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								addStep();
							}
						}}
						placeholder="Add a step…"
						aria-label="Add a focus-chain step"
						className="h-7 flex-1 rounded-md border border-border bg-surface-0 px-2 text-[13px] text-text-primary outline-none focus:border-border-focus"
					/>
					<Button size="sm" variant="default" disabled={!newStepText.trim()} onClick={addStep}>
						Add
					</Button>
				</div>
			) : null}
		</div>
	);
}
