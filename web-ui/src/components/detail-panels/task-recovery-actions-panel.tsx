import { acceptanceFailureCategoryLabel } from "@runtime-contract";
import { Check, Clipboard, GitCompareArrows, X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { showAppToast } from "@/components/app-toaster";
import { TaskEvidenceDrawer } from "@/components/detail-panels/task-evidence-drawer";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { collectTaskEvidence, mergeTaskWorktrees, verifyTaskAcceptance } from "@/runtime/runtime-config-query";
import type {
	RuntimeTaskAcceptanceVerifyResponse,
	RuntimeTaskEvidenceResponse,
	RuntimeTaskSessionSummary,
	RuntimeTaskWorktreeMergeResponse,
} from "@/runtime/types";
import type { CardSelection } from "@/types";

/**
 * The card detail view's review/recovery actions panel, extracted from the oversized `card-detail-view.tsx` (todo
 * §5.U). Offers the context-appropriate actions for a card — verify its acceptance check, merge its worktree, mark a
 * heartbeat-lost session interrupted, and collect an evidence bundle (rendered inline via TaskEvidenceDrawer). Each
 * action has its own busy state + result line + toast. Renders nothing when none apply.
 */

function hasAcceptanceCheck(prompt: string): boolean {
	return /^Acceptance check:\s*(.+?)\s*$/im.test(prompt);
}

function formatVerifyResult(response: RuntimeTaskAcceptanceVerifyResponse): string {
	const { acceptance } = response;
	const output = acceptance.output.trim();
	const outputPreview = output ? ` ${output.slice(0, 240)}` : "";
	const failureLine =
		acceptance.passed === false && (acceptance.failureCategory || acceptance.failureHint)
			? `\n${acceptanceFailureCategoryLabel(acceptance.failureCategory)}${acceptance.failureHint ? ` — ${acceptance.failureHint}` : ""}`
			: "";
	return `${response.message}${failureLine}${outputPreview}`;
}

function formatMergeResult(response: RuntimeTaskWorktreeMergeResponse): string {
	if (response.conflict) {
		const paths = response.conflict.conflictedPaths.join(", ");
		return paths ? `${response.message} ${paths}` : response.message;
	}
	return response.message;
}

export function TaskRecoveryActionsPanel({
	workspaceId,
	selection,
	sessionSummary,
	onMarkTaskInterrupted,
}: {
	workspaceId: string | null;
	selection: CardSelection;
	sessionSummary: RuntimeTaskSessionSummary | null;
	onMarkTaskInterrupted?: (taskId: string) => Promise<{ ok: boolean; message?: string }>;
}): React.ReactElement | null {
	const canVerify =
		(selection.column.id === "planning" || selection.column.id === "review") &&
		hasAcceptanceCheck(selection.card.prompt);
	const canMerge = selection.column.id === "review";
	const canMarkInterrupted =
		sessionSummary?.heartbeatStatus === "lost" &&
		sessionSummary.state !== "interrupted" &&
		Boolean(onMarkTaskInterrupted);
	const canCollectEvidence = Boolean(workspaceId);
	const [verifyResult, setVerifyResult] = useState<string | null>(null);
	const [mergeResult, setMergeResult] = useState<string | null>(null);
	const [interruptResult, setInterruptResult] = useState<string | null>(null);
	const [evidenceResult, setEvidenceResult] = useState<string | null>(null);
	const [evidenceDetails, setEvidenceDetails] = useState<RuntimeTaskEvidenceResponse | null>(null);
	const [isVerifying, setIsVerifying] = useState(false);
	const [isMerging, setIsMerging] = useState(false);
	const [isMarkingInterrupted, setIsMarkingInterrupted] = useState(false);
	const [isCollectingEvidence, setIsCollectingEvidence] = useState(false);

	useEffect(() => {
		setVerifyResult(null);
		setMergeResult(null);
		setInterruptResult(null);
		setEvidenceResult(null);
		setEvidenceDetails(null);
	}, [selection.card.id]);

	const handleVerify = useCallback(async () => {
		if (!workspaceId) {
			return;
		}
		setIsVerifying(true);
		setVerifyResult(null);
		try {
			const response = await verifyTaskAcceptance(workspaceId, selection.card.id);
			setVerifyResult(formatVerifyResult(response));
			showAppToast({
				intent: response.ok ? "success" : "warning",
				message: response.message,
				timeout: 6000,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not verify this task.";
			setVerifyResult(message);
			showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
		} finally {
			setIsVerifying(false);
		}
	}, [selection.card.id, workspaceId]);

	const handleMerge = useCallback(async () => {
		if (!workspaceId) {
			return;
		}
		setIsMerging(true);
		setMergeResult(null);
		try {
			const response = await mergeTaskWorktrees(workspaceId, selection.card.id);
			setMergeResult(formatMergeResult(response));
			showAppToast({
				intent: response.ok ? "success" : "warning",
				message: response.message,
				timeout: 7000,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not merge this task result.";
			setMergeResult(message);
			showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
		} finally {
			setIsMerging(false);
		}
	}, [selection.card.id, workspaceId]);

	const handleMarkInterrupted = useCallback(async () => {
		if (!onMarkTaskInterrupted) {
			return;
		}
		setIsMarkingInterrupted(true);
		setInterruptResult(null);
		try {
			const response = await onMarkTaskInterrupted(selection.card.id);
			if (!response.ok) {
				const message = response.message ?? "Could not mark this task interrupted.";
				setInterruptResult(message);
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
				return;
			}
			const message = "Marked the lost task session interrupted.";
			setInterruptResult(message);
			showAppToast({ intent: "success", message, timeout: 4000 });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not mark this task interrupted.";
			setInterruptResult(message);
			showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
		} finally {
			setIsMarkingInterrupted(false);
		}
	}, [onMarkTaskInterrupted, selection.card.id]);

	const handleCollectEvidence = useCallback(async () => {
		if (!workspaceId) {
			return;
		}
		setIsCollectingEvidence(true);
		setEvidenceResult(null);
		try {
			const response = await collectTaskEvidence(workspaceId, selection.card.id);
			if (!response?.promptBlock) {
				throw new Error("Evidence could not be created (the runtime returned no prompt block).");
			}
			await navigator.clipboard.writeText(response.promptBlock);
			const captureReady = response.capture.status === "result_branch";
			const message = captureReady
				? `Evidence created and copied. ${response.bundlePath}`
				: `Evidence bundle created, but task artifact status is ${response.capture.status.replaceAll("_", " ")}. ${response.capture.message}`;
			setEvidenceResult(message);
			setEvidenceDetails(response);
			showAppToast({
				intent: captureReady ? "success" : "warning",
				icon: captureReady ? "clipboard" : "warning-sign",
				message: captureReady ? "Evidence created and copied." : response.capture.message,
				timeout: captureReady ? 5000 : 7000,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not collect task evidence.";
			setEvidenceResult(message);
			setEvidenceDetails(null);
			showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
		} finally {
			setIsCollectingEvidence(false);
		}
	}, [selection.card.id, workspaceId]);

	if (!canVerify && !canMerge && !canMarkInterrupted && !canCollectEvidence) {
		return null;
	}

	return (
		<div className="border-b border-border bg-surface-1 px-3 py-2">
			<div className="mb-2 flex min-w-0 items-center gap-2 text-[12px] font-medium text-text-primary">
				<GitCompareArrows size={14} className="shrink-0 text-text-secondary" />
				<span>Review actions</span>
				<span className="truncate text-text-tertiary">Verify, merge, recover, or create evidence</span>
			</div>
			<div className="flex flex-wrap gap-2">
				{canCollectEvidence ? (
					<Button
						size="sm"
						variant="default"
						icon={isCollectingEvidence ? <Spinner size={14} /> : <Clipboard size={14} />}
						disabled={isVerifying || isMerging || isMarkingInterrupted || isCollectingEvidence}
						onClick={() => {
							void handleCollectEvidence();
						}}
					>
						Create evidence
					</Button>
				) : null}
				{canVerify ? (
					<Button
						size="sm"
						variant="default"
						icon={isVerifying ? <Spinner size={14} /> : <Check size={14} />}
						disabled={!workspaceId || isVerifying || isMerging || isMarkingInterrupted || isCollectingEvidence}
						onClick={() => {
							void handleVerify();
						}}
					>
						Verify
					</Button>
				) : null}
				{canMerge ? (
					<Button
						size="sm"
						variant="default"
						icon={isMerging ? <Spinner size={14} /> : <GitCompareArrows size={14} />}
						disabled={!workspaceId || isVerifying || isMerging || isMarkingInterrupted || isCollectingEvidence}
						onClick={() => {
							void handleMerge();
						}}
					>
						Merge
					</Button>
				) : null}
				{canMarkInterrupted ? (
					<Button
						size="sm"
						variant="default"
						icon={isMarkingInterrupted ? <Spinner size={14} /> : <X size={14} />}
						disabled={isVerifying || isMerging || isMarkingInterrupted || isCollectingEvidence}
						onClick={() => {
							void handleMarkInterrupted();
						}}
					>
						Mark interrupted
					</Button>
				) : null}
			</div>
			{verifyResult ? (
				<div className="mt-2 whitespace-pre-line text-[12px] text-text-secondary">{verifyResult}</div>
			) : null}
			{mergeResult ? <div className="mt-2 text-[12px] text-text-secondary">{mergeResult}</div> : null}
			{interruptResult ? <div className="mt-2 text-[12px] text-text-secondary">{interruptResult}</div> : null}
			{evidenceResult ? (
				<div className="mt-2 break-all text-[12px] text-text-secondary">{evidenceResult}</div>
			) : null}
			{evidenceDetails ? <TaskEvidenceDrawer evidence={evidenceDetails} /> : null}
		</div>
	);
}
