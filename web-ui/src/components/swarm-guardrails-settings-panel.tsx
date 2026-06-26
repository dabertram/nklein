// Settings UI for the "Local swarm guardrails" card (§5.X #2 / settings-dialog sections), extracted from the
// oversized `runtime-settings-dialog.tsx`. Owns real behavior: the four editable autonomous-run limits (turns,
// wall-time, no-diff checkpoints, repeated tool calls) with per-field out-of-range flagging and a reset-to-defaults
// action. The read-only context tiles (concurrent cards, sandbox pool, heartbeat policy, plan artifacts) are derived
// elsewhere and passed in, so the panel never re-reads sibling state. Controlled: the parent owns the inputs value +
// onChange + dirty/save plumbing (the guardrail state stays in the settings dialog for the unified save).
import {
	areRuntimeSwarmGuardrailsEqual,
	DEFAULT_RUNTIME_SWARM_GUARDRAILS,
	RUNTIME_SWARM_GUARDRAIL_BOUNDS,
	RUNTIME_SWARM_MAX_CARD_STARTS_PER_BATCH,
} from "@runtime-contract";
import { ShieldCheck } from "lucide-react";

import {
	inputsToSwarmGuardrails,
	isGuardrailInputOutOfRange,
	type SwarmGuardrailInputs,
	swarmGuardrailsToInputs,
	WALL_TIME_BOUNDS_HOURS,
} from "@/components/runtime-settings-swarm-guardrails";
import type { RuntimeLostHeartbeatPolicy } from "@/runtime/types";

const swarmGuardrailTurnsId = "runtime-settings-guardrail-turns";
const swarmGuardrailWallTimeId = "runtime-settings-guardrail-wall-time";
const swarmGuardrailNoDiffId = "runtime-settings-guardrail-no-diff";
const swarmGuardrailToolCallsId = "runtime-settings-guardrail-tool-calls";

// Static, always-on guardrails surfaced read-only so operators see the full safety envelope alongside the editable
// limits. Sourced from the runtime contract so the copy can't drift from the resolver.
const LOCAL_SWARM_GUARDRAIL_ROWS = [
	{
		label: "Card batch budget",
		value: `${RUNTIME_SWARM_MAX_CARD_STARTS_PER_BATCH} cards`,
		detail: "Caps one swarm start-all or auto-start batch before the next operator or dependency event.",
	},
	{
		label: "Repeated tool/API mistakes",
		value: "SDK limit",
		detail: "Stops tasks that hit !Klein's mistake guardrail.",
	},
] as const;

interface SwarmGuardrailsSettingsPanelProps {
	value: SwarmGuardrailInputs;
	onChange: (next: SwarmGuardrailInputs) => void;
	disabled?: boolean;
	maxConcurrentTasks: string;
	sandboxMaxContainers: string;
	sandboxPool: { effectiveParallelism: number; poolCapacityLabel: string; memoryGbLabel: string };
	lostHeartbeatPolicy: RuntimeLostHeartbeatPolicy;
	decompositionAutoApplyEnabled: boolean;
}

export function SwarmGuardrailsSettingsPanel({
	value,
	onChange,
	disabled = false,
	maxConcurrentTasks,
	sandboxMaxContainers,
	sandboxPool,
	lostHeartbeatPolicy,
	decompositionAutoApplyEnabled,
}: SwarmGuardrailsSettingsPanelProps) {
	return (
		<div className="rounded-md border border-border bg-surface-1 p-3">
			<div className="mb-2 flex items-center justify-between gap-2">
				<div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-text-secondary">
					<ShieldCheck size={14} />
					<span>Local swarm guardrails</span>
				</div>
				<button
					type="button"
					disabled={
						disabled ||
						areRuntimeSwarmGuardrailsEqual(inputsToSwarmGuardrails(value), DEFAULT_RUNTIME_SWARM_GUARDRAILS)
					}
					onClick={() => onChange(swarmGuardrailsToInputs(DEFAULT_RUNTIME_SWARM_GUARDRAILS))}
					className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-3 disabled:opacity-40"
				>
					Reset to defaults
				</button>
			</div>
			<div className="grid gap-2 sm:grid-cols-2">
				<div className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
					<div className="text-[11px] text-text-tertiary">Concurrent cards</div>
					<div className="text-[13px] font-medium text-text-primary">
						{maxConcurrentTasks.trim() || "3"} running max
					</div>
					<div className="mt-1 text-[11px] text-text-secondary">Saved by maxConcurrentTasks.</div>
				</div>
				<div className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
					<div className="text-[11px] text-text-tertiary">Sandbox pool</div>
					<div className="text-[13px] font-medium text-text-primary">
						{sandboxPool.effectiveParallelism} effective parallel
					</div>
					<div className="mt-1 text-[11px] text-text-secondary">
						{sandboxMaxContainers.trim() || "1"} containers, {sandboxPool.poolCapacityLabel},{" "}
						{sandboxPool.memoryGbLabel} each.
					</div>
				</div>
				<div className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
					<div className="text-[11px] text-text-tertiary">Lost heartbeat</div>
					<div className="text-[13px] font-medium text-text-primary">
						{lostHeartbeatPolicy === "park" ? "Park + actions" : "Keep running"}
					</div>
					<div className="mt-1 text-[11px] text-text-secondary">
						{lostHeartbeatPolicy === "park" ? "Moves !Klein sessions to review." : "Leaves !Klein running."}
					</div>
				</div>
				<div className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
					<div className="text-[11px] text-text-tertiary">Plan artifacts</div>
					<div className="text-[13px] font-medium text-text-primary">
						{decompositionAutoApplyEnabled ? "Auto-apply" : "Manual review"}
					</div>
					<div className="mt-1 text-[11px] text-text-secondary">
						{decompositionAutoApplyEnabled ? "Creates Planning cards immediately." : "Shows Apply/Reject."}
					</div>
				</div>
				<div className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
					<label htmlFor={swarmGuardrailTurnsId} className="text-[11px] text-text-tertiary">
						Autonomous turns
					</label>
					<input
						id={swarmGuardrailTurnsId}
						type="number"
						min={RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxAutonomousTurnsPerTask.min}
						max={RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxAutonomousTurnsPerTask.max}
						value={value.maxAutonomousTurnsPerTask}
						disabled={disabled}
						onChange={(event) => onChange({ ...value, maxAutonomousTurnsPerTask: event.target.value })}
						className="mt-0.5 w-full rounded-sm border border-border bg-surface-1 px-2 py-1 text-[13px] text-text-primary disabled:opacity-40"
					/>
					<div className="mt-1 text-[11px] text-text-secondary">
						Parks !Klein tasks at the turn checkpoint limit.
					</div>
					{isGuardrailInputOutOfRange(
						value.maxAutonomousTurnsPerTask,
						RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxAutonomousTurnsPerTask,
					) && (
						<div className="mt-0.5 text-[11px] text-status-red">
							{RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxAutonomousTurnsPerTask.min}–
							{RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxAutonomousTurnsPerTask.max} turns (clamped on save).
						</div>
					)}
				</div>
				<div className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
					<label htmlFor={swarmGuardrailWallTimeId} className="text-[11px] text-text-tertiary">
						Wall time (hours)
					</label>
					<input
						id={swarmGuardrailWallTimeId}
						type="number"
						min={WALL_TIME_BOUNDS_HOURS.min}
						max={WALL_TIME_BOUNDS_HOURS.max}
						step={0.5}
						value={value.maxAutonomousWallTimeHours}
						disabled={disabled}
						onChange={(event) => onChange({ ...value, maxAutonomousWallTimeHours: event.target.value })}
						className="mt-0.5 w-full rounded-sm border border-border bg-surface-1 px-2 py-1 text-[13px] text-text-primary disabled:opacity-40"
					/>
					<div className="mt-1 text-[11px] text-text-secondary">
						Parks !Klein tasks after the autonomous wall-time limit.
					</div>
					{isGuardrailInputOutOfRange(value.maxAutonomousWallTimeHours, WALL_TIME_BOUNDS_HOURS) && (
						<div className="mt-0.5 text-[11px] text-status-red">1 minute–7 days (clamped on save).</div>
					)}
				</div>
				<div className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
					<label htmlFor={swarmGuardrailNoDiffId} className="text-[11px] text-text-tertiary">
						No-diff checkpoints
					</label>
					<input
						id={swarmGuardrailNoDiffId}
						type="number"
						min={RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxRepeatedNoDiffCheckpoints.min}
						max={RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxRepeatedNoDiffCheckpoints.max}
						value={value.maxRepeatedNoDiffCheckpoints}
						disabled={disabled}
						onChange={(event) => onChange({ ...value, maxRepeatedNoDiffCheckpoints: event.target.value })}
						className="mt-0.5 w-full rounded-sm border border-border bg-surface-1 px-2 py-1 text-[13px] text-text-primary disabled:opacity-40"
					/>
					<div className="mt-1 text-[11px] text-text-secondary">
						Parks tasks that checkpoint the same commit repeatedly.
					</div>
					{isGuardrailInputOutOfRange(
						value.maxRepeatedNoDiffCheckpoints,
						RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxRepeatedNoDiffCheckpoints,
					) && (
						<div className="mt-0.5 text-[11px] text-status-red">
							{RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxRepeatedNoDiffCheckpoints.min}–
							{RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxRepeatedNoDiffCheckpoints.max} repeats (clamped on save).
						</div>
					)}
				</div>
				<div className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
					<label htmlFor={swarmGuardrailToolCallsId} className="text-[11px] text-text-tertiary">
						Repeated tool calls
					</label>
					<input
						id={swarmGuardrailToolCallsId}
						type="number"
						min={RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxRepeatedToolCallsPerTask.min}
						max={RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxRepeatedToolCallsPerTask.max}
						value={value.maxRepeatedToolCallsPerTask}
						disabled={disabled}
						onChange={(event) => onChange({ ...value, maxRepeatedToolCallsPerTask: event.target.value })}
						className="mt-0.5 w-full rounded-sm border border-border bg-surface-1 px-2 py-1 text-[13px] text-text-primary disabled:opacity-40"
					/>
					<div className="mt-1 text-[11px] text-text-secondary">
						Parks tasks that keep starting the same tool with the same input.
					</div>
					{isGuardrailInputOutOfRange(
						value.maxRepeatedToolCallsPerTask,
						RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxRepeatedToolCallsPerTask,
					) && (
						<div className="mt-0.5 text-[11px] text-status-red">
							{RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxRepeatedToolCallsPerTask.min}–
							{RUNTIME_SWARM_GUARDRAIL_BOUNDS.maxRepeatedToolCallsPerTask.max} repeats (clamped on save).
						</div>
					)}
				</div>
				{LOCAL_SWARM_GUARDRAIL_ROWS.map((row) => (
					<div key={row.label} className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
						<div className="text-[11px] text-text-tertiary">{row.label}</div>
						<div className="text-[13px] font-medium text-text-primary">{row.value}</div>
						<div className="mt-1 text-[11px] text-text-secondary">{row.detail}</div>
					</div>
				))}
			</div>
		</div>
	);
}
