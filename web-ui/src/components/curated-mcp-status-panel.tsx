import type { SandboxMcpSettingsPreview } from "@runtime-contract";
import { type ReactElement, useId } from "react";
import { NativeSelect } from "@/components/ui/native-select";

export interface CuratedMcpStatusPanelProps {
	preview: SandboxMcpSettingsPreview;
	modelOptions: readonly { id: string; label: string }[];
	previewModelId: string;
	onPreviewModelIdChange: (modelId: string) => void;
}

function stateLabel(active: boolean, available: boolean): string {
	if (!available) return "Unavailable";
	return active ? "Active" : "Withheld";
}

/** Operator-facing projection of the exact catalog/model/memory/control gates used for new sandbox tool bundles. */
export function CuratedMcpStatusPanel({
	preview,
	modelOptions,
	previewModelId,
	onPreviewModelIdChange,
}: CuratedMcpStatusPanelProps): ReactElement {
	const modelSelectId = useId();
	return (
		<div className="mt-3 rounded-md border border-border bg-surface-1 p-3" data-testid="curated-mcp-status-panel">
			<div className="flex flex-wrap items-end justify-between gap-2">
				<div>
					<div className="text-[12px] font-semibold text-text-primary">Effective server preview</div>
					<p className="m-0 mt-0.5 text-[11px] text-text-tertiary">
						Master: {preview.effectiveMasterEnabled ? "on" : "off"}. Availability and every fit reason come from
						the runtime catalog.
					</p>
				</div>
				<div className="min-w-[220px]">
					<label htmlFor={modelSelectId} className="mb-1 block text-[11px] text-text-secondary">
						Preview model
					</label>
					<NativeSelect
						id={modelSelectId}
						aria-label="Curated MCP preview model"
						value={previewModelId}
						onChange={(event) => onPreviewModelIdChange(event.target.value)}
						fill
					>
						{previewModelId === "" ? <option value="">No model selected</option> : null}
						{modelOptions.map((model) => (
							<option key={model.id} value={model.id}>
								{model.label}
							</option>
						))}
					</NativeSelect>
				</div>
			</div>
			<div className="mt-3 grid gap-2">
				{preview.servers.map((server) => (
					<div key={server.id} className="rounded border border-border bg-surface-0 px-3 py-2">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="text-[12px] font-medium text-text-primary">{server.label}</div>
							<span
								className={
									server.active
										? "rounded bg-status-green/10 px-2 py-0.5 text-[10px] font-semibold text-status-green"
										: "rounded bg-surface-3 px-2 py-0.5 text-[10px] font-semibold text-text-secondary"
								}
							>
								{stateLabel(server.active, server.available)}
							</span>
						</div>
						<div className="mt-1 text-[11px] text-text-secondary">
							Availability: {server.availabilityReason} · budget {server.memoryBudgetMb} MB · switch{" "}
							{server.effectiveEnabled ? "on" : "off"}
						</div>
						<div className="mt-1 text-[11px] text-text-tertiary">
							Model fit for {preview.modelId ?? "no model"}: {server.modelFit.reason}
						</div>
						<div className="mt-1 text-[11px] text-text-tertiary">Memory fit: {server.memoryFit.reason}</div>
						<div className="mt-1 text-[11px] font-medium text-text-secondary">{server.activationReason}</div>
					</div>
				))}
			</div>
			<p className="m-0 mt-2 text-[11px] text-text-tertiary">
				Saved changes are used when a new session constructs its sandbox tool bundle. Existing bundles are not
				rewritten mid-turn. “Active” assumes the selected task role permits MCP; NKLEIN_SANDBOX_MCP and
				NKLEIN_BASIC_MEMORY can still force-enable their documented gates.
			</p>
		</div>
	);
}
