import { Link2, Link2Off } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import type { BoardDependency } from "@/types/board";

/**
 * A non-drag way to manage a card's dependencies (todo §5.W). Until now links could only be created by dragging an
 * arrow between two cards; this dialog lets you pick a prerequisite from a list and remove existing links. The
 * board's pure `addTaskDependency` logic (reached via `onCreateDependency`) still validates and orients the link —
 * including the backlog reorientation rules and the same-task / duplicate / done-task / "must include a waiting task"
 * guards — and surfaces any rejection via a toast, so this dialog stays a thin, well-tested presentation layer.
 */

export interface DependencyPickerCard {
	id: string;
	title: string;
	/** The column the card currently sits in (shown to disambiguate same-titled cards). */
	columnTitle: string;
}

export interface DependencyPickerDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The card whose dependencies are being managed. */
	card: { id: string; title: string };
	/** Every card on the board; the managed card and already-linked cards are filtered out of the candidate list. */
	allCards: readonly DependencyPickerCard[];
	/** All dependency edges on the board; the ones touching `card` are shown as its current links. */
	dependencies: readonly BoardDependency[];
	/** Link the managed card with the picked card. The board logic validates + orients direction (and may reject). */
	onCreateDependency: (fromTaskId: string, toTaskId: string) => void;
	onDeleteDependency: (dependencyId: string) => void;
}

export function DependencyPickerDialog({
	open,
	onOpenChange,
	card,
	allCards,
	dependencies,
	onCreateDependency,
	onDeleteDependency,
}: DependencyPickerDialogProps): React.ReactElement {
	const [selectedId, setSelectedId] = useState("");

	const titleById = useMemo(() => new Map(allCards.map((entry) => [entry.id, entry.title])), [allCards]);

	// Edges touching this card (either direction) — its current links.
	const relatedDependencies = useMemo(
		() => dependencies.filter((dep) => dep.fromTaskId === card.id || dep.toTaskId === card.id),
		[dependencies, card.id],
	);

	// Ids already linked to this card (either direction); excluded from the candidate list so a duplicate can't be picked.
	const linkedIds = useMemo(() => {
		const ids = new Set<string>();
		for (const dep of relatedDependencies) {
			ids.add(dep.fromTaskId === card.id ? dep.toTaskId : dep.fromTaskId);
		}
		return ids;
	}, [relatedDependencies, card.id]);

	const candidates = useMemo(
		() => allCards.filter((entry) => entry.id !== card.id && !linkedIds.has(entry.id)),
		[allCards, card.id, linkedIds],
	);

	const handleAdd = (): void => {
		if (!selectedId) {
			return;
		}
		// `from` is the waiting/dependent task, `to` the prerequisite — the board reorients as needed.
		onCreateDependency(card.id, selectedId);
		setSelectedId("");
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<div data-testid="dependency-picker-dialog" className="flex flex-col min-h-0">
				<DialogHeader title={`Dependencies — ${card.title}`} icon={<Link2 size={16} />} />
				<DialogBody className="flex flex-col gap-4">
					<div>
						<div className="text-[12px] font-semibold text-text-secondary mb-1">Add a link</div>
						<div className="flex items-center gap-2">
							<NativeSelect
								aria-label="Select a task to link"
								data-testid="dependency-picker-select"
								value={selectedId}
								onChange={(event) => setSelectedId(event.target.value)}
								disabled={candidates.length === 0}
								fill
								containerClassName="flex-1 min-w-0"
							>
								<option value="">
									{candidates.length === 0 ? "No other tasks to link" : "Select a task…"}
								</option>
								{candidates.map((entry) => (
									<option key={entry.id} value={entry.id}>
										{entry.title} · {entry.columnTitle}
									</option>
								))}
							</NativeSelect>
							<Button
								variant="primary"
								size="sm"
								icon={<Link2 size={14} />}
								data-testid="dependency-picker-add"
								disabled={!selectedId}
								onClick={handleAdd}
							>
								Link
							</Button>
						</div>
						<p className="text-text-tertiary text-[11px] mt-1 mb-0">
							!Klein decides which task waits on which from the board state, and a link needs at least one
							waiting (backlog) task.
						</p>
					</div>

					<div>
						<div className="text-[12px] font-semibold text-text-secondary mb-1">Current links</div>
						{relatedDependencies.length === 0 ? (
							<p className="text-text-tertiary text-[12px] m-0">No links yet.</p>
						) : (
							<ul className="flex flex-col gap-1 m-0 p-0 list-none">
								{relatedDependencies.map((dep) => {
									const isDependent = dep.fromTaskId === card.id;
									const otherId = isDependent ? dep.toTaskId : dep.fromTaskId;
									const otherTitle = titleById.get(otherId) ?? otherId;
									return (
										<li
											key={dep.id}
											className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1"
										>
											<span className="text-[11px] text-text-tertiary shrink-0">
												{isDependent ? "waits on" : "blocks"}
											</span>
											<span className="text-[12px] text-text-primary truncate flex-1 min-w-0">
												{otherTitle}
											</span>
											<button
												type="button"
												aria-label={`Remove link to ${otherTitle}`}
												data-testid={`dependency-picker-remove-${dep.id}`}
												onClick={() => onDeleteDependency(dep.id)}
												className="shrink-0 p-1 rounded text-text-tertiary hover:text-status-red hover:bg-surface-3 cursor-pointer"
											>
												<Link2Off size={14} />
											</button>
										</li>
									);
								})}
							</ul>
						)}
					</div>
				</DialogBody>
				<DialogFooter>
					<Button variant="default" onClick={() => onOpenChange(false)}>
						Close
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
