import * as RadixSwitch from "@radix-ui/react-switch";
import { Database, FolderCog, Power, ShieldCheck } from "lucide-react";
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
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeCodeEmbeddingSettings, RuntimeModelGateAction, RuntimeSkillDynamicsLevel } from "@/runtime/types";
import { useRuntimeConfig } from "@/runtime/use-runtime-config";

export interface ProjectSettingsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaceId: string | null;
	projectName?: string | null;
	autoResumeEnabled?: boolean;
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
	autoResumeEnabled,
}: ProjectSettingsDialogProps): ReactElement {
	const { config, isSaving, save } = useRuntimeConfig(open, workspaceId, null);
	const [resumeOnBoot, setResumeOnBoot] = useState(autoResumeEnabled === true);
	const [isSavingProjectSetting, setIsSavingProjectSetting] = useState(false);
	const [overrideEnabled, setOverrideEnabled] = useState(false);
	const [provider, setProvider] = useState<RuntimeCodeEmbeddingSettings["provider"]>("local_lexical");
	const [model, setModel] = useState(LOCAL_CODE_EMBEDDING_MODEL);
	const [baseUrl, setBaseUrl] = useState("");
	// §5.AL per-project model-capability gate policy override.
	const [policyOverrideEnabled, setPolicyOverrideEnabled] = useState(false);
	const [policyUnsuitable, setPolicyUnsuitable] = useState<RuntimeModelGateAction>("reject");
	const [policyUnknown, setPolicyUnknown] = useState<RuntimeModelGateAction>("warn");
	// §5.AE per-project skill-dynamics level override.
	const [skillDynamicsOverrideEnabled, setSkillDynamicsOverrideEnabled] = useState(false);
	const [skillDynamicsLevel, setSkillDynamicsLevel] = useState<RuntimeSkillDynamicsLevel>("fully_dynamic");
	const [saveError, setSaveError] = useState<string | null>(null);

	useEffect(() => {
		setResumeOnBoot(autoResumeEnabled === true);
	}, [autoResumeEnabled, open]);

	// Load the per-project override into local state whenever the config (re)loads.
	useEffect(() => {
		const override = config?.codeEmbeddingOverride ?? null;
		setOverrideEnabled(override !== null);
		setProvider(override?.provider ?? "local_lexical");
		setModel(override?.model ?? LOCAL_CODE_EMBEDDING_MODEL);
		setBaseUrl(override?.baseUrl ?? "");
	}, [config?.codeEmbeddingOverride]);

	// §5.AL: load the model-gate policy override (seed the selects from the global default when no override).
	useEffect(() => {
		const override = config?.modelSuitabilityPolicyOverride ?? null;
		const fallback = config?.modelSuitabilityPolicyDefaults ?? null;
		setPolicyOverrideEnabled(override !== null);
		setPolicyUnsuitable(override?.onUnsuitable ?? fallback?.onUnsuitable ?? "reject");
		setPolicyUnknown(override?.onUnknown ?? fallback?.onUnknown ?? "warn");
	}, [config?.modelSuitabilityPolicyOverride, config?.modelSuitabilityPolicyDefaults]);

	// §5.AE: load the skill-dynamics level override (seed from the global default when no override).
	useEffect(() => {
		const override = config?.skillDynamicsLevelOverride ?? null;
		setSkillDynamicsOverrideEnabled(override !== null);
		setSkillDynamicsLevel(override ?? config?.skillDynamicsLevelDefault ?? "fully_dynamic");
	}, [config?.skillDynamicsLevelOverride, config?.skillDynamicsLevelDefault]);

	const defaults = config?.codeEmbeddingDefaults ?? null;
	const effective = overrideEnabled ? buildCodeEmbeddingSettings(provider, model, baseUrl) : defaults;
	const controlsDisabled = isSaving || isSavingProjectSetting || !workspaceId;

	const handleSave = async (): Promise<void> => {
		setSaveError(null);
		const override = overrideEnabled ? buildCodeEmbeddingSettings(provider, model, baseUrl) : null;
		const policyOverride = policyOverrideEnabled
			? { onUnsuitable: policyUnsuitable, onUnknown: policyUnknown }
			: null;
		const saved = await save({
			codeEmbeddingOverride: override,
			modelSuitabilityPolicyOverride: policyOverride,
			skillDynamicsLevelOverride: skillDynamicsOverrideEnabled ? skillDynamicsLevel : null,
		});
		if (!saved) {
			setSaveError("Could not save project settings. Check runtime logs and try again.");
			return;
		}
		if (workspaceId && resumeOnBoot !== (autoResumeEnabled === true)) {
			setIsSavingProjectSetting(true);
			try {
				const trpcClient = getRuntimeTrpcClient(workspaceId);
				const response = await trpcClient.projects.setAutoResume.mutate({
					projectId: workspaceId,
					enabled: resumeOnBoot,
				});
				if (!response.ok) {
					setSaveError(response.error ?? "Could not save project settings. Check runtime logs and try again.");
					return;
				}
			} catch (error) {
				setSaveError(
					error instanceof Error
						? error.message
						: "Could not save project settings. Check runtime logs and try again.",
				);
				return;
			} finally {
				setIsSavingProjectSetting(false);
			}
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
								<Power size={14} />
								Desktop
							</div>
							<div className="rounded-md border border-border bg-surface-1 p-3">
								<div className="flex items-center justify-between gap-3">
									<div className="min-w-0">
										<div className="text-[13px] text-text-primary">Resume on boot</div>
										<p className="m-0 mt-1 text-[12px] text-text-secondary">
											When the desktop app starts at login, resume eligible work for this project.
										</p>
									</div>
									<RadixSwitch.Root
										checked={resumeOnBoot}
										disabled={controlsDisabled}
										onCheckedChange={setResumeOnBoot}
										className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
									>
										<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
									</RadixSwitch.Root>
								</div>
							</div>
						</div>
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
						<div>
							<div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-text-primary">
								<ShieldCheck size={14} />
								Model capability gate
							</div>
							<p className="m-0 mb-3 text-[12px] text-text-secondary">
								How this project treats a model that the capability catalog flags as not-suitable or unknown for
								agentic tool use. When off, the project uses the global default
								{config?.modelSuitabilityPolicyDefaults
									? ` (unsuitable: ${config.modelSuitabilityPolicyDefaults.onUnsuitable}, unknown: ${config.modelSuitabilityPolicyDefaults.onUnknown})`
									: ""}
								.
							</p>
							<div className="rounded-md border border-border bg-surface-1 p-3">
								<div className="mb-3 flex items-center gap-2 text-[13px] text-text-primary">
									<RadixSwitch.Root
										checked={policyOverrideEnabled}
										disabled={controlsDisabled}
										onCheckedChange={setPolicyOverrideEnabled}
										className="relative h-5 w-9 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
									>
										<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
									</RadixSwitch.Root>
									<span>Override for this project</span>
								</div>
								<div className="grid gap-2 lg:grid-cols-2">
									<div className="min-w-0">
										<span className="mb-1 block text-[12px] text-text-secondary">Not-suitable model</span>
										<NativeSelect
											value={policyUnsuitable}
											onChange={(event) => setPolicyUnsuitable(event.target.value as RuntimeModelGateAction)}
											disabled={controlsDisabled || !policyOverrideEnabled}
											fill
										>
											<option value="reject">Reject (refuse to use)</option>
											<option value="warn">Warn (use with a caveat)</option>
											<option value="allow">Allow (use anyway)</option>
										</NativeSelect>
									</div>
									<div className="min-w-0">
										<span className="mb-1 block text-[12px] text-text-secondary">Unknown model</span>
										<NativeSelect
											value={policyUnknown}
											onChange={(event) => setPolicyUnknown(event.target.value as RuntimeModelGateAction)}
											disabled={controlsDisabled || !policyOverrideEnabled}
											fill
										>
											<option value="reject">Reject (refuse to use)</option>
											<option value="warn">Warn (use with a caveat)</option>
											<option value="allow">Allow (use anyway)</option>
										</NativeSelect>
									</div>
								</div>
							</div>
						</div>
						<div>
							<div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-text-primary">
								<FolderCog size={14} />
								Skill dynamics
							</div>
							<p className="m-0 mb-3 text-[12px] text-text-secondary">
								How dynamic vs. strict this project’s per-task skill/prompt assignment is (§5.AE). When off, the
								project uses the global default ({config?.skillDynamicsLevelDefault ?? "fully_dynamic"}).
							</p>
							<div className="rounded-md border border-border bg-surface-1 p-3">
								<div className="mb-3 flex items-center gap-2 text-[13px] text-text-primary">
									<RadixSwitch.Root
										checked={skillDynamicsOverrideEnabled}
										disabled={controlsDisabled}
										onCheckedChange={setSkillDynamicsOverrideEnabled}
										className="relative h-5 w-9 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
									>
										<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
									</RadixSwitch.Root>
									<span>Override for this project</span>
								</div>
								<NativeSelect
									value={skillDynamicsLevel}
									onChange={(event) => setSkillDynamicsLevel(event.target.value as RuntimeSkillDynamicsLevel)}
									disabled={controlsDisabled || !skillDynamicsOverrideEnabled}
									fill
								>
									<option value="fully_dynamic">Fully dynamic</option>
									<option value="static_skills_auto_model">Static skills, auto model</option>
									<option value="assigned_skills">Assigned skills</option>
									<option value="fully_static">Fully static</option>
								</NativeSelect>
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
					{isSaving || isSavingProjectSetting ? (
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
