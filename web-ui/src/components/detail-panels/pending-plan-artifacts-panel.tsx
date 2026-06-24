import { Activity, Check, Trash2 } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { showAppToast } from "@/components/app-toaster";
import { Button } from "@/components/ui/button";
import { ElementTooltip } from "@/components/ui/element-tooltip";
import { Spinner } from "@/components/ui/spinner";
import {
	applyNKleinPlanArtifact,
	fetchNKleinPlanArtifacts,
	rejectNKleinPlanArtifact,
} from "@/runtime/runtime-config-query";
import type { RuntimeNKleinPlanArtifactSummary, RuntimeWorkspaceStateResponse } from "@/runtime/types";

/**
 * The card detail view's pending-plan-artifacts panel, extracted from the oversized `card-detail-view.tsx` (todo §5.U).
 * Lists the decomposition plan artifacts awaiting a decision for a task and lets the user apply one (which mutates the
 * board and is handed back via `onWorkspaceStateApplied`) or reject it, with per-artifact busy state and toasts.
 * Renders nothing when there are no pending artifacts. Self-contained: drives `{ workspaceId, taskId }`.
 */

function formatArtifactTimestamp(value: number): string {
	if (value <= 0) {
		return "Unknown time";
	}
	return new Date(value).toLocaleString();
}

export function PendingPlanArtifactsPanel({
	workspaceId,
	taskId,
	onWorkspaceStateApplied,
}: {
	workspaceId: string | null;
	taskId: string;
	onWorkspaceStateApplied?: (state: RuntimeWorkspaceStateResponse) => void;
}): React.ReactElement | null {
	const [artifacts, setArtifacts] = useState<RuntimeNKleinPlanArtifactSummary[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [actionArtifactId, setActionArtifactId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		if (!workspaceId) {
			setArtifacts([]);
			setError(null);
			return;
		}
		setIsLoading(true);
		setError(null);
		void fetchNKleinPlanArtifacts(workspaceId, taskId)
			.then((response) => {
				if (!cancelled) {
					setArtifacts(response.artifacts);
				}
			})
			.catch((fetchError: unknown) => {
				if (!cancelled) {
					setError(fetchError instanceof Error ? fetchError.message : "Could not load pending plan artifacts.");
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
	}, [taskId, workspaceId]);

	const handleApply = useCallback(
		async (artifactId: string) => {
			if (!workspaceId) {
				return;
			}
			setActionArtifactId(artifactId);
			setError(null);
			try {
				const response = await applyNKleinPlanArtifact(workspaceId, artifactId);
				onWorkspaceStateApplied?.(response.workspaceState);
				setArtifacts((current) => current.filter((artifact) => artifact.artifactId !== artifactId));
				showAppToast({ intent: "success", message: response.message, timeout: 5000 });
			} catch (applyError) {
				const message = applyError instanceof Error ? applyError.message : "Could not apply plan artifact.";
				setError(message);
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
			} finally {
				setActionArtifactId(null);
			}
		},
		[onWorkspaceStateApplied, workspaceId],
	);

	const handleReject = useCallback(
		async (artifactId: string) => {
			if (!workspaceId) {
				return;
			}
			setActionArtifactId(artifactId);
			setError(null);
			try {
				const response = await rejectNKleinPlanArtifact(workspaceId, artifactId);
				setArtifacts((current) => current.filter((artifact) => artifact.artifactId !== artifactId));
				showAppToast({ intent: "success", message: response.message, timeout: 5000 });
			} catch (rejectError) {
				const message = rejectError instanceof Error ? rejectError.message : "Could not reject plan artifact.";
				setError(message);
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
			} finally {
				setActionArtifactId(null);
			}
		},
		[workspaceId],
	);

	if (artifacts.length === 0 && !isLoading && !error) {
		return null;
	}

	return (
		<div className="border-b border-border bg-surface-1 px-3 py-2">
			<div className="mb-2 flex min-w-0 items-center gap-2 text-[12px] font-medium text-text-primary">
				<Activity size={14} className="shrink-0 text-text-secondary" />
				<span>Pending plan artifacts</span>
				<span className="truncate text-text-tertiary">
					{artifacts.length > 0 ? `${artifacts.length} ready` : isLoading ? "Loading" : "Needs attention"}
				</span>
				{isLoading ? <Spinner size={12} className="ml-auto" /> : null}
			</div>
			{error ? <div className="mb-2 text-[12px] text-status-red">{error}</div> : null}
			<div className="space-y-2">
				{artifacts.map((artifact) => {
					const isBusy = actionArtifactId === artifact.artifactId;
					return (
						<div key={artifact.artifactId} className="rounded-md border border-border bg-surface-0 px-2 py-2">
							<div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
								<div className="min-w-0">
									<div className="truncate text-[13px] font-medium text-text-primary">{artifact.title}</div>
									<div className="mt-1 text-[11px] text-text-secondary">
										{artifact.taskCount} tasks, {artifact.dependencyCount} dependencies ·{" "}
										{formatArtifactTimestamp(artifact.createdAt)}
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									<Button
										size="sm"
										variant="primary"
										icon={isBusy ? <Spinner size={14} /> : <Check size={14} />}
										disabled={isBusy || actionArtifactId !== null}
										onClick={() => {
											void handleApply(artifact.artifactId);
										}}
									>
										Apply
									</Button>
									<ElementTooltip id="card-artifact.reject" side="top">
										<Button
											size="sm"
											variant="ghost"
											icon={<Trash2 size={14} />}
											disabled={isBusy || actionArtifactId !== null}
											onClick={() => {
												void handleReject(artifact.artifactId);
											}}
										>
											Reject
										</Button>
									</ElementTooltip>
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
