import { buildStucknessSignalsFromReport, classifyAgentStuckness } from "@runtime-agent-stuckness";
import { describeEscalationResumeAction } from "@runtime-escalation-resume-action";
import { buildEscalationSuggestions } from "@runtime-escalation-suggestions";
import { History, RefreshCw } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { fetchTaskEscalation, sendCardMailboxNote } from "@/runtime/runtime-config-query";
import type { TaskBlockedKind } from "@/types/board";

/**
 * The card detail view's §5.AG "what was tried" escalation panel — the chronological attempt chain (rung × model ×
 * approach × outcome) from the Agent Attempt Ledger, so when a card escalates the operator sees an actionable report
 * instead of a silent dead end. Lazily fetches via `runtime.getTaskEscalation` when expanded; self-contained on
 * `{ workspaceId, taskId }`, mirroring the diagnostics panel.
 */

type EscalationReport = Awaited<ReturnType<typeof fetchTaskEscalation>>;

function getOutcomeClassName(outcome: string): string {
	if (outcome === "success") {
		return "text-status-green";
	}
	if (outcome === "timeout" || outcome === "loop") {
		return "text-status-red";
	}
	return "text-status-orange";
}

export function TaskEscalationPanel({
	workspaceId,
	taskId,
	blockedKind,
	onRedrive,
}: {
	workspaceId: string | null;
	taskId: string;
	/** The card's start-blocking reason (if any) — promotes the most-likely "get through the wall" fix to the front. */
	blockedKind?: TaskBlockedKind | null;
	/** F2.18b: resume a parked card from its result branch (the redrive path — a reopen, not a cold restart). When
	 *  present, `direct_redrive` suggestions render a one-click resume button. */
	onRedrive?: (taskId: string) => void;
}): React.ReactElement {
	const [open, setOpen] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [report, setReport] = useState<EscalationReport | null>(null);
	const [error, setError] = useState<string | null>(null);
	// F2.18c: per-suggestion input text for the `input_then_redrive` kinds (keyed by suggestion kind), and which one
	// is currently submitting (its answer is queued to the card mailbox, then the card redrives + drains it).
	const [resumeInputs, setResumeInputs] = useState<Record<string, string>>({});
	const [resumeSubmitting, setResumeSubmitting] = useState<string | null>(null);

	const submitResumeWithInput = useCallback(
		async (kind: string) => {
			const text = (resumeInputs[kind] ?? "").trim();
			if (!workspaceId || !onRedrive || text.length === 0) {
				return;
			}
			setResumeSubmitting(kind);
			try {
				await sendCardMailboxNote(workspaceId, taskId, text);
				setResumeInputs((current) => ({ ...current, [kind]: "" }));
				onRedrive(taskId);
			} catch {
				// Best-effort — leave the text so the operator can retry.
			} finally {
				setResumeSubmitting(null);
			}
		},
		[resumeInputs, workspaceId, onRedrive, taskId],
	);

	const refreshEscalation = useCallback(() => {
		if (!workspaceId) {
			setReport(null);
			return;
		}
		setIsLoading(true);
		setError(null);
		void fetchTaskEscalation(workspaceId, taskId)
			.then((result) => {
				setReport(result);
			})
			.catch((refreshError) => {
				setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, [taskId, workspaceId]);

	useEffect(() => {
		setReport(null);
		setError(null);
		if (open) {
			refreshEscalation();
		}
	}, [open, refreshEscalation]);

	const summaryLabel = error
		? "Issue"
		: open && report
			? report.totalAttempts === 0
				? "No escalation"
				: `${report.totalAttempts} attempts · ${report.modelsTried.length} models`
			: "What was tried before escalating";

	// §5.AB: derive the progress verdict from the report (client-side, no extra round-trip). When hard-stuck — the
	// automatic ladder (all approaches × all loaded models) is exhausted — show the Layer-2 "get through the wall"
	// suggestions, since often a simple user decision is enough.
	const verdict = useMemo(() => {
		if (!report || report.totalAttempts === 0) {
			return null;
		}
		const stuckness = classifyAgentStuckness(buildStucknessSignalsFromReport(report));
		// Promote the most-likely fix from the card's start-blocker: a sandbox/setup blocker leads with "fix the
		// environment" (matches the §5.AG escalation-suggestion context's `environmentBlocked` mapping).
		const suggestionContext = { environmentBlocked: blockedKind === "agent_sandbox_unavailable" };
		return {
			stuckness,
			suggestions: stuckness === "hard_stuck" ? buildEscalationSuggestions(suggestionContext) : [],
		};
	}, [report, blockedKind]);

	return (
		<div className="border-b border-border bg-surface-1 px-3 py-2">
			<div className="flex items-center justify-between gap-2">
				<button
					type="button"
					className="flex min-w-0 cursor-pointer items-center gap-2 text-left text-[12px] font-medium text-text-primary"
					onClick={() => {
						setOpen((current) => !current);
					}}
				>
					<History size={14} className="shrink-0 text-text-secondary" />
					<span>What was tried</span>
					<span className="truncate text-text-tertiary">{summaryLabel}</span>
				</button>
				<Button
					size="sm"
					variant="ghost"
					icon={isLoading ? <Spinner size={14} /> : <RefreshCw size={14} />}
					disabled={!open || isLoading || !workspaceId}
					onClick={refreshEscalation}
				>
					Refresh
				</Button>
			</div>
			{open ? (
				<div className="mt-2 max-h-36 overflow-auto rounded-md border border-border bg-surface-0 p-2 text-[11px]">
					{error ? <div className="text-status-red">{error}</div> : null}
					{!error && isLoading ? <div className="text-text-secondary">Loading attempt history...</div> : null}
					{!error && !isLoading && report && report.totalAttempts === 0 ? (
						<div className="text-text-secondary">No retries — this card has not escalated.</div>
					) : null}
					{!error && !isLoading && report
						? report.attempts.map((row) => (
								<div
									key={`${row.rung}-${row.recordedAt}`}
									className="flex min-w-0 items-center gap-2 border-b border-border/60 py-1 last:border-b-0"
								>
									<span className="font-mono text-text-tertiary">#{row.rung}</span>
									<span className="truncate font-mono text-text-secondary">{row.modelId}</span>
									<span className="truncate text-text-tertiary">{row.approach}</span>
									<span className={cn("ml-auto shrink-0 font-mono", getOutcomeClassName(row.outcome))}>
										{row.outcome}
									</span>
								</div>
							))
						: null}
					{!error && !isLoading && verdict ? (
						<div className="mt-1.5 border-t border-border/60 pt-1.5">
							<div className="flex items-center gap-1.5">
								<span className="text-text-tertiary">Verdict:</span>
								<span
									className={cn(
										"font-mono",
										verdict.stuckness === "hard_stuck"
											? "text-status-red"
											: verdict.stuckness === "transient"
												? "text-status-orange"
												: "text-status-green",
									)}
								>
									{verdict.stuckness}
								</span>
							</div>
							{verdict.suggestions.length > 0 ? (
								<div className="mt-1">
									<div className="text-text-secondary">
										Automatic recovery exhausted — escalate to the user. Options to get through the wall:
									</div>
									<ul className="mt-0.5 list-none space-y-1 pl-0">
										{verdict.suggestions.map((suggestion) => {
											// F2.18b/c: a `direct_redrive` suggestion (approve / more-capable model / fixed environment)
											// resumes the parked card in one click. An `input_then_redrive` suggestion (clarify / context /
											// constraint) collects the operator's answer, queues it to the card mailbox, THEN redrives so
											// the resumed session drains it (F2.18c). `manual` (re-scope) has no in-place resume.
											// `resumesSuspendedState` is the redrive-not-restart contract.
											const resume = describeEscalationResumeAction(suggestion.kind);
											const showInputResume = resume.mode === "input_then_redrive" && Boolean(onRedrive);
											const inputValue = resumeInputs[suggestion.kind] ?? "";
											return (
												<li
													key={suggestion.kind}
													className={
														showInputResume
															? "flex flex-col gap-1"
															: "flex items-center justify-between gap-2"
													}
													title={suggestion.detail}
												>
													<span className="min-w-0 truncate text-text-tertiary">• {suggestion.title}</span>
													{resume.mode === "direct_redrive" && onRedrive ? (
														<Button
															size="sm"
															variant="ghost"
															className="shrink-0"
															data-testid={`escalation-resume-${suggestion.kind}`}
															onClick={() => onRedrive(taskId)}
														>
															{resume.actionLabel}
														</Button>
													) : showInputResume ? (
														<div className="flex items-center gap-1.5 pl-3">
															<input
																type="text"
																data-testid={`escalation-resume-input-${suggestion.kind}`}
																className="min-w-0 flex-1 rounded border border-border bg-surface-0 px-1.5 py-0.5 text-[11px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
																placeholder={`Provide ${resume.requiresInput}…`}
																value={inputValue}
																onChange={(event) =>
																	setResumeInputs((current) => ({
																		...current,
																		[suggestion.kind]: event.target.value,
																	}))
																}
																onKeyDown={(event) => {
																	if (event.key === "Enter") {
																		event.preventDefault();
																		void submitResumeWithInput(suggestion.kind);
																	}
																}}
															/>
															<Button
																size="sm"
																variant="ghost"
																className="shrink-0"
																data-testid={`escalation-resume-${suggestion.kind}`}
																disabled={
																	resumeSubmitting === suggestion.kind ||
																	inputValue.trim().length === 0
																}
																onClick={() => void submitResumeWithInput(suggestion.kind)}
															>
																{resume.actionLabel}
															</Button>
														</div>
													) : resume.mode === "input_then_redrive" ? (
														<span className="shrink-0 text-[10px] italic text-text-tertiary">
															provide {resume.requiresInput} on the card, then resume
														</span>
													) : null}
												</li>
											);
										})}
									</ul>
								</div>
							) : null}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
