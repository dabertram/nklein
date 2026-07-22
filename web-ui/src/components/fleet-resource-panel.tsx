import type { RuntimeFleetStatusResponse } from "@/runtime/types";

type Resources = RuntimeFleetStatusResponse["resources"];

const GiB = 1024 ** 3;

function formatBytes(bytes: number | null): string {
	if (bytes === null) return "unavailable";
	if (bytes >= GiB) return `${(bytes / GiB).toFixed(bytes >= 10 * GiB ? 0 : 1)} GiB`;
	return `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
}

function formatPercent(value: number | null): string {
	return value === null ? "sampling…" : `${value.toFixed(0)}%`;
}

function ResourceMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
	return (
		<div className="rounded-md border border-border bg-surface-0 px-2 py-1.5">
			<div className="text-[9px] uppercase tracking-wide text-text-tertiary">{label}</div>
			<div className="text-xs font-medium tabular-nums text-text-primary">{value}</div>
			{detail ? <div className="truncate text-[9px] text-text-tertiary">{detail}</div> : null}
		</div>
	);
}

export function FleetResourcePanel({ resources }: { resources: Resources }): React.ReactElement {
	if (!resources) {
		return (
			<div
				className="border-b border-border px-2 py-2 text-[11px] italic text-text-tertiary"
				data-testid="resources-empty"
			>
				Resource telemetry unavailable.
			</div>
		);
	}
	const systemUsedBytes = Math.max(0, resources.host.systemTotalBytes - resources.host.systemFreeBytes);
	const diskUsedBytes =
		resources.disk.totalBytes === null || resources.disk.freeBytes === null
			? null
			: Math.max(0, resources.disk.totalBytes - resources.disk.freeBytes);
	const cache = resources.promptCache;
	return (
		<section
			className="border-b border-border px-2 py-2"
			aria-label="Resource telemetry"
			data-testid="fleet-resources"
		>
			<div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-text-tertiary">
				<span>!Klein host resources</span>
				<span className="normal-case tracking-normal">live while fleet is open · 15s</span>
			</div>
			<div className="grid grid-cols-2 gap-1.5 md:grid-cols-4 xl:grid-cols-6">
				<ResourceMetric
					label="System RAM"
					value={`${formatBytes(systemUsedBytes)} / ${formatBytes(resources.host.systemTotalBytes)}`}
					detail={`${formatBytes(resources.host.systemFreeBytes)} available`}
				/>
				<ResourceMetric
					label="!Klein process"
					value={formatBytes(resources.host.processRssBytes)}
					detail={`${formatBytes(resources.host.processHeapUsedBytes)} JS heap`}
				/>
				<ResourceMetric
					label="CPU"
					value={`${formatPercent(resources.host.systemCpuPercent)} system`}
					detail={`${formatPercent(resources.host.processCpuPercent)} !Klein · ${resources.host.logicalCpuCount} logical CPUs`}
				/>
				<ResourceMetric
					label="Workspace disk"
					value={
						diskUsedBytes === null
							? "unavailable"
							: `${formatBytes(diskUsedBytes)} / ${formatBytes(resources.disk.totalBytes)}`
					}
					detail={
						resources.disk.freeBytes === null ? undefined : `${formatBytes(resources.disk.freeBytes)} available`
					}
				/>
				<ResourceMetric
					label="Prompt cache"
					value={
						cache.averageReuseRatio === null
							? "warming"
							: `${(cache.averageReuseRatio * 100).toFixed(0)}% avg reuse`
					}
					detail={`${cache.perfectHits}/${cache.comparisons} byte-identical hits`}
				/>
				<ResourceMetric
					label="Reservations"
					value={`${resources.reservations.holderCount} task hold${resources.reservations.holderCount === 1 ? "" : "s"}`}
					detail={
						resources.reservations.totals.length === 0
							? "none"
							: resources.reservations.totals
									.map((row) =>
										row.kind.endsWith("_bytes")
											? `${row.key} ${formatBytes(row.amount)}`
											: `${row.key} ${row.amount}`,
									)
									.join(" · ")
					}
				/>
			</div>
			{resources.devices.length > 0 ? (
				<div className="mt-1.5 grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
					{resources.devices.map((device) => (
						<div
							key={device.machineId}
							className="rounded-md border border-border bg-surface-0 px-2 py-1.5 text-[10px]"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-medium text-text-secondary">{device.machineId}</span>
								<span className="tabular-nums text-text-tertiary">
									{device.fastMemoryCapacityBytes === null
										? "fast-memory budget unset"
										: `${formatBytes(device.fastMemoryCapacityBytes)} fast memory / VRAM`}
								</span>
							</div>
							<div className="mt-0.5 text-text-tertiary">
								{device.residents.length} resident · {formatBytes(device.residentBytes)} known model weights
								{device.residentBytesKnownCount < device.residents.length
									? ` · ${device.residents.length - device.residentBytesKnownCount} size unknown`
									: ""}
							</div>
							{device.residents.length > 0 ? (
								<div
									className="mt-0.5 truncate text-text-secondary"
									title={device.residents.map((r) => r.identifier).join(", ")}
								>
									{device.residents
										.map((resident) =>
											resident.contextLength
												? `${resident.identifier} @${Math.round(resident.contextLength / 1_000)}k`
												: resident.identifier,
										)
										.join(" · ")}
								</div>
							) : null}
						</div>
					))}
				</div>
			) : null}
			<p className="m-0 mt-1 text-[9px] text-text-tertiary">
				Fast-memory usage is modelled from reported model weights; remote KV caches and runtime allocator overhead
				are not exposed by LM Link and are intentionally not presented as measured free VRAM.
			</p>
		</section>
	);
}
