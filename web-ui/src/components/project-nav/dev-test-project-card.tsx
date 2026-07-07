import { ChevronDown, ChevronRight, Clipboard, FlaskConical, Lightbulb, Trash2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { DevTestRegistryPicker } from "@/components/project-nav/dev-test-registry-picker";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeDevTestRegistryEntry } from "@/runtime/types";

/**
 * The developer dev-test-scenarios card for the project navigation sidebar, extracted from the oversized
 * `project-navigation-panel.tsx` (todo §5.U). Seeds a self-improvement project from the running checkout (with optional
 * notes), plus copy-evidence and cleanup actions. All fixture scenarios launch through the single folder-based registry
 * picker (searchable, tier-grouped) — the former hardcoded per-preset button stack was a duplicate presentation of the
 * same scenarios (each preset was just an alias for a registry id) and was removed. Fully props-driven.
 */
export function DevTestProjectCard({
	disabled,
	isCleaningUp,
	isCreatingSelfImprovementProject,
	evidencePath,
	selfImprovementNotes,
	registryEntries,
	isRegistryLoading,
	startingRegistryId,
	onSelfImprovementNotesChange,
	onRunById,
	onCopyEvidence,
	onCleanup,
	onCreateSelfImprovementProject,
}: {
	disabled: boolean;
	isCleaningUp: boolean;
	isCreatingSelfImprovementProject: boolean;
	evidencePath: string | null;
	selfImprovementNotes: string;
	registryEntries: RuntimeDevTestRegistryEntry[];
	isRegistryLoading: boolean;
	startingRegistryId: string | null;
	onSelfImprovementNotesChange: (value: string) => void;
	onRunById: (id: string) => Promise<void>;
	onCopyEvidence: () => Promise<void>;
	onCleanup: () => Promise<void>;
	onCreateSelfImprovementProject: () => Promise<void>;
}): React.ReactElement {
	const [showRegistry, setShowRegistry] = useState(true);
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
							disabled={isBusy || isCleaningUp}
							onStart={onRunById}
						/>
					) : null}
				</div>

				{evidencePath ? (
					<Button
						size="sm"
						variant="ghost"
						icon={<Clipboard size={14} />}
						disabled={isBusy}
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
