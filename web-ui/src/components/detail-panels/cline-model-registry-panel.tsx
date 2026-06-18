import { Activity, Gauge, Server } from "lucide-react";

import { cn } from "@/components/ui/cn";
import type { RuntimeClineModelRegistryEntry } from "@/runtime/types";

export function findClineModelRegistryEntry(
	entries: readonly RuntimeClineModelRegistryEntry[],
	providerId: string,
	modelId: string,
): RuntimeClineModelRegistryEntry | null {
	const normalizedProviderId = providerId.trim().toLowerCase();
	const normalizedModelId = modelId.trim();
	if (!normalizedProviderId || !normalizedModelId) {
		return null;
	}
	return (
		entries.find(
			(entry) =>
				entry.providerId.trim().toLowerCase() === normalizedProviderId &&
				entry.modelId.trim() === normalizedModelId,
		) ?? null
	);
}

export function formatClineModelRegistryDisplay(entry: RuntimeClineModelRegistryEntry | null): string | null {
	if (!entry || entry.speed.samples <= 0) {
		return null;
	}
	const parts: string[] = [];
	if (entry.contextWindow.effective) {
		parts.push(`${Math.round(entry.contextWindow.effective / 1000)}k measured window`);
	}
	if (entry.speed.prefillTokensPerSecondEwma) {
		parts.push(`${Math.round(entry.speed.prefillTokensPerSecondEwma)} tok/s in`);
	}
	if (entry.speed.decodeTokensPerSecondEwma) {
		parts.push(`${Math.round(entry.speed.decodeTokensPerSecondEwma)} tok/s out`);
	}
	if (entry.speed.wallTimeMsPer1kPromptTokensEwma) {
		parts.push(`${Math.round(entry.speed.wallTimeMsPer1kPromptTokensEwma)} ms/1k`);
	}
	parts.push(`cap ${Math.round(entry.capability.effectiveScore)}`);
	return parts.length > 0 ? `Model telemetry: ${parts.join(" · ")}` : null;
}

function formatTokenWindow(value: number | null): string {
	return value ? `${Math.round(value / 1000)}k` : "unknown";
}

function formatRate(value: number | null): string {
	return value ? `${Math.round(value)} tok/s` : "unknown";
}

function formatLatency(value: number | null): string {
	return value ? `${Math.round(value)} ms/1k` : "unknown";
}

function formatObservationAge(nowMs: number, observedAt: number | null): string {
	if (!observedAt) {
		return "never";
	}
	const elapsedMs = Math.max(0, nowMs - observedAt);
	const elapsedMinutes = Math.floor(elapsedMs / 60_000);
	if (elapsedMinutes < 1) {
		return "<1m ago";
	}
	if (elapsedMinutes < 60) {
		return `${elapsedMinutes}m ago`;
	}
	const elapsedHours = Math.floor(elapsedMinutes / 60);
	if (elapsedHours < 48) {
		return `${elapsedHours}h ago`;
	}
	return `${Math.floor(elapsedHours / 24)}d ago`;
}

function formatEndpoint(entry: RuntimeClineModelRegistryEntry): string {
	return entry.constraints.sharedEndpointId ?? entry.endpoint ?? "dedicated";
}

function hasContextWindow(entry: RuntimeClineModelRegistryEntry): boolean {
	return entry.contextWindow.effective !== null;
}

export function formatClineModelRegistryPanelSummary(entry: RuntimeClineModelRegistryEntry, nowMs: number): string {
	return [
		`${entry.providerId}/${entry.modelId}`,
		`endpoint ${formatEndpoint(entry)}`,
		`window ${formatTokenWindow(entry.contextWindow.effective)}`,
		`in ${formatRate(entry.speed.prefillTokensPerSecondEwma)}`,
		`out ${formatRate(entry.speed.decodeTokensPerSecondEwma)}`,
		`latency ${formatLatency(entry.speed.wallTimeMsPer1kPromptTokensEwma)}`,
		`cap ${Math.round(entry.capability.effectiveScore)}`,
		`${entry.speed.samples} samples`,
		`last ${formatObservationAge(nowMs, entry.speed.lastObservedAt ?? entry.capability.lastObservedAt)}`,
	].join(" · ");
}

interface ClineModelRegistryPanelProps {
	entries: readonly RuntimeClineModelRegistryEntry[];
	selectedProviderId: string;
	selectedModelId: string;
	nowMs: number;
	isLoading?: boolean;
}

export function ClineModelRegistryPanel({
	entries,
	selectedProviderId,
	selectedModelId,
	nowMs,
	isLoading = false,
}: ClineModelRegistryPanelProps) {
	const selectedEntry = findClineModelRegistryEntry(entries, selectedProviderId, selectedModelId);
	const visibleEntries = selectedEntry
		? [selectedEntry, ...entries.filter((entry) => entry.key !== selectedEntry.key)]
		: entries;

	return (
		<section className="mt-2 rounded-lg border border-border bg-surface-1 px-3 py-2" aria-label="Model telemetry">
			<div className="mb-2 flex items-center gap-2 text-xs font-medium text-text-primary">
				<Activity size={14} className="text-status-green" />
				<span>Model Telemetry</span>
				{isLoading ? <span className="ml-auto text-[11px] font-normal text-text-tertiary">Refreshing</span> : null}
			</div>
			{visibleEntries.length === 0 ? (
				<div className="text-xs text-text-secondary">No model observations recorded yet.</div>
			) : (
				<div className="grid gap-2">
					{visibleEntries.map((entry) => {
						const isSelected = entry.key === selectedEntry?.key;
						return (
							<div
								key={entry.key}
								className={cn(
									"rounded-md border px-2 py-2",
									isSelected ? "border-accent/60 bg-accent/10" : "border-border bg-surface-2",
								)}
							>
								<div className="flex min-w-0 items-center gap-2">
									<Server size={14} className="shrink-0 text-text-tertiary" />
									<div className="min-w-0 truncate text-xs font-medium text-text-primary">
										{entry.providerId}/{entry.modelId}
									</div>
									{isSelected ? (
										<span className="ml-auto shrink-0 rounded-sm border border-accent/50 px-1.5 py-0.5 text-[10px] text-accent">
											Selected
										</span>
									) : null}
									{!hasContextWindow(entry) ? (
										<span className="shrink-0 rounded-sm border border-status-orange/50 px-1.5 py-0.5 text-[10px] text-status-orange">
											Set context window
										</span>
									) : null}
								</div>
								<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-secondary">
									<span>Endpoint: {formatEndpoint(entry)}</span>
									<span>Window: {formatTokenWindow(entry.contextWindow.effective)}</span>
									<span>Samples: {entry.speed.samples}</span>
									<span>
										Last:{" "}
										{formatObservationAge(
											nowMs,
											entry.speed.lastObservedAt ?? entry.capability.lastObservedAt,
										)}
									</span>
								</div>
								<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-tertiary">
									<span className="inline-flex items-center gap-1">
										<Gauge size={12} />
										In {formatRate(entry.speed.prefillTokensPerSecondEwma)}
									</span>
									<span>Out {formatRate(entry.speed.decodeTokensPerSecondEwma)}</span>
									<span>Latency {formatLatency(entry.speed.wallTimeMsPer1kPromptTokensEwma)}</span>
									<span>Capability {Math.round(entry.capability.effectiveScore)}</span>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}
