import { ChevronDown, ChevronRight, FlaskConical, Play, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeDevTestRegistryEntry } from "@/runtime/types";

/**
 * Searchable, tier-grouped picker for the folder-based dev-test-project registry.
 * Renders all 47 registry projects in collapsible tier groups with a search box,
 * each row having a "Start" button that calls onStart(id).
 */
export function DevTestRegistryPicker({
	entries,
	isLoading,
	startingId,
	disabled,
	onStart,
}: {
	entries: RuntimeDevTestRegistryEntry[];
	isLoading: boolean;
	startingId: string | null;
	disabled: boolean;
	onStart: (id: string) => Promise<void>;
}): React.ReactElement {
	const [query, setQuery] = useState("");
	// Tiers start collapsed: the picker is the always-visible dev-test launch surface, so show compact tier headers
	// (expand the one you want) rather than a wall of 47 rows. A search query force-expands matches (below).
	const [expandedTiers, setExpandedTiers] = useState<Set<string>>(new Set());

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return entries;
		return entries.filter(
			(e) =>
				e.title.toLowerCase().includes(q) ||
				e.id.toLowerCase().includes(q) ||
				e.tier?.toLowerCase().includes(q) ||
				e.tags?.some((t) => t.toLowerCase().includes(q)),
		);
	}, [entries, query]);

	// Group by tier; entries without a tier go into "Other"
	const groups = useMemo(() => {
		const map = new Map<string, RuntimeDevTestRegistryEntry[]>();
		for (const entry of filtered) {
			const tier = entry.tier ?? "Other";
			const group = map.get(tier);
			if (group) {
				group.push(entry);
			} else {
				map.set(tier, [entry]);
			}
		}
		// Sort groups: numbered tiers first (by numeric prefix), then "Other"
		return [...map.entries()].sort(([a], [b]) => {
			const numA = Number.parseInt(a, 10);
			const numB = Number.parseInt(b, 10);
			if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
			if (!Number.isNaN(numA)) return -1;
			if (!Number.isNaN(numB)) return 1;
			if (a === "Other") return 1;
			if (b === "Other") return -1;
			return a.localeCompare(b);
		});
	}, [filtered]);

	const isSearching = query.trim().length > 0;
	const toggleTier = (tier: string) => {
		setExpandedTiers((prev) => {
			const next = new Set(prev);
			if (next.has(tier)) {
				next.delete(tier);
			} else {
				next.add(tier);
			}
			return next;
		});
	};

	return (
		<div className="flex flex-col gap-1.5">
			{/* Search box */}
			<div className="relative">
				<Search
					size={12}
					className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-text-tertiary"
				/>
				<input
					type="text"
					value={query}
					onChange={(e) => setQuery(e.currentTarget.value)}
					placeholder="Search registry projects…"
					className="w-full rounded-md border border-border bg-surface-2 py-1.5 pr-2 pl-7 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					disabled={disabled || isLoading}
				/>
			</div>

			{isLoading ? (
				<div className="flex items-center justify-center py-4">
					<Spinner size={14} className="text-text-secondary" />
				</div>
			) : filtered.length === 0 ? (
				<p className="py-2 text-center text-[11px] text-text-secondary">No projects match your search.</p>
			) : (
				<div className="flex flex-col gap-1">
					{groups.map(([tier, groupEntries]) => {
						const isCollapsed = isSearching ? false : !expandedTiers.has(tier);
						return (
							<div key={tier} className="rounded-md border border-border bg-surface-1">
								{/* Tier header */}
								<button
									type="button"
									className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-surface-3 rounded-md transition-colors"
									onClick={() => toggleTier(tier)}
								>
									{isCollapsed ? (
										<ChevronRight size={12} className="shrink-0 text-text-tertiary" />
									) : (
										<ChevronDown size={12} className="shrink-0 text-text-tertiary" />
									)}
									<FlaskConical size={12} className="shrink-0 text-status-purple" />
									<span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-text-primary">
										{tier}
									</span>
									<span className="shrink-0 text-[10px] text-text-tertiary">{groupEntries.length}</span>
								</button>

								{/* Rows */}
								{!isCollapsed && (
									<div className="flex flex-col gap-0.5 px-1 pb-1">
										{groupEntries.map((entry) => {
											const isStarting = startingId === entry.id;
											return (
												<div
													key={entry.id}
													className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 hover:bg-surface-3"
												>
													<div className="min-w-0 flex-1">
														<p className="m-0 truncate text-[11px] text-text-primary" title={entry.title}>
															{entry.title}
														</p>
														{entry.tags && entry.tags.length > 0 ? (
															<p className="m-0 truncate text-[10px] text-text-tertiary">
																{entry.tags.slice(0, 3).join(", ")}
																{entry.tags.length > 3 ? "…" : ""}
															</p>
														) : null}
													</div>
													<Button
														size="sm"
														variant="ghost"
														icon={isStarting ? <Spinner size={12} /> : <Play size={12} />}
														disabled={disabled || isStarting}
														onClick={() => {
															if (
																!window.confirm(
																	`Create dev-test project "${entry.title}" and make it the active project?`,
																)
															) {
																return;
															}
															void onStart(entry.id);
														}}
														aria-label={`Start ${entry.title}`}
														className={cn("shrink-0 px-1.5", isStarting && "text-text-secondary")}
													>
														{isStarting ? "" : "Start"}
													</Button>
												</div>
											);
										})}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
