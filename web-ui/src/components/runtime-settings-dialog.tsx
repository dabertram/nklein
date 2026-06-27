// Settings dialog composition for !Klein.
// Generic app settings live here, while NKlein-specific provider state and
// side effects should stay in use-runtime-settings-nklein-controller.ts.
import * as RadixCheckbox from "@radix-ui/react-checkbox";
import * as RadixPopover from "@radix-ui/react-popover";
import * as RadixSelect from "@radix-ui/react-select";
import * as RadixSwitch from "@radix-ui/react-switch";
import { getRuntimeAgentCatalogEntry, getRuntimeLaunchSupportedAgentCatalog } from "@runtime-agent-catalog";
import {
	AGENT_CAPABILITY_TIER_INFO,
	AGENT_DELIVERY_TIER_INFO,
	areRuntimeSwarmGuardrailsEqual,
	DEFAULT_AGENT_RULESETS_CONFIG,
	DEFAULT_RUNTIME_SWARM_GUARDRAILS,
} from "@runtime-contract";
import { areRuntimeProjectShortcutsEqual } from "@runtime-shortcuts";
import {
	BarChart3,
	Bell,
	Bot,
	Boxes,
	Check,
	ChevronDown,
	Circle,
	CircleDot,
	Clipboard,
	ExternalLink,
	FolderOpen,
	GitCommit,
	Palette,
	Play,
	Plus,
	RefreshCw,
	Search,
	Settings,
	ShieldCheck,
	SlidersHorizontal,
	Sparkles,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentRulesetsSettingsPanel } from "@/components/agent-rulesets-settings-panel";
import { showAppToast } from "@/components/app-toaster";
import {
	areCodeEmbeddingSettingsEqual,
	buildCodeEmbeddingSettings,
	CODE_EMBEDDING_PROVIDER_OPTIONS,
	EmbeddingEndpointFields,
	LOCAL_CODE_EMBEDDING_MODEL,
} from "@/components/code-embedding-fields";
import { ConcurrencyEditor, type ConcurrencyMap } from "@/components/concurrency-editor";
import {
	filterRegistryEntriesToLoadedModels,
	NKleinModelRegistryPanel,
} from "@/components/detail-panels/nklein-model-registry-panel";
import { KleinCorePyHealthLine } from "@/components/klein-core-py-health-line";
import { ModelPerformanceStatsDialog } from "@/components/model-performance-stats-dialog";
import { ModelRolesEditor } from "@/components/model-roles-editor";
import { buildDisplayedAgentCommand } from "@/components/runtime-settings-command-display";
import { type ParsedMcpSuggestion, parseMcpSuggestionText } from "@/components/runtime-settings-mcp-parsing";
import {
	MODEL_ROLE_IDS,
	MODEL_ROLE_LABELS,
	type ModelRoleId,
	normalizeModelRolesForSettings,
	serializeModelRoles,
} from "@/components/runtime-settings-model-roles";
import { findProviderCatalogItem, normalizeProviderId } from "@/components/runtime-settings-provider-helpers";
import {
	inputsToSwarmGuardrails,
	type SwarmGuardrailInputs,
	swarmGuardrailsToInputs,
} from "@/components/runtime-settings-swarm-guardrails";
import { AccountOrganizationSection } from "@/components/shared/account-organization-section";
import { NKleinSetupSection } from "@/components/shared/nklein-setup-section";
import {
	getRuntimeShortcutIconComponent,
	getRuntimeShortcutPickerOption,
	RUNTIME_SHORTCUT_ICON_OPTIONS,
	type RuntimeShortcutIconOption,
	type RuntimeShortcutPickerIconId,
} from "@/components/shared/runtime-shortcut-icons";
import { SwarmGuardrailsSettingsPanel } from "@/components/swarm-guardrails-settings-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { TASK_GIT_BASE_REF_PROMPT_VARIABLE, type TaskGitAction } from "@/git-actions/build-task-git-action-prompt";
import { useRuntimeSettingsNKleinController } from "@/hooks/use-runtime-settings-nklein-controller";
import {
	type UseRuntimeSettingsNKleinMcpControllerResult,
	useRuntimeSettingsNKleinMcpController,
} from "@/hooks/use-runtime-settings-nklein-mcp-controller";
import { previewThemeId, readStoredThemeId, saveThemeId, THEME_GROUPS, THEMES, type ThemeId } from "@/hooks/use-theme";
import { useLayoutCustomizations } from "@/resize/layout-customizations";
import { buildSuggestedCodeEmbeddingBaseUrl } from "@/runtime/code-embedding-endpoint";
import { isCloudProviderSupportEnabled } from "@/runtime/native-agent";
import {
	findNKleinProviderModel,
	formatModelOptionLabel,
	formatNKleinModelContextWindowLabel,
	getNKleinModelContextWindowWarning,
	isLmStudioProviderId,
} from "@/runtime/nklein-context-window-policy";
import {
	buildNKleinAdvisorRequest,
	fetchNKleinModelRegistry,
	fetchNKleinProviderModels,
	openFileOnHost,
	pruneNKleinModelRegistry,
	removeNKleinModelRegistryEntry,
	runNKleinSmokeEval,
	saveNKleinModelContextWindowOverride,
	saveNKleinModelMaxConcurrentRequests,
	sendNKleinAdvisorRequest,
	writeNKleinDogfoodBacklog,
} from "@/runtime/runtime-config-query";
import type {
	AgentRulesetsConfigPayload,
	RuntimeAgentId,
	RuntimeCodeEmbeddingSettings,
	RuntimeConfigResponse,
	RuntimeLostHeartbeatPolicy,
	RuntimeModelRoles,
	RuntimeNKleinAdvisorKind,
	RuntimeNKleinAdvisorRequest,
	RuntimeNKleinAdvisorSendResponse,
	RuntimeNKleinDogfoodBacklogResponse,
	RuntimeNKleinMcpServerAuthStatus,
	RuntimeNKleinModelRegistryEntry,
	RuntimeNKleinProviderModel,
	RuntimeNKleinSmokeEvalResponse,
	RuntimeProjectShortcut,
	RuntimeTaskAutoReviewMode,
} from "@/runtime/types";
import { useRuntimeConfig } from "@/runtime/use-runtime-config";
import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";
import {
	type BrowserNotificationPermission,
	getBrowserNotificationPermission,
	requestBrowserNotificationPermission,
} from "@/utils/notification-permission";
import { formatPathForDisplay } from "@/utils/path-display";
import { useUnmount, useWindowEvent } from "@/utils/react-use";

interface RuntimeSettingsAgentRowModel {
	id: RuntimeAgentId;
	label: string;
	binary: string;
	command: string;
	installed: boolean | null;
}

function normalizeTemplateForComparison(value: string): string {
	return value.replaceAll("\r\n", "\n").trim();
}

const GIT_PROMPT_VARIANT_OPTIONS: Array<{ value: TaskGitAction; label: string }> = [
	{ value: "commit", label: "Commit" },
	{ value: "pr", label: "Make PR" },
];

export type RuntimeSettingsSection = "shortcuts";

const SETTINGS_AGENT_ORDER: readonly RuntimeAgentId[] = ["nklein", "claude", "codex", "droid", "kiro"];

const ADVANCED_POLICY_ROWS = [
	{
		label: "Routing policy",
		value: "Local model fit",
		detail: "Uses model roles, local-only provider checks, context-window feasibility, and endpoint admission.",
		raw: "modelRoles, selectedAgentId, maxConcurrentTasks",
	},
	{
		label: "Context budget policy",
		value: "Effective context window",
		detail: "Budgets include prompt, history, retained files, tool schemas, overhead, and reserved output.",
		raw: "contextBudgetBreakdown",
	},
	{
		label: "Acceptance gate",
		value: "Task prompt command",
		detail: "Runs the card's Acceptance check line and records verification_failed or plan_gap diagnostics.",
		raw: "Acceptance check: <command>",
	},
	{
		label: "Telemetry",
		value: "Local JSONL",
		detail: "Task diagnostics read recent local telemetry events; no LLM is used for the diagnostics drawer.",
		raw: ".nklein/nklein/telemetry, limit 20",
	},
] as const;

function normalizeAgentTimeoutProfile(
	value: "cloud" | "local" | "custom" | null | undefined,
	cloudProviderSupportEnabled: boolean,
): "cloud" | "local" | "custom" {
	if (value === "custom") {
		return "custom";
	}
	if (value === "cloud") {
		return cloudProviderSupportEnabled ? "cloud" : "local";
	}
	return "local";
}

type SettingsNavId =
	| "general"
	| "agents"
	| "tasks"
	| "nklein"
	| "git-prompts"
	| "notifications"
	| "appearance"
	| "project";

const SETTINGS_NAV_ITEMS: ReadonlyArray<{
	id: SettingsNavId;
	label: string;
	icon: React.ReactNode;
	nkleinOnly?: boolean;
}> = [
	{ id: "general", label: "General", icon: <SlidersHorizontal size={16} /> },
	{ id: "agents", label: "Agents", icon: <Boxes size={16} /> },
	{ id: "tasks", label: "Tasks", icon: <Check size={16} /> },
	{ id: "nklein", label: "!Klein", icon: <Bot size={16} />, nkleinOnly: true },
	{ id: "git-prompts", label: "Git Prompts", icon: <GitCommit size={16} /> },
	{ id: "notifications", label: "Notifications", icon: <Bell size={16} /> },
	{ id: "appearance", label: "Appearance", icon: <Palette size={16} /> },
	{ id: "project", label: "Project", icon: <FolderOpen size={16} /> },
];

const TASK_AUTO_REVIEW_MODE_OPTIONS: Array<{ value: RuntimeTaskAutoReviewMode; label: string }> = [
	{ value: "commit", label: "Commit" },
	{ value: "pr", label: "Open PR" },
];

function readBooleanTaskDefault(key: LocalStorageKey, fallback: boolean): boolean {
	const stored = readLocalStorageItem(key);
	if (stored === "true") {
		return true;
	}
	if (stored === "false") {
		return false;
	}
	return fallback;
}

function readTaskAutoReviewModeDefault(): RuntimeTaskAutoReviewMode {
	const stored = readLocalStorageItem(LocalStorageKey.TaskAutoReviewMode);
	return stored === "pr" ? "pr" : "commit";
}

function getShortcutIconOption(icon: string | undefined): RuntimeShortcutIconOption {
	return getRuntimeShortcutPickerOption(icon);
}

function ShortcutIconComponent({ icon, size = 14 }: { icon: string | undefined; size?: number }): React.ReactElement {
	const Component = getRuntimeShortcutIconComponent(icon);
	return <Component size={size} />;
}

function formatNotificationPermissionStatus(permission: BrowserNotificationPermission): string {
	if (permission === "default") {
		return "not requested yet";
	}
	return permission;
}

function getNextShortcutLabel(shortcuts: RuntimeProjectShortcut[], baseLabel: string): string {
	const normalizedTakenLabels = new Set(
		shortcuts.map((shortcut) => shortcut.label.trim().toLowerCase()).filter((label) => label.length > 0),
	);
	const normalizedBaseLabel = baseLabel.trim().toLowerCase();
	if (!normalizedTakenLabels.has(normalizedBaseLabel)) {
		return baseLabel;
	}

	let suffix = 2;
	while (normalizedTakenLabels.has(`${normalizedBaseLabel} ${suffix}`)) {
		suffix += 1;
	}
	return `${baseLabel} ${suffix}`;
}

function AgentRow({
	agent,
	isSelected,
	onSelect,
	disabled,
}: {
	agent: RuntimeSettingsAgentRowModel;
	isSelected: boolean;
	onSelect: () => void;
	disabled: boolean;
}): React.ReactElement {
	const installUrl = getRuntimeAgentCatalogEntry(agent.id)?.installUrl;
	const isNativeNKlein = agent.id === "nklein";
	const isInstalled = agent.installed === true;
	const isInstallStatusPending = !isNativeNKlein && agent.installed === null;

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={() => {
				if (isInstalled && !disabled) {
					onSelect();
				}
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter" && isInstalled && !disabled) {
					onSelect();
				}
			}}
			className="flex items-center justify-between gap-3 py-1.5"
			style={{ cursor: isInstalled ? "pointer" : "default" }}
		>
			<div className="flex items-start gap-2 min-w-0">
				{isSelected ? (
					<CircleDot size={16} className="text-accent mt-0.5 shrink-0" />
				) : (
					<Circle
						size={16}
						className={cn("mt-0.5 shrink-0", !isInstalled ? "text-text-tertiary" : "text-text-secondary")}
					/>
				)}
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-[13px] text-text-primary">{agent.label}</span>
						{!isNativeNKlein && isInstalled ? (
							<span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-status-green/10 text-status-green">
								Installed
							</span>
						) : isInstallStatusPending ? (
							<span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-surface-3 text-text-secondary">
								Checking...
							</span>
						) : null}
					</div>
					{agent.command ? (
						<p className="text-text-secondary font-mono text-xs mt-0.5 m-0">{agent.command}</p>
					) : null}
				</div>
			</div>
			{!isNativeNKlein && agent.installed === false && installUrl ? (
				<a
					href={installUrl}
					target="_blank"
					rel="noreferrer"
					onClick={(event: React.MouseEvent) => event.stopPropagation()}
					className="inline-flex items-center justify-center rounded-md font-medium duration-150 cursor-default select-none h-7 px-2 text-xs bg-surface-2 border border-border text-text-primary hover:bg-surface-3 hover:border-border-bright"
				>
					Install
				</a>
			) : !isNativeNKlein && agent.installed === false ? (
				<Button size="sm" disabled>
					Install
				</Button>
			) : null}
		</div>
	);
}

function InlineUtilityButton({
	text,
	onClick,
	disabled,
	monospace,
	widthCh,
}: {
	text: string;
	onClick: () => void;
	disabled?: boolean;
	monospace?: boolean;
	widthCh?: number;
}): React.ReactElement {
	return (
		<Button
			size="sm"
			disabled={disabled}
			onClick={onClick}
			className={cn(monospace && "font-mono")}
			style={{
				fontSize: 10,
				verticalAlign: "middle",
				...(typeof widthCh === "number"
					? {
							width: `${widthCh}ch`,
							justifyContent: "center",
						}
					: {}),
			}}
		>
			{text}
		</Button>
	);
}

function ShortcutIconPicker({
	value,
	onSelect,
}: {
	value: string | undefined;
	onSelect: (icon: RuntimeShortcutPickerIconId) => void;
}): React.ReactElement {
	const [open, setOpen] = useState(false);
	const selectedOption = getShortcutIconOption(value);

	return (
		<RadixPopover.Root open={open} onOpenChange={setOpen}>
			<RadixPopover.Trigger asChild>
				<button
					type="button"
					aria-label={`Shortcut icon: ${selectedOption.label}`}
					className="inline-flex items-center gap-1 h-7 px-1.5 rounded-md border border-border bg-surface-2 text-text-primary hover:bg-surface-3"
				>
					<ShortcutIconComponent icon={value} size={14} />
					<ChevronDown size={12} />
				</button>
			</RadixPopover.Trigger>
			<RadixPopover.Portal>
				<RadixPopover.Content
					side="bottom"
					align="start"
					sideOffset={4}
					className="z-50 rounded-md border border-border bg-surface-2 p-1 shadow-lg"
					style={{ animation: "kb-tooltip-show 100ms ease" }}
				>
					<div className="flex gap-0.5">
						{RUNTIME_SHORTCUT_ICON_OPTIONS.map((option) => {
							const IconComponent = getRuntimeShortcutIconComponent(option.value);
							return (
								<button
									key={option.value}
									type="button"
									aria-label={option.label}
									className={cn(
										"p-1.5 rounded hover:bg-surface-3",
										selectedOption.value === option.value && "bg-surface-3",
									)}
									onClick={() => {
										onSelect(option.value);
										setOpen(false);
									}}
								>
									<IconComponent size={14} />
								</button>
							);
						})}
					</div>
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}

function SettingsNav({
	items,
	activeId,
	onSelect,
}: {
	items: ReadonlyArray<{ id: SettingsNavId; label: string; icon: React.ReactNode }>;
	activeId: SettingsNavId;
	onSelect: (id: SettingsNavId) => void;
}): React.ReactElement {
	return (
		<nav className="hidden md:flex w-[180px] shrink-0 flex-col gap-0.5 border-r border-border bg-surface-1 p-3 overflow-y-auto">
			{items.map((item) => (
				<button
					key={item.id}
					type="button"
					onClick={() => onSelect(item.id)}
					className={cn(
						"flex items-center gap-2.5 text-left px-3 py-2 rounded-md text-[13px] font-medium cursor-pointer",
						activeId === item.id
							? "bg-surface-3 text-text-primary"
							: "text-text-secondary hover:text-text-primary hover:bg-surface-2",
					)}
				>
					<span className="shrink-0 opacity-80">{item.icon}</span>
					<span>{item.label}</span>
				</button>
			))}
		</nav>
	);
}

const NKLEIN_ADVISOR_ACTIONS: ReadonlyArray<{
	kind: RuntimeNKleinAdvisorKind;
	label: string;
	icon: React.ReactNode;
}> = [
	{ kind: "model_freshness", label: "Check models", icon: <Sparkles size={14} /> },
	{ kind: "mcp_discovery", label: "Find MCP plugins", icon: <Search size={14} /> },
	{ kind: "config_explainer", label: "Explain config", icon: <SlidersHorizontal size={14} /> },
	{ kind: "log_analysis", label: "Analyze logs", icon: <Clipboard size={14} /> },
];

function NKleinAdvisorActions({
	workspaceId,
	disabled,
	mcpController,
	runtimeConfigSummary,
	advisorProviderId,
	advisorModelId,
	onError,
}: {
	workspaceId: string | null;
	disabled: boolean;
	mcpController: UseRuntimeSettingsNKleinMcpControllerResult;
	runtimeConfigSummary: string;
	advisorProviderId: string;
	advisorModelId: string;
	onError: (message: string | null) => void;
}): React.ReactElement {
	const [activeKind, setActiveKind] = useState<RuntimeNKleinAdvisorKind | null>(null);
	const [advisorRequest, setAdvisorRequest] = useState<RuntimeNKleinAdvisorRequest | null>(null);
	const [advisorModels, setAdvisorModels] = useState<RuntimeNKleinProviderModel[]>([]);
	const [selectedAdvisorModelId, setSelectedAdvisorModelId] = useState("");
	const [isLoadingAdvisorModels, setIsLoadingAdvisorModels] = useState(false);
	const [isSendingAdvisor, setIsSendingAdvisor] = useState(false);
	const [advisorResponse, setAdvisorResponse] = useState<RuntimeNKleinAdvisorSendResponse | null>(null);
	const [advisorSendError, setAdvisorSendError] = useState<string | null>(null);
	const [mcpSuggestionText, setMcpSuggestionText] = useState("");
	const [parsedMcpSuggestions, setParsedMcpSuggestions] = useState<ParsedMcpSuggestion[]>([]);
	const [addingMcpServerName, setAddingMcpServerName] = useState<string | null>(null);
	const [copyButtonText, setCopyButtonText] = useState("Copy prompt");
	const copyResetTimerRef = useRef<number | null>(null);
	const configuredAdvisorProviderId = advisorProviderId.trim();
	const configuredAdvisorModelId = advisorModelId.trim();

	useUnmount(() => {
		if (copyResetTimerRef.current !== null) {
			window.clearTimeout(copyResetTimerRef.current);
		}
	});

	useEffect(() => {
		let cancelled = false;
		setAdvisorModels([]);
		setSelectedAdvisorModelId(configuredAdvisorModelId);
		if (!workspaceId || !configuredAdvisorProviderId) {
			return;
		}
		setIsLoadingAdvisorModels(true);
		void fetchNKleinProviderModels(workspaceId, configuredAdvisorProviderId)
			.then((models) => {
				if (cancelled) {
					return;
				}
				setAdvisorModels(models);
				const configuredModelExists = models.some((model) => model.id === configuredAdvisorModelId);
				setSelectedAdvisorModelId(
					configuredModelExists ? configuredAdvisorModelId : (models[0]?.id ?? configuredAdvisorModelId),
				);
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					const message = error instanceof Error ? error.message : String(error);
					onError(`Could not load advisor models: ${message}`);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingAdvisorModels(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [configuredAdvisorProviderId, configuredAdvisorModelId, onError, workspaceId]);

	const handleBuildAdvisor = useCallback(
		(kind: RuntimeNKleinAdvisorKind) => {
			onError(null);
			setActiveKind(kind);
			void buildNKleinAdvisorRequest(workspaceId, {
				kind,
				...(kind === "config_explainer" ? { runtimeConfigSummary } : {}),
			})
				.then((request) => {
					setAdvisorRequest(request);
					setAdvisorResponse(null);
					setAdvisorSendError(null);
					if (kind !== "mcp_discovery") {
						setMcpSuggestionText("");
						setParsedMcpSuggestions([]);
					}
				})
				.catch((error) => {
					const message = error instanceof Error ? error.message : String(error);
					onError(`Could not build advisor prompt: ${message}`);
				})
				.finally(() => {
					setActiveKind(null);
				});
		},
		[onError, runtimeConfigSummary, workspaceId],
	);

	const handleParseMcpSuggestions = useCallback(() => {
		onError(null);
		try {
			const suggestions = parseMcpSuggestionText(mcpSuggestionText);
			setParsedMcpSuggestions(suggestions);
			if (suggestions.length === 0) {
				onError("No addable HTTPS MCP servers found in the pasted advisor JSON.");
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setParsedMcpSuggestions([]);
			onError(`Could not parse MCP suggestion JSON: ${message}`);
		}
	}, [mcpSuggestionText, onError]);

	const handleAddMcpSuggestion = useCallback(
		(suggestion: ParsedMcpSuggestion) => {
			onError(null);
			setAddingMcpServerName(suggestion.server.name);
			void mcpController
				.addMcpServer(suggestion.server)
				.then((result) => {
					if (!result.ok) {
						onError(result.message ?? `Could not add MCP server "${suggestion.server.name}".`);
					}
				})
				.catch((error) => {
					const message = error instanceof Error ? error.message : String(error);
					onError(`Could not add MCP server "${suggestion.server.name}": ${message}`);
				})
				.finally(() => {
					setAddingMcpServerName(null);
				});
		},
		[mcpController, onError],
	);

	const handleCopyPrompt = useCallback(() => {
		if (!advisorRequest) {
			return;
		}
		void navigator.clipboard
			.writeText(advisorRequest.prompt)
			.then(() => {
				setCopyButtonText("Copied");
				if (copyResetTimerRef.current !== null) {
					window.clearTimeout(copyResetTimerRef.current);
				}
				copyResetTimerRef.current = window.setTimeout(() => {
					setCopyButtonText("Copy prompt");
					copyResetTimerRef.current = null;
				}, 1800);
			})
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				onError(`Could not copy advisor prompt: ${message}`);
			});
	}, [advisorRequest, onError]);

	const handleSendAdvisor = useCallback(() => {
		if (!advisorRequest) {
			return;
		}
		const modelId = selectedAdvisorModelId.trim();
		if (!configuredAdvisorProviderId || !modelId) {
			setAdvisorSendError("Choose a local !Klein model before sending the advisor prompt.");
			return;
		}
		setIsSendingAdvisor(true);
		setAdvisorSendError(null);
		setAdvisorResponse(null);
		void sendNKleinAdvisorRequest(workspaceId, {
			prompt: advisorRequest.prompt,
			providerId: configuredAdvisorProviderId,
			modelId,
		})
			.then((response) => {
				setAdvisorResponse(response);
			})
			.catch((error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				setAdvisorSendError(message);
			})
			.finally(() => {
				setIsSendingAdvisor(false);
			});
	}, [configuredAdvisorProviderId, advisorRequest, selectedAdvisorModelId, workspaceId]);

	return (
		<div className="mt-4 border-t border-border pt-4">
			<div className="flex items-center justify-between gap-3 mb-2">
				<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0">Advisor</h6>
				<div className="flex flex-wrap items-center justify-end gap-2">
					{NKLEIN_ADVISOR_ACTIONS.map((action) => (
						<Button
							key={action.kind}
							size="sm"
							variant="default"
							icon={action.icon}
							disabled={disabled || activeKind !== null}
							onClick={() => handleBuildAdvisor(action.kind)}
						>
							{activeKind === action.kind ? "Building..." : action.label}
						</Button>
					))}
				</div>
			</div>
			{advisorRequest ? (
				<div className="rounded-md border border-border bg-surface-2 p-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="min-w-0">
							<p className="text-[13px] font-medium text-text-primary m-0">{advisorRequest.title}</p>
							<p className="text-[12px] text-text-secondary mt-0.5 mb-0">
								{advisorRequest.requiresWebResearch ? "Uses web research sources" : "Uses local context only"}
							</p>
						</div>
						<div className="flex flex-wrap items-center justify-end gap-2">
							<NativeSelect
								value={selectedAdvisorModelId}
								onChange={(event) => setSelectedAdvisorModelId(event.target.value)}
								disabled={
									disabled || isLoadingAdvisorModels || isSendingAdvisor || !configuredAdvisorProviderId
								}
							>
								{selectedAdvisorModelId &&
								!advisorModels.some((model) => model.id === selectedAdvisorModelId) ? (
									<option value={selectedAdvisorModelId}>{selectedAdvisorModelId}</option>
								) : null}
								{advisorModels.map((model) => (
									<option key={model.id} value={model.id}>
										{formatModelOptionLabel(model)}
									</option>
								))}
							</NativeSelect>
							<Button
								size="sm"
								variant="primary"
								icon={isSendingAdvisor ? <Spinner size={14} /> : <Sparkles size={14} />}
								disabled={
									disabled ||
									isSendingAdvisor ||
									isLoadingAdvisorModels ||
									!configuredAdvisorProviderId ||
									!selectedAdvisorModelId
								}
								onClick={handleSendAdvisor}
							>
								{isSendingAdvisor ? "Sending" : "Send prompt"}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								icon={<Clipboard size={14} />}
								disabled={disabled}
								onClick={handleCopyPrompt}
							>
								{copyButtonText}
							</Button>
						</div>
					</div>
					<textarea
						readOnly
						value={advisorRequest.prompt}
						rows={8}
						className="mt-3 w-full resize-none rounded-md border border-border bg-surface-1 p-3 font-mono text-[12px] text-text-primary focus:outline-none"
					/>
					{advisorResponse || advisorSendError ? (
						<div className="mt-3 rounded-md border border-border bg-surface-1 p-3">
							<div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
								<span>
									{advisorResponse
										? `${advisorResponse.providerId} / ${advisorResponse.modelId}`
										: "Advisor send failed"}
								</span>
								{advisorResponse ? (
									<span>
										Sent {new Date(advisorResponse.sentAt).toLocaleTimeString()} · Received{" "}
										{new Date(advisorResponse.receivedAt).toLocaleTimeString()}
									</span>
								) : null}
							</div>
							<textarea
								readOnly
								value={advisorResponse?.output ?? advisorSendError ?? ""}
								rows={8}
								className={cn(
									"w-full resize-none rounded-md border bg-surface-2 p-3 text-[12px] text-text-primary focus:outline-none",
									advisorSendError ? "border-status-red/50" : "border-border",
								)}
							/>
						</div>
					) : null}
					{advisorRequest.recommendedSources.length > 0 ? (
						<div className="mt-3 flex flex-wrap gap-2">
							{advisorRequest.recommendedSources.map((source) => (
								<a
									key={source}
									href={source}
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-1 px-2 py-1 text-[12px] text-text-secondary hover:text-text-primary hover:border-border-bright"
								>
									<span>{new URL(source).hostname}</span>
									<ExternalLink size={12} />
								</a>
							))}
						</div>
					) : null}
					{advisorRequest.kind === "mcp_discovery" ? (
						<div className="mt-3 border-t border-border pt-3">
							<textarea
								value={mcpSuggestionText}
								onChange={(event) => setMcpSuggestionText(event.target.value)}
								rows={4}
								disabled={disabled || mcpController.isSavingMcpSettings}
								placeholder='Paste advisor JSON: {"mcpServers":[{"name":"linear","type":"streamableHttp","url":"https://mcp.linear.app/mcp"}]}'
								className="w-full resize-none rounded-md border border-border bg-surface-1 p-3 font-mono text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
							/>
							<div className="mt-2 flex items-center justify-between gap-3">
								<p className="text-[12px] text-text-secondary m-0">HTTPS MCP suggestions only</p>
								<Button
									size="sm"
									variant="default"
									icon={<Search size={14} />}
									disabled={
										disabled || mcpController.isSavingMcpSettings || mcpSuggestionText.trim().length === 0
									}
									onClick={handleParseMcpSuggestions}
								>
									Find addable servers
								</Button>
							</div>
							{parsedMcpSuggestions.length > 0 ? (
								<div className="mt-2 grid gap-2">
									{parsedMcpSuggestions.map((suggestion) => (
										<div
											key={suggestion.server.name}
											className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-1 px-3 py-2"
										>
											<div className="min-w-0">
												<p className="text-[13px] font-medium text-text-primary m-0">{suggestion.label}</p>
												<p className="text-[12px] text-text-secondary m-0 break-all">
													{suggestion.server.name} ·{" "}
													{suggestion.server.type === "stdio"
														? suggestion.server.command
														: suggestion.server.url}
												</p>
											</div>
											<Button
												size="sm"
												variant="primary"
												icon={<Plus size={14} />}
												disabled={
													disabled || addingMcpServerName !== null || mcpController.isSavingMcpSettings
												}
												onClick={() => handleAddMcpSuggestion(suggestion)}
											>
												{addingMcpServerName === suggestion.server.name ? "Adding..." : "Add"}
											</Button>
										</div>
									))}
								</div>
							) : null}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function NKleinDogfoodSuggestion({
	workspaceId,
	disabled,
	onError,
}: {
	workspaceId: string | null;
	disabled: boolean;
	onError: (message: string | null) => void;
}): React.ReactElement {
	const [suggestion, setSuggestion] = useState("");
	const [isWriting, setIsWriting] = useState(false);
	const [result, setResult] = useState<RuntimeNKleinDogfoodBacklogResponse | null>(null);

	const handleWriteBacklog = useCallback(() => {
		const trimmed = suggestion.trim();
		onError(null);
		setIsWriting(true);
		void writeNKleinDogfoodBacklog(workspaceId, trimmed ? { suggestion: trimmed } : {})
			.then((response) => {
				setResult(response);
			})
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				onError(`Could not write self-improvement backlog: ${message}`);
			})
			.finally(() => {
				setIsWriting(false);
			});
	}, [onError, suggestion, workspaceId]);

	const handleOpenPlan = useCallback(() => {
		if (!result) {
			return;
		}
		void openFileOnHost(workspaceId, result.planPath).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			onError(`Could not open self-improvement plan: ${message}`);
		});
	}, [onError, result, workspaceId]);

	return (
		<div className="mt-4 border-t border-border pt-4">
			<div className="flex items-center justify-between gap-3 mb-2">
				<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0">
					Self-improvement
				</h6>
				<Button
					size="sm"
					variant="default"
					icon={<Plus size={14} />}
					disabled={disabled || isWriting}
					onClick={handleWriteBacklog}
				>
					{isWriting ? "Writing..." : "Suggest improvement"}
				</Button>
			</div>
			<textarea
				value={suggestion}
				onChange={(event) => setSuggestion(event.target.value)}
				rows={3}
				disabled={disabled || isWriting}
				placeholder="Describe a !Klein improvement to turn into guarded dogfood tasks."
				className="w-full resize-none rounded-md border border-border bg-surface-2 p-3 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
			/>
			{result ? (
				<div className="mt-3 rounded-md border border-border bg-surface-2 p-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="min-w-0">
							<p className="text-[13px] font-medium text-text-primary m-0">
								{result.taskCount} task{result.taskCount === 1 ? "" : "s"} drafted
							</p>
							<p className="text-[12px] text-text-secondary mt-0.5 mb-0 font-mono break-all">
								{result.taskGraphPath}
							</p>
						</div>
						<Button
							size="sm"
							variant="ghost"
							icon={<ExternalLink size={14} />}
							disabled={disabled}
							onClick={handleOpenPlan}
						>
							Open plan
						</Button>
					</div>
					<p className="text-[12px] text-text-secondary mt-3 mb-1">Next</p>
					<code className="block rounded-md border border-border bg-surface-1 px-2 py-1.5 text-[12px] text-text-primary break-all">
						{result.nextCommand}
					</code>
				</div>
			) : null}
		</div>
	);
}

function NKleinModelContextWindowSettingsPanel({
	workspaceId,
	open,
	disabled,
	selectedProviderId,
	selectedModelId,
	selectedProviderModels,
	onRefreshProviderModels,
	onError,
}: {
	workspaceId: string | null;
	open: boolean;
	disabled: boolean;
	selectedProviderId: string;
	selectedModelId: string;
	selectedProviderModels: RuntimeNKleinProviderModel[];
	onRefreshProviderModels: () => Promise<void>;
	onError: (message: string | null) => void;
}): React.ReactElement {
	const [isLoading, setIsLoading] = useState(false);
	const [registryEntries, setRegistryEntries] = useState<RuntimeNKleinModelRegistryEntry[]>([]);
	const [nowMs, setNowMs] = useState(() => Date.now());
	const visibleRegistryEntries = useMemo(
		() => filterRegistryEntriesToLoadedModels(registryEntries, selectedProviderId, selectedProviderModels),
		[registryEntries, selectedProviderId, selectedProviderModels],
	);
	const selectedLoadedProviderModel = useMemo(
		() => findNKleinProviderModel(selectedProviderModels, selectedModelId),
		[selectedModelId, selectedProviderModels],
	);

	const refreshRegistry = useCallback(async () => {
		if (!open) {
			return;
		}
		onError(null);
		setIsLoading(true);
		try {
			await onRefreshProviderModels();
			const response = await fetchNKleinModelRegistry(workspaceId);
			setRegistryEntries(response.models);
			setNowMs(Date.now());
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			onError(`Could not load model telemetry: ${message}`);
		} finally {
			setIsLoading(false);
		}
	}, [onError, onRefreshProviderModels, open, workspaceId]);

	useEffect(() => {
		void refreshRegistry();
	}, [refreshRegistry]);

	const saveOverride = useCallback(
		async (entry: RuntimeNKleinModelRegistryEntry, contextWindow: number | null) => {
			if (disabled) {
				return;
			}
			await saveNKleinModelContextWindowOverride(workspaceId, {
				providerId: entry.providerId,
				modelId: entry.modelId,
				endpoint: entry.endpoint,
				contextWindow,
			});
			await refreshRegistry();
		},
		[disabled, refreshRegistry, workspaceId],
	);

	const saveMaxConcurrentRequests = useCallback(
		async (entry: RuntimeNKleinModelRegistryEntry, maxConcurrentRequests: number | null) => {
			if (disabled) {
				return;
			}
			await saveNKleinModelMaxConcurrentRequests(workspaceId, {
				providerId: entry.providerId,
				modelId: entry.modelId,
				endpoint: entry.endpoint,
				maxConcurrentRequests,
			});
			await refreshRegistry();
		},
		[disabled, refreshRegistry, workspaceId],
	);

	const removeEntry = useCallback(
		async (entry: RuntimeNKleinModelRegistryEntry) => {
			if (disabled) {
				return;
			}
			const response = await removeNKleinModelRegistryEntry(workspaceId, { key: entry.key });
			await refreshRegistry();
			showAppToast({
				intent: response.removed ? "success" : "none",
				message: response.removed
					? `Removed model telemetry for ${entry.providerId}/${entry.modelId}.`
					: `Model telemetry for ${entry.providerId}/${entry.modelId} was already gone.`,
			});
		},
		[disabled, refreshRegistry, workspaceId],
	);

	const pruneStale = useCallback(async () => {
		if (disabled) {
			return;
		}
		const response = await pruneNKleinModelRegistry(workspaceId);
		await refreshRegistry();
		showAppToast({
			intent: "success",
			message: response.removed === 1 ? "Removed 1 stale model." : `Removed ${response.removed} stale models.`,
		});
	}, [disabled, refreshRegistry, workspaceId]);

	return (
		<div className="mt-4 border-t border-border pt-4">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<h6 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0">
						<SlidersHorizontal size={14} />
						Model context windows
					</h6>
					<p className="text-[12px] text-text-secondary mt-1 mb-0">
						{visibleRegistryEntries.length > 0
							? `${visibleRegistryEntries.length} local model${visibleRegistryEntries.length === 1 ? "" : "s"} tracked`
							: "No local model telemetry loaded"}
					</p>
					{selectedLoadedProviderModel ? (
						<p className="text-[12px] text-text-secondary mt-1 mb-0">
							Selected loaded model (live): {formatNKleinModelContextWindowLabel(selectedLoadedProviderModel)}
						</p>
					) : (
						<p className="text-[12px] text-text-tertiary mt-1 mb-0">
							Selected model is not currently loaded in LM Studio.
						</p>
					)}
				</div>
				<Button
					size="sm"
					variant="default"
					icon={<RefreshCw size={14} />}
					disabled={disabled || isLoading}
					onClick={() => {
						void refreshRegistry();
					}}
				>
					{isLoading ? "Refreshing..." : "Refresh"}
				</Button>
			</div>
			<NKleinModelRegistryPanel
				entries={visibleRegistryEntries}
				selectedProviderId={selectedProviderId}
				selectedModelId={selectedModelId}
				nowMs={nowMs}
				isLoading={isLoading}
				onContextWindowOverrideSave={disabled ? undefined : saveOverride}
				onMaxConcurrentRequestsSave={disabled ? undefined : saveMaxConcurrentRequests}
				onRemoveEntry={disabled ? undefined : removeEntry}
				onPruneStale={disabled ? undefined : pruneStale}
			/>
			<KleinCorePyHealthLine workspaceId={workspaceId} />
		</div>
	);
}

function NKleinSmokeEvalTrial({
	workspaceId,
	disabled,
	onError,
}: {
	workspaceId: string | null;
	disabled: boolean;
	onError: (message: string | null) => void;
}): React.ReactElement {
	const [isRunning, setIsRunning] = useState(false);
	const [result, setResult] = useState<RuntimeNKleinSmokeEvalResponse | null>(null);

	const handleRunEval = useCallback(() => {
		onError(null);
		setIsRunning(true);
		void runNKleinSmokeEval(workspaceId)
			.then((response) => {
				setResult(response);
			})
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				onError(`Could not run !Klein smoke eval: ${message}`);
			})
			.finally(() => {
				setIsRunning(false);
			});
	}, [onError, workspaceId]);

	const handleOpenEvidence = useCallback(() => {
		if (!result) {
			return;
		}
		void openFileOnHost(workspaceId, result.evidenceBundlePath).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			onError(`Could not open smoke eval evidence: ${message}`);
		});
	}, [onError, result, workspaceId]);

	return (
		<div className="mt-3">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0">
						Eval harness
					</h6>
					{result ? (
						<p className="text-[12px] text-text-secondary mt-1 mb-0">
							{result.providerId}:{result.modelId} {result.passed ? "passed" : "failed"}{" "}
							{result.acceptanceCommand}
						</p>
					) : null}
				</div>
				<div className="flex items-center gap-2">
					{result ? (
						<Button
							size="sm"
							variant="ghost"
							icon={<ExternalLink size={14} />}
							disabled={disabled}
							onClick={handleOpenEvidence}
						>
							Evidence
						</Button>
					) : null}
					<Button
						size="sm"
						variant="default"
						icon={<Play size={14} />}
						disabled={disabled || isRunning}
						onClick={handleRunEval}
					>
						{isRunning ? "Running..." : "Run smoke eval"}
					</Button>
				</div>
			</div>
			{result ? (
				<p className="mt-2 mb-0 break-all font-mono text-[12px] text-text-secondary">{result.evidenceBundlePath}</p>
			) : null}
		</div>
	);
}

function OverrideRow({
	label,
	inheritLabel,
	isOverridden,
	onOverride,
	onRevert,
	disabled,
	children,
}: {
	label: string;
	inheritLabel: string;
	isOverridden: boolean;
	onOverride: () => void;
	onRevert: () => void;
	disabled: boolean;
	children: React.ReactNode;
}): React.ReactElement {
	return (
		<div className="grid gap-1">
			<div className="flex items-center justify-between gap-2">
				<span className="text-[13px] text-text-primary">{label}</span>
				{isOverridden ? (
					<Button size="sm" variant="ghost" onClick={onRevert} disabled={disabled}>
						Revert to global
					</Button>
				) : (
					<Button size="sm" variant="default" onClick={onOverride} disabled={disabled}>
						Override for this project
					</Button>
				)}
			</div>
			{isOverridden ? (
				children
			) : (
				<p className="text-[12px] text-text-secondary m-0">Inherits global: {inheritLabel}</p>
			)}
		</div>
	);
}

export function RuntimeSettingsDialog({
	open,
	workspaceId,
	initialConfig = null,
	liveMcpAuthStatuses = null,
	onOpenChange,
	onSaved,
	onAccountSwitched,
	initialSection,
}: {
	open: boolean;
	workspaceId: string | null;
	initialConfig?: RuntimeConfigResponse | null;
	liveMcpAuthStatuses?: RuntimeNKleinMcpServerAuthStatus[] | null;
	onOpenChange: (open: boolean) => void;
	onSaved?: () => void;
	onAccountSwitched?: () => void;
	initialSection?: RuntimeSettingsSection | null;
}): React.ReactElement {
	const { config, isLoading, isSaving, save, refresh } = useRuntimeConfig(open, workspaceId, initialConfig);
	const { resetLayoutCustomizations } = useLayoutCustomizations();
	const [selectedAgentId, setSelectedAgentId] = useState<RuntimeAgentId>("nklein");
	const [agentAutonomousModeEnabled, setAgentAutonomousModeEnabled] = useState(true);
	const [agentTimeoutMode, setAgentTimeoutMode] = useState<"normal" | "long" | "extended" | "unlimited">("normal");
	const [agentTimeoutProfile, setAgentTimeoutProfile] = useState<"cloud" | "local" | "custom">("local");
	const [requestTimeoutMs, setRequestTimeoutMs] = useState("");
	const [streamTimeoutMs, setStreamTimeoutMs] = useState("");
	const [toolTimeoutMs, setToolTimeoutMs] = useState("");
	const [agentTimeoutMs, setAgentTimeoutMs] = useState("");
	const [conversationTimeoutMs, setConversationTimeoutMs] = useState("");
	const [maxAgentWritableFileLines, setMaxAgentWritableFileLines] = useState("1000");
	const [maxConcurrentTasks, setMaxConcurrentTasks] = useState("3");
	const [workspaceBaseDir, setWorkspaceBaseDir] = useState("");
	const [sandboxMaxContainers, setSandboxMaxContainers] = useState("1");
	const [sandboxAgentsPerContainer, setSandboxAgentsPerContainer] = useState("0");
	const [sandboxMemoryPerContainerMb, setSandboxMemoryPerContainerMb] = useState("2048");
	const [sandboxCpusPerContainer, setSandboxCpusPerContainer] = useState("2");
	const [sandboxIdleTimeoutMinutes, setSandboxIdleTimeoutMinutes] = useState("10");
	const [lostHeartbeatPolicy, setLostHeartbeatPolicy] = useState<RuntimeLostHeartbeatPolicy>("park");
	const [decompositionAutoApplyEnabled, setDecompositionAutoApplyEnabled] = useState(true);
	const [secondOpinionReviewEnabled, setSecondOpinionReviewEnabled] = useState(true);
	const [reviewMaxRounds, setReviewMaxRounds] = useState(20);
	const [swarmGuardrailInputs, setSwarmGuardrailInputs] = useState<SwarmGuardrailInputs>(() =>
		swarmGuardrailsToInputs(DEFAULT_RUNTIME_SWARM_GUARDRAILS),
	);
	const [developerModeEnabled, setDeveloperModeEnabled] = useState(false);
	const [replayCardsEnabled, setReplayCardsEnabled] = useState(false);
	const [readyForReviewNotificationsEnabled, setReadyForReviewNotificationsEnabled] = useState(true);
	const [codeEmbeddingDefaultsProvider, setCodeEmbeddingDefaultsProvider] =
		useState<RuntimeCodeEmbeddingSettings["provider"]>("local_lexical");
	const [codeEmbeddingDefaultsModel, setCodeEmbeddingDefaultsModel] = useState(LOCAL_CODE_EMBEDDING_MODEL);
	const [codeEmbeddingDefaultsBaseUrl, setCodeEmbeddingDefaultsBaseUrl] = useState("");
	const [taskDefaultStartInPlanMode, setTaskDefaultStartInPlanMode] = useState(() =>
		readBooleanTaskDefault(LocalStorageKey.TaskStartInPlanMode, false),
	);
	const [taskDefaultAutoReviewEnabled, setTaskDefaultAutoReviewEnabled] = useState(() =>
		readBooleanTaskDefault(LocalStorageKey.TaskAutoReviewEnabled, false),
	);
	const [taskDefaultAutoReviewMode, setTaskDefaultAutoReviewMode] =
		useState<RuntimeTaskAutoReviewMode>(readTaskAutoReviewModeDefault);
	const [initialTaskDefaultStartInPlanMode, setInitialTaskDefaultStartInPlanMode] =
		useState(taskDefaultStartInPlanMode);
	const [initialTaskDefaultAutoReviewEnabled, setInitialTaskDefaultAutoReviewEnabled] =
		useState(taskDefaultAutoReviewEnabled);
	const [initialTaskDefaultAutoReviewMode, setInitialTaskDefaultAutoReviewMode] =
		useState<RuntimeTaskAutoReviewMode>(taskDefaultAutoReviewMode);
	const [initialThemeId, setInitialThemeId] = useState<ThemeId>(readStoredThemeId);
	const [draftThemeId, setDraftThemeId] = useState<ThemeId>(readStoredThemeId);
	const [notificationPermission, setNotificationPermission] = useState<BrowserNotificationPermission>("unsupported");
	const [shortcuts, setShortcuts] = useState<RuntimeProjectShortcut[]>([]);
	const [maxConcurrentTasksOverride, setMaxConcurrentTasksOverride] = useState<number | null>(null);
	const [selectedAgentIdOverride, setSelectedAgentIdOverride] = useState<RuntimeAgentId | null>(null);
	const [modelRoles, setModelRoles] = useState<RuntimeModelRoles>({});
	const [concurrencyDefaults, setConcurrencyDefaults] = useState<{
		perProvider: ConcurrencyMap;
		perModel: ConcurrencyMap;
	}>({
		perProvider: {},
		perModel: {},
	});
	const [concurrencyOverride, setConcurrencyOverride] = useState<{
		perProvider: ConcurrencyMap;
		perModel: ConcurrencyMap;
	} | null>(null);
	const [agentRulesets, setAgentRulesets] = useState<AgentRulesetsConfigPayload>(DEFAULT_AGENT_RULESETS_CONFIG);
	const [modelRolesOverride, setModelRolesOverride] = useState<RuntimeModelRoles | null>(null);
	const [agentRulesetsOverride, setAgentRulesetsOverride] = useState<AgentRulesetsConfigPayload | null>(null);
	const [modelPerformanceStatsOpen, setModelPerformanceStatsOpen] = useState(false);
	const [modelRoleModelsByProviderId, setModelRoleModelsByProviderId] = useState<
		Record<string, RuntimeNKleinProviderModel[]>
	>({});
	const [loadingModelRoleProviderIds, setLoadingModelRoleProviderIds] = useState<Record<string, boolean>>({});
	const modelRoleModelsByProviderIdRef = useRef<Record<string, RuntimeNKleinProviderModel[]>>({});
	const loadingModelRoleProviderIdsRef = useRef<Record<string, boolean>>({});
	const [commitPromptTemplate, setCommitPromptTemplate] = useState("");
	const [openPrPromptTemplate, setOpenPrPromptTemplate] = useState("");
	const [selectedPromptVariant, setSelectedPromptVariant] = useState<TaskGitAction>("commit");
	const [copiedVariableToken, setCopiedVariableToken] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [pendingShortcutScrollIndex, setPendingShortcutScrollIndex] = useState<number | null>(null);
	const copiedVariableResetTimerRef = useRef<number | null>(null);
	const shortcutsSectionRef = useRef<HTMLHeadingElement | null>(null);
	const shortcutRowRefs = useRef<Array<HTMLDivElement | null>>([]);
	const bodyRef = useRef<HTMLDivElement>(null);
	const isScrollingProgrammatically = useRef(false);
	const [activeSection, setActiveSection] = useState<SettingsNavId>("general");
	const controlsDisabled = isLoading || isSaving || config === null;
	const commitPromptTemplateDefault = config?.commitPromptTemplateDefault ?? "";
	const openPrPromptTemplateDefault = config?.openPrPromptTemplateDefault ?? "";
	const isCommitPromptAtDefault =
		normalizeTemplateForComparison(commitPromptTemplate) ===
		normalizeTemplateForComparison(commitPromptTemplateDefault);
	const isOpenPrPromptAtDefault =
		normalizeTemplateForComparison(openPrPromptTemplate) ===
		normalizeTemplateForComparison(openPrPromptTemplateDefault);
	const selectedPromptValue = selectedPromptVariant === "commit" ? commitPromptTemplate : openPrPromptTemplate;
	const selectedPromptDefaultValue =
		selectedPromptVariant === "commit" ? commitPromptTemplateDefault : openPrPromptTemplateDefault;
	const isSelectedPromptAtDefault =
		selectedPromptVariant === "commit" ? isCommitPromptAtDefault : isOpenPrPromptAtDefault;
	const selectedPromptPlaceholder =
		selectedPromptVariant === "commit" ? "Commit prompt template" : "PR prompt template";
	const bypassPermissionsCheckboxId = "runtime-settings-bypass-permissions";
	const developerModeCheckboxId = "runtime-settings-developer-mode";
	const replayCardsCheckboxId = "runtime-settings-replay-cards";
	const maxConcurrentTasksId = "runtime-settings-max-concurrent-tasks";
	const workspaceBaseDirId = "runtime-settings-workspace-base-dir";
	const maxAgentWritableFileLinesId = "runtime-settings-max-agent-writable-file-lines";
	const taskDefaultStartInPlanModeId = "runtime-settings-task-default-start-in-plan-mode";
	const taskDefaultAutoReviewEnabledId = "runtime-settings-task-default-auto-review-enabled";
	const decompositionAutoApplyLabelId = "runtime-settings-decomposition-auto-apply-label";
	const secondOpinionReviewLabelId = "runtime-settings-second-opinion-review-label";
	const reviewMaxRoundsId = "runtime-settings-review-max-rounds";
	const refreshNotificationPermission = useCallback(() => {
		setNotificationPermission(getBrowserNotificationPermission());
	}, []);
	const cloudProviderSupportEnabled = isCloudProviderSupportEnabled(config);
	const agentSandboxStatus = config?.agentSandboxStatus ?? {
		state: "checking" as const,
		dockerAvailable: null,
		imageAvailable: null,
		image: "nklein/agent-sandbox:0.0.1",
		message: null,
		checkedAt: null,
	};

	const supportedAgents = useMemo<RuntimeSettingsAgentRowModel[]>(() => {
		const agents =
			config?.agents.map((agent) => ({
				id: agent.id,
				label: agent.label,
				binary: agent.binary,
				installed: agent.id === "nklein" ? true : agent.installed,
			})) ??
			getRuntimeLaunchSupportedAgentCatalog().map((agent) => ({
				id: agent.id,
				label: agent.label,
				binary: agent.binary,
				installed: agent.id === "nklein" ? true : null,
			}));
		const orderIndexByAgentId = new Map(SETTINGS_AGENT_ORDER.map((agentId, index) => [agentId, index] as const));
		const orderedAgents = [...agents].sort((left, right) => {
			const leftOrderIndex = orderIndexByAgentId.get(left.id) ?? Number.MAX_SAFE_INTEGER;
			const rightOrderIndex = orderIndexByAgentId.get(right.id) ?? Number.MAX_SAFE_INTEGER;
			return leftOrderIndex - rightOrderIndex;
		});
		return orderedAgents.map((agent) => ({
			...agent,
			command: buildDisplayedAgentCommand(agent.id, agent.binary, agentAutonomousModeEnabled),
		}));
	}, [agentAutonomousModeEnabled, config?.agents]);
	const displayedAgents = useMemo(
		() => (cloudProviderSupportEnabled ? supportedAgents : supportedAgents.filter((agent) => agent.id === "nklein")),
		[cloudProviderSupportEnabled, supportedAgents],
	);
	const navItems = useMemo(
		() => SETTINGS_NAV_ITEMS.filter((item) => !item.nkleinOnly || selectedAgentId === "nklein"),
		[selectedAgentId],
	);

	useEffect(() => {
		modelRoleModelsByProviderIdRef.current = modelRoleModelsByProviderId;
	}, [modelRoleModelsByProviderId]);

	useEffect(() => {
		loadingModelRoleProviderIdsRef.current = loadingModelRoleProviderIds;
	}, [loadingModelRoleProviderIds]);

	const configuredAgentId = config?.selectedAgentId ?? null;
	const fallbackAgentId = cloudProviderSupportEnabled ? (configuredAgentId ?? "nklein") : "nklein";
	const initialSelectedAgentId = cloudProviderSupportEnabled ? (configuredAgentId ?? fallbackAgentId) : "nklein";
	const initialAgentAutonomousModeEnabled = config?.agentAutonomousModeEnabled ?? true;
	const initialAgentTimeoutMode = config?.agentTimeoutMode ?? "normal";
	const initialAgentTimeoutProfile = normalizeAgentTimeoutProfile(
		config?.agentTimeoutProfile,
		cloudProviderSupportEnabled,
	);
	const initialRequestTimeoutMs = config?.requestTimeoutMs == null ? "" : String(config.requestTimeoutMs);
	const initialStreamTimeoutMs = config?.streamTimeoutMs == null ? "" : String(config.streamTimeoutMs);
	const initialToolTimeoutMs = config?.toolTimeoutMs == null ? "" : String(config.toolTimeoutMs);
	const initialAgentTimeoutMs = config?.agentTimeoutMs == null ? "" : String(config.agentTimeoutMs);
	const initialConversationTimeoutMs =
		config?.conversationTimeoutMs == null ? "" : String(config.conversationTimeoutMs);
	const initialMaxAgentWritableFileLines = String(config?.maxAgentWritableFileLines ?? 1000);
	const initialMaxConcurrentTasks = String(config?.maxConcurrentTasks ?? 3);
	const initialWorkspaceBaseDir = config?.workspaceBaseDir ?? "";
	const initialSandboxMaxContainers = String(config?.sandboxMaxContainers ?? 1);
	const initialSandboxAgentsPerContainer = String(config?.sandboxAgentsPerContainer ?? 0);
	const initialSandboxMemoryPerContainerMb = String(config?.sandboxMemoryPerContainerMb ?? 2048);
	const initialSandboxCpusPerContainer = String(config?.sandboxCpusPerContainer ?? 2);
	const initialSandboxIdleTimeoutMinutes = String(config?.sandboxIdleTimeoutMinutes ?? 10);
	const initialLostHeartbeatPolicy = config?.lostHeartbeatPolicy ?? "park";
	const initialDecompositionAutoApplyEnabled = config?.decompositionAutoApplyEnabled ?? true;
	const initialSecondOpinionReviewEnabled = config?.secondOpinionReviewEnabled ?? true;
	const initialReviewMaxRounds = config?.reviewMaxRounds ?? 20;
	const initialSwarmGuardrails = config?.swarmGuardrails ?? DEFAULT_RUNTIME_SWARM_GUARDRAILS;
	const initialDeveloperModeEnabled = config?.developerModeEnabled ?? false;
	const initialReplayCardsEnabled = config?.replayCardsEnabled ?? false;
	const initialReadyForReviewNotificationsEnabled = config?.readyForReviewNotificationsEnabled ?? true;
	const initialCodeEmbeddingDefaults = config?.codeEmbeddingDefaults ?? {
		provider: "local_lexical" as const,
		model: LOCAL_CODE_EMBEDDING_MODEL,
		baseUrl: null,
	};
	const initialShortcuts = config?.shortcuts ?? [];
	const initialMaxConcurrentTasksOverride = config?.maxConcurrentTasksOverride ?? null;
	const initialSelectedAgentIdOverride = config?.selectedAgentIdOverride ?? null;
	const initialModelRoles = useMemo(() => normalizeModelRolesForSettings(config?.modelRoles), [config?.modelRoles]);
	const initialConcurrencyDefaults = useMemo(
		() => ({
			perProvider: { ...(config?.concurrencyDefaults?.perProvider ?? {}) },
			perModel: { ...(config?.concurrencyDefaults?.perModel ?? {}) },
		}),
		[config?.concurrencyDefaults],
	);
	const initialConcurrencyOverride = useMemo(
		() =>
			config?.concurrencyOverride != null
				? {
						perProvider: { ...(config.concurrencyOverride.perProvider ?? {}) },
						perModel: { ...(config.concurrencyOverride.perModel ?? {}) },
					}
				: null,
		[config?.concurrencyOverride],
	);
	const initialAgentRulesets = useMemo<AgentRulesetsConfigPayload>(
		() => config?.agentRulesets ?? DEFAULT_AGENT_RULESETS_CONFIG,
		[config?.agentRulesets],
	);
	const initialModelRolesOverride = useMemo(
		() => (config?.modelRolesOverride != null ? normalizeModelRolesForSettings(config.modelRolesOverride) : null),
		[config?.modelRolesOverride],
	);
	const initialAgentRulesetsOverride = useMemo(
		() => config?.agentRulesetsOverride ?? null,
		[config?.agentRulesetsOverride],
	);
	const initialCommitPromptTemplate = config?.commitPromptTemplate ?? "";
	const initialOpenPrPromptTemplate = config?.openPrPromptTemplate ?? "";
	const nkleinSettings = useRuntimeSettingsNKleinController({
		open,
		workspaceId,
		selectedAgentId,
		config,
	});
	const nkleinMcpSettings = useRuntimeSettingsNKleinMcpController({
		open,
		workspaceId,
		selectedAgentId,
		liveAuthStatuses: liveMcpAuthStatuses,
	});
	const suggestedCodeEmbeddingBaseUrl = useMemo(
		() =>
			buildSuggestedCodeEmbeddingBaseUrl({
				providerId: nkleinSettings.providerId,
				baseUrl: nkleinSettings.baseUrl,
				providerCatalog: nkleinSettings.providerCatalog,
			}),
		[nkleinSettings.baseUrl, nkleinSettings.providerCatalog, nkleinSettings.providerId],
	);
	const nkleinProviderId = nkleinSettings.providerId.trim();
	const selectedModelRoleProviderIds = useMemo(() => {
		const providerIds = new Set<string>();
		for (const roleId of MODEL_ROLE_IDS) {
			const providerId = modelRoles[roleId]?.providerId?.trim();
			if (providerId) {
				providerIds.add(providerId);
			}
		}
		return [...providerIds].sort((left, right) => left.localeCompare(right));
	}, [modelRoles]);
	const advisorRuntimeConfigSummary = useMemo(
		() =>
			[
				`selectedAgentId=${selectedAgentId}`,
				`autonomousMode=${agentAutonomousModeEnabled}`,
				`timeoutMode=${agentTimeoutMode}`,
				`timeoutProfile=${agentTimeoutProfile}`,
				`maxConcurrentTasks=${maxConcurrentTasks}`,
				`sandboxMaxContainers=${sandboxMaxContainers}`,
				`sandboxAgentsPerContainer=${sandboxAgentsPerContainer}`,
				`sandboxMemoryPerContainerMb=${sandboxMemoryPerContainerMb}`,
				`sandboxCpusPerContainer=${sandboxCpusPerContainer}`,
				`sandboxIdleTimeoutMinutes=${sandboxIdleTimeoutMinutes}`,
				`lostHeartbeatPolicy=${lostHeartbeatPolicy}`,
				`decompositionAutoApply=${decompositionAutoApplyEnabled}`,
				`secondOpinionReview=${secondOpinionReviewEnabled}`,
				`readyForReviewNotifications=${readyForReviewNotificationsEnabled}`,
				`nkleinProvider=${nkleinSettings.providerId || "default"}`,
				`nkleinModel=${nkleinSettings.modelId || "default"}`,
				`nkleinBaseUrl=${nkleinSettings.baseUrl || "default"}`,
			].join("\n"),
		[
			agentAutonomousModeEnabled,
			agentTimeoutMode,
			agentTimeoutProfile,
			nkleinSettings.baseUrl,
			nkleinSettings.modelId,
			nkleinSettings.providerId,
			decompositionAutoApplyEnabled,
			secondOpinionReviewEnabled,
			reviewMaxRounds,
			lostHeartbeatPolicy,
			maxConcurrentTasks,
			sandboxAgentsPerContainer,
			sandboxCpusPerContainer,
			sandboxIdleTimeoutMinutes,
			sandboxMaxContainers,
			sandboxMemoryPerContainerMb,
			readyForReviewNotificationsEnabled,
			selectedAgentId,
		],
	);
	const draftCodeEmbeddingDefaults = useMemo(
		() =>
			buildCodeEmbeddingSettings(
				codeEmbeddingDefaultsProvider,
				codeEmbeddingDefaultsModel,
				codeEmbeddingDefaultsBaseUrl,
			),
		[codeEmbeddingDefaultsBaseUrl, codeEmbeddingDefaultsModel, codeEmbeddingDefaultsProvider],
	);
	const sandboxPoolSummary = useMemo(() => {
		const parsePositiveInteger = (value: string, fallback: number) => {
			const parsed = Number(value.trim());
			return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
		};
		const parseNonNegativeInteger = (value: string, fallback: number) => {
			const parsed = Number(value.trim());
			return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
		};
		const maxConcurrent = parsePositiveInteger(maxConcurrentTasks, 3);
		const maxContainers = parsePositiveInteger(sandboxMaxContainers, 1);
		const agentsPerContainer = parseNonNegativeInteger(sandboxAgentsPerContainer, 0);
		const memoryMb = parsePositiveInteger(sandboxMemoryPerContainerMb, 2048);
		const poolCapacity = agentsPerContainer === 0 ? Number.POSITIVE_INFINITY : maxContainers * agentsPerContainer;
		const effectiveParallelism =
			poolCapacity === Number.POSITIVE_INFINITY ? maxConcurrent : Math.min(maxConcurrent, poolCapacity);
		const memoryGb = memoryMb / 1024;
		return {
			effectiveParallelism,
			memoryGbLabel: `${Number.isInteger(memoryGb) ? memoryGb : memoryGb.toFixed(1)} GB`,
			poolCapacityLabel: agentsPerContainer === 0 ? "unlimited pool slots" : `${poolCapacity} pool slots`,
		};
	}, [maxConcurrentTasks, sandboxAgentsPerContainer, sandboxMaxContainers, sandboxMemoryPerContainerMb]);
	const sandboxPoolPreset = useMemo(() => {
		if (sandboxMaxContainers.trim() === "1" && sandboxAgentsPerContainer.trim() === "0") {
			return "shared";
		}
		if (sandboxAgentsPerContainer.trim() === "1") {
			return "dedicated";
		}
		return "custom";
	}, [sandboxAgentsPerContainer, sandboxMaxContainers]);
	const applySharedSandboxPreset = useCallback(() => {
		setSandboxMaxContainers("1");
		setSandboxAgentsPerContainer("0");
	}, []);
	const applyDedicatedSandboxPreset = useCallback(() => {
		setSandboxAgentsPerContainer("1");
	}, []);
	const hasUnsavedChanges = useMemo(() => {
		if (!config) {
			return false;
		}
		if (selectedAgentId !== initialSelectedAgentId) {
			return true;
		}
		if (agentAutonomousModeEnabled !== initialAgentAutonomousModeEnabled) {
			return true;
		}
		if (agentTimeoutMode !== initialAgentTimeoutMode) {
			return true;
		}
		if (agentTimeoutProfile !== initialAgentTimeoutProfile) {
			return true;
		}
		if (requestTimeoutMs.trim() !== initialRequestTimeoutMs.trim()) {
			return true;
		}
		if (streamTimeoutMs.trim() !== initialStreamTimeoutMs.trim()) {
			return true;
		}
		if (toolTimeoutMs.trim() !== initialToolTimeoutMs.trim()) {
			return true;
		}
		if (agentTimeoutMs.trim() !== initialAgentTimeoutMs.trim()) {
			return true;
		}
		if (conversationTimeoutMs.trim() !== initialConversationTimeoutMs.trim()) {
			return true;
		}
		if (maxAgentWritableFileLines.trim() !== initialMaxAgentWritableFileLines.trim()) {
			return true;
		}
		if (maxConcurrentTasks.trim() !== initialMaxConcurrentTasks.trim()) {
			return true;
		}
		if (workspaceBaseDir.trim() !== initialWorkspaceBaseDir.trim()) {
			return true;
		}
		if (sandboxMaxContainers.trim() !== initialSandboxMaxContainers.trim()) {
			return true;
		}
		if (sandboxAgentsPerContainer.trim() !== initialSandboxAgentsPerContainer.trim()) {
			return true;
		}
		if (sandboxMemoryPerContainerMb.trim() !== initialSandboxMemoryPerContainerMb.trim()) {
			return true;
		}
		if (sandboxCpusPerContainer.trim() !== initialSandboxCpusPerContainer.trim()) {
			return true;
		}
		if (sandboxIdleTimeoutMinutes.trim() !== initialSandboxIdleTimeoutMinutes.trim()) {
			return true;
		}
		if (lostHeartbeatPolicy !== initialLostHeartbeatPolicy) {
			return true;
		}
		if (decompositionAutoApplyEnabled !== initialDecompositionAutoApplyEnabled) {
			return true;
		}
		if (secondOpinionReviewEnabled !== initialSecondOpinionReviewEnabled) {
			return true;
		}
		if (reviewMaxRounds !== initialReviewMaxRounds) {
			return true;
		}
		if (!areRuntimeSwarmGuardrailsEqual(inputsToSwarmGuardrails(swarmGuardrailInputs), initialSwarmGuardrails)) {
			return true;
		}
		if (developerModeEnabled !== initialDeveloperModeEnabled) {
			return true;
		}
		if (replayCardsEnabled !== initialReplayCardsEnabled) {
			return true;
		}
		if (readyForReviewNotificationsEnabled !== initialReadyForReviewNotificationsEnabled) {
			return true;
		}
		if (!areCodeEmbeddingSettingsEqual(draftCodeEmbeddingDefaults, initialCodeEmbeddingDefaults)) {
			return true;
		}
		if (
			taskDefaultStartInPlanMode !== initialTaskDefaultStartInPlanMode ||
			taskDefaultAutoReviewEnabled !== initialTaskDefaultAutoReviewEnabled ||
			taskDefaultAutoReviewMode !== initialTaskDefaultAutoReviewMode
		) {
			return true;
		}
		if (nkleinSettings.hasUnsavedChanges) {
			return true;
		}
		if (nkleinMcpSettings.hasUnsavedChanges) {
			return true;
		}
		if (serializeModelRoles(modelRoles) !== serializeModelRoles(initialModelRoles)) {
			return true;
		}
		if (JSON.stringify(concurrencyDefaults) !== JSON.stringify(initialConcurrencyDefaults)) {
			return true;
		}
		if (JSON.stringify(concurrencyOverride) !== JSON.stringify(initialConcurrencyOverride)) {
			return true;
		}
		if (JSON.stringify(agentRulesets) !== JSON.stringify(initialAgentRulesets)) {
			return true;
		}
		if (draftThemeId !== initialThemeId) {
			return true;
		}
		if (!areRuntimeProjectShortcutsEqual(shortcuts, initialShortcuts)) {
			return true;
		}
		if (maxConcurrentTasksOverride !== initialMaxConcurrentTasksOverride) {
			return true;
		}
		if (selectedAgentIdOverride !== initialSelectedAgentIdOverride) {
			return true;
		}
		if (
			(modelRolesOverride === null) !== (initialModelRolesOverride === null) ||
			(modelRolesOverride !== null &&
				serializeModelRoles(modelRolesOverride) !== serializeModelRoles(initialModelRolesOverride ?? {}))
		) {
			return true;
		}
		if (JSON.stringify(agentRulesetsOverride) !== JSON.stringify(initialAgentRulesetsOverride)) {
			return true;
		}
		if (
			normalizeTemplateForComparison(commitPromptTemplate) !==
			normalizeTemplateForComparison(initialCommitPromptTemplate)
		) {
			return true;
		}
		return (
			normalizeTemplateForComparison(openPrPromptTemplate) !==
			normalizeTemplateForComparison(initialOpenPrPromptTemplate)
		);
	}, [
		agentAutonomousModeEnabled,
		agentTimeoutMode,
		agentTimeoutMs,
		agentTimeoutProfile,
		nkleinMcpSettings.hasUnsavedChanges,
		nkleinSettings.hasUnsavedChanges,
		commitPromptTemplate,
		conversationTimeoutMs,
		config,
		decompositionAutoApplyEnabled,
		secondOpinionReviewEnabled,
		developerModeEnabled,
		draftCodeEmbeddingDefaults,
		draftThemeId,
		initialCodeEmbeddingDefaults,
		initialAgentAutonomousModeEnabled,
		initialAgentTimeoutMs,
		initialAgentTimeoutMode,
		initialAgentTimeoutProfile,
		initialCommitPromptTemplate,
		initialConversationTimeoutMs,
		initialDecompositionAutoApplyEnabled,
		initialSecondOpinionReviewEnabled,
		initialDeveloperModeEnabled,
		initialMaxAgentWritableFileLines,
		initialMaxConcurrentTasks,
		initialWorkspaceBaseDir,
		initialSandboxAgentsPerContainer,
		initialSandboxCpusPerContainer,
		initialSandboxIdleTimeoutMinutes,
		initialSandboxMaxContainers,
		initialSandboxMemoryPerContainerMb,
		initialLostHeartbeatPolicy,
		initialModelRoles,
		initialConcurrencyDefaults,
		concurrencyDefaults,
		initialConcurrencyOverride,
		concurrencyOverride,
		initialAgentRulesets,
		agentRulesets,
		initialOpenPrPromptTemplate,
		initialRequestTimeoutMs,
		initialReadyForReviewNotificationsEnabled,
		initialReplayCardsEnabled,
		initialSelectedAgentId,
		initialShortcuts,
		initialMaxConcurrentTasksOverride,
		initialSelectedAgentIdOverride,
		maxConcurrentTasksOverride,
		selectedAgentIdOverride,
		modelRolesOverride,
		agentRulesetsOverride,
		initialModelRolesOverride,
		initialAgentRulesetsOverride,
		initialTaskDefaultAutoReviewEnabled,
		initialTaskDefaultAutoReviewMode,
		initialTaskDefaultStartInPlanMode,
		initialStreamTimeoutMs,
		initialThemeId,
		initialToolTimeoutMs,
		maxAgentWritableFileLines,
		maxConcurrentTasks,
		workspaceBaseDir,
		sandboxAgentsPerContainer,
		sandboxCpusPerContainer,
		sandboxIdleTimeoutMinutes,
		sandboxMaxContainers,
		sandboxMemoryPerContainerMb,
		lostHeartbeatPolicy,
		modelRoles,
		openPrPromptTemplate,
		requestTimeoutMs,
		readyForReviewNotificationsEnabled,
		replayCardsEnabled,
		selectedAgentId,
		shortcuts,
		streamTimeoutMs,
		taskDefaultAutoReviewEnabled,
		taskDefaultAutoReviewMode,
		taskDefaultStartInPlanMode,
		toolTimeoutMs,
	]);

	useEffect(() => {
		if (!open) {
			return;
		}
		setSelectedAgentId(fallbackAgentId);
		setAgentAutonomousModeEnabled(config?.agentAutonomousModeEnabled ?? true);
		setAgentTimeoutMode(config?.agentTimeoutMode ?? "normal");
		setAgentTimeoutProfile(normalizeAgentTimeoutProfile(config?.agentTimeoutProfile, cloudProviderSupportEnabled));
		setRequestTimeoutMs(config?.requestTimeoutMs == null ? "" : String(config.requestTimeoutMs));
		setStreamTimeoutMs(config?.streamTimeoutMs == null ? "" : String(config.streamTimeoutMs));
		setToolTimeoutMs(config?.toolTimeoutMs == null ? "" : String(config.toolTimeoutMs));
		setAgentTimeoutMs(config?.agentTimeoutMs == null ? "" : String(config.agentTimeoutMs));
		setConversationTimeoutMs(config?.conversationTimeoutMs == null ? "" : String(config.conversationTimeoutMs));
		setMaxAgentWritableFileLines(String(config?.maxAgentWritableFileLines ?? 1000));
		setMaxConcurrentTasks(String(config?.maxConcurrentTasks ?? 3));
		setWorkspaceBaseDir(config?.workspaceBaseDir ?? "");
		setSandboxMaxContainers(String(config?.sandboxMaxContainers ?? 1));
		setSandboxAgentsPerContainer(String(config?.sandboxAgentsPerContainer ?? 0));
		setSandboxMemoryPerContainerMb(String(config?.sandboxMemoryPerContainerMb ?? 2048));
		setSandboxCpusPerContainer(String(config?.sandboxCpusPerContainer ?? 2));
		setSandboxIdleTimeoutMinutes(String(config?.sandboxIdleTimeoutMinutes ?? 10));
		setLostHeartbeatPolicy(config?.lostHeartbeatPolicy ?? "park");
		setDecompositionAutoApplyEnabled(config?.decompositionAutoApplyEnabled ?? true);
		setSecondOpinionReviewEnabled(config?.secondOpinionReviewEnabled ?? true);
		setReviewMaxRounds(config?.reviewMaxRounds ?? 20);
		setSwarmGuardrailInputs(swarmGuardrailsToInputs(config?.swarmGuardrails ?? DEFAULT_RUNTIME_SWARM_GUARDRAILS));
		setDeveloperModeEnabled(config?.developerModeEnabled ?? false);
		setReplayCardsEnabled(config?.replayCardsEnabled ?? false);
		setReadyForReviewNotificationsEnabled(config?.readyForReviewNotificationsEnabled ?? true);
		const nextEmbeddingDefaults = config?.codeEmbeddingDefaults ?? {
			provider: "local_lexical" as const,
			model: LOCAL_CODE_EMBEDDING_MODEL,
			baseUrl: null,
		};
		setCodeEmbeddingDefaultsProvider(nextEmbeddingDefaults.provider);
		setCodeEmbeddingDefaultsModel(nextEmbeddingDefaults.model ?? "");
		setCodeEmbeddingDefaultsBaseUrl(nextEmbeddingDefaults.baseUrl ?? "");
		const storedTaskDefaultStartInPlanMode = readBooleanTaskDefault(LocalStorageKey.TaskStartInPlanMode, false);
		const storedTaskDefaultAutoReviewEnabled = readBooleanTaskDefault(LocalStorageKey.TaskAutoReviewEnabled, false);
		const storedTaskDefaultAutoReviewMode = readTaskAutoReviewModeDefault();
		setTaskDefaultStartInPlanMode(storedTaskDefaultStartInPlanMode);
		setInitialTaskDefaultStartInPlanMode(storedTaskDefaultStartInPlanMode);
		setTaskDefaultAutoReviewEnabled(storedTaskDefaultAutoReviewEnabled);
		setInitialTaskDefaultAutoReviewEnabled(storedTaskDefaultAutoReviewEnabled);
		setTaskDefaultAutoReviewMode(storedTaskDefaultAutoReviewMode);
		setInitialTaskDefaultAutoReviewMode(storedTaskDefaultAutoReviewMode);
		setShortcuts(config?.shortcuts ?? []);
		setMaxConcurrentTasksOverride(config?.maxConcurrentTasksOverride ?? null);
		setSelectedAgentIdOverride(config?.selectedAgentIdOverride ?? null);
		setModelRoles(normalizeModelRolesForSettings(config?.modelRoles));
		setConcurrencyDefaults({
			perProvider: { ...(config?.concurrencyDefaults?.perProvider ?? {}) },
			perModel: { ...(config?.concurrencyDefaults?.perModel ?? {}) },
		});
		setConcurrencyOverride(
			config?.concurrencyOverride != null
				? {
						perProvider: { ...(config.concurrencyOverride.perProvider ?? {}) },
						perModel: { ...(config.concurrencyOverride.perModel ?? {}) },
					}
				: null,
		);
		setAgentRulesets(config?.agentRulesets ?? DEFAULT_AGENT_RULESETS_CONFIG);
		setModelRolesOverride(
			config?.modelRolesOverride != null ? normalizeModelRolesForSettings(config.modelRolesOverride) : null,
		);
		setAgentRulesetsOverride(config?.agentRulesetsOverride ?? null);
		setCommitPromptTemplate(config?.commitPromptTemplate ?? "");
		setOpenPrPromptTemplate(config?.openPrPromptTemplate ?? "");
		setSaveError(null);
	}, [
		config?.agentAutonomousModeEnabled,
		config?.agentTimeoutMode,
		config?.agentTimeoutMs,
		cloudProviderSupportEnabled,
		config?.agentTimeoutProfile,
		config?.commitPromptTemplate,
		config?.conversationTimeoutMs,
		config?.codeEmbeddingDefaults,
		config?.concurrencyDefaults,
		config?.concurrencyOverride,
		config?.decompositionAutoApplyEnabled,
		config?.secondOpinionReviewEnabled,
		config?.reviewMaxRounds,
		config?.swarmGuardrails,
		config?.developerModeEnabled,
		config?.replayCardsEnabled,
		config?.maxAgentWritableFileLines,
		config?.maxConcurrentTasks,
		config?.workspaceBaseDir,
		config?.sandboxAgentsPerContainer,
		config?.sandboxCpusPerContainer,
		config?.sandboxIdleTimeoutMinutes,
		config?.sandboxMaxContainers,
		config?.sandboxMemoryPerContainerMb,
		config?.lostHeartbeatPolicy,
		config?.openPrPromptTemplate,
		config?.requestTimeoutMs,
		config?.readyForReviewNotificationsEnabled,
		config?.selectedAgentId,
		config?.shortcuts,
		config?.maxConcurrentTasksOverride,
		config?.selectedAgentIdOverride,
		config?.modelRoles,
		config?.modelRolesOverride,
		config?.agentRulesetsOverride,
		config?.streamTimeoutMs,
		config?.toolTimeoutMs,
		fallbackAgentId,
		open,
	]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const persistedThemeId = readStoredThemeId();
		setInitialThemeId(persistedThemeId);
		setDraftThemeId(persistedThemeId);
	}, [open]);

	useEffect(() => {
		if (!open) {
			return;
		}
		refreshNotificationPermission();
	}, [open, refreshNotificationPermission]);
	useWindowEvent("focus", open ? refreshNotificationPermission : null);

	useEffect(() => {
		if (!open || initialSection !== "shortcuts") {
			return;
		}
		const timeout = window.setTimeout(() => {
			shortcutsSectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
		}, 500);
		return () => {
			window.clearTimeout(timeout);
		};
	}, [initialSection, open]);

	useEffect(() => {
		if (!open || selectedAgentId !== "nklein") {
			setModelRoleModelsByProviderId({});
			setLoadingModelRoleProviderIds({});
			return;
		}
		const providerIdsToLoad = selectedModelRoleProviderIds.filter((providerId) => {
			const normalizedProviderId = normalizeProviderId(providerId);
			if (!normalizedProviderId) {
				return false;
			}
			if (normalizedProviderId === normalizeProviderId(nkleinProviderId)) {
				return false;
			}
			return (
				modelRoleModelsByProviderIdRef.current[normalizedProviderId] === undefined &&
				!loadingModelRoleProviderIdsRef.current[normalizedProviderId]
			);
		});
		if (providerIdsToLoad.length === 0) {
			return;
		}
		let cancelled = false;
		setLoadingModelRoleProviderIds((current) => {
			const next = { ...current };
			for (const providerId of providerIdsToLoad) {
				next[normalizeProviderId(providerId)] = true;
			}
			return next;
		});
		for (const providerId of providerIdsToLoad) {
			const normalizedProviderId = normalizeProviderId(providerId);
			void fetchNKleinProviderModels(workspaceId, providerId)
				.then((models) => {
					if (cancelled) {
						return;
					}
					setModelRoleModelsByProviderId((current) => ({
						...current,
						[normalizedProviderId]: models,
					}));
				})
				.catch(() => {
					if (cancelled) {
						return;
					}
					setModelRoleModelsByProviderId((current) => ({
						...current,
						[normalizedProviderId]: [],
					}));
				})
				.finally(() => {
					if (cancelled) {
						return;
					}
					setLoadingModelRoleProviderIds((current) => {
						const next = { ...current };
						delete next[normalizedProviderId];
						return next;
					});
				});
		}
		return () => {
			cancelled = true;
		};
	}, [nkleinProviderId, open, selectedAgentId, selectedModelRoleProviderIds, workspaceId]);

	useEffect(() => {
		if (pendingShortcutScrollIndex === null) {
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			const target = shortcutRowRefs.current[pendingShortcutScrollIndex] ?? null;
			if (target) {
				target.scrollIntoView({ block: "nearest", behavior: "smooth" });
				const firstInput = target.querySelector("input");
				firstInput?.focus();
				setPendingShortcutScrollIndex(null);
			}
		});
		return () => {
			window.cancelAnimationFrame(frame);
		};
	}, [pendingShortcutScrollIndex, shortcuts]);

	useUnmount(() => {
		if (copiedVariableResetTimerRef.current !== null) {
			window.clearTimeout(copiedVariableResetTimerRef.current);
			copiedVariableResetTimerRef.current = null;
		}
	});

	useEffect(() => {
		if (activeSection === "nklein" && selectedAgentId !== "nklein") {
			setActiveSection("general");
		}
	}, [activeSection, selectedAgentId]);

	const handleBodyScroll = useCallback(() => {
		if (isScrollingProgrammatically.current) return;
		const body = bodyRef.current;
		if (!body) return;
		const headings = body.querySelectorAll<HTMLElement>("[data-settings-section]");
		const bodyRect = body.getBoundingClientRect();
		let current: SettingsNavId = "general";

		for (const heading of headings) {
			const rect = heading.getBoundingClientRect();
			if (rect.top - bodyRect.top <= 40) {
				const id = heading.getAttribute("data-settings-section");
				if (id) current = id as SettingsNavId;
			}
		}

		setActiveSection(current);
	}, []);

	const handleNavSelect = useCallback((id: SettingsNavId) => {
		setActiveSection(id);
		isScrollingProgrammatically.current = true;
		const body = bodyRef.current;
		if (!body) return;
		const target = body.querySelector(`[data-settings-section="${id}"]`);
		if (target) {
			const bodyRect = body.getBoundingClientRect();
			const targetRect = target.getBoundingClientRect();
			body.scrollTo({
				top: targetRect.top - bodyRect.top + body.scrollTop,
				behavior: "smooth",
			});
		}
		window.setTimeout(() => {
			isScrollingProgrammatically.current = false;
		}, 600);
	}, []);

	const handleCopyVariableToken = (token: string) => {
		void (async () => {
			try {
				await navigator.clipboard.writeText(token);
				setCopiedVariableToken(token);
				if (copiedVariableResetTimerRef.current !== null) {
					window.clearTimeout(copiedVariableResetTimerRef.current);
				}
				copiedVariableResetTimerRef.current = window.setTimeout(() => {
					setCopiedVariableToken((current) => (current === token ? null : current));
					copiedVariableResetTimerRef.current = null;
				}, 2000);
			} catch {
				// Ignore clipboard failures.
			}
		})();
	};

	const handleSelectedPromptChange = (value: string) => {
		if (selectedPromptVariant === "commit") {
			setCommitPromptTemplate(value);
			return;
		}
		setOpenPrPromptTemplate(value);
	};

	const handleResetSelectedPrompt = () => {
		handleSelectedPromptChange(selectedPromptDefaultValue);
	};

	const getModelRoleProviderModels = useCallback(
		(providerId: string): RuntimeNKleinProviderModel[] => {
			const normalizedProviderId = normalizeProviderId(providerId || nkleinProviderId);
			if (!normalizedProviderId || normalizedProviderId === normalizeProviderId(nkleinProviderId)) {
				return nkleinSettings.providerModels;
			}
			return modelRoleModelsByProviderId[normalizedProviderId] ?? [];
		},
		[nkleinProviderId, nkleinSettings.providerModels, modelRoleModelsByProviderId],
	);

	const getModelRoleContextWarning = useCallback(
		(roleId: ModelRoleId): string | null => {
			const roleSettings = modelRoles[roleId] ?? {};
			const roleProviderId = roleSettings.providerId ?? "";
			const effectiveProviderId = roleProviderId || nkleinProviderId;
			const providerDefaultModelId = roleProviderId
				? (findProviderCatalogItem(nkleinSettings.providerCatalog, roleProviderId)?.defaultModelId?.trim() ?? "")
				: "";
			const effectiveModelId = roleSettings.modelId?.trim() || providerDefaultModelId;
			if (!effectiveModelId) {
				return null;
			}
			const roleModels = getModelRoleProviderModels(effectiveProviderId);
			return getNKleinModelContextWindowWarning({
				model: findNKleinProviderModel(roleModels, effectiveModelId),
				modelId: effectiveModelId,
				label: `${MODEL_ROLE_LABELS[roleId]} model`,
			});
		},
		[nkleinProviderId, nkleinSettings.providerCatalog, getModelRoleProviderModels, modelRoles],
	);

	const getModelRoleAvailabilityWarning = useCallback(
		(roleId: ModelRoleId): string | null => {
			const roleSettings = modelRoles[roleId] ?? {};
			const roleProviderId = roleSettings.providerId ?? "";
			const effectiveProviderId = roleProviderId || nkleinProviderId;
			if (!isLmStudioProviderId(effectiveProviderId)) {
				return null;
			}
			const roleModelId = roleSettings.modelId?.trim() ?? "";
			if (roleProviderId && !roleModelId) {
				return `${MODEL_ROLE_LABELS[roleId]} role uses LM Studio. Choose a loaded LM Studio model before saving.`;
			}
			if (!roleModelId) {
				return null;
			}
			const roleModels = getModelRoleProviderModels(effectiveProviderId);
			if (findNKleinProviderModel(roleModels, roleModelId)) {
				return null;
			}
			return `${MODEL_ROLE_LABELS[roleId]} model "${roleModelId}" is not loaded in LM Studio. Load it, refresh models, then choose it before saving.`;
		},
		[nkleinProviderId, getModelRoleProviderModels, modelRoles],
	);

	useEffect(() => {
		if (!saveError?.includes("Selected LM Studio model")) {
			return;
		}
		if (!findNKleinProviderModel(nkleinSettings.providerModels, nkleinSettings.modelId)) {
			return;
		}
		setSaveError(null);
	}, [nkleinSettings.modelId, nkleinSettings.providerModels, saveError]);

	const handleSave = async () => {
		setSaveError(null);
		const parseTimeoutMsInput = (value: string): number | null | "invalid" => {
			const trimmed = value.trim();
			if (trimmed.length === 0) {
				return null;
			}
			const parsed = Number(trimmed);
			if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
				return "invalid";
			}
			return parsed;
		};
		const parsePositiveNumberInput = (value: string): number | "invalid" => {
			const parsed = Number(value.trim());
			if (!Number.isFinite(parsed) || parsed <= 0) {
				return "invalid";
			}
			return parsed;
		};
		const parsedRequestTimeout = parseTimeoutMsInput(requestTimeoutMs);
		const parsedStreamTimeout = parseTimeoutMsInput(streamTimeoutMs);
		const parsedToolTimeout = parseTimeoutMsInput(toolTimeoutMs);
		const parsedAgentTimeout = parseTimeoutMsInput(agentTimeoutMs);
		const parsedConversationTimeout = parseTimeoutMsInput(conversationTimeoutMs);
		const parsedMaxAgentWritableFileLines = parseTimeoutMsInput(maxAgentWritableFileLines);
		const parsedMaxConcurrentTasks = parseTimeoutMsInput(maxConcurrentTasks);
		const parsedSandboxMaxContainers = parseTimeoutMsInput(sandboxMaxContainers);
		const parsedSandboxAgentsPerContainer = parseTimeoutMsInput(sandboxAgentsPerContainer);
		const parsedSandboxMemoryPerContainerMb = parseTimeoutMsInput(sandboxMemoryPerContainerMb);
		const parsedSandboxCpusPerContainer = parsePositiveNumberInput(sandboxCpusPerContainer);
		const parsedSandboxIdleTimeoutMinutes = parseTimeoutMsInput(sandboxIdleTimeoutMinutes);
		if (
			parsedRequestTimeout === "invalid" ||
			parsedStreamTimeout === "invalid" ||
			parsedToolTimeout === "invalid" ||
			parsedAgentTimeout === "invalid" ||
			parsedConversationTimeout === "invalid" ||
			parsedMaxAgentWritableFileLines === "invalid" ||
			parsedMaxAgentWritableFileLines === null ||
			parsedMaxConcurrentTasks === "invalid" ||
			parsedMaxConcurrentTasks === null ||
			parsedSandboxMaxContainers === "invalid" ||
			parsedSandboxMaxContainers === null ||
			parsedSandboxAgentsPerContainer === "invalid" ||
			parsedSandboxAgentsPerContainer === null ||
			parsedSandboxMemoryPerContainerMb === "invalid" ||
			parsedSandboxMemoryPerContainerMb === null ||
			parsedSandboxCpusPerContainer === "invalid" ||
			parsedSandboxIdleTimeoutMinutes === "invalid" ||
			parsedSandboxIdleTimeoutMinutes === null
		) {
			setSaveError(
				"Timeout values must be integers >= 0; max writable file lines, concurrency, and sandbox pool settings must be within their allowed ranges.",
			);
			return;
		}
		if (parsedMaxAgentWritableFileLines < 1) {
			setSaveError("Max writable file lines must be an integer >= 1.");
			return;
		}
		if (parsedMaxConcurrentTasks < 1) {
			setSaveError("Max concurrent tasks must be an integer >= 1.");
			return;
		}
		if (parsedSandboxMaxContainers < 1) {
			setSaveError("Sandbox max containers must be an integer >= 1.");
			return;
		}
		if (parsedSandboxAgentsPerContainer < 0) {
			setSaveError("Sandbox agents per container must be an integer >= 0.");
			return;
		}
		if (parsedSandboxMemoryPerContainerMb < 1) {
			setSaveError("Sandbox memory per container must be an integer >= 1.");
			return;
		}
		if (parsedSandboxIdleTimeoutMinutes < 1) {
			setSaveError("Sandbox idle timeout must be an integer >= 1 minute.");
			return;
		}
		if (!config) {
			setSaveError("Runtime settings are still loading. Try again in a moment.");
			return;
		}
		if (
			draftCodeEmbeddingDefaults.provider === "openai_compatible" &&
			(!draftCodeEmbeddingDefaults.baseUrl || !draftCodeEmbeddingDefaults.model)
		) {
			setSaveError("Default OpenAI-compatible embeddings need both an endpoint URL and a model id.");
			return;
		}
		const selectedAgent = displayedAgents.find((agent) => agent.id === selectedAgentId);
		if (selectedAgent?.installed !== true) {
			setSaveError("Selected agent is not installed. Install it first or choose an installed agent.");
			return;
		}
		const shouldRequestNotificationPermission =
			!initialReadyForReviewNotificationsEnabled &&
			readyForReviewNotificationsEnabled &&
			notificationPermission === "default";
		if (shouldRequestNotificationPermission) {
			const nextPermission = await requestBrowserNotificationPermission();
			setNotificationPermission(nextPermission);
		}
		if (selectedAgentId === "nklein" && nkleinSettings.providerId.trim().length === 0) {
			setSaveError("Choose a !Klein provider before saving.");
			return;
		}
		if (selectedAgentId === "nklein") {
			const modelRoleAvailabilityWarning = MODEL_ROLE_IDS.map((roleId) =>
				getModelRoleAvailabilityWarning(roleId),
			).find((warning): warning is string => warning !== null);
			if (modelRoleAvailabilityWarning) {
				setSaveError(modelRoleAvailabilityWarning);
				return;
			}
			const modelRoleContextWarning = MODEL_ROLE_IDS.map((roleId) => getModelRoleContextWarning(roleId)).find(
				(warning): warning is string => warning !== null,
			);
			if (modelRoleContextWarning) {
				setSaveError(modelRoleContextWarning);
				return;
			}
			const nkleinProviderSaveResult = await nkleinSettings.saveProviderSettings();
			if (!nkleinProviderSaveResult.ok) {
				setSaveError(nkleinProviderSaveResult.message ?? "Could not save !Klein provider settings.");
				return;
			}
			const nkleinMcpSaveResult = await nkleinMcpSettings.saveMcpSettings();
			if (!nkleinMcpSaveResult.ok) {
				setSaveError(nkleinMcpSaveResult.message ?? "Could not save !Klein MCP settings.");
				return;
			}
		}
		const saved = await save({
			selectedAgentId,
			selectedAgentIdOverride,
			maxConcurrentTasksOverride,
			modelRolesOverride: modelRolesOverride !== null ? normalizeModelRolesForSettings(modelRolesOverride) : null,
			agentRulesetsOverride,
			agentAutonomousModeEnabled,
			agentTimeoutMode,
			agentTimeoutProfile,
			requestTimeoutMs: parsedRequestTimeout,
			streamTimeoutMs: parsedStreamTimeout,
			toolTimeoutMs: parsedToolTimeout,
			agentTimeoutMs: parsedAgentTimeout,
			conversationTimeoutMs: parsedConversationTimeout,
			maxAgentWritableFileLines: parsedMaxAgentWritableFileLines,
			maxConcurrentTasks: parsedMaxConcurrentTasks,
			workspaceBaseDir: workspaceBaseDir.trim() || null,
			sandboxMaxContainers: parsedSandboxMaxContainers,
			sandboxAgentsPerContainer: parsedSandboxAgentsPerContainer,
			sandboxMemoryPerContainerMb: parsedSandboxMemoryPerContainerMb,
			sandboxCpusPerContainer: parsedSandboxCpusPerContainer,
			sandboxIdleTimeoutMinutes: parsedSandboxIdleTimeoutMinutes,
			lostHeartbeatPolicy,
			decompositionAutoApplyEnabled,
			secondOpinionReviewEnabled,
			reviewMaxRounds,
			swarmGuardrails: inputsToSwarmGuardrails(swarmGuardrailInputs),
			developerModeEnabled,
			replayCardsEnabled,
			codeEmbeddingDefaults: draftCodeEmbeddingDefaults,
			readyForReviewNotificationsEnabled,
			modelRoles: normalizeModelRolesForSettings(modelRoles),
			concurrencyDefaults,
			concurrencyOverride,
			agentRulesets,
			shortcuts,
			commitPromptTemplate,
			openPrPromptTemplate,
		});
		if (!saved) {
			setSaveError("Could not save runtime settings. Check runtime logs and try again.");
			return;
		}
		if (draftThemeId !== initialThemeId) {
			saveThemeId(draftThemeId);
			setInitialThemeId(draftThemeId);
		}
		writeLocalStorageItem(LocalStorageKey.TaskStartInPlanMode, String(taskDefaultStartInPlanMode));
		writeLocalStorageItem(LocalStorageKey.TaskAutoReviewEnabled, String(taskDefaultAutoReviewEnabled));
		writeLocalStorageItem(LocalStorageKey.TaskAutoReviewMode, taskDefaultAutoReviewMode);
		setInitialTaskDefaultStartInPlanMode(taskDefaultStartInPlanMode);
		setInitialTaskDefaultAutoReviewEnabled(taskDefaultAutoReviewEnabled);
		setInitialTaskDefaultAutoReviewMode(taskDefaultAutoReviewMode);
		onSaved?.();
		handleDialogOpenChange(false);
	};

	const handleRequestPermission = () => {
		void (async () => {
			const nextPermission = await requestBrowserNotificationPermission();
			setNotificationPermission(nextPermission);
		})();
	};

	const handleOpenFilePath = useCallback(
		(filePath: string) => {
			setSaveError(null);
			void openFileOnHost(workspaceId, filePath).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				setSaveError(`Could not open file on host: ${message}`);
			});
		},
		[workspaceId],
	);

	const handleNKleinSetupSaved = useCallback(() => {
		refresh();
		onSaved?.();
	}, [onSaved, refresh]);

	const handleRefreshNKleinProviderModels = useCallback(async () => {
		const result = await nkleinSettings.refreshProviderModels();
		if (!result.ok && result.message) {
			throw new Error(result.message);
		}
	}, [nkleinSettings.refreshProviderModels]);

	const handleDialogOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (!nextOpen) {
				const persistedThemeId = readStoredThemeId();
				if (draftThemeId !== persistedThemeId) {
					previewThemeId(persistedThemeId);
				}
				setDraftThemeId(persistedThemeId);
				setInitialThemeId(persistedThemeId);
			}
			onOpenChange(nextOpen);
		},
		[draftThemeId, onOpenChange],
	);

	const currentThemeDef = THEMES.find((t) => t.id === draftThemeId);

	return (
		<>
			<Dialog
				open={open}
				onOpenChange={handleDialogOpenChange}
				contentClassName="!w-[min(1240px,calc(100vw-24px))] !max-w-none !max-h-[calc(100vh-24px)]"
			>
				<DialogHeader title="Settings" icon={<Settings size={16} />} />
				<div className="flex h-[min(760px,calc(100vh-120px))]">
					<SettingsNav items={navItems} activeId={activeSection} onSelect={handleNavSelect} />
					<div
						ref={bodyRef}
						onScroll={handleBodyScroll}
						className="px-5 pb-5 overflow-y-auto overscroll-contain flex-1 min-h-0 bg-surface-1"
					>
						{/* ---- General ---- */}
						<div data-settings-section="general" />
						<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
							<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
								<SlidersHorizontal size={16} className="text-text-secondary" />
								General
							</h2>
						</div>
						<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-1">
								Developer Mode
							</h6>
							<label
								htmlFor={developerModeCheckboxId}
								className="flex items-center gap-2 text-[13px] text-text-primary mt-2 cursor-pointer"
							>
								<RadixSwitch.Root
									id={developerModeCheckboxId}
									checked={developerModeEnabled}
									disabled={controlsDisabled}
									onCheckedChange={setDeveloperModeEnabled}
									className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
								>
									<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
								</RadixSwitch.Root>
								<span>Enable developer mode</span>
							</label>
							<p className="text-text-secondary text-[13px] ml-11 mt-0 mb-0">
								Shows developer-only surfaces: sidebar dev-test scenarios, debug tools, data-dir shortcut, reset
								state.
							</p>
						</div>

						<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-3">
								Advanced
							</h6>
							<div className="grid gap-4">
								<div>
									<label
										htmlFor={maxAgentWritableFileLinesId}
										className="block text-[13px] text-text-primary mb-1"
									>
										Max writable file lines
									</label>
									<input
										id={maxAgentWritableFileLinesId}
										type="number"
										min={1}
										value={maxAgentWritableFileLines}
										onChange={(event) => setMaxAgentWritableFileLines(event.target.value)}
										placeholder="1000"
										disabled={controlsDisabled}
										className="h-8 w-full max-w-[160px] rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary disabled:opacity-40"
									/>
									<p className="text-text-tertiary text-[11px] mt-1 mb-0">
										Maximum lines an agent write tool may create in a single file (must be &ge; 1).
									</p>
									{(() => {
										const v = Number.parseInt(maxAgentWritableFileLines, 10);
										return !Number.isFinite(v) || v < 1 ? (
											<p className="text-status-red text-[11px] mt-0.5 mb-0">
												Must be an integer &ge; 1 (clamped on save).
											</p>
										) : null;
									})()}
								</div>
								<div className="border-t border-border pt-4">
									<label
										htmlFor={replayCardsCheckboxId}
										className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer"
									>
										<RadixSwitch.Root
											id={replayCardsCheckboxId}
											checked={replayCardsEnabled}
											disabled={controlsDisabled}
											onCheckedChange={setReplayCardsEnabled}
											className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
										>
											<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
										</RadixSwitch.Root>
										<span>Enable card replay</span>
									</label>
									<p className="text-text-tertiary text-[11px] ml-11 mt-1 mb-0">
										Shows a Replay action on finished cards to re-run them from scratch. Off by default — the
										action is destructive and irreversible.
									</p>
								</div>
							</div>
						</div>

						{/* ---- Agents ---- */}
						<div data-settings-section="agents" />
						<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
							<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
								<Boxes size={16} className="text-text-secondary" />
								Agents
							</h2>
						</div>
						<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-1">
								Agent isolation
							</h6>
							<div className="rounded-md border border-border bg-surface-1 p-3">
								<div className="flex items-center gap-2 text-[13px] font-medium text-text-primary">
									<ShieldCheck size={14} className="text-text-secondary" />
									<span>
										{agentSandboxStatus.state === "ready"
											? "Docker sandbox ready"
											: agentSandboxStatus.state === "blocked"
												? "Docker sandbox unavailable"
												: "Checking Docker sandbox"}
									</span>
								</div>
								<div className="mt-2 grid gap-2 sm:grid-cols-2">
									<div className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
										<div className="text-[11px] text-text-tertiary">Docker daemon</div>
										<div className="text-[13px] font-medium text-text-primary">
											{agentSandboxStatus.dockerAvailable === null
												? "Checking"
												: agentSandboxStatus.dockerAvailable
													? "Available"
													: "Unavailable"}
										</div>
									</div>
									<div className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
										<div className="text-[11px] text-text-tertiary">Sandbox image</div>
										<div className="text-[13px] font-medium text-text-primary">
											{agentSandboxStatus.imageAvailable === null
												? "Checking"
												: agentSandboxStatus.imageAvailable
													? "Available"
													: "Unavailable"}
										</div>
										<div className="mt-1 text-[11px] text-text-secondary">{agentSandboxStatus.image}</div>
									</div>
								</div>
								{agentSandboxStatus.message ? (
									<p className="text-status-orange text-[12px] mt-2 mb-0">{agentSandboxStatus.message}</p>
								) : null}
							</div>
							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-1 mt-4 border-t border-border pt-4">
								Agent
							</h6>
							{cloudProviderSupportEnabled ? (
								<>
									{displayedAgents.map((agent) => (
										<AgentRow
											key={agent.id}
											agent={agent}
											isSelected={agent.id === selectedAgentId}
											onSelect={() => setSelectedAgentId(agent.id)}
											disabled={controlsDisabled}
										/>
									))}
									{config === null ? (
										<p className="text-text-secondary py-2">
											Checking which CLIs are installed for this project...
										</p>
									) : null}
								</>
							) : (
								<p className="text-[13px] text-text-secondary mt-0 mb-3">
									Local !Klein agent (cloud disabled).
								</p>
							)}
							<label
								htmlFor={bypassPermissionsCheckboxId}
								className="flex items-center gap-2 text-[13px] text-text-primary mt-2 cursor-pointer"
							>
								<RadixCheckbox.Root
									id={bypassPermissionsCheckboxId}
									aria-label="Enable bypass permissions flag"
									checked={agentAutonomousModeEnabled}
									disabled={controlsDisabled}
									onCheckedChange={(checked) => setAgentAutonomousModeEnabled(checked === true)}
									className="flex h-4 w-4 cursor-pointer items-center justify-center rounded border border-border bg-surface-2 data-[state=checked]:bg-accent data-[state=checked]:border-accent disabled:cursor-default disabled:opacity-40"
								>
									<RadixCheckbox.Indicator>
										<Check size={12} className="text-white" />
									</RadixCheckbox.Indicator>
								</RadixCheckbox.Root>
								<span>Enable bypass permissions flag</span>
							</label>
							<p className="text-text-secondary text-[13px] ml-6 mt-0 mb-0">
								Allows agents to use tools without stopping for permission. Use at your own risk.
							</p>
							<div className="mt-2 ml-6 max-w-[220px]">
								<p className="text-text-secondary text-[12px] mt-0 mb-1">Agent timeout</p>
								<NativeSelect
									fill
									value={agentTimeoutMode}
									onChange={(event) =>
										setAgentTimeoutMode(event.target.value as "normal" | "long" | "extended" | "unlimited")
									}
									disabled={controlsDisabled}
								>
									<option value="normal">Normal (1x)</option>
									<option value="long">Long (3x)</option>
									<option value="extended">Extended (6x)</option>
									<option value="unlimited">Unlimited</option>
								</NativeSelect>
							</div>
							<div className="mt-2 ml-6 max-w-[260px]">
								<p className="text-text-secondary text-[12px] mt-0 mb-1">Timeout profile</p>
								<NativeSelect
									fill
									value={agentTimeoutProfile}
									onChange={(event) =>
										setAgentTimeoutProfile(event.target.value as "cloud" | "local" | "custom")
									}
									disabled={controlsDisabled}
								>
									{cloudProviderSupportEnabled ? <option value="cloud">Cloud</option> : null}
									<option value="local">Local</option>
									<option value="custom">Custom</option>
								</NativeSelect>
								<p className="text-text-tertiary text-[11px] mt-1 mb-0">
									Unlimited timeout: requests may run indefinitely until manually cancelled.
								</p>
							</div>
							<div className="mt-2 ml-6 grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
								<div>
									<p className="text-text-secondary text-[12px] mt-0 mb-1">Request timeout (ms)</p>
									<input
										value={requestTimeoutMs}
										onChange={(event) => setRequestTimeoutMs(event.target.value)}
										placeholder="3600000"
										disabled={controlsDisabled}
										className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary"
									/>
								</div>
								<div>
									<p className="text-text-secondary text-[12px] mt-0 mb-1">Stream timeout (ms)</p>
									<input
										value={streamTimeoutMs}
										onChange={(event) => setStreamTimeoutMs(event.target.value)}
										placeholder="86400000"
										disabled={controlsDisabled}
										className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary"
									/>
								</div>
								<div>
									<p className="text-text-secondary text-[12px] mt-0 mb-1">Tool timeout (ms)</p>
									<input
										value={toolTimeoutMs}
										onChange={(event) => setToolTimeoutMs(event.target.value)}
										placeholder="86400000"
										disabled={controlsDisabled}
										className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary"
									/>
								</div>
								<div>
									<p className="text-text-secondary text-[12px] mt-0 mb-1">agentTimeoutMs</p>
									<input
										value={agentTimeoutMs}
										onChange={(event) => setAgentTimeoutMs(event.target.value)}
										placeholder="86400000"
										disabled={controlsDisabled}
										className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary"
									/>
								</div>
								<div style={{ gridColumn: "1 / span 2" }}>
									<p className="text-text-secondary text-[12px] mt-0 mb-1">conversationTimeoutMs</p>
									<input
										value={conversationTimeoutMs}
										onChange={(event) => setConversationTimeoutMs(event.target.value)}
										placeholder="604800000"
										disabled={controlsDisabled}
										className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary"
									/>
								</div>
								<div style={{ gridColumn: "1 / span 2" }} className="border-t border-border pt-3">
									<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
										<div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-text-secondary">
											<ShieldCheck size={14} />
											<span>Agent isolation pool</span>
										</div>
										<div className="flex items-center gap-1">
											<Button
												size="sm"
												variant={sandboxPoolPreset === "shared" ? "primary" : "default"}
												aria-pressed={sandboxPoolPreset === "shared"}
												disabled={controlsDisabled}
												onClick={applySharedSandboxPreset}
											>
												Shared
											</Button>
											<Button
												size="sm"
												variant={sandboxPoolPreset === "dedicated" ? "primary" : "default"}
												aria-pressed={sandboxPoolPreset === "dedicated"}
												disabled={controlsDisabled}
												onClick={applyDedicatedSandboxPreset}
											>
												Dedicated
											</Button>
										</div>
									</div>
									<div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
										<div>
											<p className="text-text-secondary text-[12px] mt-0 mb-1">sandboxMaxContainers</p>
											<input
												value={sandboxMaxContainers}
												onChange={(event) => setSandboxMaxContainers(event.target.value)}
												placeholder="1"
												disabled={controlsDisabled}
												className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary"
											/>
										</div>
										<div>
											<p className="text-text-secondary text-[12px] mt-0 mb-1">sandboxAgentsPerContainer</p>
											<input
												value={sandboxAgentsPerContainer}
												onChange={(event) => setSandboxAgentsPerContainer(event.target.value)}
												placeholder="0"
												disabled={controlsDisabled}
												className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary"
											/>
										</div>
										<div>
											<p className="text-text-secondary text-[12px] mt-0 mb-1">
												sandboxMemoryPerContainerMb
											</p>
											<input
												value={sandboxMemoryPerContainerMb}
												onChange={(event) => setSandboxMemoryPerContainerMb(event.target.value)}
												placeholder="2048"
												disabled={controlsDisabled}
												className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary"
											/>
										</div>
										<div>
											<p className="text-text-secondary text-[12px] mt-0 mb-1">sandboxCpusPerContainer</p>
											<input
												value={sandboxCpusPerContainer}
												onChange={(event) => setSandboxCpusPerContainer(event.target.value)}
												placeholder="2"
												disabled={controlsDisabled}
												className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary"
											/>
										</div>
										<div style={{ gridColumn: "1 / span 2" }}>
											<p className="text-text-secondary text-[12px] mt-0 mb-1">sandboxIdleTimeoutMinutes</p>
											<input
												value={sandboxIdleTimeoutMinutes}
												onChange={(event) => setSandboxIdleTimeoutMinutes(event.target.value)}
												placeholder="10"
												disabled={controlsDisabled}
												className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary"
											/>
											<p className="text-text-tertiary text-[11px] mt-1 mb-0">
												Agents per container accepts 0 for unlimited sharing; maxConcurrentTasks remains the
												outer parallelism cap.
											</p>
										</div>
									</div>
								</div>
								<div style={{ gridColumn: "1 / span 2" }}>
									<p className="text-text-secondary text-[12px] mt-0 mb-1">Lost heartbeat policy</p>
									<NativeSelect
										fill
										value={lostHeartbeatPolicy}
										onChange={(event) =>
											setLostHeartbeatPolicy(event.target.value as RuntimeLostHeartbeatPolicy)
										}
										disabled={controlsDisabled}
									>
										<option value="park">Park + actions</option>
										<option value="keep_running">Keep running</option>
									</NativeSelect>
									<p className="text-text-tertiary text-[11px] mt-1 mb-0">
										Park lost !Klein sessions for review, or keep them running with the lost status visible.
									</p>
								</div>
								<div style={{ gridColumn: "1 / span 2" }}>
									<div className="flex items-center gap-2 text-[13px] text-text-primary">
										<RadixSwitch.Root
											checked={decompositionAutoApplyEnabled}
											disabled={controlsDisabled}
											onCheckedChange={setDecompositionAutoApplyEnabled}
											aria-labelledby={decompositionAutoApplyLabelId}
											className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
										>
											<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
										</RadixSwitch.Root>
										<span id={decompositionAutoApplyLabelId}>Auto-apply valid decomposition artifacts</span>
									</div>
									<p className="text-text-tertiary text-[11px] mt-1 mb-0">
										When disabled, valid task graphs stay pending on the source card for manual review.
									</p>
								</div>
								<div style={{ gridColumn: "1 / span 2" }}>
									<div className="flex items-center gap-2 text-[13px] text-text-primary">
										<RadixSwitch.Root
											checked={secondOpinionReviewEnabled}
											disabled={controlsDisabled}
											onCheckedChange={setSecondOpinionReviewEnabled}
											aria-labelledby={secondOpinionReviewLabelId}
											className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
										>
											<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
										</RadixSwitch.Root>
										<span id={secondOpinionReviewLabelId}>Second-opinion review of completed cards</span>
									</div>
									<p className="text-text-tertiary text-[11px] mt-1 mb-0">
										When on, each completed worker card gets a peer review from the Reviewer role before
										delivery: the reviewer approves (a valued sign-off) or sends concrete feedback back to the
										worker, bounded by a round cap with stall/loop detection. When off, cards go straight to
										review/delivery.
									</p>
									<div className="mt-2 flex items-center gap-2 text-[12px] text-text-secondary">
										<label htmlFor={reviewMaxRoundsId}>Max review rounds</label>
										<input
											id={reviewMaxRoundsId}
											type="number"
											min={1}
											value={reviewMaxRounds}
											disabled={controlsDisabled || !secondOpinionReviewEnabled}
											onChange={(event) => {
												const parsed = Number.parseInt(event.target.value, 10);
												setReviewMaxRounds(Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
											}}
											className="w-16 rounded-md border border-border bg-surface-2 px-2 py-1 text-text-primary disabled:opacity-40"
										/>
										<span className="text-text-tertiary text-[11px]">
											Rounds before a bouncing card parks for attention (default 20).
										</span>
									</div>
								</div>
								<div style={{ gridColumn: "1 / span 2" }}>
									<SwarmGuardrailsSettingsPanel
										value={swarmGuardrailInputs}
										onChange={setSwarmGuardrailInputs}
										disabled={controlsDisabled}
										maxConcurrentTasks={maxConcurrentTasks}
										sandboxMaxContainers={sandboxMaxContainers}
										sandboxPool={sandboxPoolSummary}
										lostHeartbeatPolicy={lostHeartbeatPolicy}
										decompositionAutoApplyEnabled={decompositionAutoApplyEnabled}
									/>
								</div>
								<div
									style={{ gridColumn: "1 / span 2" }}
									className="rounded-md border border-border bg-surface-1 p-3"
								>
									<div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-text-secondary">
										<SlidersHorizontal size={14} />
										<span>Advanced policy visibility</span>
									</div>
									<div className="grid gap-2 sm:grid-cols-2">
										{ADVANCED_POLICY_ROWS.map((row) => (
											<div
												key={row.label}
												className="rounded-md border border-border bg-surface-2 px-2 py-1.5"
											>
												<div className="text-[11px] text-text-tertiary">{row.label}</div>
												<div className="text-[13px] font-medium text-text-primary">{row.value}</div>
												<div className="mt-1 text-[11px] text-text-secondary">{row.detail}</div>
												<div className="mt-1 font-mono text-[10px] text-text-tertiary">{row.raw}</div>
											</div>
										))}
									</div>
								</div>
								<div
									style={{ gridColumn: "1 / span 2" }}
									className="rounded-md border border-border bg-surface-1 p-3"
								>
									<div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-text-secondary">
										<ShieldCheck size={14} />
										<span>Agent rulesets</span>
									</div>
									<AgentRulesetsSettingsPanel
										value={agentRulesets}
										disabled={controlsDisabled}
										onChange={setAgentRulesets}
									/>
								</div>
							</div>
						</div>
						{/* ---- Tasks ---- */}
						<div data-settings-section="tasks" />
						<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
							<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
								<Check size={16} className="text-text-secondary" />
								Tasks
							</h2>
						</div>
						<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-1">
								New Task Defaults
							</h6>
							<div className="grid gap-3">
								<label
									htmlFor={taskDefaultStartInPlanModeId}
									className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer"
								>
									<RadixSwitch.Root
										id={taskDefaultStartInPlanModeId}
										checked={taskDefaultStartInPlanMode}
										disabled={controlsDisabled}
										onCheckedChange={setTaskDefaultStartInPlanMode}
										className="relative h-5 w-9 rounded-full bg-surface-4 data-[state=checked]:bg-accent cursor-pointer disabled:opacity-40"
									>
										<RadixSwitch.Thumb className="block h-4 w-4 rounded-full bg-white shadow-sm transition-transform translate-x-0.5 data-[state=checked]:translate-x-[18px]" />
									</RadixSwitch.Root>
									<span>Start new tasks in Planning</span>
								</label>
								<label
									htmlFor={taskDefaultAutoReviewEnabledId}
									className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer"
								>
									<RadixSwitch.Root
										id={taskDefaultAutoReviewEnabledId}
										checked={taskDefaultAutoReviewEnabled}
										disabled={controlsDisabled}
										onCheckedChange={setTaskDefaultAutoReviewEnabled}
										className="relative h-5 w-9 rounded-full bg-surface-4 data-[state=checked]:bg-accent cursor-pointer disabled:opacity-40"
									>
										<RadixSwitch.Thumb className="block h-4 w-4 rounded-full bg-white shadow-sm transition-transform translate-x-0.5 data-[state=checked]:translate-x-[18px]" />
									</RadixSwitch.Root>
									<span>Run review action automatically</span>
								</label>
								<div className="max-w-[220px]">
									<p className="text-text-secondary text-[12px] mt-0 mb-1">Automatic review action</p>
									<NativeSelect
										fill
										value={taskDefaultAutoReviewMode}
										onChange={(event) =>
											setTaskDefaultAutoReviewMode(event.target.value as RuntimeTaskAutoReviewMode)
										}
										disabled={controlsDisabled || !taskDefaultAutoReviewEnabled}
									>
										{TASK_AUTO_REVIEW_MODE_OPTIONS.map((option) => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</NativeSelect>
								</div>
							</div>
						</div>

						<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-3">
								Swarm Parallelism
							</h6>
							<div>
								<label htmlFor={maxConcurrentTasksId} className="block text-[13px] text-text-primary mb-1">
									Max concurrent tasks
								</label>
								<input
									id={maxConcurrentTasksId}
									type="number"
									min={1}
									value={maxConcurrentTasks}
									onChange={(event) => setMaxConcurrentTasks(event.target.value)}
									placeholder="3"
									disabled={controlsDisabled}
									className="h-8 w-full max-w-[120px] rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary disabled:opacity-40"
								/>
								<p className="text-text-tertiary text-[11px] mt-1 mb-0">
									How many dependency-unblocked cards the swarm may run in parallel (must be &ge; 1). The
									sandbox pool may further limit effective parallelism.
								</p>
								{(() => {
									const v = Number.parseInt(maxConcurrentTasks, 10);
									return !Number.isFinite(v) || v < 1 ? (
										<p className="text-status-red text-[11px] mt-0.5 mb-0">
											Must be an integer &ge; 1 (clamped on save).
										</p>
									) : null;
								})()}
							</div>
						</div>

						<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-2">
								Per-provider / per-model concurrency
							</h6>
							<p className="text-text-tertiary text-[11px] mt-0 mb-2">
								Cap how many sessions run at once on a provider, or on a specific model (canonical{" "}
								<code>provider:model:endpoint</code> id). A cap of 1 serializes; remove a row for no extra
								limit. This is the global default (a per-project override is a follow-up); it AND-s with the
								per-model registry limit.
							</p>
							<ConcurrencyEditor
								perProvider={concurrencyDefaults.perProvider}
								perModel={concurrencyDefaults.perModel}
								disabled={controlsDisabled}
								onChange={setConcurrencyDefaults}
							/>
						</div>

						<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-3">
								Workspace Location
							</h6>
							<div>
								<label htmlFor={workspaceBaseDirId} className="block text-[13px] text-text-primary mb-1">
									Workspace base directory
								</label>
								<input
									id={workspaceBaseDirId}
									type="text"
									value={workspaceBaseDir}
									onChange={(event) => setWorkspaceBaseDir(event.target.value)}
									placeholder="~/.nklein/dev-workspaces"
									disabled={controlsDisabled}
									className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary disabled:opacity-40"
								/>
								<p className="text-text-tertiary text-[11px] mt-1 mb-0">
									Base directory under which !Klein creates new workspaces (dev-test projects, scaffolds). For
									safety it must be outside the !Klein install folder; an unsafe path is redirected
									automatically. Leave blank to use the default <code>~/.nklein/dev-workspaces</code> (or the{" "}
									<code>NKLEIN_DEV_WORKSPACE_DIR</code>
									environment variable).
								</p>
							</div>
						</div>

						<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-1">
								Agent Capabilities & Autonomy
							</h6>
							<p className="text-text-secondary text-[12px] mt-0 mb-3">
								Tiers for what agents can reach (network &amp; tools) and how far delivery proceeds without you.
								Docker isolation and the local-models-only lockdown never relax at any tier.
							</p>
							<div className="grid gap-4">
								<div>
									<p className="text-text-primary text-[12px] font-medium mt-0 mb-1">Capabilities</p>
									<NativeSelect
										fill
										value={agentRulesets.capability.globalPreset}
										onChange={(event) =>
											setAgentRulesets((prev) => ({
												...prev,
												capability: {
													...prev.capability,
													globalPreset: event.target
														.value as AgentRulesetsConfigPayload["capability"]["globalPreset"],
												},
											}))
										}
										disabled={controlsDisabled}
									>
										{Object.entries(AGENT_CAPABILITY_TIER_INFO).map(([tier, info]) => (
											<option key={tier} value={tier}>
												{info.label}
											</option>
										))}
									</NativeSelect>
									<p className="text-text-tertiary text-[11px] mt-1 mb-0">
										{AGENT_CAPABILITY_TIER_INFO[agentRulesets.capability.globalPreset].description}
									</p>
								</div>
								<div>
									<p className="text-text-primary text-[12px] font-medium mt-0 mb-1">Delivery autonomy</p>
									<NativeSelect
										fill
										value={agentRulesets.delivery.globalPreset}
										onChange={(event) =>
											setAgentRulesets((prev) => ({
												...prev,
												delivery: {
													...prev.delivery,
													globalPreset: event.target
														.value as AgentRulesetsConfigPayload["delivery"]["globalPreset"],
												},
											}))
										}
										disabled={controlsDisabled}
									>
										{Object.entries(AGENT_DELIVERY_TIER_INFO).map(([tier, info]) => (
											<option key={tier} value={tier}>
												{info.label}
											</option>
										))}
									</NativeSelect>
									<p className="text-text-tertiary text-[11px] mt-1 mb-0">
										{AGENT_DELIVERY_TIER_INFO[agentRulesets.delivery.globalPreset].description}
									</p>
								</div>
							</div>
						</div>

						{/* ---- NKlein ---- */}
						{selectedAgentId === "nklein" ? (
							<>
								<div data-settings-section="nklein" />
								<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
									<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
										<Bot size={16} className="text-text-secondary" />
										NKlein
									</h2>
								</div>
								<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
									<NKleinSetupSection
										controller={nkleinSettings}
										mcpController={nkleinMcpSettings}
										controlsDisabled={controlsDisabled}
										workspaceId={workspaceId}
										cloudProviderSupportEnabled={cloudProviderSupportEnabled}
										accountSection={
											cloudProviderSupportEnabled && nkleinSettings.providerId.trim() === "nklein" ? (
												<AccountOrganizationSection
													workspaceId={workspaceId}
													open={open}
													onAccountSwitched={onAccountSwitched}
												/>
											) : null
										}
										onError={setSaveError}
										onSaved={handleNKleinSetupSaved}
									/>
									<NKleinModelContextWindowSettingsPanel
										workspaceId={workspaceId}
										open={open}
										disabled={controlsDisabled}
										selectedProviderId={nkleinSettings.providerId}
										selectedModelId={nkleinSettings.modelId}
										selectedProviderModels={nkleinSettings.providerModels}
										onRefreshProviderModels={handleRefreshNKleinProviderModels}
										onError={setSaveError}
									/>
									<div className="mt-4 border-t border-border pt-4">
										<div className="mb-2 flex items-center justify-between gap-3">
											<h6 className="m-0 text-[12px] font-semibold uppercase tracking-wider text-text-secondary">
												Model roles
											</h6>
											<Button
												variant="ghost"
												size="sm"
												icon={<BarChart3 size={14} />}
												onClick={() => setModelPerformanceStatsOpen(true)}
											>
												Model Performance
											</Button>
										</div>
										<ModelRolesEditor
											value={modelRoles}
											onChange={setModelRoles}
											disabled={controlsDisabled}
											nkleinProviderId={nkleinProviderId}
											providerCatalog={nkleinSettings.providerCatalog}
											providerModels={nkleinSettings.providerModels}
											isLoadingProviderModels={nkleinSettings.isLoadingProviderModels}
											modelRoleModelsByProviderId={modelRoleModelsByProviderId}
											loadingModelRoleProviderIds={loadingModelRoleProviderIds}
											cloudProviderSupportEnabled={cloudProviderSupportEnabled}
										/>
									</div>
									{cloudProviderSupportEnabled ? (
										<NKleinAdvisorActions
											workspaceId={workspaceId}
											disabled={controlsDisabled}
											mcpController={nkleinMcpSettings}
											runtimeConfigSummary={advisorRuntimeConfigSummary}
											advisorProviderId={config?.nkleinProviderSettings.providerId ?? ""}
											advisorModelId={config?.nkleinProviderSettings.modelId ?? ""}
											onError={setSaveError}
										/>
									) : null}
									{/* informational dev surface -> developer mode only (works in packaged builds) */}
									{developerModeEnabled ? (
										<div className="mt-4 border-t border-border pt-4">
											<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-2">
												Developer Tools
											</h6>
											<NKleinSmokeEvalTrial
												workspaceId={workspaceId}
												disabled={controlsDisabled}
												onError={setSaveError}
											/>
											<NKleinDogfoodSuggestion
												workspaceId={workspaceId}
												disabled={controlsDisabled}
												onError={setSaveError}
											/>
										</div>
									) : null}
									<div className="mt-4 border-t border-border pt-4">
										<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-2">
											Code intelligence embeddings
										</h6>
										<div className="grid gap-3">
											<div className="grid gap-2 lg:grid-cols-[minmax(180px,0.8fr)_1fr]">
												<div className="min-w-0">
													<span className="mb-1 block text-[12px] text-text-secondary">
														Global default provider
													</span>
													<NativeSelect
														value={codeEmbeddingDefaultsProvider}
														onChange={(event) =>
															setCodeEmbeddingDefaultsProvider(
																event.target.value as RuntimeCodeEmbeddingSettings["provider"],
															)
														}
														disabled={controlsDisabled}
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
													labelPrefix="Default"
													disabled={controlsDisabled}
													provider={codeEmbeddingDefaultsProvider}
													baseUrl={codeEmbeddingDefaultsBaseUrl}
													model={codeEmbeddingDefaultsModel}
													suggestedBaseUrl={suggestedCodeEmbeddingBaseUrl}
													endpointPlaceholder="http://127.0.0.1:11434/v1/embeddings"
													modelPlaceholder="nomic-embed-text"
													onBaseUrlChange={setCodeEmbeddingDefaultsBaseUrl}
													onModelChange={setCodeEmbeddingDefaultsModel}
													onError={setSaveError}
												/>
											</div>
										</div>
									</div>
								</div>
							</>
						) : null}

						{/* ---- Git Prompts ---- */}
						<div data-settings-section="git-prompts" />
						<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
							<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
								<GitCommit size={16} className="text-text-secondary" />
								Git Prompts
							</h2>
						</div>
						<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
							<p className="text-text-secondary text-[13px] mt-0 mb-2">
								Modify the prompts sent to the agent when using Commit or Make PR on tasks in Review.
							</p>
							<div className="flex items-center justify-between gap-2 mb-2">
								<NativeSelect
									value={selectedPromptVariant}
									onChange={(event) => setSelectedPromptVariant(event.target.value as TaskGitAction)}
									disabled={controlsDisabled}
									style={{ minWidth: 220 }}
								>
									{GIT_PROMPT_VARIANT_OPTIONS.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</NativeSelect>
								<Button
									variant="ghost"
									size="sm"
									onClick={handleResetSelectedPrompt}
									disabled={controlsDisabled || isSelectedPromptAtDefault}
								>
									Reset
								</Button>
							</div>
							<textarea
								rows={5}
								value={selectedPromptValue}
								onChange={(event) => handleSelectedPromptChange(event.target.value)}
								placeholder={selectedPromptPlaceholder}
								disabled={controlsDisabled}
								className="w-full rounded-md border border-border bg-surface-2 p-3 text-[13px] text-text-primary font-mono placeholder:text-text-tertiary focus:border-border-focus focus:outline-none resize-none disabled:opacity-40"
							/>
							<p className="text-text-secondary text-[13px] mt-2 mb-0">
								Use{" "}
								<InlineUtilityButton
									text={
										copiedVariableToken === TASK_GIT_BASE_REF_PROMPT_VARIABLE.token
											? "Copied!"
											: TASK_GIT_BASE_REF_PROMPT_VARIABLE.token
									}
									monospace
									widthCh={Math.max(TASK_GIT_BASE_REF_PROMPT_VARIABLE.token.length, "Copied!".length) + 2}
									onClick={() => {
										handleCopyVariableToken(TASK_GIT_BASE_REF_PROMPT_VARIABLE.token);
									}}
									disabled={controlsDisabled}
								/>{" "}
								to reference {TASK_GIT_BASE_REF_PROMPT_VARIABLE.description}
							</p>
						</div>

						{/* ---- Notifications ---- */}
						<div data-settings-section="notifications" />
						<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
							<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
								<Bell size={16} className="text-text-secondary" />
								Notifications
							</h2>
						</div>
						<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
							<div className="flex items-center gap-2">
								<RadixSwitch.Root
									checked={readyForReviewNotificationsEnabled}
									disabled={controlsDisabled}
									onCheckedChange={setReadyForReviewNotificationsEnabled}
									className="relative h-5 w-9 rounded-full bg-surface-4 data-[state=checked]:bg-accent cursor-pointer disabled:opacity-40"
								>
									<RadixSwitch.Thumb className="block h-4 w-4 rounded-full bg-white shadow-sm transition-transform translate-x-0.5 data-[state=checked]:translate-x-[18px]" />
								</RadixSwitch.Root>
								<span className="text-[13px] text-text-primary">Notify when a task is ready for review</span>
							</div>
							<div className="flex items-center gap-2 mt-2">
								<p className="text-text-secondary text-[13px] m-0">
									Browser permission: {formatNotificationPermissionStatus(notificationPermission)}
								</p>
								{notificationPermission !== "granted" && notificationPermission !== "unsupported" ? (
									<InlineUtilityButton
										text="Request permission"
										onClick={handleRequestPermission}
										disabled={controlsDisabled}
									/>
								) : null}
							</div>
						</div>

						{/* ---- Appearance ---- */}
						<div data-settings-section="appearance" />
						<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
							<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
								<Palette size={16} className="text-text-secondary" />
								Appearance
							</h2>
						</div>
						<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-2">
								Theme
							</h6>
							<div className="min-w-0 w-1/2 max-w-full">
								<RadixSelect.Root
									value={draftThemeId}
									onValueChange={(value) => {
										setDraftThemeId(value as ThemeId);
										previewThemeId(value as ThemeId);
									}}
									onOpenChange={(selectOpen) => {
										if (!selectOpen) {
											previewThemeId(draftThemeId);
										}
									}}
								>
									<RadixSelect.Trigger
										className="flex h-9 w-full cursor-pointer items-center justify-between rounded-md border border-border-bright bg-surface-2 px-3 text-[13px] text-text-primary outline-none hover:bg-surface-3 hover:border-border-bright focus:border-border-focus focus:outline-none"
										aria-label="Theme"
									>
										<span className="flex items-center gap-2.5">
											<span className="flex shrink-0 h-5 w-10 rounded overflow-hidden border border-border">
												<span
													className="flex-1"
													style={{ background: currentThemeDef?.surface ?? "#1F2428" }}
												/>
												<span
													className="flex-1"
													style={{ background: currentThemeDef?.accent ?? "#0084FF" }}
												/>
												<span
													className="flex-1"
													style={{ background: currentThemeDef?.accent2 ?? "#7C5CFF" }}
												/>
											</span>
											<RadixSelect.Value />
										</span>
										<RadixSelect.Icon>
											<ChevronDown size={14} className="text-text-tertiary" />
										</RadixSelect.Icon>
									</RadixSelect.Trigger>
									<RadixSelect.Portal>
										<RadixSelect.Content
											className="z-50 max-h-72 w-(--radix-select-trigger-width) overflow-auto rounded-lg border border-border bg-surface-1 p-1 shadow-xl"
											position="popper"
											sideOffset={4}
											align="start"
										>
											<RadixSelect.Viewport>
												{THEME_GROUPS.map((group) => {
													const groupThemes = THEMES.filter((t) => t.group === group.key);
													if (groupThemes.length === 0) return null;
													return (
														<RadixSelect.Group key={group.key}>
															<RadixSelect.Label className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
																{group.label}
															</RadixSelect.Label>
															{groupThemes.map((theme) => (
																<RadixSelect.Item
																	key={theme.id}
																	value={theme.id}
																	className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-text-secondary outline-none data-highlighted:bg-surface-3 data-highlighted:text-text-primary data-[state=checked]:text-text-primary"
																	onMouseEnter={() => previewThemeId(theme.id)}
																	onFocus={() => previewThemeId(theme.id)}
																>
																	<span className="flex shrink-0 h-5 w-10 rounded overflow-hidden border border-border">
																		<span className="flex-1" style={{ background: theme.surface }} />
																		<span className="flex-1" style={{ background: theme.accent }} />
																		<span className="flex-1" style={{ background: theme.accent2 }} />
																	</span>
																	<RadixSelect.ItemText>{theme.label}</RadixSelect.ItemText>
																	<RadixSelect.ItemIndicator className="ml-auto">
																		<Check size={14} className="text-accent-2" />
																	</RadixSelect.ItemIndicator>
																</RadixSelect.Item>
															))}
														</RadixSelect.Group>
													);
												})}
											</RadixSelect.Viewport>
										</RadixSelect.Content>
									</RadixSelect.Portal>
								</RadixSelect.Root>
							</div>

							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary mt-5 mb-2">
								Layout
							</h6>
							<Button size="sm" onClick={resetLayoutCustomizations}>
								Reset layout
							</Button>
							<p className="text-text-secondary text-[13px] mt-2 mb-0">
								Reset sidebar, split pane, and terminal resize customizations back to their defaults.
							</p>
						</div>
						<div data-settings-section="project" />
						<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
							<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
								<FolderOpen size={16} className="text-text-secondary" />
								Project
							</h2>
						</div>
						<p
							className="text-text-secondary font-mono text-xs m-0 mb-3 break-all"
							style={{ cursor: config?.projectConfigPath ? "pointer" : undefined }}
							onClick={() => {
								if (config?.projectConfigPath) {
									handleOpenFilePath(config.projectConfigPath);
								}
							}}
						>
							{config?.projectConfigPath
								? formatPathForDisplay(config.projectConfigPath)
								: "<project>/.nklein/nklein/config.json"}
							{config?.projectConfigPath ? (
								<ExternalLink size={12} className="inline ml-1.5 align-middle" />
							) : null}
						</p>
						<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-3">
								Per-project overrides
							</h6>
							{config?.projectConfigPath ? (
								<div className="grid gap-4">
									<OverrideRow
										label="Max concurrent tasks"
										inheritLabel={String(config.maxConcurrentTasks)}
										isOverridden={maxConcurrentTasksOverride !== null}
										onOverride={() => setMaxConcurrentTasksOverride(config.maxConcurrentTasks)}
										onRevert={() => setMaxConcurrentTasksOverride(null)}
										disabled={controlsDisabled}
									>
										<input
											id="runtime-settings-max-concurrent-tasks-override"
											type="number"
											min={1}
											value={maxConcurrentTasksOverride ?? ""}
											onChange={(event) => {
												const parsed = Number.parseInt(event.target.value, 10);
												setMaxConcurrentTasksOverride(
													Number.isFinite(parsed) && parsed >= 1 ? parsed : null,
												);
											}}
											disabled={controlsDisabled}
											className="h-8 w-full max-w-[120px] rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary disabled:opacity-40"
										/>
									</OverrideRow>
									<OverrideRow
										label="Agent"
										inheritLabel={config.selectedAgentId}
										isOverridden={selectedAgentIdOverride !== null}
										onOverride={() => setSelectedAgentIdOverride(config.selectedAgentId)}
										onRevert={() => setSelectedAgentIdOverride(null)}
										disabled={controlsDisabled}
									>
										<NativeSelect
											value={selectedAgentIdOverride ?? ""}
											onChange={(event) =>
												setSelectedAgentIdOverride((event.target.value as RuntimeAgentId) || null)
											}
											disabled={controlsDisabled}
											style={{ maxWidth: 260 }}
										>
											{config.agents.map((agent) => (
												<option key={agent.id} value={agent.id}>
													{agent.label}
												</option>
											))}
										</NativeSelect>
									</OverrideRow>
									<OverrideRow
										label="Model roles"
										inheritLabel={
											Object.keys(config.effectiveModelRoles ?? config.modelRoles ?? {}).length > 0
												? `${Object.keys(config.effectiveModelRoles ?? config.modelRoles ?? {}).length} role(s) customised`
												: "defaults"
										}
										isOverridden={modelRolesOverride !== null}
										onOverride={() =>
											setModelRolesOverride(
												normalizeModelRolesForSettings(config.effectiveModelRoles ?? config.modelRoles),
											)
										}
										onRevert={() => setModelRolesOverride(null)}
										disabled={controlsDisabled}
									>
										<ModelRolesEditor
											value={modelRolesOverride ?? {}}
											onChange={(action) =>
												setModelRolesOverride((prev) =>
													typeof action === "function" ? action(prev ?? {}) : action,
												)
											}
											disabled={controlsDisabled}
											nkleinProviderId={nkleinProviderId}
											providerCatalog={nkleinSettings.providerCatalog}
											providerModels={nkleinSettings.providerModels}
											isLoadingProviderModels={nkleinSettings.isLoadingProviderModels}
											modelRoleModelsByProviderId={modelRoleModelsByProviderId}
											loadingModelRoleProviderIds={loadingModelRoleProviderIds}
											cloudProviderSupportEnabled={cloudProviderSupportEnabled}
										/>
									</OverrideRow>
									<OverrideRow
										label="Agent rulesets"
										inheritLabel={`capability: ${(config.effectiveAgentRulesets ?? config.agentRulesets ?? DEFAULT_AGENT_RULESETS_CONFIG).capability.globalPreset}, delivery: ${(config.effectiveAgentRulesets ?? config.agentRulesets ?? DEFAULT_AGENT_RULESETS_CONFIG).delivery.globalPreset}`}
										isOverridden={agentRulesetsOverride !== null}
										onOverride={() =>
											setAgentRulesetsOverride(
												config.effectiveAgentRulesets ??
													config.agentRulesets ??
													DEFAULT_AGENT_RULESETS_CONFIG,
											)
										}
										onRevert={() => setAgentRulesetsOverride(null)}
										disabled={controlsDisabled}
									>
										<AgentRulesetsSettingsPanel
											value={agentRulesetsOverride ?? DEFAULT_AGENT_RULESETS_CONFIG}
											disabled={controlsDisabled}
											onChange={setAgentRulesetsOverride}
										/>
									</OverrideRow>
									<OverrideRow
										label="Concurrency caps"
										inheritLabel={
											Object.keys(concurrencyDefaults.perProvider).length +
												Object.keys(concurrencyDefaults.perModel).length >
											0
												? `${Object.keys(concurrencyDefaults.perProvider).length} provider, ${Object.keys(concurrencyDefaults.perModel).length} model cap(s)`
												: "defaults"
										}
										isOverridden={concurrencyOverride !== null}
										onOverride={() =>
											setConcurrencyOverride({
												perProvider: { ...concurrencyDefaults.perProvider },
												perModel: { ...concurrencyDefaults.perModel },
											})
										}
										onRevert={() => setConcurrencyOverride(null)}
										disabled={controlsDisabled}
									>
										<ConcurrencyEditor
											perProvider={concurrencyOverride?.perProvider ?? {}}
											perModel={concurrencyOverride?.perModel ?? {}}
											disabled={controlsDisabled}
											onChange={setConcurrencyOverride}
										/>
									</OverrideRow>
								</div>
							) : (
								<p className="text-[13px] text-text-secondary m-0">
									Select a project to set per-project overrides.
								</p>
							)}
						</div>

						<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
							<div className="flex items-center justify-between mb-2">
								<h6
									ref={shortcutsSectionRef}
									className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0"
								>
									Script shortcuts
								</h6>
								<Button
									variant="ghost"
									size="sm"
									icon={<Plus size={14} />}
									onClick={() => {
										setShortcuts((current) => {
											const nextLabel = getNextShortcutLabel(current, "Run");
											setPendingShortcutScrollIndex(current.length);
											return [
												...current,
												{
													label: nextLabel,
													command: "",
													icon: "play",
												},
											];
										});
									}}
									disabled={controlsDisabled}
								>
									Add
								</Button>
							</div>

							{shortcuts.map((shortcut, shortcutIndex) => (
								<div
									key={shortcutIndex}
									ref={(node) => {
										shortcutRowRefs.current[shortcutIndex] = node;
									}}
									className="grid gap-2 mb-1"
									style={{
										gridTemplateColumns: "max-content 1fr 2fr auto",
									}}
								>
									<ShortcutIconPicker
										value={shortcut.icon}
										onSelect={(icon) =>
											setShortcuts((current) =>
												current.map((item, itemIndex) =>
													itemIndex === shortcutIndex ? { ...item, icon } : item,
												),
											)
										}
									/>
									<input
										value={shortcut.label}
										onChange={(event) =>
											setShortcuts((current) =>
												current.map((item, itemIndex) =>
													itemIndex === shortcutIndex ? { ...item, label: event.target.value } : item,
												),
											)
										}
										placeholder="Label"
										className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
									/>
									<input
										value={shortcut.command}
										onChange={(event) =>
											setShortcuts((current) =>
												current.map((item, itemIndex) =>
													itemIndex === shortcutIndex ? { ...item, command: event.target.value } : item,
												),
											)
										}
										placeholder="Command"
										className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
									/>
									<Button
										variant="ghost"
										size="sm"
										icon={<X size={14} />}
										aria-label={`Remove shortcut ${shortcut.label}`}
										onClick={() =>
											setShortcuts((current) =>
												current.filter((_, itemIndex) => itemIndex !== shortcutIndex),
											)
										}
									/>
								</div>
							))}
							{shortcuts.length === 0 ? (
								<p className="text-text-secondary text-[13px]">No shortcuts configured.</p>
							) : null}
						</div>

						{saveError ? (
							<div className="flex gap-2 rounded-md border border-status-red/30 bg-status-red/5 p-3 text-[13px]">
								<span className="text-text-primary">{saveError}</span>
							</div>
						) : null}
					</div>
				</div>
				<DialogFooter>
					{/* Docs aren't published yet (todo §5.T): keep the entry point visible but disabled so it doesn't
					    open a dead link. Native title attr (the dialog's tooltip pattern; no TooltipProvider here).
					    Re-enable once docs.nklein.bot is live. */}
					<span className="mr-auto mt-[3px] inline-flex" title="Documentation isn't available yet — coming soon.">
						<Button size="sm" variant="ghost" icon={<ExternalLink size={14} />} disabled>
							Read the docs (not yet available)
						</Button>
					</span>
					<Button onClick={() => handleDialogOpenChange(false)} disabled={controlsDisabled}>
						Cancel
					</Button>
					<Button
						variant="primary"
						onClick={() => void handleSave()}
						disabled={controlsDisabled || !hasUnsavedChanges}
					>
						Save
					</Button>
				</DialogFooter>
			</Dialog>
			<ModelPerformanceStatsDialog
				open={modelPerformanceStatsOpen}
				onOpenChange={setModelPerformanceStatsOpen}
				workspaceId={workspaceId}
			/>
		</>
	);
}
