import { ChevronDown, ChevronRight, Clipboard, FlaskConical, Lightbulb, Play, Trash2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { DevTestRegistryPicker } from "@/components/project-nav/dev-test-registry-picker";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeDevTestProjectPreset, RuntimeDevTestRegistryEntry } from "@/runtime/types";

/**
 * The developer dev-test-scenarios card for the project navigation sidebar, extracted from the oversized
 * `project-navigation-panel.tsx` (todo §5.U). Seeds a self-improvement project from the running checkout (with optional
 * notes) and the fixture preset projects, plus copy-evidence and cleanup actions. Also exposes the full folder-based
 * registry (45+ projects) via a searchable grouped picker. Fully props-driven — all state + handlers are passed in.
 */

/**
 * The quick-launch preset buttons — kept in lock-step with `runtimeDevTestProjectPresetSchema` (all 8 presets are
 * runnable via the API, §5.AF). `mid_task` is a single card; the rest seed a decompose card that fans out into a DAG.
 */
const DEV_TEST_PRESET_BUTTONS: { preset: RuntimeDevTestProjectPreset; label: string }[] = [
	{ preset: "mid_task", label: "mid task" },
	{ preset: "complex_dag", label: "complex product" },
	{ preset: "audio_vst", label: "audio VST" },
	{ preset: "daw_foundation", label: "DAW foundation" },
	{ preset: "wide_fanout", label: "wide fan-out" },
	{ preset: "deep_chain", label: "deep chain" },
	{ preset: "mixed_dag", label: "mixed DAG" },
	{ preset: "many_small", label: "many small cards" },
];
export function DevTestProjectCard({
	disabled,
	runningPreset,
	isCleaningUp,
	isCreatingSelfImprovementProject,
	evidencePath,
	selfImprovementNotes,
	registryEntries,
	isRegistryLoading,
	startingRegistryId,
	onSelfImprovementNotesChange,
	onRun,
	onRunById,
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
	registryEntries: RuntimeDevTestRegistryEntry[];
	isRegistryLoading: boolean;
	startingRegistryId: string | null;
	onSelfImprovementNotesChange: (value: string) => void;
	onRun: (preset: RuntimeDevTestProjectPreset) => Promise<void>;
	onRunById: (id: string) => Promise<void>;
	onCopyEvidence: () => Promise<void>;
	onCleanup: () => Promise<void>;
	onCreateSelfImprovementProject: () => Promise<void>;
}): React.ReactElement {
	const [showRegistry, setShowRegistry] = useState(false);
	const isBusy = disabled || isCreatingSelfImprovementProject;
	const isAnyPresetRunning = runningPreset !== null;

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
				{/* Self-improvement section */}
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

				{/* Registry picker — collapsible, searchable, tier-grouped */}
				<div className="rounded-md border border-border bg-surface-1 px-2 py-2">
					<button
						type="button"
						className="mb-1.5 flex w-full items-center gap-1.5 text-left"
						onClick={() => setShowRegistry((v) => !v)}
					>
						{showRegistry ? (
							<ChevronDown size={12} className="shrink-0 text-text-tertiary" />
						) : (
							<ChevronRight size={12} className="shrink-0 text-text-tertiary" />
						)}
						<span className="text-[12px] font-semibold text-text-primary">
							Registry ({registryEntries.length || "…"})
						</span>
						<span className="ml-auto text-[10px] text-text-tertiary">browse all projects</span>
					</button>
					{showRegistry ? (
						<DevTestRegistryPicker
							entries={registryEntries}
							isLoading={isRegistryLoading}
							startingId={startingRegistryId}
							disabled={isBusy || isAnyPresetRunning || isCleaningUp}
							onStart={onRunById}
						/>
					) : null}
				</div>

				{/* Quick-launch preset buttons (data-driven — all 8 presets, §5.AF) */}
				{DEV_TEST_PRESET_BUTTONS.map(({ preset, label }) => {
					const isRunning = runningPreset === preset;
					return (
						<Button
							key={preset}
							size="sm"
							variant="default"
							icon={
								isRunning ? (
									<Spinner size={14} />
								) : preset === "mid_task" ? (
									<Play size={14} />
								) : (
									<FlaskConical size={14} />
								)
							}
							disabled={isBusy}
							onClick={() => {
								if (
									!window.confirm(
										`Create a marked !Klein ${label} dev-test project and make it the active project?`,
									)
								) {
									return;
								}
								void onRun(preset);
							}}
							fill
						>
							{isRunning ? "Creating..." : `Create ${label} project`}
						</Button>
					);
				})}
				{evidencePath ? (
					<Button
						size="sm"
						variant="ghost"
						icon={<Clipboard size={14} />}
						disabled={isBusy || isAnyPresetRunning}
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
