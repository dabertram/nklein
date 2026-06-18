import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { getRuntimeAgentCatalogEntry } from "@runtime-agent-catalog";
import { RUNTIME_CLINE_MIN_CONTEXT_WINDOW_TOKENS } from "@runtime-contract";
import { Check } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ClineSetupSection } from "@/components/shared/cline-setup-section";
import { cn } from "@/components/ui/cn";
import { useRuntimeSettingsClineController } from "@/hooks/use-runtime-settings-cline-controller";
import { isClineProviderAuthenticated } from "@/runtime/native-agent";
import { buildFirstRunLocalModelRoles } from "@/runtime/onboarding";
import { saveClineModelContextWindowOverride, saveRuntimeConfig } from "@/runtime/runtime-config-query";
import type {
	RuntimeAgentDefinition,
	RuntimeAgentId,
	RuntimeClineProviderCatalogItem,
	RuntimeClineProviderModel,
	RuntimeClineProviderSettings,
	RuntimeConfigResponse,
} from "@/runtime/types";

interface BaseOnboardingSlide {
	kind: "media" | "agent-selection";
	title: string;
	description: string;
}

interface MediaOnboardingSlide extends BaseOnboardingSlide {
	kind: "media";
	assetVideoUrl?: string;
	assetImageUrl?: string;
	assetStemPath?: string;
	assetAlt: string;
	assetWidthPx: number;
	assetHeightPx: number;
	assetFrameWidthPx?: number;
	assetFrameHeightPx?: number;
	assetObjectFit?: "contain" | "cover";
}

type OnboardingSlide = BaseOnboardingSlide | MediaOnboardingSlide;

interface AgentSelectionResult {
	ok: boolean;
	message?: string;
}

interface OnboardingDoneResult {
	ok: boolean;
	message?: string;
}

export const TASK_START_ONBOARDING_SLIDES: OnboardingSlide[] = [
	{
		kind: "media",
		title: "Create tasks with Kanban",
		description:
			"Press c to create a task yourself, or talk to the sidebar Kanban agent to plan work for you. It can pull projects and issues from Linear and GitHub, then turn them into tasks your coding agent can pick up.",
		assetVideoUrl: "https://github.com/user-attachments/assets/4408930c-33cd-4af9-a343-e82b099eab8c",
		assetAlt: "Talking to the sidebar Kanban agent to create tasks from Linear and GitHub",
		assetWidthPx: 1908,
		assetHeightPx: 720,
	},
	{
		kind: "media",
		title: "Auto commit and link",
		description:
			"Create dependency chains of linked tasks that start one another automatically. Agents can auto commit their work as they finish, so you can orchestrate tasks in order and watch the board burn them down automatically.",
		assetVideoUrl: "https://github.com/user-attachments/assets/9a979242-bd22-4ac1-94c5-3ed5351a99d1",
		assetAlt: "Linking task cards in Cline Kanban",
		assetWidthPx: 1156,
		assetHeightPx: 720,
	},
	{
		kind: "media",
		title: "Review changes with comments",
		description:
			"Your workflow will feel like writing tickets, reviewing code, and shipping. Watch the agent work next to real-time diffs, then click lines to leave comments like you're reviewing a PR.",
		assetVideoUrl: "https://github.com/user-attachments/assets/17992035-c1ca-449a-a48b-bb094007f0a1",
		assetAlt: "Leaving comments on code diffs in Cline Kanban",
		assetWidthPx: 1616,
		assetHeightPx: 1080,
	},
	{
		kind: "agent-selection",
		title: "Choose your agent",
		description: "Choose a coding agent to complete your tasks. You can change this anytime in Settings.",
	},
];

const ONBOARDING_AGENT_IDS: readonly RuntimeAgentId[] = ["cline", "claude", "codex", "droid", "kiro"];
const FALLBACK_ONBOARDING_SLIDE: OnboardingSlide = {
	kind: "agent-selection",
	title: "",
	description: "",
};
const ONBOARDING_MEDIA_SLIDES = TASK_START_ONBOARDING_SLIDES.filter(
	(slide): slide is MediaOnboardingSlide => slide.kind === "media",
);
const ONBOARDING_MEDIA_FRAME_REFERENCE_SLIDE =
	ONBOARDING_MEDIA_SLIDES.reduce<MediaOnboardingSlide | null>((tallestSlide, slide) => {
		if (tallestSlide === null) {
			return slide;
		}
		const tallestRelativeHeight = tallestSlide.assetHeightPx / tallestSlide.assetWidthPx;
		const slideRelativeHeight = slide.assetHeightPx / slide.assetWidthPx;
		return slideRelativeHeight > tallestRelativeHeight ? slide : tallestSlide;
	}, null) ?? null;
const ONBOARDING_MEDIA_FRAME_WIDTH_PX = ONBOARDING_MEDIA_FRAME_REFERENCE_SLIDE?.assetWidthPx ?? 0;
const ONBOARDING_MEDIA_FRAME_HEIGHT_PX = ONBOARDING_MEDIA_FRAME_REFERENCE_SLIDE?.assetHeightPx ?? 0;

function isMediaOnboardingSlide(slide: OnboardingSlide): slide is MediaOnboardingSlide {
	return slide.kind === "media";
}

function AgentStatusBadge({ label, statusClassName }: { label: string; statusClassName: string }): ReactElement {
	return (
		<span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium", statusClassName)}>
			{label}
		</span>
	);
}

function isBuiltInLocalProviderId(providerId: string): boolean {
	const normalized = providerId.trim().toLowerCase();
	return normalized === "ollama" || normalized === "lmstudio" || normalized === "lm-studio";
}

function formatLocalProviderLabel(provider: RuntimeClineProviderCatalogItem): string {
	const endpoint = provider.baseUrl?.trim();
	return endpoint ? `${provider.name} (${endpoint})` : provider.name;
}

function LocalModelSetupStatus({
	providers,
	models,
	selectedProviderId,
	isLoadingModels,
}: {
	providers: RuntimeClineProviderCatalogItem[];
	models: RuntimeClineProviderModel[];
	selectedProviderId: string;
	isLoadingModels: boolean;
}): ReactElement {
	const localProviders = providers.filter((provider) => isBuiltInLocalProviderId(provider.id));
	const detectedProviders = localProviders.filter((provider) => provider.enabled);
	const selectedProviderIsLocal = isBuiltInLocalProviderId(selectedProviderId);
	const visibleModels = selectedProviderIsLocal ? models.slice(0, 4) : [];
	return (
		<div className="mt-2 rounded-md border border-border bg-surface-2 p-2 text-[12px] text-text-secondary">
			<div className="font-medium text-text-primary">Local model setup</div>
			<div className="mt-1">
				Detected endpoints:{" "}
				<span className="text-text-primary">
					{detectedProviders.length > 0
						? detectedProviders.map((provider) => formatLocalProviderLabel(provider)).join(", ")
						: "none yet"}
				</span>
			</div>
			<div className="mt-1">
				Loaded models:{" "}
				<span className="text-text-primary">
					{isLoadingModels
						? "refreshing"
						: visibleModels.length > 0
							? visibleModels.map((model) => model.name || model.id).join(", ")
							: selectedProviderIsLocal
								? "none detected"
								: "choose Ollama or LM Studio"}
				</span>
				{selectedProviderIsLocal && !isLoadingModels && models.length > visibleModels.length ? (
					<span className="text-text-tertiary"> +{models.length - visibleModels.length}</span>
				) : null}
			</div>
		</div>
	);
}

function OnboardingMedia({
	assetStemPath,
	assetVideoUrl,
	assetImageUrl,
	assetWidthPx,
	assetHeightPx,
	assetFrameWidthPx,
	assetFrameHeightPx,
	assetObjectFit,
	alt,
}: {
	assetStemPath?: string;
	assetVideoUrl?: string;
	assetImageUrl?: string;
	assetWidthPx?: number;
	assetHeightPx?: number;
	assetFrameWidthPx?: number;
	assetFrameHeightPx?: number;
	assetObjectFit?: "contain" | "cover";
	alt: string;
}): ReactElement {
	const [assetMode, setAssetMode] = useState<"video" | "image" | "missing">("video");
	const [isVideoLoading, setIsVideoLoading] = useState(true);
	const videoPath = assetVideoUrl ?? (assetStemPath ? `${assetStemPath}.mp4` : null);
	const imagePath = assetImageUrl ?? (assetStemPath ? `${assetStemPath}.gif` : null);
	const mediaWidth = assetWidthPx;
	const mediaHeight = assetHeightPx;
	const frameWidth = assetFrameWidthPx ?? assetWidthPx;
	const frameHeight = assetFrameHeightPx ?? assetHeightPx;
	const objectFitClassName = assetObjectFit === "cover" ? "object-cover" : "object-contain";
	const hasFrameSize = typeof frameWidth === "number" && typeof frameHeight === "number";
	const mediaContainerStyle = hasFrameSize
		? {
				aspectRatio: `${frameWidth} / ${frameHeight}`,
				maxWidth: `${frameWidth}px`,
				width: "100%",
			}
		: typeof frameWidth === "number"
			? {
					maxWidth: `${frameWidth}px`,
					width: "100%",
				}
			: {
					width: "100%",
				};
	const missingStateStyle =
		typeof frameWidth === "number" && typeof frameHeight === "number"
			? {
					maxHeight: `${frameHeight}px`,
					maxWidth: `${frameWidth}px`,
					width: "100%",
				}
			: typeof frameHeight === "number"
				? {
						maxHeight: `${frameHeight}px`,
						maxWidth: "100%",
						width: "auto",
					}
				: {
						width: "100%",
					};

	useEffect(() => {
		setAssetMode("video");
		setIsVideoLoading(true);
	}, [imagePath, videoPath]);

	if (assetMode === "missing") {
		return (
			<div className="flex w-full justify-center">
				<div
					className="flex min-h-[180px] w-full items-center justify-center rounded-md border border-dashed border-border-bright bg-surface-1 p-4 text-center"
					style={missingStateStyle}
				>
					<p className="m-0 text-xs text-text-secondary">
						Add onboarding media by setting a valid slide video or gif source.
					</p>
				</div>
			</div>
		);
	}

	if (assetMode === "video") {
		if (!videoPath) {
			if (!imagePath) {
				return (
					<div className="flex w-full justify-center">
						<div
							className="flex min-h-[180px] w-full items-center justify-center rounded-md border border-dashed border-border-bright bg-surface-1 p-4 text-center"
							style={mediaContainerStyle}
						>
							<p className="m-0 text-xs text-text-secondary">
								Add onboarding media by setting a valid slide video or gif source.
							</p>
						</div>
					</div>
				);
			}
			return (
				<div className="flex w-full justify-center">
					<div className="relative w-full overflow-hidden rounded-md bg-surface-1" style={mediaContainerStyle}>
						<img
							src={imagePath}
							alt={alt}
							onError={() => setAssetMode("missing")}
							width={mediaWidth}
							height={mediaHeight}
							className={cn("h-full w-full", objectFitClassName)}
						/>
					</div>
				</div>
			);
		}
		return (
			<div className="flex w-full justify-center">
				<div className="relative w-full overflow-hidden rounded-md bg-surface-1" style={mediaContainerStyle}>
					{isVideoLoading ? <div aria-hidden="true" className="kb-skeleton absolute inset-0" /> : null}
					<video
						src={videoPath}
						autoPlay
						loop
						muted
						playsInline
						preload="auto"
						width={mediaWidth}
						height={mediaHeight}
						onLoadedData={() => setIsVideoLoading(false)}
						onError={() => {
							setIsVideoLoading(false);
							setAssetMode(imagePath ? "image" : "missing");
						}}
						className={cn(
							"h-full w-full transition-opacity duration-200",
							objectFitClassName,
							isVideoLoading ? "opacity-0" : "opacity-100",
						)}
					/>
				</div>
			</div>
		);
	}

	if (!imagePath) {
		return (
			<div className="flex w-full justify-center">
				<div
					className="flex min-h-[180px] w-full items-center justify-center rounded-md border border-dashed border-border-bright bg-surface-1 p-4 text-center"
					style={mediaContainerStyle}
				>
					<p className="m-0 text-xs text-text-secondary">
						Add onboarding media by setting a valid slide video or gif source.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex w-full justify-center">
			<div className="relative w-full overflow-hidden rounded-md bg-surface-1" style={mediaContainerStyle}>
				<img
					src={imagePath}
					alt={alt}
					onError={() => setAssetMode("missing")}
					width={mediaWidth}
					height={mediaHeight}
					className={cn("h-full w-full", objectFitClassName)}
				/>
			</div>
		</div>
	);
}

function resolveInstallInstructions(agentId: RuntimeAgentId): string {
	if (agentId === "cline") {
		return "Built-in agent with support for any LLM provider. No CLI install needed.";
	}
	if (agentId === "claude") {
		return "Anthropic's coding agent CLI with access to Claude models.";
	}
	if (agentId === "codex") {
		return "OpenAI's coding agent CLI with access to the latest GPT models.";
	}
	if (agentId === "droid") {
		return "Factory's coding agent with access to the latest frontier models.";
	}
	if (agentId === "kiro") {
		return "Amazon's coding agent with access to the latest frontier models.";
	}
	return "Install from the official docs.";
}

function getInstallLinkLabel(agentId: RuntimeAgentId): string {
	if (agentId === "claude") {
		return "Learn more";
	}
	if (agentId === "codex") {
		return "Learn more";
	}
	if (agentId === "droid") {
		return "Learn more";
	}
	if (agentId === "kiro") {
		return "Learn more";
	}
	return "Install guide";
}

export function TaskStartAgentOnboardingCarousel({
	open,
	workspaceId,
	runtimeConfig,
	selectedAgentId,
	agents,
	clineProviderSettings,
	activeSlideIndex,
	onSelectAgent,
	onClineSetupSaved,
	onDoneActionChange,
}: {
	open: boolean;
	workspaceId: string | null;
	runtimeConfig: RuntimeConfigResponse | null;
	selectedAgentId: RuntimeAgentId | null;
	agents: RuntimeAgentDefinition[];
	clineProviderSettings: RuntimeClineProviderSettings | null;
	activeSlideIndex: number;
	onSelectAgent?: (agentId: RuntimeAgentId) => Promise<AgentSelectionResult>;
	onClineSetupSaved?: () => void;
	onDoneActionChange?: (action: (() => Promise<OnboardingDoneResult>) | null) => void;
}): ReactElement {
	const [activeAgentId, setActiveAgentId] = useState<RuntimeAgentId | null>(selectedAgentId);
	const [selectionError, setSelectionError] = useState<string | null>(null);
	const [clineSetupError, setClineSetupError] = useState<string | null>(null);
	const [clineContextWindowInput, setClineContextWindowInput] = useState("");
	const selectionSavePromiseRef = useRef<Promise<AgentSelectionResult> | null>(null);

	useEffect(() => {
		setActiveAgentId(selectedAgentId);
	}, [selectedAgentId]);

	const currentSlide =
		TASK_START_ONBOARDING_SLIDES[activeSlideIndex] ?? TASK_START_ONBOARDING_SLIDES[0] ?? FALLBACK_ONBOARDING_SLIDE;
	const clineAuthenticated = isClineProviderAuthenticated(clineProviderSettings);
	const clineSettings = useRuntimeSettingsClineController({
		open,
		workspaceId,
		selectedAgentId: activeAgentId ?? selectedAgentId ?? "cline",
		config: runtimeConfig,
	});
	const onboardingAgents = useMemo(
		() =>
			ONBOARDING_AGENT_IDS.map((agentId) => {
				const configuredAgent = agents.find((agent) => agent.id === agentId) ?? null;
				const catalogEntry = getRuntimeAgentCatalogEntry(agentId);
				return {
					id: agentId,
					label: catalogEntry?.label ?? configuredAgent?.label ?? agentId,
					installUrl: catalogEntry?.installUrl ?? null,
					installed: configuredAgent?.installed ?? false,
				};
			}),
		[agents],
	);
	const selectedClineProviderModel = clineSettings.providerModels.find((model) => model.id === clineSettings.modelId);
	const selectedModelContextWindow = selectedClineProviderModel?.contextWindow ?? null;

	const handleAgentSelect = (agentId: RuntimeAgentId) => {
		if (activeAgentId === agentId) {
			return;
		}
		setActiveAgentId(agentId);
		setSelectionError(null);
		if (!onSelectAgent) {
			return;
		}
		const savePromise = onSelectAgent(agentId);
		selectionSavePromiseRef.current = savePromise;
		void savePromise
			.then((result) => {
				if (selectionSavePromiseRef.current !== savePromise) {
					return;
				}
				if (!result.ok) {
					setSelectionError(result.message ?? "Could not switch agents. Try again.");
					setActiveAgentId(selectedAgentId);
				}
			})
			.catch((error: unknown) => {
				if (selectionSavePromiseRef.current !== savePromise) {
					return;
				}
				const message = error instanceof Error ? error.message : String(error);
				setSelectionError(message || "Could not switch agents. Try again.");
				setActiveAgentId(selectedAgentId);
			})
			.finally(() => {
				if (selectionSavePromiseRef.current === savePromise) {
					selectionSavePromiseRef.current = null;
				}
			});
	};

	const handleDoneAction = useCallback(async (): Promise<OnboardingDoneResult> => {
		if (selectionSavePromiseRef.current) {
			const selectionResult = await selectionSavePromiseRef.current.catch((error: unknown) => ({
				ok: false,
				message: error instanceof Error ? error.message : String(error),
			}));
			if (!selectionResult.ok) {
				const message = selectionResult.message ?? "Could not switch agents. Try again.";
				setSelectionError(message);
				return { ok: false, message };
			}
		}
		if (activeAgentId !== "cline") {
			return { ok: true };
		}
		if (!clineSettings.hasUnsavedChanges) {
			return { ok: true };
		}
		setClineSetupError(null);
		const saveResult = await clineSettings.saveProviderSettings();
		if (!saveResult.ok) {
			const message = saveResult.message ?? "Could not save Cline provider settings.";
			setClineSetupError(message);
			return { ok: false, message };
		}
		const firstRunRoles = buildFirstRunLocalModelRoles({
			existingRoles: runtimeConfig?.modelRoles,
			providerId: clineSettings.providerId,
			modelId: clineSettings.modelId,
			baseUrl: clineSettings.baseUrl,
			reasoningEffort: clineSettings.reasoningEffort,
		});
		const trimmedContextWindow = clineContextWindowInput.trim();
		if (trimmedContextWindow) {
			const contextWindow = Number(trimmedContextWindow);
			if (!Number.isInteger(contextWindow) || contextWindow < RUNTIME_CLINE_MIN_CONTEXT_WINDOW_TOKENS) {
				const message = `Context window must be at least ${RUNTIME_CLINE_MIN_CONTEXT_WINDOW_TOKENS.toLocaleString()} tokens.`;
				setClineSetupError(message);
				return { ok: false, message };
			}
			try {
				await saveClineModelContextWindowOverride(workspaceId, {
					providerId: clineSettings.providerId,
					modelId: clineSettings.modelId,
					endpoint: clineSettings.baseUrl?.trim() || null,
					contextWindow,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setClineSetupError(message);
				return { ok: false, message };
			}
		}
		if (firstRunRoles) {
			try {
				await saveRuntimeConfig(workspaceId, { modelRoles: firstRunRoles });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setClineSetupError(message);
				return { ok: false, message };
			}
		}
		onClineSetupSaved?.();
		return { ok: true };
	}, [
		activeAgentId,
		clineContextWindowInput,
		clineSettings,
		onClineSetupSaved,
		runtimeConfig?.modelRoles,
		workspaceId,
	]);

	useEffect(() => {
		onDoneActionChange?.(handleDoneAction);
		return () => {
			onDoneActionChange?.(null);
		};
	}, [handleDoneAction, onDoneActionChange]);

	return (
		<div className="space-y-3">
			{open ? (
				<div aria-hidden="true" className="h-0 overflow-hidden opacity-0">
					{ONBOARDING_MEDIA_SLIDES.map((slide) =>
						slide.assetVideoUrl ? (
							<video key={slide.assetVideoUrl} src={slide.assetVideoUrl} preload="auto" muted playsInline />
						) : null,
					)}
				</div>
			) : null}

			<div>
				<h4 className="m-0 text-[15px] font-semibold text-text-primary">{currentSlide?.title}</h4>
				<p className="mt-1 mb-0 text-[13px] text-text-secondary">{currentSlide?.description}</p>
			</div>

			{isMediaOnboardingSlide(currentSlide) ? (
				<OnboardingMedia
					assetStemPath={currentSlide.assetStemPath}
					assetVideoUrl={currentSlide.assetVideoUrl}
					assetImageUrl={currentSlide.assetImageUrl}
					assetWidthPx={currentSlide.assetWidthPx}
					assetHeightPx={currentSlide.assetHeightPx}
					assetFrameWidthPx={currentSlide.assetFrameWidthPx ?? ONBOARDING_MEDIA_FRAME_WIDTH_PX}
					assetFrameHeightPx={currentSlide.assetFrameHeightPx ?? ONBOARDING_MEDIA_FRAME_HEIGHT_PX}
					assetObjectFit={currentSlide.assetObjectFit}
					alt={currentSlide.assetAlt}
				/>
			) : null}

			{currentSlide.kind === "agent-selection" ? (
				<div className="space-y-2">
					{onboardingAgents.map((agent) => (
						<div
							key={agent.id}
							className={cn(
								"rounded-md border bg-surface-1 p-3",
								activeAgentId === agent.id ? "border-accent" : "border-border",
							)}
						>
							<div
								role="button"
								tabIndex={0}
								onClick={() => handleAgentSelect(agent.id)}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										handleAgentSelect(agent.id);
									}
								}}
								className="flex cursor-pointer items-center justify-between gap-3"
							>
								<span className="flex items-center gap-2">
									<RadixCheckbox.Root
										checked={activeAgentId === agent.id}
										onCheckedChange={(checked) => {
											if (checked === true) {
												handleAgentSelect(agent.id);
											}
										}}
										className="flex h-4 w-4 cursor-pointer items-center justify-center rounded border border-border-bright bg-surface-2 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
									>
										<RadixCheckbox.Indicator>
											<Check size={12} className="text-white" />
										</RadixCheckbox.Indicator>
									</RadixCheckbox.Root>
									<span className="text-[13px] text-text-primary">{agent.label}</span>
								</span>
								{agent.id === "cline" ? (
									clineAuthenticated ? (
										<AgentStatusBadge
											label="Authenticated"
											statusClassName="bg-status-green/10 text-status-green"
										/>
									) : null
								) : agent.installed ? (
									<AgentStatusBadge label="Detected" statusClassName="bg-status-green/10 text-status-green" />
								) : (
									<AgentStatusBadge label="Not installed" statusClassName="bg-surface-3 text-text-secondary" />
								)}
							</div>
							<p className="mt-2 mb-0 text-[12px] text-text-secondary">
								{resolveInstallInstructions(agent.id)}
								{agent.id !== "cline" && agent.installUrl ? (
									<>
										{" "}
										<a
											href={agent.installUrl}
											target="_blank"
											rel="noreferrer"
											className="text-accent hover:underline"
										>
											{getInstallLinkLabel(agent.id)}
										</a>
									</>
								) : null}
							</p>
							{agent.id === "cline" ? (
								<div className="mt-2">
									<LocalModelSetupStatus
										providers={clineSettings.providerCatalog}
										models={clineSettings.providerModels}
										selectedProviderId={clineSettings.providerId}
										isLoadingModels={clineSettings.isLoadingProviderModels}
									/>
									<ClineSetupSection
										controller={clineSettings}
										controlsDisabled={false}
										showMcpSettings={false}
										onError={setClineSetupError}
										onSaved={onClineSetupSaved}
									/>
									<div className="mt-2 rounded-md border border-border bg-surface-1 p-2">
										<div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
											<div className="min-w-0">
												<div className="text-[12px] font-medium text-text-primary">Context window</div>
												<div className="mt-0.5 text-[11px] text-text-secondary">
													{selectedModelContextWindow
														? `${selectedModelContextWindow.toLocaleString()} tokens reported`
														: "No window reported"}
												</div>
											</div>
											<input
												value={clineContextWindowInput}
												onChange={(event) => setClineContextWindowInput(event.target.value)}
												placeholder="64000"
												inputMode="numeric"
												className="h-8 min-w-0 rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary"
												aria-label="Cline context window override"
											/>
										</div>
										<div className="mt-2 flex flex-wrap gap-1.5">
											{(["architect", "worker", "reviewer"] as const).map((roleId) => (
												<span
													key={roleId}
													className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-secondary"
												>
													{roleId}: {clineSettings.modelId || "select model"}
													{clineSettings.reasoningEffort ? ` · ${clineSettings.reasoningEffort}` : ""}
												</span>
											))}
										</div>
									</div>
									{clineSetupError ? (
										<div className="mt-2 rounded-md border border-status-red/30 bg-status-red/5 p-2 text-[12px] text-text-primary">
											{clineSetupError}
										</div>
									) : null}
								</div>
							) : null}
						</div>
					))}
					{selectionError ? (
						<div className="rounded-md border border-status-red/30 bg-status-red/5 p-2 text-[12px] text-text-primary">
							{selectionError}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
