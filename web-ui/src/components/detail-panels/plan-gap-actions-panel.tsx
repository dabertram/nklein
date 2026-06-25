import { Flag } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";
import { showAppToast } from "@/components/app-toaster";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { recordNKleinPlanGap } from "@/runtime/runtime-config-query";
import type { PlanGapKind, RuntimeWorkspaceStateResponse } from "@/runtime/types";

/**
 * The card detail view's plan-gap reporting panel. Renders on planning/review-lane cards and lets the
 * user report a plan gap (select kind + description + optional evidence) which calls `recordNKleinPlanGap`
 * and may create a companion card on the board. Mirrors the structure of `PendingPlanArtifactsPanel` and
 * `TaskRecoveryActionsPanel`. Renders null when no workspaceId is available.
 */

const PLAN_GAP_KIND_LABELS: { value: PlanGapKind; label: string }[] = [
	{ value: "missing_decision", label: "Missing decision" },
	{ value: "contradictory_requirement", label: "Contradictory requirement" },
	{ value: "missing_dependency", label: "Missing dependency" },
	{ value: "scope_too_large", label: "Scope too large" },
	{ value: "integration_needed", label: "Integration needed" },
	{ value: "other", label: "Other" },
];

export function PlanGapActionsPanel({
	workspaceId,
	taskId,
	onWorkspaceStateApplied,
}: {
	workspaceId: string | null;
	taskId: string;
	onWorkspaceStateApplied?: (state: RuntimeWorkspaceStateResponse) => void;
}): React.ReactElement | null {
	const [kind, setKind] = useState<PlanGapKind>("missing_decision");
	const [description, setDescription] = useState("");
	const [evidence, setEvidence] = useState("");
	const [isBusy, setIsBusy] = useState(false);
	const [result, setResult] = useState<string | null>(null);

	const handleSubmit = useCallback(async () => {
		if (!workspaceId || !description.trim()) {
			return;
		}
		setIsBusy(true);
		setResult(null);
		try {
			const response = await recordNKleinPlanGap(workspaceId, {
				taskId,
				kind,
				description: description.trim(),
				evidence: evidence.trim() || undefined,
			});
			if (response.workspaceState) {
				onWorkspaceStateApplied?.(response.workspaceState);
			}
			setResult(response.message);
			setDescription("");
			setEvidence("");
			showAppToast({ intent: "success", message: response.message, timeout: 5000 });
		} catch (err) {
			const message = err instanceof Error ? err.message : "Could not record plan gap.";
			setResult(message);
			showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
		} finally {
			setIsBusy(false);
		}
	}, [workspaceId, taskId, kind, description, evidence, onWorkspaceStateApplied]);

	if (!workspaceId) {
		return null;
	}

	return (
		<div className="border-b border-border bg-surface-1 px-3 py-2">
			<div className="mb-2 flex min-w-0 items-center gap-2 text-[12px] font-medium text-text-primary">
				<Flag size={14} className="shrink-0 text-text-secondary" />
				<span>Report a plan gap</span>
				<span className="truncate text-text-tertiary">Flag a missing decision, integration, or scope issue</span>
			</div>
			<div className="flex flex-col gap-2">
				<NativeSelect
					size="sm"
					fill
					value={kind}
					disabled={isBusy}
					onChange={(e) => {
						setKind(e.target.value as PlanGapKind);
					}}
				>
					{PLAN_GAP_KIND_LABELS.map(({ value, label }) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</NativeSelect>
				<textarea
					className="min-h-[60px] w-full resize-y rounded-md border border-border-bright bg-surface-2 px-2 py-1.5 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
					placeholder="Describe the plan gap…"
					value={description}
					disabled={isBusy}
					onChange={(e) => {
						setDescription(e.target.value);
					}}
				/>
				<textarea
					className="min-h-[40px] w-full resize-y rounded-md border border-border-bright bg-surface-2 px-2 py-1.5 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
					placeholder="Evidence (optional)"
					value={evidence}
					disabled={isBusy}
					onChange={(e) => {
						setEvidence(e.target.value);
					}}
				/>
				<div className="flex items-center justify-end">
					<Button
						size="sm"
						variant="default"
						icon={isBusy ? <Spinner size={14} /> : <Flag size={14} />}
						disabled={isBusy || !description.trim()}
						onClick={() => {
							void handleSubmit();
						}}
					>
						Report gap
					</Button>
				</div>
			</div>
			{result ? <div className="mt-2 text-[12px] text-text-secondary">{result}</div> : null}
		</div>
	);
}
