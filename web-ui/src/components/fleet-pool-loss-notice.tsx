// P0.POOLLOSS board notice: a configured role-pool model that the fleet sweep found NO LONGER LOADED. Live 2026-09-03
// a crashed worker went unnoticed for 17 hours because nothing on the board said so; this bar is that saying-so.
// Polls the sweep's ledger (30 s) and renders nothing while every pool member is loaded.
import type { RuntimeFleetPoolHealthResponse, RuntimeFleetPoolLoss } from "@runtime-contract";
import { AlertTriangle } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";

import { fetchFleetPoolHealth } from "@/runtime/queries/config";

const DEFAULT_POLL_MS = 30_000;

function clockTime(epochMs: number): string {
	return new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatFleetPoolLoss(loss: RuntimeFleetPoolLoss, nowMs: number): string {
	const minutes = Math.max(0, Math.round((nowMs - loss.absentSince) / 60_000));
	const roles = loss.roles.length > 0 ? `${loss.roles.join(", ")} pool` : "pool";
	const lastSeen =
		loss.lastSeenAt === null
			? "never seen loaded since the runtime started"
			: `last seen loaded ${clockTime(loss.lastSeenAt)}`;
	const signature = loss.lastError
		? ` Last error: ${loss.lastError.message}`
		: " No wire error was recorded before it vanished.";
	return `${loss.modelId} at ${loss.endpoint} (${roles}) is no longer loaded — gone since ${clockTime(loss.absentSince)} (${minutes} min), ${lastSeen}.${signature}`;
}

export function FleetPoolLossNotice({
	workspaceId,
	fetchHealth = fetchFleetPoolHealth,
	pollMs = DEFAULT_POLL_MS,
	now = () => Date.now(),
}: {
	workspaceId: string | null;
	fetchHealth?: (workspaceId: string | null) => Promise<RuntimeFleetPoolHealthResponse>;
	pollMs?: number;
	now?: () => number;
}): ReactElement | null {
	const [health, setHealth] = useState<RuntimeFleetPoolHealthResponse | null>(null);

	useEffect(() => {
		let cancelled = false;
		const load = () => {
			void fetchHealth(workspaceId)
				.then((result) => {
					if (!cancelled) {
						setHealth(result);
					}
				})
				.catch(() => {
					// An unreachable runtime shows no fleet notice; the board's own connection state covers that.
				});
		};
		load();
		const timer = setInterval(load, pollMs);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [workspaceId, fetchHealth, pollMs]);

	if (!health || health.losses.length === 0) {
		return null;
	}
	const nowMs = now();
	return (
		<div
			className="border-b border-border bg-status-orange/10 px-4 py-2"
			data-testid="fleet-pool-loss-notice"
			role="status"
		>
			<div className="flex items-start gap-3">
				<div className="mt-0.5 shrink-0 text-status-orange">
					<AlertTriangle size={16} />
				</div>
				<div className="min-w-0 flex-1">
					<p className="text-[13px] font-medium text-text-primary">
						{health.losses.length === 1
							? "A fleet pool model vanished"
							: `${health.losses.length} fleet pool models vanished`}
					</p>
					<ul className="mt-1 space-y-0.5 text-[13px] text-text-secondary">
						{health.losses.map((loss) => (
							<li key={`${loss.modelId} ${loss.endpoint}`}>{formatFleetPoolLoss(loss, nowMs)}</li>
						))}
					</ul>
					<p className="mt-1 text-[12px] text-text-tertiary">
						Routing excludes it until its endpoint lists it loaded again. Reload it in LM Studio — the runtime
						never loads models itself.
					</p>
				</div>
			</div>
		</div>
	);
}
