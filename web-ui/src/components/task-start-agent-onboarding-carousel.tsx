import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { getRuntimeAgentCatalogEntry } from "@runtime-agent-catalog";
import { RUNTIME_NKLEIN_MIN_CONTEXT_WINDOW_TOKENS } from "@runtime-contract";
import { Check, ExternalLink, Terminal } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { hasSelfHostedOnboardingMedia } from "@/components/onboarding-media-source";
import { NKleinSetupSection } from "@/components/shared/nklein-setup-section";
import { cn } from "@/components/ui/cn";
import { useRuntimeSettingsNKleinController } from "@/hooks/use-runtime-settings-nklein-controller";
import {
	filterVisibleNKleinProviderCatalog,
	isCloudProviderSupportEnabled,
	isNKleinProviderAuthenticated,
} from "@/runtime/native-agent";
import { buildFirstRunLocalModelRoles } from "@/runtime/onboarding";
import { saveNKleinModelContextWindowOverride, saveRuntimeConfig } from "@/runtime/runtime-config-query";
import type {
	RuntimeAgentDefinition,
	RuntimeAgentId,
	RuntimeConfigResponse,
	RuntimeNKleinProviderCatalogItem,
	RuntimeNKleinProviderModel,
	RuntimeNKleinProviderSettings,
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
		title: "Describe it — !Klein plans and builds it",
		description:
			"Talk to the chat (or press c to write a card yourself): !Klein breaks your goal into small dependent tasks on the board, and your local models work through them one by one. Everything runs on your machine — no cloud, and every agent works inside an isolated Docker sandbox.",
		// Onboarding demo media pending: !Klein's own self-hosted clips. The prior
		// inherited Cline demo videos were removed (they streamed from external
		// signed S3 URLs that the served CSP intentionally blocks — see todo.md).
		// With no source, the slide renders as title + description only.
		assetAlt: "Talking to the !Klein chat to plan work into board cards",
		assetWidthPx: 1908,
		assetHeightPx: 720,
	},
	{
		kind: "media",
		title: "Watch the board burn down",
		description:
			"Cards flow Planning → Ready → In Progress → Review → Completed on their own; dependency chains start the next task automatically and finished work is committed to its own branch. Zoom to taste: Chat keeps it simple, Professional and the dependency graph show everything.",
		assetAlt: "Cards flowing across the !Klein board with dependency links",
		assetWidthPx: 1156,
		assetHeightPx: 720,
	},
	{
		kind: "media",
		title: "Reviewed before it ships",
		description:
			"Every task's work is checked by a second model and the task's own acceptance command before delivery. Watch real-time diffs while agents work, click lines to leave comments like a PR review, and anything that needs you shows up in the chat.",
		assetAlt: "Reviewing diffs and leaving line comments in !Klein",
		assetWidthPx: 1616,
		assetHeightPx: 1080,
	},
	{
		kind: "agent-selection",
		title: "Choose your agent",
		description: "Choose a coding agent to complete your tasks. You can change this anytime in Settings.",
	},
];

// P0.9c: the agent contract is nklein-only; the cloud-agent carousel entries return with a future multi-agent phase.
const ONBOARDING_AGENT_IDS: readonly RuntimeAgentId[] = ["nklein"];
const FALLBACK_ONBOARDING_SLIDE: OnboardingSlide = {
	kind: "agent-selection",
	title: "",
	description: "",
};

export function resolveOnboardingAgentIds(cloudProviderSupportEnabled: boolean): RuntimeAgentId[] {
	return cloudProviderSupportEnabled ? [...ONBOARDING_AGENT_IDS] : ["nklein"];
}
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

/**
 * A media slide only renders its media frame when it points at a SELF-HOSTED asset (a same-origin path the CSP `self`
 * policy allows). Asset-less slides — or ones whose only source is off-origin (e.g. the removed external S3 demos) —
 * render as title + description only (F5.4's text fallback), never a broken frame or the developer placeholder.
 */
function hasOnboardingMediaSource(slide: MediaOnboardingSlide): boolean {
	return hasSelfHostedOnboardingMedia(slide);
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

function formatLocalProviderLabel(provider: RuntimeNKleinProviderCatalogItem): string {
	const endpoint = provider.baseUrl?.trim();
	return endpoint ? `${provider.name} (${endpoint})` : provider.name;
}

function LocalModelSetupStatus({
	providers,
	models,
	selectedProviderId,
	isLoadingModels,
}: {
	providers: RuntimeNKleinProviderCatalogItem[];
	models: RuntimeNKleinProviderModel[];
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

interface LocalEndpointGuide {
	id: "ollama" | "lmstudio";
	label: string;
	downloadUrl: string;
	installCommand: string;
	startCommand: string;
	modelCommand: string;
	verifyCommand: string;
}

const LOCAL_ENDPOINT_GUIDES: readonly LocalEndpointGuide[] = [
	{
		id: "ollama",
		label: "Ollama",
		downloadUrl: "https://ollama.com/download",
		installCommand: "curl -fsSL https://ollama.com/install.sh | sh",
		startCommand: "ollama serve",
		modelCommand: "ollama run gemma4",
		verifyCommand: "ollama ps",
	},
	{
		id: "lmstudio",
		label: "LM Studio",
		downloadUrl: "https://lmstudio.ai/download",
		installCommand: "curl -fsSL https://lmstudio.ai/install.sh | bash",
		startCommand: "lms server start",
		modelCommand: "lms load <model-id> --context-length=64000",
		verifyCommand: "lms ps",
	},
];

function SetupCommand({ label, command }: { label: string; command: string }): ReactElement {
	return (
		<div className="min-w-0">
			<div className="mb-0.5 text-[10px] font-medium uppercase text-text-tertiary">{label}</div>
			<code className="block truncate rounded-sm border border-border bg-surface-2 px-1.5 py-1 font-mono text-[11px] text-text-secondary">
				{command}
			</code>
		</div>
	);
}

function LocalEndpointStartGuide({
	providers,
	models,
	selectedProviderId,
}: {
	providers: RuntimeNKleinProviderCatalogItem[];
	models: RuntimeNKleinProviderModel[];
	selectedProviderId: string;
}): ReactElement {
	const providersById = new Map(providers.map((provider) => [provider.id.trim().toLowerCase(), provider]));
	const selectedProvider = selectedProviderId.trim().toLowerCase();
	const hasLoadedModels = models.length > 0;
	return (
		<div className="mt-2 rounded-md border border-border bg-surface-1 p-2">
			<div className="flex items-center gap-1.5 text-[12px] font-medium text-text-primary">
				<Terminal size={14} className="text-text-secondary" />
				<span>Endpoint start guide</span>
			</div>
			<div className="mt-2 grid gap-2">
				{LOCAL_ENDPOINT_GUIDES.map((guide) => {
					const provider = providersById.get(guide.id) ?? null;
					const detected = provider?.enabled === true;
					const selected =
						selectedProvider === guide.id || (guide.id === "lmstudio" && selectedProvider === "lm-studio");
					return (
						<div
							key={guide.id}
							className={cn(
								"rounded-md border p-2",
								selected ? "border-accent/50 bg-accent/5" : "border-border bg-surface-2/60",
							)}
						>
							<div className="flex min-w-0 items-center justify-between gap-2">
								<div className="min-w-0 text-[12px] font-medium text-text-primary">
									{guide.label}
									<span className="ml-1 text-[11px] text-text-tertiary">
										{detected ? "detected" : "not detected"}
									</span>
								</div>
								<a
									href={guide.downloadUrl}
									target="_blank"
									rel="noreferrer"
									className="inline-flex shrink-0 items-center gap-1 text-[11px] text-accent hover:underline"
								>
									Download <ExternalLink size={11} />
								</a>
							</div>
							<div className="mt-2 grid gap-1.5 sm:grid-cols-2">
								<SetupCommand label="Install" command={guide.installCommand} />
								<SetupCommand label="Start" command={guide.startCommand} />
								<SetupCommand label="Load model" command={guide.modelCommand} />
								<SetupCommand
									label={hasLoadedModels && selected ? "Loaded" : "Check"}
									command={guide.verifyCommand}
								/>
							</div>
						</div>
					);
				})}
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
	if (agentId === "nklein") {
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

function getInstallLinkLabel(_agentId: RuntimeAgentId): string {
	// P0.9c: with the nklein-only agent contract the per-CLI-agent labels became unreachable.
	return "Install guide";
}

export function TaskStartAgentOnboardingCarousel({
	open,
	workspaceId,
	runtimeConfig,
	selectedAgentId,
	agents,
	nkleinProviderSettings,
	activeSlideIndex,
	onSelectAgent,
	onNKleinSetupSaved,
	onDoneActionChange,
}: {
	open: boolean;
	workspaceId: string | null;
	runtimeConfig: RuntimeConfigResponse | null;
	selectedAgentId: RuntimeAgentId | null;
	agents: RuntimeAgentDefinition[];
	nkleinProviderSettings: RuntimeNKleinProviderSettings | null;
	activeSlideIndex: number;
	onSelectAgent?: (agentId: RuntimeAgentId) => Promise<AgentSelectionResult>;
	onNKleinSetupSaved?: () => void;
	onDoneActionChange?: (action: (() => Promise<OnboardingDoneResult>) | null) => void;
}): ReactElement {
	const [activeAgentId, setActiveAgentId] = useState<RuntimeAgentId | null>(selectedAgentId);
	const [selectionError, setSelectionError] = useState<string | null>(null);
	const [nkleinSetupError, setNKleinSetupError] = useState<string | null>(null);
	const [nkleinContextWindowInput, setNKleinContextWindowInput] = useState("");
	const selectionSavePromiseRef = useRef<Promise<AgentSelectionResult> | null>(null);

	useEffect(() => {
		setActiveAgentId(selectedAgentId);
	}, [selectedAgentId]);

	const currentSlide =
		TASK_START_ONBOARDING_SLIDES[activeSlideIndex] ?? TASK_START_ONBOARDING_SLIDES[0] ?? FALLBACK_ONBOARDING_SLIDE;
	const nkleinAuthenticated = isNKleinProviderAuthenticated(nkleinProviderSettings);
	const nkleinSettings = useRuntimeSettingsNKleinController({
		open,
		workspaceId,
		selectedAgentId: activeAgentId ?? selectedAgentId ?? "nklein",
		config: runtimeConfig,
	});
	const cloudProviderSupportEnabled = isCloudProviderSupportEnabled(runtimeConfig);
	const visibleNKleinProviderCatalog = useMemo(
		() => filterVisibleNKleinProviderCatalog(nkleinSettings.providerCatalog, cloudProviderSupportEnabled),
		[nkleinSettings.providerCatalog, cloudProviderSupportEnabled],
	);
	const onboardingAgents = useMemo(
		() =>
			resolveOnboardingAgentIds(cloudProviderSupportEnabled).map((agentId) => {
				const configuredAgent = agents.find((agent) => agent.id === agentId) ?? null;
				const catalogEntry = getRuntimeAgentCatalogEntry(agentId);
				return {
					id: agentId,
					label: catalogEntry?.label ?? configuredAgent?.label ?? agentId,
					installUrl: catalogEntry?.installUrl ?? null,
					installed: configuredAgent?.installed ?? false,
				};
			}),
		[agents, cloudProviderSupportEnabled],
	);
	const selectedNKleinProviderModel = nkleinSettings.providerModels.find(
		(model) => model.id === nkleinSettings.modelId,
	);
	const selectedModelContextWindow = selectedNKleinProviderModel?.contextWindow ?? null;

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
		if (activeAgentId !== "nklein") {
			return { ok: true };
		}
		if (!nkleinSettings.hasUnsavedChanges) {
			return { ok: true };
		}
		setNKleinSetupError(null);
		const saveResult = await nkleinSettings.saveProviderSettings();
		if (!saveResult.ok) {
			const message = saveResult.message ?? "Could not save !Klein provider settings.";
			setNKleinSetupError(message);
			return { ok: false, message };
		}
		const firstRunRoles = buildFirstRunLocalModelRoles({
			existingRoles: runtimeConfig?.modelRoles,
			providerId: nkleinSettings.providerId,
			modelId: nkleinSettings.modelId,
			baseUrl: nkleinSettings.baseUrl,
			reasoningEffort: nkleinSettings.reasoningEffort,
		});
		const trimmedContextWindow = nkleinContextWindowInput.trim();
		if (trimmedContextWindow) {
			const contextWindow = Number(trimmedContextWindow);
			if (!Number.isInteger(contextWindow) || contextWindow < RUNTIME_NKLEIN_MIN_CONTEXT_WINDOW_TOKENS) {
				const message = `Context window must be at least ${RUNTIME_NKLEIN_MIN_CONTEXT_WINDOW_TOKENS.toLocaleString()} tokens.`;
				setNKleinSetupError(message);
				return { ok: false, message };
			}
			try {
				await saveNKleinModelContextWindowOverride(workspaceId, {
					providerId: nkleinSettings.providerId,
					modelId: nkleinSettings.modelId,
					endpoint: nkleinSettings.baseUrl?.trim() || null,
					contextWindow,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setNKleinSetupError(message);
				return { ok: false, message };
			}
		}
		if (firstRunRoles) {
			try {
				await saveRuntimeConfig(workspaceId, { modelRoles: firstRunRoles });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setNKleinSetupError(message);
				return { ok: false, message };
			}
		}
		onNKleinSetupSaved?.();
		return { ok: true };
	}, [
		activeAgentId,
		nkleinContextWindowInput,
		nkleinSettings,
		onNKleinSetupSaved,
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

			{isMediaOnboardingSlide(currentSlide) && hasOnboardingMediaSource(currentSlide) ? (
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
								{agent.id === "nklein" ? (
									nkleinAuthenticated ? (
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
								{agent.id !== "nklein" && agent.installUrl ? (
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
							{agent.id === "nklein" ? (
								<div className="mt-2">
									<LocalModelSetupStatus
										providers={visibleNKleinProviderCatalog}
										models={nkleinSettings.providerModels}
										selectedProviderId={nkleinSettings.providerId}
										isLoadingModels={nkleinSettings.isLoadingProviderModels}
									/>
									<LocalEndpointStartGuide
										providers={visibleNKleinProviderCatalog}
										models={nkleinSettings.providerModels}
										selectedProviderId={nkleinSettings.providerId}
									/>
									<NKleinSetupSection
										controller={nkleinSettings}
										controlsDisabled={false}
										cloudProviderSupportEnabled={cloudProviderSupportEnabled}
										showMcpSettings={false}
										onError={setNKleinSetupError}
										onSaved={onNKleinSetupSaved}
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
												value={nkleinContextWindowInput}
												onChange={(event) => setNKleinContextWindowInput(event.target.value)}
												placeholder="64000"
												inputMode="numeric"
												className="h-8 min-w-0 rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary"
												aria-label="!Klein context window override"
											/>
										</div>
										<div className="mt-2 flex flex-wrap gap-1.5">
											{(["architect", "worker", "reviewer"] as const).map((roleId) => (
												<span
													key={roleId}
													className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-secondary"
												>
													{roleId}: {nkleinSettings.modelId || "select model"}
													{nkleinSettings.reasoningEffort ? ` · ${nkleinSettings.reasoningEffort}` : ""}
												</span>
											))}
										</div>
									</div>
									{nkleinSetupError ? (
										<div className="mt-2 rounded-md border border-status-red/30 bg-status-red/5 p-2 text-[12px] text-text-primary">
											{nkleinSetupError}
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
