import { ChevronDown, ChevronUp, Minus, Plus, Scissors } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";
import { showAppToast } from "@/components/app-toaster";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { expandNKleinPlanTask } from "@/runtime/runtime-config-query";
import type { RuntimeExpandNKleinPlanTaskItem } from "@/runtime/types";

/**
 * The card detail view's expand-plan-task panel (todo §5.W / path 2b).
 *
 * Lets the user split one plan task into several replacement tasks and apply the
 * expansion to the saved plan DAG via `runtime.expandNKleinPlanTask`. Mirrors the
 * structure of `PlanGapActionsPanel`.
 *
 * Path 2a (agent-proposed replacements persisted as a discoverable artifact) can
 * layer on later once the model writes proposed replacements as a dedicated artifact
 * type — for now, the user authors the replacement list here.
 *
 * Only rendered for planning-lane cards that belong to a workspace. Renders null
 * when no workspaceId is available.
 */

const MIN_REPLACEMENTS = 2;
const MAX_REPLACEMENTS = 10;

function newItem(index: number): RuntimeExpandNKleinPlanTaskItem {
	return {
		id: `replacement-${index + 1}`,
		title: "",
		prompt: "",
		dependsOn: [],
		complexity: 50,
		acceptanceCommand: "",
	};
}

function ReplacementEditor({
	item,
	index,
	total,
	disabled,
	onChange,
	onRemove,
	onMoveUp,
	onMoveDown,
}: {
	item: RuntimeExpandNKleinPlanTaskItem;
	index: number;
	total: number;
	disabled: boolean;
	onChange: (updated: RuntimeExpandNKleinPlanTaskItem) => void;
	onRemove: () => void;
	onMoveUp: () => void;
	onMoveDown: () => void;
}): React.ReactElement {
	return (
		<div className="rounded-md border border-border bg-surface-0 px-2 py-2">
			<div className="mb-1.5 flex min-w-0 items-center gap-1">
				<span className="shrink-0 text-[11px] font-medium text-text-secondary">#{index + 1}</span>
				<input
					className="min-w-0 flex-1 rounded-sm border border-border-bright bg-surface-2 px-2 py-1 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
					placeholder="Task title…"
					value={item.title}
					disabled={disabled}
					onChange={(e) => onChange({ ...item, title: e.target.value })}
				/>
				<div className="flex shrink-0 items-center gap-0.5">
					<Button
						size="sm"
						variant="ghost"
						icon={<ChevronUp size={12} />}
						disabled={disabled || index === 0}
						onClick={onMoveUp}
						aria-label="Move replacement up"
						className="h-5 w-5 p-0"
					/>
					<Button
						size="sm"
						variant="ghost"
						icon={<ChevronDown size={12} />}
						disabled={disabled || index === total - 1}
						onClick={onMoveDown}
						aria-label="Move replacement down"
						className="h-5 w-5 p-0"
					/>
					{total > MIN_REPLACEMENTS ? (
						<Button
							size="sm"
							variant="ghost"
							icon={<Minus size={12} />}
							disabled={disabled}
							onClick={onRemove}
							aria-label="Remove replacement"
							className="h-5 w-5 p-0 text-status-red"
						/>
					) : null}
				</div>
			</div>
			<textarea
				className="mb-1 min-h-[48px] w-full resize-y rounded-sm border border-border-bright bg-surface-2 px-2 py-1 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
				placeholder="Prompt / description for this replacement task…"
				value={item.prompt}
				disabled={disabled}
				onChange={(e) => onChange({ ...item, prompt: e.target.value })}
			/>
			<input
				className="min-w-0 w-full rounded-sm border border-border-bright bg-surface-2 px-2 py-1 text-[12px] font-mono text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
				placeholder="Acceptance command (e.g. npm test)…"
				value={item.acceptanceCommand}
				disabled={disabled}
				onChange={(e) => onChange({ ...item, acceptanceCommand: e.target.value })}
			/>
		</div>
	);
}

export function ExpandPlanTaskPanel({
	workspaceId,
	taskId,
}: {
	workspaceId: string | null;
	taskId: string;
}): React.ReactElement | null {
	const [isOpen, setIsOpen] = useState(false);
	const [replacements, setReplacements] = useState<RuntimeExpandNKleinPlanTaskItem[]>([newItem(0), newItem(1)]);
	const [description, setDescription] = useState("");
	const [isBusy, setIsBusy] = useState(false);
	const [result, setResult] = useState<string | null>(null);

	const allFilled = replacements.every((r) => r.title.trim() && r.prompt.trim() && r.acceptanceCommand.trim());

	const handleAddReplacement = useCallback(() => {
		setReplacements((prev) => [...prev, newItem(prev.length)]);
	}, []);

	const handleRemoveReplacement = useCallback((index: number) => {
		setReplacements((prev) => prev.filter((_, i) => i !== index));
	}, []);

	const handleMoveUp = useCallback((index: number) => {
		setReplacements((prev) => {
			if (index === 0) return prev;
			const next = [...prev];
			const a = next[index - 1];
			const b = next[index];
			if (!a || !b) return prev;
			next[index - 1] = b;
			next[index] = a;
			return next;
		});
	}, []);

	const handleMoveDown = useCallback((index: number) => {
		setReplacements((prev) => {
			if (index === prev.length - 1) return prev;
			const next = [...prev];
			const a = next[index];
			const b = next[index + 1];
			if (!a || !b) return prev;
			next[index] = b;
			next[index + 1] = a;
			return next;
		});
	}, []);

	const handleChange = useCallback((index: number, updated: RuntimeExpandNKleinPlanTaskItem) => {
		setReplacements((prev) => prev.map((item, i) => (i === index ? updated : item)));
	}, []);

	const handleSubmit = useCallback(async () => {
		if (!workspaceId || !allFilled) {
			return;
		}
		setIsBusy(true);
		setResult(null);
		try {
			const response = await expandNKleinPlanTask(workspaceId, {
				taskId,
				replacements,
				description: description.trim() || undefined,
			});
			setResult(response.message);
			showAppToast({ intent: "success", message: response.message, timeout: 5000 });
			// Reset form after success so the panel is ready for another expansion.
			setReplacements([newItem(0), newItem(1)]);
			setDescription("");
			setIsOpen(false);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Could not apply plan task expansion.";
			setResult(message);
			showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
		} finally {
			setIsBusy(false);
		}
	}, [workspaceId, taskId, replacements, description, allFilled]);

	if (!workspaceId) {
		return null;
	}

	return (
		<div className="border-b border-border bg-surface-1 px-3 py-2">
			{/* Header row — always visible; click to toggle the form */}
			<button
				type="button"
				className="flex w-full min-w-0 items-center gap-2 text-left text-[12px] font-medium text-text-primary"
				onClick={() => setIsOpen((v) => !v)}
			>
				<Scissors size={14} className="shrink-0 text-text-secondary" />
				<span>Expand plan task</span>
				<span className="truncate text-text-tertiary">Split this task into replacement tasks in the plan DAG</span>
				<ChevronDown
					size={12}
					className={`ml-auto shrink-0 text-text-tertiary transition-transform ${isOpen ? "rotate-180" : ""}`}
				/>
			</button>

			{isOpen ? (
				<div className="mt-2 flex flex-col gap-2">
					<div className="space-y-1.5">
						{replacements.map((item, index) => (
							<ReplacementEditor
								key={`${index}-${item.id}`}
								item={item}
								index={index}
								total={replacements.length}
								disabled={isBusy}
								onChange={(updated) => handleChange(index, updated)}
								onRemove={() => handleRemoveReplacement(index)}
								onMoveUp={() => handleMoveUp(index)}
								onMoveDown={() => handleMoveDown(index)}
							/>
						))}
					</div>

					{replacements.length < MAX_REPLACEMENTS ? (
						<Button
							size="sm"
							variant="ghost"
							icon={<Plus size={12} />}
							disabled={isBusy}
							onClick={handleAddReplacement}
							className="self-start"
						>
							Add replacement
						</Button>
					) : null}

					<textarea
						className="min-h-[36px] w-full resize-y rounded-md border border-border-bright bg-surface-2 px-2 py-1.5 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
						placeholder="Rationale (optional) — written to the plan revisions log"
						value={description}
						disabled={isBusy}
						onChange={(e) => setDescription(e.target.value)}
					/>

					<div className="flex items-center justify-end gap-2">
						<Button size="sm" variant="ghost" disabled={isBusy} onClick={() => setIsOpen(false)}>
							Cancel
						</Button>
						<Button
							size="sm"
							variant="primary"
							icon={isBusy ? <Spinner size={14} /> : <Scissors size={14} />}
							disabled={isBusy || !allFilled}
							onClick={() => {
								void handleSubmit();
							}}
						>
							Apply expansion
						</Button>
					</div>

					{result ? <div className="text-[12px] text-text-secondary">{result}</div> : null}
				</div>
			) : null}
		</div>
	);
}
