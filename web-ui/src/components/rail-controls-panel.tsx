import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchRailStatus, setRailControl, setRailTunables } from "@/runtime/queries/config";
import type { RuntimeRailControlRequest, RuntimeRailStatusResponse } from "@/runtime/types";

/**
 * F1.35b — the background-eval RAIL controls/status surface. Enable/pause the automated background evaluation loop
 * (the §5.AI rail: the unattended counterpart of "Evaluate connected models") and tune its cadence + concurrency.
 *
 * The control INTENT persists regardless of whether this runtime hosts the F1.31 service; when the service is hosted
 * (the `NKLEIN_EVAL_RAIL` boot flag), enable/pause actually start/stop it and the live section (active runs, last tick)
 * fills in. Otherwise the surface configures the rail ahead of enabling it on a capable runtime — the status reads
 * "disabled"/"idle" and the live section stays empty.
 */

const STATE_STYLES: Record<RuntimeRailStatusResponse["state"], { label: string; className: string }> = {
	disabled: { label: "Disabled", className: "border-border bg-surface-2 text-text-secondary" },
	idle: { label: "Idle", className: "border-status-green/50 bg-status-green/10 text-status-green" },
	active: { label: "Active", className: "border-status-blue/50 bg-status-blue/10 text-status-blue" },
	paused: { label: "Paused", className: "border-status-amber/50 bg-status-amber/10 text-status-amber" },
};

const NUMBER_INPUT_CLASS =
	"w-20 rounded border border-border bg-surface-0 px-2 py-1 text-[13px] text-text-primary focus:border-accent focus:outline-none";

export function RailControlsPanel({ workspaceId }: { workspaceId: string | null }): React.JSX.Element {
	const [status, setStatus] = useState<RuntimeRailStatusResponse | null>(null);
	const [cadenceMin, setCadenceMin] = useState("");
	const [cap, setCap] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const applyStatus = useCallback((next: RuntimeRailStatusResponse) => {
		setStatus(next);
		setCadenceMin(String(Math.max(1, Math.round(next.cadenceMs / 60_000))));
		setCap(String(next.maxConcurrentEvals));
	}, []);

	const refresh = useCallback(async () => {
		try {
			applyStatus(await fetchRailStatus(workspaceId));
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Failed to load rail status");
		}
	}, [workspaceId, applyStatus]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const runControl = useCallback(
		async (command: RuntimeRailControlRequest) => {
			setBusy(true);
			try {
				applyStatus(await setRailControl(workspaceId, command));
				setError(null);
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : "Rail control failed");
			} finally {
				setBusy(false);
			}
		},
		[workspaceId, applyStatus],
	);

	const saveTunables = useCallback(async () => {
		const cadenceMs = Math.max(1, Math.round(Number(cadenceMin) || 0)) * 60_000;
		const maxConcurrentEvals = Math.max(1, Math.round(Number(cap) || 0));
		setBusy(true);
		try {
			applyStatus(await setRailTunables(workspaceId, { cadenceMs, maxConcurrentEvals }));
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Failed to save rail tunables");
		} finally {
			setBusy(false);
		}
	}, [workspaceId, cadenceMin, cap, applyStatus]);

	if (!status) {
		return (
			<div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-text-secondary">
				{error ? `Background eval rail: ${error}` : "Loading background eval rail…"}
			</div>
		);
	}

	const stateStyle = STATE_STYLES[status.state];
	const enabled = status.state !== "disabled";
	const paused = status.state === "paused";

	return (
		<div className="rounded-md border border-border bg-surface-1 p-3" data-testid="rail-controls-panel">
			<div className="mb-2 flex items-center justify-between gap-3">
				<h6 className="m-0 text-[12px] font-semibold uppercase tracking-wider text-text-secondary">
					Background eval rail
				</h6>
				<span
					data-testid="rail-status-badge"
					className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${stateStyle.className}`}
				>
					{stateStyle.label}
				</span>
			</div>
			<p className="mb-3 text-[12px] text-text-secondary">
				Automatically re-evaluates connected models in the background (the unattended counterpart of “Evaluate
				connected models”). The service runs only on a runtime started with <code>NKLEIN_EVAL_RAIL</code>; the
				intent and tunables below persist regardless.
			</p>

			{error ? (
				<div className="mb-3 rounded-md border border-status-red/50 bg-status-red/10 px-3 py-2 text-[12.5px] text-status-red">
					{error}
				</div>
			) : null}

			<div className="mb-3 flex flex-wrap items-center gap-2">
				{enabled ? (
					<Button variant="danger" size="sm" disabled={busy} onClick={() => void runControl({ kind: "disable" })}>
						Disable
					</Button>
				) : (
					<Button variant="primary" size="sm" disabled={busy} onClick={() => void runControl({ kind: "enable" })}>
						Enable
					</Button>
				)}
				{enabled ? (
					paused ? (
						<Button
							variant="default"
							size="sm"
							disabled={busy}
							onClick={() => void runControl({ kind: "resume" })}
						>
							Resume
						</Button>
					) : (
						<Button
							variant="default"
							size="sm"
							disabled={busy}
							onClick={() => void runControl({ kind: "pause", reason: "operator" })}
						>
							Pause
						</Button>
					)
				) : null}
				{paused && status.pauseReason ? (
					<span className="text-[12px] text-text-secondary">Paused: {status.pauseReason}</span>
				) : null}
			</div>

			<div className="mb-3 flex flex-wrap items-end gap-4">
				<label className="flex flex-col gap-1 text-[12px] text-text-secondary">
					Cadence (min)
					<input
						type="number"
						min={1}
						className={NUMBER_INPUT_CLASS}
						value={cadenceMin}
						disabled={busy}
						onChange={(event) => setCadenceMin(event.target.value)}
						aria-label="Rail cadence in minutes"
					/>
				</label>
				<label className="flex flex-col gap-1 text-[12px] text-text-secondary">
					Concurrent cap
					<input
						type="number"
						min={1}
						className={NUMBER_INPUT_CLASS}
						value={cap}
						disabled={busy}
						onChange={(event) => setCap(event.target.value)}
						aria-label="Rail concurrent-eval cap"
					/>
				</label>
				<Button variant="ghost" size="sm" disabled={busy} onClick={() => void saveTunables()}>
					Save tunables
				</Button>
			</div>

			<dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-text-secondary">
				<dt>Active runs</dt>
				<dd className="text-text-primary" data-testid="rail-active-runs">
					{status.activeLeases.length}
				</dd>
				<dt>Last tick</dt>
				<dd className="text-text-primary">
					{status.lastTick ? `${status.lastTick.reason} (reaped ${status.lastTick.reapedCount})` : "—"}
				</dd>
				{status.lastTickError ? (
					<>
						<dt>Last error</dt>
						<dd className="text-status-red">{status.lastTickError}</dd>
					</>
				) : null}
			</dl>
		</div>
	);
}
