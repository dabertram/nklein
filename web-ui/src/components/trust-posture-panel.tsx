// F12.98 Trust & Privacy Panel — read-only render of the trust-center's LIVE state: per-egress-class posture (the
// F12.101 assessment served by getTrustPosture) + the F12.99 hash-chained receipt log's verification. No save/dirty
// machinery: this panel shows what the architecture currently enforces; changing a class happens where its control
// lives (settings flags, env, MCP config). Self-contained so the settings dialog only mounts it.

import { useEffect, useState } from "react";
import { fetchTrustPosture } from "@/runtime/queries/config";
import type { RuntimeTrustPostureResponse } from "@/runtime/types";

export function TrustPosturePanel({ workspaceId }: { workspaceId: string | null }): React.ReactElement {
	const [posture, setPosture] = useState<RuntimeTrustPostureResponse | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		fetchTrustPosture(workspaceId)
			.then((response) => {
				if (!cancelled) {
					setPosture(response);
				}
			})
			.catch((cause: unknown) => {
				if (!cancelled) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId]);

	if (error) {
		return <p className="text-[13px] text-status-red m-0">Could not load the trust posture: {error}</p>;
	}
	if (!posture) {
		return <p className="text-[13px] text-text-tertiary m-0">Loading live egress posture…</p>;
	}
	return (
		<div className="flex flex-col gap-3">
			<div
				className={`rounded-lg border px-4 py-3 text-[13px] ${
					posture.airGapped
						? "border-status-green/40 bg-status-green/5 text-text-primary"
						: "border-border bg-surface-0 text-text-primary"
				}`}
				data-testid="trust-posture-summary"
			>
				{posture.summary}
			</div>
			<div className="rounded-lg border border-border bg-surface-0 divide-y divide-border">
				{posture.classes.map((entry) => (
					<div key={entry.egressClass} className="flex items-start gap-3 px-4 py-2.5">
						<span
							className={`mt-0.5 shrink-0 rounded px-1.5 py-px text-[10px] uppercase tracking-wide ${
								entry.open
									? "bg-status-gold/15 text-status-gold border border-status-gold/40"
									: "bg-status-green/10 text-status-green border border-status-green/30"
							}`}
						>
							{entry.open ? "open" : "closed"}
						</span>
						<div className="min-w-0">
							<p className="text-[13px] font-medium text-text-primary m-0">{entry.egressClass}</p>
							<p className="text-[12px] text-text-secondary m-0">{entry.detail}</p>
						</div>
					</div>
				))}
			</div>
			<div className="rounded-lg border border-border bg-surface-0 px-4 py-3">
				<p className="text-[13px] text-text-primary m-0">
					Egress receipts: {posture.egressReceiptCount} recorded — chain{" "}
					<span className={posture.receiptChainValid ? "text-status-green" : "text-status-red"}>
						{posture.receiptChainValid ? "intact" : "BROKEN"}
					</span>
				</p>
				<p className="text-[12px] text-text-secondary m-0 mt-1">
					{posture.receiptChainReason} Every outbound request appends a hash-chained receipt to a local log
					(`~/.nklein/nklein/egress-receipts.jsonl`) you can audit with `nklein dev egress-receipts`.
				</p>
			</div>
			<p className="text-[12px] text-text-tertiary m-0">
				The full data-flow and compliance posture lives in <code>docs/trust-center.md</code> — private by
				architecture, not by policy.
			</p>
		</div>
	);
}
