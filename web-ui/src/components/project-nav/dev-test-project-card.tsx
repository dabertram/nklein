import { Clipboard, FlaskConical, Lightbulb, Play, Trash2 } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeDevTestProjectPreset } from "@/runtime/types";

/**
 * The developer dev-test-scenarios card for the project navigation sidebar, extracted from the oversized
 * `project-navigation-panel.tsx` (todo §5.U). Seeds a self-improvement project from the running checkout (with optional
 * notes) and the fixture preset projects (mid-task / complex-DAG / audio-VST / DAW-foundation), plus copy-evidence and
 * cleanup actions. Fully props-driven — all state + handlers are passed in — so it's self-contained.
 */
export function DevTestProjectCard({
	disabled,
	runningPreset,
	isCleaningUp,
	isCreatingSelfImprovementProject,
	evidencePath,
	selfImprovementNotes,
	onSelfImprovementNotesChange,
	onRun,
	onCopyEvidence,
	onCleanup,
	onCreateSelfImprovementProject,
}: {
	disabled: boolean;
	runningPreset: RuntimeDevTestProjectPreset | null;
	isCleaningUp: boolean;
	isCreatingSelfImprovementProject: boolean;
	evidencePath: string | null;
	selfImprovementNotes: string;
	onSelfImprovementNotesChange: (value: string) => void;
	onRun: (preset: RuntimeDevTestProjectPreset) => Promise<void>;
	onCopyEvidence: () => Promise<void>;
	onCleanup: () => Promise<void>;
	onCreateSelfImprovementProject: () => Promise<void>;
}): React.ReactElement {
	const isRunningMidTask = runningPreset === "mid_task";
	const isRunningComplexProject = runningPreset === "complex_dag";
	const isRunningAudioVstProject = runningPreset === "audio_vst";
	const isRunningDawFoundationProject = runningPreset === "daw_foundation";
	const isBusy = disabled || isCreatingSelfImprovementProject;

	return (
		<div className="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2.5">
			<div className="mb-2 flex items-start gap-2">
				<FlaskConical size={14} className="mt-0.5 shrink-0 text-status-purple" />
				<div className="min-w-0">
					<p className="m-0 text-xs font-semibold text-text-primary">Dev Test Scenarios</p>
					<p className="mt-1 mb-0 text-[11px] leading-4 text-text-secondary">
						Create fixture projects or load the current dev checkout for !Klein self-improvement.
					</p>
				</div>
			</div>
			<div className="grid gap-2">
				<div className="rounded-md border border-border bg-surface-1 px-2 py-2">
					<div className="mb-2 flex items-start gap-2">
						<Lightbulb size={14} className="mt-0.5 shrink-0 text-status-gold" />
						<div className="min-w-0">
							<p className="m-0 text-[12px] font-semibold text-text-primary">Self-improvement</p>
							<p className="mt-1 mb-0 text-[11px] leading-4 text-text-secondary">
								Use the currently running code and seed a Backlog task with optional notes.
							</p>
						</div>
					</div>
					<textarea
						value={selfImprovementNotes}
						onChange={(event) => onSelfImprovementNotesChange(event.currentTarget.value)}
						placeholder="Optional notes for the seeded task"
						rows={3}
						className="mb-2 min-h-16 w-full resize-y rounded-md border border-border-bright bg-surface-2 px-2 py-1.5 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						disabled={isBusy}
					/>
					<Button
						size="sm"
						variant="primary"
						icon={isCreatingSelfImprovementProject ? <Spinner size={14} /> : <Lightbulb size={14} />}
						disabled={isBusy}
						onClick={() => {
							void onCreateSelfImprovementProject();
						}}
						fill
					>
						{isCreatingSelfImprovementProject ? "Creating..." : "Create self-improvement project"}
					</Button>
				</div>
				<Button
					size="sm"
					variant="default"
					icon={isRunningMidTask ? <Spinner size={14} /> : <Play size={14} />}
					disabled={isBusy}
					onClick={() => {
						if (!window.confirm("Create a marked !Klein dev-test project and make it the active project?")) {
							return;
						}
						void onRun("mid_task");
					}}
					fill
				>
					{isRunningMidTask ? "Creating..." : "Create mid task project"}
				</Button>
				<Button
					size="sm"
					variant="default"
					icon={isRunningComplexProject ? <Spinner size={14} /> : <FlaskConical size={14} />}
					disabled={isBusy}
					onClick={() => {
						if (
							!window.confirm("Create a marked !Klein complex dev-test project and make it the active project?")
						) {
							return;
						}
						void onRun("complex_dag");
					}}
					fill
				>
					{isRunningComplexProject ? "Creating..." : "Create complex product project"}
				</Button>
				<Button
					size="sm"
					variant="default"
					icon={isRunningAudioVstProject ? <Spinner size={14} /> : <FlaskConical size={14} />}
					disabled={isBusy}
					onClick={() => {
						if (
							!window.confirm(
								"Create a marked !Klein audio VST dev-test project and make it the active project?",
							)
						) {
							return;
						}
						void onRun("audio_vst");
					}}
					fill
				>
					{isRunningAudioVstProject ? "Creating..." : "Create audio VST project"}
				</Button>
				<Button
					size="sm"
					variant="default"
					icon={isRunningDawFoundationProject ? <Spinner size={14} /> : <FlaskConical size={14} />}
					disabled={isBusy}
					onClick={() => {
						if (
							!window.confirm(
								"Create a marked !Klein DAW foundation dev-test project and make it the active project?",
							)
						) {
							return;
						}
						void onRun("daw_foundation");
					}}
					fill
				>
					{isRunningDawFoundationProject ? "Creating..." : "Create DAW foundation project"}
				</Button>
				{evidencePath ? (
					<Button
						size="sm"
						variant="ghost"
						icon={<Clipboard size={14} />}
						disabled={isBusy || runningPreset !== null}
						onClick={() => {
							void onCopyEvidence();
						}}
						aria-label="Copy dev scenario evidence"
						fill
					>
						Copy evidence
					</Button>
				) : null}
				<Button
					size="sm"
					variant="ghost"
					icon={isCleaningUp ? <Spinner size={14} /> : <Trash2 size={14} />}
					disabled={isBusy}
					onClick={() => {
						if (
							!window.confirm(
								"Delete marked !Klein dev-test projects, their task workspaces, and saved dev-test task patches?",
							)
						) {
							return;
						}
						void onCleanup();
					}}
					fill
				>
					{isCleaningUp ? "Cleaning..." : "Delete dev workspaces"}
				</Button>
			</div>
			{evidencePath ? (
				<p className="mt-2 mb-0 truncate font-mono text-[11px] text-text-tertiary" title={evidencePath}>
					{evidencePath}
				</p>
			) : null}
		</div>
	);
}
