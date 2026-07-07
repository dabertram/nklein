// Settings health line for the Python core (`core-py`) sidecar (todo §5.H).
// Self-contained so it doesn't thread extra state through the large settings dialog: it fetches the core's
// health once on mount (and on workspace change) and renders a compact running / unreachable / disabled status.
import type { RuntimeKleinCorePyHealthResponse } from "@runtime-contract";
import { CircleSlash, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchKleinCorePyHealth } from "@/runtime/runtime-config-query";

interface KleinCorePyHealthLineProps {
	workspaceId: string | null;
}

export function KleinCorePyHealthLine({ workspaceId }: KleinCorePyHealthLineProps) {
	const [health, setHealth] = useState<RuntimeKleinCorePyHealthResponse | null>(null);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		setIsLoading(true);
		void fetchKleinCorePyHealth(workspaceId)
			.then((result) => {
				if (!cancelled) {
					setHealth(result);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setHealth(null);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId]);

	const statusLabel = !health
		? isLoading
			? "Checking…"
			: "Unknown"
		: !health.enabled
			? "Disabled"
			: health.reachable
				? "Running"
				: "Not reachable";
	const isUp = health?.enabled === true && health.reachable;
	const isDisabled = health?.enabled === false;

	return (
		<div className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
			<div className="flex items-center gap-2 text-[11px] text-text-tertiary">
				{isDisabled ? <CircleSlash size={12} /> : <Server size={12} />}
				<span>Python core (core-py)</span>
			</div>
			<div
				className={
					isUp
						? "text-[13px] font-medium text-status-green"
						: isDisabled
							? "text-[13px] font-medium text-text-secondary"
							: "text-[13px] font-medium text-status-orange"
				}
			>
				{statusLabel}
			</div>
			<div className="mt-1 text-[11px] text-text-secondary">
				{health?.enabled === false
					? "Set NKLEIN_CORE_PY=1 to enable the local ML sidecar."
					: `Endpoint ${health?.sidecarUrl ?? "—"}`}
			</div>
			{/* §5.H model-loaded detail: the core's resident embedding models (basenames — the path is host detail). */}
			{isUp && (health?.loadedModels?.length ?? 0) > 0 ? (
				<div className="mt-0.5 truncate text-[11px] text-text-tertiary" data-testid="core-py-loaded-models">
					Model loaded: {health?.loadedModels.map((path) => path.split("/").at(-1) ?? path).join(", ")}
				</div>
			) : null}
		</div>
	);
}
