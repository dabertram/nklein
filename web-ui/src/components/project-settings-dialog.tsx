import * as RadixSwitch from "@radix-ui/react-switch";
import { Database, FolderCog } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import {
	buildCodeEmbeddingSettings,
	CODE_EMBEDDING_PROVIDER_OPTIONS,
	EmbeddingEndpointFields,
	formatCodeEmbeddingSettings,
	LOCAL_CODE_EMBEDDING_MODEL,
} from "@/components/code-embedding-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeCodeEmbeddingSettings } from "@/runtime/types";
import { useRuntimeConfig } from "@/runtime/use-runtime-config";

export interface ProjectSettingsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaceId: string | null;
	projectName?: string | null;
}

/**
 * Per-project settings (todo §5.I#3): project-scoped overrides live here, reachable from the project selector,
 * instead of polluting global settings. Today that's the code-embedding override; the save is a scoped partial
 * merge (`save({ codeEmbeddingOverride })`) so it never touches global/other-project config.
 */
export function ProjectSettingsDialog({
	open,
	onOpenChange,
	workspaceId,
	projectName,
}: ProjectSettingsDialogProps): ReactElement {
	const { config, isSaving, save } = useRuntimeConfig(open, workspaceId, null);
	const [overrideEnabled, setOverrideEnabled] = useState(false);
	const [provider, setProvider] = useState<RuntimeCodeEmbeddingSettings["provider"]>("local_lexical");
	const [model, setModel] = useState(LOCAL_CODE_EMBEDDING_MODEL);
	const [baseUrl, setBaseUrl] = useState("");
	const [saveError, setSaveError] = useState<string | null>(null);

	// Load the per-project override into local state whenever the config (re)loads.
	useEffect(() => {
		const override = config?.codeEmbeddingOverride ?? null;
		setOverrideEnabled(override !== null);
		setProvider(override?.provider ?? "local_lexical");
		setModel(override?.model ?? LOCAL_CODE_EMBEDDING_MODEL);
		setBaseUrl(override?.baseUrl ?? "");
	}, [config?.codeEmbeddingOverride]);

	const defaults = config?.codeEmbeddingDefaults ?? null;
	const effective = overrideEnabled ? buildCodeEmbeddingSettings(provider, model, baseUrl) : defaults;
	const controlsDisabled = isSaving || !workspaceId;

	const handleSave = async (): Promise<void> => {
		setSaveError(null);
		const override = overrideEnabled ? buildCodeEmbeddingSettings(provider, model, baseUrl) : null;
		const saved = await save({ codeEmbeddingOverride: override });
		if (!saved) {
			setSaveError("Could not save project settings. Check runtime logs and try again.");
			return;
		}
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange} contentClassName="max-w-xl">
			<DialogHeader
				title={projectName ? `Project Settings — ${projectName}` : "Project Settings"}
				icon={<FolderCog size={16} />}
			/>
			<DialogBody>
				{workspaceId ? (
					<div className="flex flex-col gap-4">
						<div>
							<div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-text-primary">
								<Database size={14} />
								Code embeddings
							</div>
							<p className="m-0 mb-3 text-[12px] text-text-secondary">
								Override the global code-embedding provider for this project only. When off, the project uses
								the global default{defaults ? ` (${formatCodeEmbeddingSettings(defaults)})` : ""}.
							</p>
							<div className="rounded-md border border-border bg-surface-1 p-3">
								<div className="mb-3 flex items-center justify-between gap-3">
									<div className="flex items-center gap-2 text-[13px] text-text-primary">
										<RadixSwitch.Root
											checked={overrideEnabled}
											disabled={controlsDisabled}
											onCheckedChange={setOverrideEnabled}
											className="relative h-5 w-9 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
										>
											<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
										</RadixSwitch.Root>
										<span>Override for this project</span>
									</div>
									{effective ? (
										<div className="text-right text-[11px] text-text-secondary">
											Effective: {formatCodeEmbeddingSettings(effective)}
										</div>
									) : null}
								</div>
								<div className="grid gap-2 lg:grid-cols-[minmax(180px,0.8fr)_1fr]">
									<div className="min-w-0">
										<span className="mb-1 block text-[12px] text-text-secondary">Project provider</span>
										<NativeSelect
											value={provider}
											onChange={(event) =>
												setProvider(event.target.value as RuntimeCodeEmbeddingSettings["provider"])
											}
											disabled={controlsDisabled || !overrideEnabled}
											fill
										>
											{CODE_EMBEDDING_PROVIDER_OPTIONS.map((option) => (
												<option key={option.value} value={option.value}>
													{option.label}
												</option>
											))}
										</NativeSelect>
									</div>
									<EmbeddingEndpointFields
										workspaceId={workspaceId}
										labelPrefix="Project"
										disabled={controlsDisabled || !overrideEnabled}
										provider={provider}
										baseUrl={baseUrl}
										model={model}
										endpointPlaceholder={defaults?.baseUrl || "Inherited endpoint"}
										modelPlaceholder={defaults?.model || "Inherited model"}
										onBaseUrlChange={setBaseUrl}
										onModelChange={setModel}
										onError={setSaveError}
									/>
								</div>
							</div>
						</div>
						{saveError ? <p className="m-0 text-[12px] text-status-red">{saveError}</p> : null}
					</div>
				) : (
					<p className="m-0 text-[13px] text-text-secondary">Select a project to configure its settings.</p>
				)}
			</DialogBody>
			<DialogFooter>
				<Button variant="default" onClick={() => onOpenChange(false)} disabled={isSaving}>
					Cancel
				</Button>
				<Button variant="primary" onClick={() => void handleSave()} disabled={controlsDisabled}>
					{isSaving ? (
						<>
							<Spinner size={14} />
							Saving...
						</>
					) : (
						"Save"
					)}
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
