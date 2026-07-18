import { CircleCheck, CircleDashed, CircleX, Loader2, Play, SkipForward, Workflow } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

/**
 * F12.107 — the ADW runner surface: list the project's `.nklein/workflows/*.json` definitions, run one with an
 * input, and watch per-step status live (3s polling while a run is active). Deterministic steps run host-side;
 * agent steps become ordinary board cards the autonomous machinery works — the panel links their card ids.
 */

interface WorkflowSummary {
	name: string;
	description: string | null;
	stepCount: number;
	agentStepCount: number;
	invalid: string | null;
}

interface RunStep {
	id: string;
	kind: "deterministic" | "agent";
	status: "pending" | "running" | "ok" | "fail" | "skipped";
	detail: string | null;
	cardId: string | null;
}

interface RunSnapshot {
	runId: string;
	name: string;
	verdict: "running" | "pass" | "fail";
	steps: RunStep[];
	error: string | null;
}

function StepIcon({ status }: { status: RunStep["status"] }) {
	if (status === "running") {
		return <Loader2 size={12} className="animate-spin text-status-blue" />;
	}
	if (status === "ok") {
		return <CircleCheck size={12} className="text-status-green" />;
	}
	if (status === "fail") {
		return <CircleX size={12} className="text-status-red" />;
	}
	if (status === "skipped") {
		return <SkipForward size={12} className="text-text-tertiary" />;
	}
	return <CircleDashed size={12} className="text-text-tertiary" />;
}

export function AdwWorkflowsPanel({ workspaceId }: { workspaceId: string | null }) {
	const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [runInput, setRunInput] = useState("");
	const [run, setRun] = useState<RunSnapshot | null>(null);
	const [startError, setStartError] = useState<string | null>(null);
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		let cancelled = false;
		if (!workspaceId) {
			setWorkflows(null);
			return;
		}
		void (async () => {
			try {
				const response = await getRuntimeTrpcClient(workspaceId).runtime.listAdwWorkflows.query();
				if (!cancelled) {
					setWorkflows(response.workflows);
					setLoadError(null);
				}
			} catch {
				if (!cancelled) {
					setLoadError("Could not list workflows (is the runtime reachable?).");
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [workspaceId]);

	const stopPolling = useCallback(() => {
		if (pollRef.current) {
			clearInterval(pollRef.current);
			pollRef.current = null;
		}
	}, []);
	useEffect(() => stopPolling, [stopPolling]);

	const handleRun = useCallback(
		async (name: string) => {
			if (!workspaceId) {
				return;
			}
			setStartError(null);
			try {
				const started = await getRuntimeTrpcClient(workspaceId).runtime.startAdwRun.mutate({
					name,
					input: runInput,
				});
				if (!started.ok || !started.runId) {
					setStartError(started.error ?? "Could not start the workflow.");
					return;
				}
				const runId = started.runId;
				stopPolling();
				pollRef.current = setInterval(() => {
					void (async () => {
						try {
							const status = await getRuntimeTrpcClient(workspaceId).runtime.getAdwRunStatus.query({ runId });
							if (status.run) {
								setRun(status.run);
								if (status.run.verdict !== "running") {
									stopPolling();
								}
							}
						} catch {
							// Poll again next tick — transient runtime hiccups never kill the watch.
						}
					})();
				}, 3_000);
				setRun({ runId, name, verdict: "running", steps: [], error: null });
			} catch {
				setStartError("Could not start the workflow (runtime unreachable?).");
			}
		},
		[workspaceId, runInput, stopPolling],
	);

	return (
		<div>
			<div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-text-primary">
				<Workflow size={14} />
				Workflows (ADW)
			</div>
			<div className="rounded-md border border-border bg-surface-1 p-3" data-testid="adw-workflows-panel">
				{loadError ? <p className="m-0 text-[12px] text-status-red">{loadError}</p> : null}
				{workflows !== null && workflows.length === 0 ? (
					<p className="m-0 text-[12px] text-text-secondary">
						No workflows defined. Add <code>.nklein/workflows/&lt;name&gt;.json</code> to this repo (see{" "}
						<code>examples/adw-workflows/</code>) — deterministic steps run host-side, agent steps become board
						cards.
					</p>
				) : null}
				{workflows && workflows.length > 0 ? (
					<div className="flex flex-col gap-2">
						<input
							type="text"
							value={runInput}
							onChange={(event) => setRunInput(event.target.value)}
							placeholder="Workflow input — substituted as {input}"
							aria-label="Workflow input"
							className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
						{workflows.map((workflow) => (
							<div key={workflow.name} className="flex items-center justify-between gap-2">
								<div className="min-w-0">
									<div className="truncate text-[12px] text-text-primary">
										{workflow.name}
										<span className="ml-2 text-text-tertiary">
											{workflow.stepCount} step(s), {workflow.agentStepCount} agent
										</span>
									</div>
									{workflow.invalid ? (
										<div className="truncate text-[11px] text-status-red">{workflow.invalid}</div>
									) : workflow.description ? (
										<div className="truncate text-[11px] text-text-tertiary">{workflow.description}</div>
									) : null}
								</div>
								<Button
									size="sm"
									variant="ghost"
									icon={<Play size={12} />}
									disabled={workflow.invalid !== null || run?.verdict === "running"}
									onClick={() => void handleRun(workflow.name)}
									aria-label={`Run workflow ${workflow.name}`}
								>
									Run
								</Button>
							</div>
						))}
						{startError ? <p className="m-0 text-[12px] text-status-red">{startError}</p> : null}
						{run ? (
							<div
								className="mt-1 rounded-md border border-border bg-surface-2 p-2"
								data-testid="adw-run-status"
							>
								<div className="mb-1 text-[12px] text-text-primary">
									{run.name} —{" "}
									<span
										className={
											run.verdict === "pass"
												? "text-status-green"
												: run.verdict === "fail"
													? "text-status-red"
													: "text-status-blue"
										}
									>
										{run.verdict.toUpperCase()}
									</span>
								</div>
								{run.steps.map((step) => (
									<div key={step.id} className="flex items-center gap-1.5 text-[11px] text-text-secondary">
										<StepIcon status={step.status} />
										<span className="text-text-primary">{step.id}</span>
										<span className="text-text-tertiary">[{step.kind}]</span>
										{step.detail ? <span className="truncate">{step.detail}</span> : null}
										{step.cardId ? <span className="text-text-tertiary">card {step.cardId}</span> : null}
									</div>
								))}
								{run.error ? <div className="text-[11px] text-status-red">{run.error}</div> : null}
							</div>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
}
