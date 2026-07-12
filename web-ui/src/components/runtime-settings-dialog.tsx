// Settings dialog composition for !Klein.
// Generic app settings live here, while NKlein-specific provider state and
// side effects should stay in use-runtime-settings-nklein-controller.ts.
import * as RadixCheckbox from "@radix-ui/react-checkbox";
import * as RadixSelect from "@radix-ui/react-select";
import * as RadixSwitch from "@radix-ui/react-switch";
import { getRuntimeLaunchSupportedAgentCatalog } from "@runtime-agent-catalog";
import {
	AGENT_CAPABILITY_TIER_INFO,
	AGENT_DELIVERY_TIER_INFO,
	DEFAULT_AGENT_RULESETS_CONFIG,
	DEFAULT_RUNTIME_SWARM_GUARDRAILS,
} from "@runtime-contract";
import {
	BarChart3,
	Bell,
	Bot,
	Boxes,
	Braces,
	Check,
	ChevronDown,
	ExternalLink,
	FolderOpen,
	Gauge,
	GitCommit,
	Palette,
	Plus,
	Settings,
	ShieldCheck,
	SlidersHorizontal,
	Wand2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentRulesetsSettingsPanel } from "@/components/agent-rulesets-settings-panel";
import {
	buildCodeEmbeddingSettings,
	CODE_EMBEDDING_PROVIDER_OPTIONS,
	EmbeddingEndpointFields,
	formatCodeEmbeddingSettings,
	LOCAL_CODE_EMBEDDING_MODEL,
} from "@/components/code-embedding-fields";
import { ConcurrencyEditor, type ConcurrencyMap } from "@/components/concurrency-editor";
import { ModelPerformanceStatsDialog } from "@/components/model-performance-stats-dialog";
import { ModelRolesEditor } from "@/components/model-roles-editor";
import { buildDisplayedAgentCommand } from "@/components/runtime-settings-command-display";
import { MODEL_ROLE_IDS, normalizeModelRolesForSettings } from "@/components/runtime-settings-model-roles";
import { normalizeProviderId } from "@/components/runtime-settings-provider-helpers";
import { type SwarmGuardrailInputs, swarmGuardrailsToInputs } from "@/components/runtime-settings-swarm-guardrails";
import { AccountOrganizationSection } from "@/components/shared/account-organization-section";
import { NKleinSetupSection } from "@/components/shared/nklein-setup-section";
import { SwarmGuardrailsSettingsPanel } from "@/components/swarm-guardrails-settings-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { listActiveProjectOverrides } from "@/features/settings/project-overrides";
import {
	initSettingsDraftFromConfig,
	isSettingsDraftDirty,
	readBooleanTaskDefault,
	readTaskAutoReviewModeDefault,
	type SettingsDraft,
	snapshotSwarmGuardrailInputs,
} from "@/features/settings/settings-draft";
import {
	buildRuntimeConfigSaveRequest,
	findFirstModelRoleAvailabilityWarning,
	findFirstModelRoleContextWarning,
	validateAndParseSettingsNumbers,
	validateCodeEmbeddingDefaultsForSave,
} from "@/features/settings/settings-save";
import { TASK_GIT_BASE_REF_PROMPT_VARIABLE, type TaskGitAction } from "@/git-actions/build-task-git-action-prompt";
import { useRuntimeSettingsNKleinController } from "@/hooks/use-runtime-settings-nklein-controller";
import { useRuntimeSettingsNKleinMcpController } from "@/hooks/use-runtime-settings-nklein-mcp-controller";
import { previewThemeId, readStoredThemeId, saveThemeId, THEME_GROUPS, THEMES, type ThemeId } from "@/hooks/use-theme";
import { useLayoutCustomizations } from "@/resize/layout-customizations";
import { buildSuggestedCodeEmbeddingBaseUrl } from "@/runtime/code-embedding-endpoint";
import { isCloudProviderSupportEnabled } from "@/runtime/native-agent";
import { findNKleinProviderModel } from "@/runtime/nklein-context-window-policy";
import { fetchNKleinProviderModels, openFileOnHost } from "@/runtime/runtime-config-query";
import type {
	AgentRulesetsConfigPayload,
	RuntimeAgentId,
	RuntimeCodeEmbeddingSettings,
	RuntimeConfigResponse,
	RuntimeLlmfitCatalogUpdateMode,
	RuntimeLostHeartbeatPolicy,
	RuntimeModelGateAction,
	RuntimeModelRoles,
	RuntimeNKleinMcpServerAuthStatus,
	RuntimeNKleinProviderModel,
	RuntimeProjectShortcut,
	RuntimeSandboxIsolationProfile,
	RuntimeSkillDynamicsLevel,
	RuntimeTaskAutoReviewMode,
} from "@/runtime/types";
import { useRuntimeConfig } from "@/runtime/use-runtime-config";
import { LocalStorageKey, writeLocalStorageItem } from "@/storage/local-storage-store";
import {
	type BrowserNotificationPermission,
	formatNotificationPermissionStatus,
	getBrowserNotificationPermission,
	requestBrowserNotificationPermission,
} from "@/utils/notification-permission";
import { formatPathForDisplay } from "@/utils/path-display";
import { useUnmount, useWindowEvent } from "@/utils/react-use";
import { NKleinAdvisorActions } from "./nklein-advisor-actions";
import {
	NKleinDogfoodSuggestion,
	NKleinModelContextWindowSettingsPanel,
	NKleinSmokeEvalTrial,
} from "./nklein-settings-panels";
import { getNextShortcutLabel, normalizeTemplateForComparison } from "./runtime-settings-dialog-helpers";
import {
	AgentRow,
	InlineUtilityButton,
	OverrideRow,
	type RuntimeSettingsAgentRowModel,
} from "./runtime-settings-dialog-rows";
import { SettingsNav, type SettingsNavId } from "./settings-nav";
import { ShortcutIconPicker } from "./shortcut-icon-picker";

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

const SETTINGS_NAV_ITEMS: ReadonlyArray<{
	id: SettingsNavId;
	label: string;
	icon: React.ReactNode;
	nkleinOnly?: boolean;
}> = [
	{ id: "general", label: "General", icon: <SlidersHorizontal size={16} /> },
	{ id: "agents", label: "Agents", icon: <Boxes size={16} /> },
	{ id: "tasks", label: "Tasks", icon: <Check size={16} /> },
	{ id: "guardrails", label: "Guardrails & Limits", icon: <Gauge size={16} /> },
	{ id: "nklein", label: "!Klein Provider & Models", icon: <Bot size={16} />, nkleinOnly: true },
	{ id: "code-intelligence", label: "Code Intelligence", icon: <Braces size={16} /> },
	{ id: "git-prompts", label: "Git", icon: <GitCommit size={16} /> },
	{ id: "notifications", label: "Notifications", icon: <Bell size={16} /> },
	{ id: "appearance", label: "Appearance", icon: <Palette size={16} /> },
	{ id: "project", label: "Project", icon: <FolderOpen size={16} /> },
];

const TASK_AUTO_REVIEW_MODE_OPTIONS: Array<{ value: RuntimeTaskAutoReviewMode; label: string }> = [
	{ value: "commit", label: "Commit" },
	{ value: "pr", label: "Open PR" },
];

/** Readable labels for the §5.AE skill-dynamics levels (shared by the global control and the per-project override row). */
const SKILL_DYNAMICS_LEVEL_LABELS: Record<RuntimeSkillDynamicsLevel, string> = {
	fully_dynamic: "Fully dynamic",
	static_skills_auto_model: "Static skills, auto model",
	assigned_skills: "Assigned skills",
	fully_static: "Fully static",
};

export function RuntimeSettingsDialog({
	open,
	workspaceId,
	initialConfig = null,
	liveMcpAuthStatuses = null,
	onOpenChange,
	onSaved,
	onAccountSwitched,
	initialSection,
	onRunGlobalSetupWizard,
	onRunProjectSetupWizard,
}: {
	open: boolean;
	workspaceId: string | null;
	initialConfig?: RuntimeConfigResponse | null;
	liveMcpAuthStatuses?: RuntimeNKleinMcpServerAuthStatus[] | null;
	onOpenChange: (open: boolean) => void;
	onSaved?: () => void;
	onAccountSwitched?: () => void;
	initialSection?: RuntimeSettingsSection | null;
	/** §5.BA re-trigger for the GLOBAL guided-setup wizard (rendered in the General section). */
	onRunGlobalSetupWizard?: () => void;
	/** §5.BA re-trigger for the PROJECT guided-setup wizard (rendered in the Project section; omit when no project). */
	onRunProjectSetupWizard?: () => void;
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
	const [deviceRamGb, setDeviceRamGb] = useState("");
	const [sandboxEgressProxyEnabled, setSandboxEgressProxyEnabled] = useState(false);
	const [sandboxEgressAllowlist, setSandboxEgressAllowlist] = useState("");
	const [sandboxMaxContainers, setSandboxMaxContainers] = useState("1");
	const [sandboxAgentsPerContainer, setSandboxAgentsPerContainer] = useState("0");
	const [sandboxMemoryPerContainerMb, setSandboxMemoryPerContainerMb] = useState("2048");
	const [sandboxCpusPerContainer, setSandboxCpusPerContainer] = useState("2");
	const [sandboxIdleTimeoutMinutes, setSandboxIdleTimeoutMinutes] = useState("10");
	const [sandboxIsolationProfileDefault, setSandboxIsolationProfileDefault] =
		useState<RuntimeSandboxIsolationProfile>("lean_shared");
	const [lostHeartbeatPolicy, setLostHeartbeatPolicy] = useState<RuntimeLostHeartbeatPolicy>("park");
	const [decompositionAutoApplyEnabled, setDecompositionAutoApplyEnabled] = useState(true);
	const [testDrivenModeEnabled, setTestDrivenModeEnabled] = useState(false);
	const [hardTaskRoutingMode, setHardTaskRoutingMode] = useState<"wait_for_best" | "attempt_with_available">(
		"attempt_with_available",
	);
	const [secondOpinionReviewEnabled, setSecondOpinionReviewEnabled] = useState(true);
	const [reviewMaxRounds, setReviewMaxRounds] = useState(20);
	const [speculativeBestOfNEnabled, setSpeculativeBestOfNEnabled] = useState(true);
	const [speculativeMaxConcurrentSpecs, setSpeculativeMaxConcurrentSpecs] = useState(1);
	const [speculativeMaxSpecsPerRun, setSpeculativeMaxSpecsPerRun] = useState(3);
	const [swarmGuardrailInputs, setSwarmGuardrailInputs] = useState<SwarmGuardrailInputs>(() =>
		swarmGuardrailsToInputs(DEFAULT_RUNTIME_SWARM_GUARDRAILS),
	);
	const [developerModeEnabled, setDeveloperModeEnabled] = useState(false);
	// Desktop-only "start on boot" — an IMMEDIATE OS action via the Electron bridge (NOT part of the config draft/save
	// flow). `undefined` in a plain browser, so the whole toggle is hidden there.
	const desktopBridge = typeof window !== "undefined" ? window.desktop : undefined;
	const [autostartEnabled, setAutostartEnabled] = useState(false);
	const [autostartBusy, setAutostartBusy] = useState(false);
	const [networkAccessEnabled, setNetworkAccessEnabled] = useState(false);
	const [networkAccessBusy, setNetworkAccessBusy] = useState(false);
	const [networkRestartPending, setNetworkRestartPending] = useState(false);
	const [replayCardsEnabled, setReplayCardsEnabled] = useState(false);
	const [knowsTodayEnabled, setKnowsTodayEnabled] = useState(false);
	// §5.AC online-retrieval egress (web_search) — OFF by default (fail closed); needs a search backend URL.
	const [retrievalEgressEnabled, setRetrievalEgressEnabled] = useState(false);
	const [retrievalSearchBackendUrl, setRetrievalSearchBackendUrl] = useState("");
	const [llmfitCatalogUpdateMode, setLlmfitCatalogUpdateMode] = useState<RuntimeLlmfitCatalogUpdateMode>("notify");
	// §5.AR curated sandbox-MCP servers (ON by default) + §5.M capability broker (prompt-injection taint gate).
	const [sandboxMcpServersEnabled, setSandboxMcpServersEnabled] = useState(true);
	const [capabilityBrokerEnabled, setCapabilityBrokerEnabled] = useState(false);
	// §5.BB env-flag promotions: basic-memory MCP (OFF), chat adaptive truncation (ON), reasoning budget (OFF),
	// review-panel lenses (OFF). Each still honors its NKLEIN_* env override for scripts/harnesses.
	const [basicMemoryEnabled, setBasicMemoryEnabled] = useState(false);
	const [chatAdaptiveTruncationEnabled, setChatAdaptiveTruncationEnabled] = useState(true);
	const [reasoningBudgetEnabled, setReasoningBudgetEnabled] = useState(false);
	const [reviewLensesEnabled, setReviewLensesEnabled] = useState(false);
	const [readyForReviewNotificationsEnabled, setReadyForReviewNotificationsEnabled] = useState(true);
	const [codeEmbeddingDefaultsProvider, setCodeEmbeddingDefaultsProvider] =
		useState<RuntimeCodeEmbeddingSettings["provider"]>("local_lexical");
	const [codeEmbeddingDefaultsModel, setCodeEmbeddingDefaultsModel] = useState(LOCAL_CODE_EMBEDDING_MODEL);
	const [codeEmbeddingDefaultsBaseUrl, setCodeEmbeddingDefaultsBaseUrl] = useState("");
	// §5.W per-project code-embedding override (raw fields preserved across provider switches, like the global set).
	const [codeEmbeddingOverrideEnabled, setCodeEmbeddingOverrideEnabled] = useState(false);
	const [codeEmbeddingOverrideProvider, setCodeEmbeddingOverrideProvider] =
		useState<RuntimeCodeEmbeddingSettings["provider"]>("local_lexical");
	const [codeEmbeddingOverrideModel, setCodeEmbeddingOverrideModel] = useState(LOCAL_CODE_EMBEDDING_MODEL);
	const [codeEmbeddingOverrideBaseUrl, setCodeEmbeddingOverrideBaseUrl] = useState("");
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
		perHost: ConcurrencyMap;
		perEndpoint: ConcurrencyMap;
	}>({
		perProvider: {},
		perModel: {},
		perHost: {},
		perEndpoint: {},
	});
	// §5.AL global model-capability gate policy default.
	const [modelGateUnsuitable, setModelGateUnsuitable] = useState<RuntimeModelGateAction>("reject");
	const [modelGateUnknown, setModelGateUnknown] = useState<RuntimeModelGateAction>("warn");
	// §5.AE global skill-dynamics level default.
	const [skillDynamicsLevel, setSkillDynamicsLevel] = useState<RuntimeSkillDynamicsLevel>("fully_dynamic");
	const [skillDynamicsLevelOverride, setSkillDynamicsLevelOverride] = useState<RuntimeSkillDynamicsLevel | null>(null);
	const [concurrencyOverride, setConcurrencyOverride] = useState<{
		perProvider: ConcurrencyMap;
		perModel: ConcurrencyMap;
		perHost: ConcurrencyMap;
		perEndpoint: ConcurrencyMap;
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
	const autostartCheckboxId = "runtime-settings-autostart";
	const networkAccessCheckboxId = "runtime-settings-network-access";
	const replayCardsCheckboxId = "runtime-settings-replay-cards";
	const knowsTodayCheckboxId = "runtime-settings-knows-today";
	const retrievalEgressCheckboxId = "runtime-settings-retrieval-egress";
	const retrievalBackendUrlInputId = "runtime-settings-retrieval-backend-url";
	const sandboxMcpCheckboxId = "runtime-settings-sandbox-mcp";
	const basicMemoryCheckboxId = "runtime-settings-basic-memory";
	const chatAdaptiveTruncationCheckboxId = "runtime-settings-chat-adaptive-truncation";
	const reasoningBudgetCheckboxId = "runtime-settings-reasoning-budget";
	const reviewLensesLabelId = "runtime-settings-review-lenses-label";
	const capabilityBrokerCheckboxId = "runtime-settings-capability-broker";
	const maxConcurrentTasksId = "runtime-settings-max-concurrent-tasks";
	const workspaceBaseDirId = "runtime-settings-workspace-base-dir";
	const deviceRamGbId = "runtime-settings-device-ram-gb";
	const sandboxEgressProxyEnabledId = "runtime-settings-sandbox-egress-proxy-enabled";
	const sandboxEgressAllowlistId = "runtime-settings-sandbox-egress-allowlist";
	const maxAgentWritableFileLinesId = "runtime-settings-max-agent-writable-file-lines";
	const taskDefaultStartInPlanModeId = "runtime-settings-task-default-start-in-plan-mode";
	const taskDefaultAutoReviewEnabledId = "runtime-settings-task-default-auto-review-enabled";
	const decompositionAutoApplyLabelId = "runtime-settings-decomposition-auto-apply-label";
	const secondOpinionReviewLabelId = "runtime-settings-second-opinion-review-label";
	const reviewMaxRoundsId = "runtime-settings-review-max-rounds";
	const speculativeBestOfNLabelId = "runtime-settings-speculative-best-of-n-label";
	const speculativeMaxConcurrentSpecsId = "runtime-settings-speculative-max-concurrent-specs";
	const speculativeMaxSpecsPerRunId = "runtime-settings-speculative-max-specs-per-run";
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
	const navItems = useMemo(() => {
		// §10c#9: badge the Project entry with the ACTIVE per-project overrides so divergence-from-global is visible
		// at a glance; the pill's title lists them.
		const activeOverrides = listActiveProjectOverrides(config);
		return SETTINGS_NAV_ITEMS.filter((item) => !item.nkleinOnly || selectedAgentId === "nklein").map((item) =>
			item.id === "project" && activeOverrides.length > 0
				? { ...item, badge: { count: activeOverrides.length, title: `Overrides: ${activeOverrides.join(", ")}` } }
				: item,
		);
	}, [selectedAgentId, config]);

	useEffect(() => {
		modelRoleModelsByProviderIdRef.current = modelRoleModelsByProviderId;
	}, [modelRoleModelsByProviderId]);

	useEffect(() => {
		loadingModelRoleProviderIdsRef.current = loadingModelRoleProviderIds;
	}, [loadingModelRoleProviderIds]);

	// Read the live start-on-boot state from the desktop app each time the dialog opens (the OS is the store).
	useEffect(() => {
		if (!open || !desktopBridge) {
			return;
		}
		let cancelled = false;
		desktopBridge
			.getAutostart()
			.then((enabled) => {
				if (!cancelled) setAutostartEnabled(enabled);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [open, desktopBridge]);

	const handleAutostartChange = useCallback(
		(next: boolean) => {
			if (!desktopBridge) {
				return;
			}
			setAutostartEnabled(next); // optimistic
			setAutostartBusy(true);
			desktopBridge
				.setAutostart(next)
				.then((result) => {
					if (!result.ok) setAutostartEnabled((prev) => !prev); // revert on failure
				})
				.catch(() => setAutostartEnabled((prev) => !prev))
				.finally(() => setAutostartBusy(false));
		},
		[desktopBridge],
	);

	// Read the live LAN-serving opt-in from the desktop app each time the dialog opens.
	useEffect(() => {
		if (!open || !desktopBridge) {
			return;
		}
		let cancelled = false;
		desktopBridge
			.getNetworkAccess()
			.then((enabled) => {
				if (!cancelled) setNetworkAccessEnabled(enabled);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [open, desktopBridge]);

	const handleNetworkAccessChange = useCallback(
		(next: boolean) => {
			if (!desktopBridge) {
				return;
			}
			setNetworkAccessEnabled(next); // optimistic
			setNetworkAccessBusy(true);
			setNetworkRestartPending(false);
			desktopBridge
				.setNetworkAccess(next)
				.then((result) => {
					if (!result.ok) {
						setNetworkAccessEnabled((prev) => !prev); // revert on failure
						return;
					}
					// The relaunch that rebinds the host was deferred ⇒ tell the user it applies after a restart.
					setNetworkRestartPending(result.restartRequired === true);
				})
				.catch(() => setNetworkAccessEnabled((prev) => !prev))
				.finally(() => setNetworkAccessBusy(false));
		},
		[desktopBridge],
	);

	// Config-derived snapshot the draft is seeded from and compared against (see settings-draft.ts).
	// Pure derivation, so recomputing on config identity changes is safe; the reset effect below keeps
	// its own field-level dependency list so a refresh with unchanged values never clobbers edits.
	const configSnapshot = useMemo(
		() => initSettingsDraftFromConfig(config, { cloudProviderSupportEnabled }),
		[config, cloudProviderSupportEnabled],
	);
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
				`testDrivenMode=${testDrivenModeEnabled}`,
				`hardTaskRoutingMode=${hardTaskRoutingMode}`,
				`secondOpinionReview=${secondOpinionReviewEnabled}`,
				`speculativeBestOfN=${speculativeBestOfNEnabled}`,
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
			testDrivenModeEnabled,
			hardTaskRoutingMode,
			secondOpinionReviewEnabled,
			reviewMaxRounds,
			speculativeBestOfNEnabled,
			speculativeMaxConcurrentSpecs,
			speculativeMaxSpecsPerRun,
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
	const draftCodeEmbeddingOverride = useMemo(
		() =>
			codeEmbeddingOverrideEnabled
				? buildCodeEmbeddingSettings(
						codeEmbeddingOverrideProvider,
						codeEmbeddingOverrideModel,
						codeEmbeddingOverrideBaseUrl,
					)
				: null,
		[
			codeEmbeddingOverrideEnabled,
			codeEmbeddingOverrideProvider,
			codeEmbeddingOverrideModel,
			codeEmbeddingOverrideBaseUrl,
		],
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
	const applySharedSandboxPreset = useCallback(() => {
		setSandboxIsolationProfileDefault("lean_shared");
		setSandboxMaxContainers("1");
		setSandboxAgentsPerContainer("0");
	}, []);
	const applyDedicatedSandboxPreset = useCallback(() => {
		setSandboxIsolationProfileDefault("strict_per_agent");
		const parsedMaxConcurrentTasks = Number(maxConcurrentTasks.trim());
		if (Number.isFinite(parsedMaxConcurrentTasks) && parsedMaxConcurrentTasks > 1) {
			setSandboxMaxContainers(String(Math.trunc(parsedMaxConcurrentTasks)));
		} else if (sandboxMaxContainers.trim() === "1") {
			setSandboxMaxContainers("4");
		}
		setSandboxAgentsPerContainer("1");
	}, [maxConcurrentTasks, sandboxMaxContainers]);
	const handleSandboxIsolationProfileChange = (profile: RuntimeSandboxIsolationProfile): void => {
		setSandboxIsolationProfileDefault(profile);
		if (profile === "lean_shared") {
			setSandboxMaxContainers("1");
			setSandboxAgentsPerContainer("0");
			return;
		}
		if (profile === "strict_per_agent") {
			applyDedicatedSandboxPreset();
		}
	};
	// The editable draft, assembled from the dialog's local state for the behavior model
	// (dirty detection here; validation + save payload in settings-save.ts).
	const draft = useMemo<SettingsDraft>(
		() => ({
			selectedAgentId,
			agentAutonomousModeEnabled,
			agentTimeoutMode,
			agentTimeoutProfile,
			requestTimeoutMs,
			streamTimeoutMs,
			toolTimeoutMs,
			agentTimeoutMs,
			conversationTimeoutMs,
			maxAgentWritableFileLines,
			maxConcurrentTasks,
			workspaceBaseDir,
			deviceRamGb,
			sandboxEgressProxyEnabled,
			sandboxEgressAllowlist,
			sandboxMaxContainers,
			sandboxAgentsPerContainer,
			sandboxMemoryPerContainerMb,
			sandboxCpusPerContainer,
			sandboxIdleTimeoutMinutes,
			sandboxIsolationProfileDefault,
			lostHeartbeatPolicy,
			decompositionAutoApplyEnabled,
			testDrivenModeEnabled,
			hardTaskRoutingMode,
			secondOpinionReviewEnabled,
			reviewMaxRounds,
			speculativeBestOfNEnabled,
			speculativeMaxConcurrentSpecs,
			speculativeMaxSpecsPerRun,
			swarmGuardrailInputs,
			developerModeEnabled,
			replayCardsEnabled,
			knowsTodayEnabled,
			retrievalEgressEnabled,
			retrievalSearchBackendUrl,
			llmfitCatalogUpdateMode,
			sandboxMcpServersEnabled,
			capabilityBrokerEnabled,
			basicMemoryEnabled,
			chatAdaptiveTruncationEnabled,
			reasoningBudgetEnabled,
			reviewLensesEnabled,
			readyForReviewNotificationsEnabled,
			codeEmbeddingDefaults: draftCodeEmbeddingDefaults,
			codeEmbeddingOverride: draftCodeEmbeddingOverride,
			shortcuts,
			maxConcurrentTasksOverride,
			selectedAgentIdOverride,
			modelRoles,
			concurrencyDefaults,
			modelGateUnsuitable,
			modelGateUnknown,
			skillDynamicsLevel,
			skillDynamicsLevelOverride,
			concurrencyOverride,
			agentRulesets,
			modelRolesOverride,
			agentRulesetsOverride,
			commitPromptTemplate,
			openPrPromptTemplate,
		}),
		[
			selectedAgentId,
			agentAutonomousModeEnabled,
			agentTimeoutMode,
			agentTimeoutProfile,
			requestTimeoutMs,
			streamTimeoutMs,
			toolTimeoutMs,
			agentTimeoutMs,
			conversationTimeoutMs,
			maxAgentWritableFileLines,
			maxConcurrentTasks,
			workspaceBaseDir,
			deviceRamGb,
			sandboxEgressProxyEnabled,
			sandboxEgressAllowlist,
			sandboxMaxContainers,
			sandboxAgentsPerContainer,
			sandboxMemoryPerContainerMb,
			sandboxCpusPerContainer,
			sandboxIdleTimeoutMinutes,
			sandboxIsolationProfileDefault,
			lostHeartbeatPolicy,
			decompositionAutoApplyEnabled,
			testDrivenModeEnabled,
			hardTaskRoutingMode,
			secondOpinionReviewEnabled,
			reviewMaxRounds,
			speculativeBestOfNEnabled,
			speculativeMaxConcurrentSpecs,
			speculativeMaxSpecsPerRun,
			swarmGuardrailInputs,
			developerModeEnabled,
			replayCardsEnabled,
			knowsTodayEnabled,
			retrievalEgressEnabled,
			retrievalSearchBackendUrl,
			llmfitCatalogUpdateMode,
			sandboxMcpServersEnabled,
			capabilityBrokerEnabled,
			basicMemoryEnabled,
			chatAdaptiveTruncationEnabled,
			reasoningBudgetEnabled,
			reviewLensesEnabled,
			readyForReviewNotificationsEnabled,
			draftCodeEmbeddingDefaults,
			draftCodeEmbeddingOverride,
			shortcuts,
			maxConcurrentTasksOverride,
			selectedAgentIdOverride,
			modelRoles,
			concurrencyDefaults,
			modelGateUnsuitable,
			modelGateUnknown,
			skillDynamicsLevel,
			skillDynamicsLevelOverride,
			concurrencyOverride,
			agentRulesets,
			modelRolesOverride,
			agentRulesetsOverride,
			commitPromptTemplate,
			openPrPromptTemplate,
		],
	);
	const hasUnsavedChanges = useMemo(
		() =>
			config !== null &&
			isSettingsDraftDirty({
				draft,
				snapshot: configSnapshot,
				local: {
					taskDefaultStartInPlanMode,
					taskDefaultAutoReviewEnabled,
					taskDefaultAutoReviewMode,
					themeId: draftThemeId,
				},
				localInitial: {
					taskDefaultStartInPlanMode: initialTaskDefaultStartInPlanMode,
					taskDefaultAutoReviewEnabled: initialTaskDefaultAutoReviewEnabled,
					taskDefaultAutoReviewMode: initialTaskDefaultAutoReviewMode,
					themeId: initialThemeId,
				},
				nkleinSettingsDirty: nkleinSettings.hasUnsavedChanges,
				nkleinMcpSettingsDirty: nkleinMcpSettings.hasUnsavedChanges,
			}),
		[
			config,
			draft,
			configSnapshot,
			taskDefaultStartInPlanMode,
			taskDefaultAutoReviewEnabled,
			taskDefaultAutoReviewMode,
			draftThemeId,
			initialTaskDefaultStartInPlanMode,
			initialTaskDefaultAutoReviewEnabled,
			initialTaskDefaultAutoReviewMode,
			initialThemeId,
			nkleinSettings.hasUnsavedChanges,
			nkleinMcpSettings.hasUnsavedChanges,
		],
	);

	// Reset the draft to the loaded config whenever the dialog opens or a watched config field changes.
	// The dependency list is intentionally field-level (NOT the snapshot object): a config refresh that
	// returns identical values must not clobber in-progress edits.
	useEffect(() => {
		if (!open) {
			return;
		}
		const snapshot = initSettingsDraftFromConfig(config, { cloudProviderSupportEnabled });
		setSelectedAgentId(snapshot.selectedAgentId);
		setAgentAutonomousModeEnabled(snapshot.agentAutonomousModeEnabled);
		setAgentTimeoutMode(snapshot.agentTimeoutMode);
		setAgentTimeoutProfile(snapshot.agentTimeoutProfile);
		setRequestTimeoutMs(snapshot.requestTimeoutMs);
		setStreamTimeoutMs(snapshot.streamTimeoutMs);
		setToolTimeoutMs(snapshot.toolTimeoutMs);
		setAgentTimeoutMs(snapshot.agentTimeoutMs);
		setConversationTimeoutMs(snapshot.conversationTimeoutMs);
		setMaxAgentWritableFileLines(snapshot.maxAgentWritableFileLines);
		setMaxConcurrentTasks(snapshot.maxConcurrentTasks);
		setWorkspaceBaseDir(snapshot.workspaceBaseDir);
		setDeviceRamGb(snapshot.deviceRamGb);
		setSandboxEgressProxyEnabled(snapshot.sandboxEgressProxyEnabled);
		setSandboxEgressAllowlist(snapshot.sandboxEgressAllowlist);
		setSandboxMaxContainers(snapshot.sandboxMaxContainers);
		setSandboxAgentsPerContainer(snapshot.sandboxAgentsPerContainer);
		setSandboxMemoryPerContainerMb(snapshot.sandboxMemoryPerContainerMb);
		setSandboxCpusPerContainer(snapshot.sandboxCpusPerContainer);
		setSandboxIdleTimeoutMinutes(snapshot.sandboxIdleTimeoutMinutes);
		setSandboxIsolationProfileDefault(snapshot.sandboxIsolationProfileDefault);
		setLostHeartbeatPolicy(snapshot.lostHeartbeatPolicy);
		setDecompositionAutoApplyEnabled(snapshot.decompositionAutoApplyEnabled);
		setTestDrivenModeEnabled(snapshot.testDrivenModeEnabled);
		setHardTaskRoutingMode(snapshot.hardTaskRoutingMode);
		setSecondOpinionReviewEnabled(snapshot.secondOpinionReviewEnabled);
		setReviewMaxRounds(snapshot.reviewMaxRounds);
		setSpeculativeBestOfNEnabled(snapshot.speculativeBestOfNEnabled);
		setSpeculativeMaxConcurrentSpecs(snapshot.speculativeMaxConcurrentSpecs);
		setSpeculativeMaxSpecsPerRun(snapshot.speculativeMaxSpecsPerRun);
		setSwarmGuardrailInputs(snapshotSwarmGuardrailInputs(snapshot));
		setDeveloperModeEnabled(snapshot.developerModeEnabled);
		setReplayCardsEnabled(snapshot.replayCardsEnabled);
		setKnowsTodayEnabled(snapshot.knowsTodayEnabled);
		setRetrievalEgressEnabled(snapshot.retrievalEgressEnabled);
		setRetrievalSearchBackendUrl(snapshot.retrievalSearchBackendUrl);
		setLlmfitCatalogUpdateMode(snapshot.llmfitCatalogUpdateMode);
		setSandboxMcpServersEnabled(snapshot.sandboxMcpServersEnabled);
		setCapabilityBrokerEnabled(snapshot.capabilityBrokerEnabled);
		setBasicMemoryEnabled(snapshot.basicMemoryEnabled);
		setChatAdaptiveTruncationEnabled(snapshot.chatAdaptiveTruncationEnabled);
		setReasoningBudgetEnabled(snapshot.reasoningBudgetEnabled);
		setReviewLensesEnabled(snapshot.reviewLensesEnabled);
		setReadyForReviewNotificationsEnabled(snapshot.readyForReviewNotificationsEnabled);
		setCodeEmbeddingDefaultsProvider(snapshot.codeEmbeddingDefaults.provider);
		setCodeEmbeddingDefaultsModel(snapshot.codeEmbeddingDefaults.model ?? "");
		setCodeEmbeddingDefaultsBaseUrl(snapshot.codeEmbeddingDefaults.baseUrl ?? "");
		setCodeEmbeddingOverrideEnabled(snapshot.codeEmbeddingOverride !== null);
		setCodeEmbeddingOverrideProvider(snapshot.codeEmbeddingOverride?.provider ?? "local_lexical");
		setCodeEmbeddingOverrideModel(snapshot.codeEmbeddingOverride?.model ?? LOCAL_CODE_EMBEDDING_MODEL);
		setCodeEmbeddingOverrideBaseUrl(snapshot.codeEmbeddingOverride?.baseUrl ?? "");
		const storedTaskDefaultStartInPlanMode = readBooleanTaskDefault(LocalStorageKey.TaskStartInPlanMode, false);
		const storedTaskDefaultAutoReviewEnabled = readBooleanTaskDefault(LocalStorageKey.TaskAutoReviewEnabled, false);
		const storedTaskDefaultAutoReviewMode = readTaskAutoReviewModeDefault();
		setTaskDefaultStartInPlanMode(storedTaskDefaultStartInPlanMode);
		setInitialTaskDefaultStartInPlanMode(storedTaskDefaultStartInPlanMode);
		setTaskDefaultAutoReviewEnabled(storedTaskDefaultAutoReviewEnabled);
		setInitialTaskDefaultAutoReviewEnabled(storedTaskDefaultAutoReviewEnabled);
		setTaskDefaultAutoReviewMode(storedTaskDefaultAutoReviewMode);
		setInitialTaskDefaultAutoReviewMode(storedTaskDefaultAutoReviewMode);
		setShortcuts(snapshot.shortcuts);
		setMaxConcurrentTasksOverride(snapshot.maxConcurrentTasksOverride);
		setSelectedAgentIdOverride(snapshot.selectedAgentIdOverride);
		setModelRoles(snapshot.modelRoles);
		setConcurrencyDefaults(snapshot.concurrencyDefaults);
		setModelGateUnsuitable(snapshot.modelGateUnsuitable);
		setModelGateUnknown(snapshot.modelGateUnknown);
		setSkillDynamicsLevel(snapshot.skillDynamicsLevel);
		setSkillDynamicsLevelOverride(snapshot.skillDynamicsLevelOverride);
		setConcurrencyOverride(snapshot.concurrencyOverride);
		setAgentRulesets(snapshot.agentRulesets);
		setModelRolesOverride(snapshot.modelRolesOverride);
		setAgentRulesetsOverride(snapshot.agentRulesetsOverride);
		setCommitPromptTemplate(snapshot.commitPromptTemplate);
		setOpenPrPromptTemplate(snapshot.openPrPromptTemplate);
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
		config?.testDrivenModeEnabled,
		config?.hardTaskRoutingMode,
		config?.secondOpinionReviewEnabled,
		config?.reviewMaxRounds,
		config?.speculativeBestOfNEnabled,
		config?.speculativeMaxConcurrentSpecs,
		config?.speculativeMaxSpecsPerRun,
		config?.swarmGuardrails,
		config?.developerModeEnabled,
		config?.replayCardsEnabled,
		config?.knowsTodayEnabled,
		config?.retrievalEgressEnabled,
		config?.retrievalSearchBackendUrl,
		config?.llmfitCatalogUpdateMode,
		config?.sandboxMcpServersEnabled,
		config?.capabilityBrokerEnabled,
		config?.basicMemoryEnabled,
		config?.chatAdaptiveTruncationEnabled,
		config?.reasoningBudgetEnabled,
		config?.reviewLensesEnabled,
		config?.maxAgentWritableFileLines,
		config?.maxConcurrentTasks,
		config?.workspaceBaseDir,
		config?.deviceRamGb,
		config?.sandboxEgressProxyEnabled,
		config?.sandboxEgressAllowlist,
		config?.sandboxAgentsPerContainer,
		config?.sandboxCpusPerContainer,
		config?.sandboxIdleTimeoutMinutes,
		config?.sandboxIsolationProfileDefault,
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
		config?.skillDynamicsLevelOverride,
		config?.modelRoles,
		config?.modelRolesOverride,
		config?.agentRulesetsOverride,
		config?.streamTimeoutMs,
		config?.toolTimeoutMs,
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

	// Inputs for the pure model-role save validations in settings-save.ts.
	const modelRoleWarningContext = useMemo(
		() => ({
			modelRoles,
			nkleinProviderId,
			providerCatalog: nkleinSettings.providerCatalog,
			getModelsForProvider: getModelRoleProviderModels,
		}),
		[modelRoles, nkleinProviderId, nkleinSettings.providerCatalog, getModelRoleProviderModels],
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
		const numbersResult = validateAndParseSettingsNumbers(draft);
		if (!numbersResult.ok) {
			setSaveError(numbersResult.error);
			return;
		}
		if (!config) {
			setSaveError("Runtime settings are still loading. Try again in a moment.");
			return;
		}
		const codeEmbeddingError = validateCodeEmbeddingDefaultsForSave(draftCodeEmbeddingDefaults);
		if (codeEmbeddingError !== null) {
			setSaveError(codeEmbeddingError);
			return;
		}
		const selectedAgent = displayedAgents.find((agent) => agent.id === selectedAgentId);
		if (selectedAgent?.installed !== true) {
			setSaveError("Selected agent is not installed. Install it first or choose an installed agent.");
			return;
		}
		const shouldRequestNotificationPermission =
			!configSnapshot.readyForReviewNotificationsEnabled &&
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
			const modelRoleAvailabilityWarning = findFirstModelRoleAvailabilityWarning(modelRoleWarningContext);
			if (modelRoleAvailabilityWarning) {
				setSaveError(modelRoleAvailabilityWarning);
				return;
			}
			const modelRoleContextWarning = findFirstModelRoleContextWarning(modelRoleWarningContext);
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
		const saved = await save(buildRuntimeConfigSaveRequest(draft, numbersResult.parsed));
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

						{/* Desktop-only: start !Klein on boot. An IMMEDIATE OS action via the Electron bridge (hidden in a browser). */}
						{desktopBridge ? (
							<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
								<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-1">
									Start on boot
								</h6>
								<label
									htmlFor={autostartCheckboxId}
									className="flex items-center gap-2 text-[13px] text-text-primary mt-2 cursor-pointer"
								>
									<RadixSwitch.Root
										id={autostartCheckboxId}
										checked={autostartEnabled}
										disabled={autostartBusy}
										onCheckedChange={handleAutostartChange}
										className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
									>
										<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
									</RadixSwitch.Root>
									<span>Launch !Klein automatically when you log in</span>
								</label>
								<p className="text-text-secondary text-[13px] ml-11 mt-0 mb-0">
									Registers a login item (macOS/Windows) or an autostart entry (Linux). Takes effect on your
									next login.
								</p>
							</div>
						) : null}

						{/* Desktop-only: serve the UI on the LAN. Needs a relaunch (the bind host is fixed at startup). Hidden in a browser. */}
						{desktopBridge ? (
							<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
								<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-1">
									Local network access (experimental)
								</h6>
								<label
									htmlFor={networkAccessCheckboxId}
									className="flex items-center gap-2 text-[13px] text-text-primary mt-2 cursor-pointer"
								>
									<RadixSwitch.Root
										id={networkAccessCheckboxId}
										checked={networkAccessEnabled}
										disabled={networkAccessBusy}
										onCheckedChange={handleNetworkAccessChange}
										className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
									>
										<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
									</RadixSwitch.Root>
									<span>Serve the !Klein UI to other devices on your local network</span>
								</label>
								<p className="text-text-secondary text-[13px] ml-11 mt-0 mb-0">
									OFF by default (this machine only). When on, LAN devices reach !Klein through a required
									passcode — anyone on your network with it can see your projects and terminals. Takes effect
									after a restart.
									{networkRestartPending ? (
										<span className="font-medium text-text-primary"> Restart !Klein to apply.</span>
									) : null}
								</p>
							</div>
						) : null}

						{/* §5.BA guided-setup re-trigger (GLOBAL). The per-project wizard lives in the Project section below. */}
						{onRunGlobalSetupWizard ? (
							<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
								<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-1">
									Guided setup
								</h6>
								<div className="flex items-center justify-between gap-3">
									<p className="text-text-secondary text-[13px] m-0">
										Walk through the recommended global configuration again.
									</p>
									<Button
										variant="default"
										size="sm"
										icon={<Wand2 size={14} />}
										onClick={onRunGlobalSetupWizard}
										disabled={controlsDisabled}
									>
										Run setup wizard
									</Button>
								</div>
							</div>
						) : null}

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
										File-size soft target (lines)
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
										Agents are nudged to keep any written file under this many lines (must be &ge; 1). A write
										may exceed it when one file is genuinely more cohesive; only 4&times; this value
										hard-blocks a write.
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
								<div className="border-t border-border pt-4">
									<label
										htmlFor={knowsTodayCheckboxId}
										className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer"
									>
										<RadixSwitch.Root
											id={knowsTodayCheckboxId}
											checked={knowsTodayEnabled}
											disabled={controlsDisabled}
											onCheckedChange={setKnowsTodayEnabled}
											className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
										>
											<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
										</RadixSwitch.Root>
										<span>Tell the chat agent today&apos;s date</span>
									</label>
									<p className="text-text-tertiary text-[11px] ml-11 mt-1 mb-0">
										Injects the current date into the chat agent&apos;s context when a message is
										time-sensitive (&sect;5.AC &quot;knows today&quot;). Off by default; relevance-gated +
										placed to preserve prompt caching.
									</p>
								</div>
								<div className="border-t border-border pt-4">
									<label
										htmlFor={chatAdaptiveTruncationCheckboxId}
										className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer"
									>
										<RadixSwitch.Root
											id={chatAdaptiveTruncationCheckboxId}
											checked={chatAdaptiveTruncationEnabled}
											disabled={controlsDisabled}
											onCheckedChange={setChatAdaptiveTruncationEnabled}
											className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
										>
											<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
										</RadixSwitch.Root>
										<span>Retry truncated chat replies with a bigger budget</span>
									</label>
									<p className="text-text-tertiary text-[11px] ml-11 mt-1 mb-0">
										A chat reply cut off mid-answer is re-asked with an escalating token budget (bounded by a
										pass cap + ceiling, &sect;5.AA). ON by default; when off, a single one-shot retry remains.
										The <code>NKLEIN_CHAT_ADAPTIVE_TRUNCATION</code> env var still overrides either way.
									</p>
								</div>
								<div className="border-t border-border pt-4">
									<label
										htmlFor={reasoningBudgetCheckboxId}
										className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer"
									>
										<RadixSwitch.Root
											id={reasoningBudgetCheckboxId}
											checked={reasoningBudgetEnabled}
											disabled={controlsDisabled}
											onCheckedChange={setReasoningBudgetEnabled}
											className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
										>
											<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
										</RadixSwitch.Root>
										<span>Reserve extra chat tokens for reasoning models</span>
									</label>
									<p className="text-text-tertiary text-[11px] ml-11 mt-1 mb-0">
										Sizes a chat turn&apos;s <code>max_tokens</code> with a thinking reserve on top of the
										answer budget so a reasoning model&apos;s reply isn&apos;t starved by its own thinking
										burn (&sect;5.AN). OFF by default; only applies when no explicit budget is set. The{" "}
										<code>NKLEIN_REASONING_BUDGET</code> env var also enables it.
									</p>
								</div>
								<div className="border-t border-border pt-4">
									<label
										htmlFor={retrievalEgressCheckboxId}
										className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer"
									>
										<RadixSwitch.Root
											id={retrievalEgressCheckboxId}
											checked={retrievalEgressEnabled}
											disabled={controlsDisabled}
											onCheckedChange={setRetrievalEgressEnabled}
											className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
										>
											<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
										</RadixSwitch.Root>
										<span>Allow online web research (egress)</span>
									</label>
									<p className="text-text-tertiary text-[11px] ml-11 mt-1 mb-0">
										Lets agents + chat use the online <code>research</code>/<code>web_search</code> tool
										against a configured search backend (&sect;5.AC). OFF by default (fail-closed); the
										runtime reaches only that backend, which queries the web. SSRF-guarded.
									</p>
									<div className="ml-11 mt-2">
										<label
											htmlFor={retrievalBackendUrlInputId}
											className="block text-[12px] text-text-secondary mb-1"
										>
											Search backend URL
										</label>
										<input
											id={retrievalBackendUrlInputId}
											type="url"
											value={retrievalSearchBackendUrl}
											disabled={controlsDisabled || !retrievalEgressEnabled}
											onChange={(event) => setRetrievalSearchBackendUrl(event.target.value)}
											placeholder="http://localhost:18888"
											className="w-full max-w-sm rounded border border-border bg-surface-2 px-2 py-1 text-[12px] text-text-primary disabled:opacity-40"
										/>
										<p className="text-text-tertiary text-[11px] mt-1 mb-0">
											Use an existing SearXNG-compatible endpoint, or optionally start the bundled local
											backend with <code>docker compose -f docker/searxng/docker-compose.yml up -d</code>{" "}
											(binds localhost:18888). Web search stays off until egress is on AND a backend is set.
										</p>
									</div>
								</div>
								<div className="border-t border-border pt-4">
									<label
										htmlFor={sandboxMcpCheckboxId}
										className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer"
									>
										<RadixSwitch.Root
											id={sandboxMcpCheckboxId}
											checked={sandboxMcpServersEnabled}
											disabled={controlsDisabled}
											onCheckedChange={setSandboxMcpServersEnabled}
											className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
										>
											<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
										</RadixSwitch.Root>
										<span>Curated sandbox MCP servers</span>
									</label>
									<p className="text-text-tertiary text-[11px] ml-11 mt-1 mb-0">
										Offers the baked-in, offline MCP servers (codebase-memory, sequential-thinking,
										basic-memory) to agents whose capability ruleset allows MCP (&sect;5.AR). ON by default;
										each runs inside the <code>--network none</code> sandbox.
									</p>
								</div>
								<div className="border-t border-border pt-4">
									<label
										htmlFor={basicMemoryCheckboxId}
										className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer"
									>
										<RadixSwitch.Root
											id={basicMemoryCheckboxId}
											checked={basicMemoryEnabled}
											disabled={controlsDisabled || !sandboxMcpServersEnabled}
											onCheckedChange={setBasicMemoryEnabled}
											className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
										>
											<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
										</RadixSwitch.Root>
										<span>Basic-memory agent notes (writable)</span>
									</label>
									<p className="text-text-tertiary text-[11px] ml-11 mt-1 mb-0">
										Lets agents keep persistent per-project Markdown notes via the sandboxed basic-memory MCP
										server (&sect;5.AR). OFF by default because it adds the ONLY writable mounts to the
										otherwise read-only sandbox. Needs curated sandbox MCP servers on; applies to newly
										started containers. The <code>NKLEIN_BASIC_MEMORY</code> env var also enables it.
									</p>
								</div>
								<div className="border-t border-border pt-4">
									<label
										htmlFor={capabilityBrokerCheckboxId}
										className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer"
									>
										<RadixSwitch.Root
											id={capabilityBrokerCheckboxId}
											checked={capabilityBrokerEnabled}
											disabled={controlsDisabled}
											onCheckedChange={setCapabilityBrokerEnabled}
											className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
										>
											<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
										</RadixSwitch.Root>
										<span>Prompt-injection capability broker</span>
									</label>
									<p className="text-text-tertiary text-[11px] ml-11 mt-1 mb-0">
										Taints untrusted (web/MCP/repo) content and refuses a later protected sink (host
										write/command/git) without a trusted plan (&sect;5.M). OFF by default;
										assume-injection-succeeds defense for when online + MCP tools are live.
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
												variant={sandboxIsolationProfileDefault === "lean_shared" ? "primary" : "default"}
												aria-pressed={sandboxIsolationProfileDefault === "lean_shared"}
												disabled={controlsDisabled}
												onClick={applySharedSandboxPreset}
											>
												Shared
											</Button>
											<Button
												size="sm"
												variant={
													sandboxIsolationProfileDefault === "strict_per_agent" ? "primary" : "default"
												}
												aria-pressed={sandboxIsolationProfileDefault === "strict_per_agent"}
												disabled={controlsDisabled}
												onClick={applyDedicatedSandboxPreset}
											>
												Dedicated
											</Button>
										</div>
									</div>
									<div className="mb-2">
										<p className="text-text-secondary text-[12px] mt-0 mb-1">Isolation profile</p>
										<NativeSelect
											id="runtime-settings-sandbox-isolation-profile"
											value={sandboxIsolationProfileDefault}
											onChange={(event) =>
												handleSandboxIsolationProfileChange(
													event.target.value as RuntimeSandboxIsolationProfile,
												)
											}
											disabled={controlsDisabled}
											fill
										>
											<option value="lean_shared">Lean shared container</option>
											<option value="strict_per_agent">Strict per-agent containers</option>
											<option value="custom">Custom numeric pool</option>
										</NativeSelect>
									</div>
									<div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
										<div>
											<p className="text-text-secondary text-[12px] mt-0 mb-1">sandboxMaxContainers</p>
											<input
												value={sandboxMaxContainers}
												onChange={(event) => {
													setSandboxIsolationProfileDefault("custom");
													setSandboxMaxContainers(event.target.value);
												}}
												placeholder="1"
												disabled={controlsDisabled}
												className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary"
											/>
										</div>
										<div>
											<p className="text-text-secondary text-[12px] mt-0 mb-1">sandboxAgentsPerContainer</p>
											<input
												value={sandboxAgentsPerContainer}
												onChange={(event) => {
													setSandboxIsolationProfileDefault("custom");
													setSandboxAgentsPerContainer(event.target.value);
												}}
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
											checked={testDrivenModeEnabled}
											disabled={controlsDisabled}
											onCheckedChange={setTestDrivenModeEnabled}
											aria-label="Test-driven delivery"
											className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
										>
											<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
										</RadixSwitch.Root>
										<span>Test-driven delivery</span>
									</div>
									<p className="text-text-tertiary text-[11px] mt-1 mb-0">
										A change that touched no test file bounces back to the worker with an "add a test" note
										before review. Repeated testless rounds park the card for you.
									</p>
								</div>
								<div style={{ gridColumn: "1 / span 2" }}>
									<label
										className="flex items-center gap-2 text-[13px] text-text-primary"
										htmlFor="runtime-settings-hard-task-routing-mode"
									>
										Hard-task routing when the best model is busy
										<select
											id="runtime-settings-hard-task-routing-mode"
											value={hardTaskRoutingMode}
											disabled={controlsDisabled}
											onChange={(event) =>
												setHardTaskRoutingMode(
													event.target.value === "wait_for_best"
														? "wait_for_best"
														: "attempt_with_available",
												)
											}
											className="rounded border border-border bg-surface-0 px-2 py-1 text-[13px] text-text-primary disabled:opacity-40"
										>
											<option value="attempt_with_available">
												Attempt with the best available model now
											</option>
											<option value="wait_for_best">Wait for the best qualified model</option>
										</select>
									</label>
									<p className="text-text-tertiary text-[11px] mt-1 mb-0">
										§5.AB routing policy for hard cards: wait for the top qualified model to free up, or start
										immediately on the best model available.
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
									<div className="flex items-center gap-2 text-[13px] text-text-primary">
										<RadixSwitch.Root
											checked={reviewLensesEnabled}
											disabled={controlsDisabled || !secondOpinionReviewEnabled}
											onCheckedChange={setReviewLensesEnabled}
											aria-labelledby={reviewLensesLabelId}
											className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
										>
											<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
										</RadixSwitch.Root>
										<span id={reviewLensesLabelId}>Review-panel lenses</span>
									</div>
									<p className="text-text-tertiary text-[11px] mt-1 mb-0">
										Seeds each second-opinion review with complexity-matched focus lenses (correctness, edge
										cases, security, …) so the reviewer covers distinct angles instead of one generic pass
										(&sect;5.AW). OFF by default; needs second-opinion review on. The{" "}
										<code>NKLEIN_REVIEW_LENSES</code> env var also enables it.
									</p>
								</div>
								<div style={{ gridColumn: "1 / span 2" }}>
									<div className="flex items-center gap-2 text-[13px] text-text-primary">
										<RadixSwitch.Root
											checked={speculativeBestOfNEnabled}
											disabled={controlsDisabled}
											onCheckedChange={setSpeculativeBestOfNEnabled}
											aria-labelledby={speculativeBestOfNLabelId}
											className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
										>
											<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
										</RadixSwitch.Root>
										<span id={speculativeBestOfNLabelId}>
											Speculative best-of-N (idle models mirror the hardest running card)
										</span>
									</div>
									<p className="text-text-tertiary text-[11px] mt-1 mb-0">
										When on, an idle lineage-diverse model speculatively implements the same card in parallel;
										the reviewer compares both candidates (A/B) and the better one is delivered. Real work
										always outranks speculation.
									</p>
									<div className="mt-2 flex items-center gap-2 text-[12px] text-text-secondary">
										<label htmlFor={speculativeMaxConcurrentSpecsId}>
											Max concurrent speculative sessions
										</label>
										<input
											id={speculativeMaxConcurrentSpecsId}
											type="number"
											min={1}
											max={4}
											value={speculativeMaxConcurrentSpecs}
											disabled={controlsDisabled || !speculativeBestOfNEnabled}
											onChange={(event) => {
												const parsed = Number.parseInt(event.target.value, 10);
												setSpeculativeMaxConcurrentSpecs(
													Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 4) : 1,
												);
											}}
											className="w-16 rounded-md border border-border bg-surface-2 px-2 py-1 text-text-primary disabled:opacity-40"
										/>
										<span className="text-text-tertiary text-[11px]">
											Speculative sessions running at once (default 1, max 4).
										</span>
									</div>
									<div className="mt-2 flex items-center gap-2 text-[12px] text-text-secondary">
										<label htmlFor={speculativeMaxSpecsPerRunId}>Max speculative sessions per run</label>
										<input
											id={speculativeMaxSpecsPerRunId}
											type="number"
											min={1}
											max={20}
											value={speculativeMaxSpecsPerRun}
											disabled={controlsDisabled || !speculativeBestOfNEnabled}
											onChange={(event) => {
												const parsed = Number.parseInt(event.target.value, 10);
												setSpeculativeMaxSpecsPerRun(
													Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 20) : 1,
												);
											}}
											className="w-16 rounded-md border border-border bg-surface-2 px-2 py-1 text-text-primary disabled:opacity-40"
										/>
										<span className="text-text-tertiary text-[11px]">
											Ceiling on speculative sessions across a run (default 3, max 20).
										</span>
									</div>
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
						<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-3">
								Sandbox Egress
							</h6>
							<label
								htmlFor={sandboxEgressProxyEnabledId}
								className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer"
							>
								<RadixSwitch.Root
									id={sandboxEgressProxyEnabledId}
									checked={sandboxEgressProxyEnabled}
									disabled={controlsDisabled}
									onCheckedChange={setSandboxEgressProxyEnabled}
									className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
								>
									<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
								</RadixSwitch.Root>
								<span>Domain-allowlisted sandbox egress (experimental)</span>
							</label>
							<p className="text-text-tertiary text-[11px] ml-11 mt-1 mb-0">
								OFF by default and fail-closed: with it off, every sandbox stays fully offline (
								<code>--network none</code>). When on, agents on the <code>allowlist</code> capability tier
								reach ONLY the hosts listed below, through a local egress proxy that vets every connection;
								anything else is denied and audited. The <code>NKLEIN_SANDBOX_EGRESS_PROXY</code> environment
								variable overrides this.
							</p>
							<div className="mt-3">
								<label htmlFor={sandboxEgressAllowlistId} className="block text-[13px] text-text-primary mb-1">
									Host allowlist
								</label>
								<textarea
									id={sandboxEgressAllowlistId}
									value={sandboxEgressAllowlist}
									onChange={(event) => setSandboxEgressAllowlist(event.target.value)}
									placeholder={"api.github.com\nregistry.npmjs.org\npypi.org"}
									disabled={controlsDisabled || !sandboxEgressProxyEnabled}
									rows={3}
									className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-text-primary disabled:opacity-40"
								/>
								<p className="text-text-tertiary text-[11px] mt-1 mb-0">
									Hosts allowlist-tier agents may reach — one per line (or comma-separated). Blank &rArr;
									default-deny (no egress). Applies to newly created sandbox containers; v1 uses one global
									list for every agent role.
								</p>
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
							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-3">
								Machine-Aware Model Loading
							</h6>
							<div>
								<label htmlFor={deviceRamGbId} className="block text-[13px] text-text-primary mb-1">
									Per-device RAM budget
								</label>
								<input
									id={deviceRamGbId}
									type="text"
									value={deviceRamGb}
									onChange={(event) => setDeviceRamGb(event.target.value)}
									placeholder="m5max:128,m4mini:24,legion5pro:32"
									disabled={controlsDisabled}
									className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary disabled:opacity-40"
								/>
								<p className="text-text-tertiary text-[11px] mt-1 mb-0">
									Total RAM (GB) per linked device, as <code>name:GB</code> pairs. When set, !Klein loads an
									explicitly-requested model onto a device that FITS it (weights + KV cache) instead of an
									undersized node that would swap. Leave blank to disable and keep LM Studio's default
									placement. The <code>NKLEIN_DEVICE_RAM_GB</code> environment variable overrides this.
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

						{/* ---- Guardrails & Limits ---- */}
						<div data-settings-section="guardrails" />
						<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
							<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
								<Gauge size={16} className="text-text-secondary" />
								Guardrails &amp; Limits
							</h2>
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
							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-3">
								Swarm Safety Guardrails
							</h6>
							<SwarmGuardrailsSettingsPanel
								value={swarmGuardrailInputs}
								onChange={setSwarmGuardrailInputs}
								disabled={controlsDisabled}
								maxConcurrentTasks={maxConcurrentTasks}
								sandboxMaxContainers={sandboxMaxContainers}
								sandboxPool={sandboxPoolSummary}
								lostHeartbeatPolicy={lostHeartbeatPolicy}
								decompositionAutoApplyEnabled={decompositionAutoApplyEnabled}
								modelRoles={modelRolesOverride ?? modelRoles}
							/>
						</div>

						<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
							<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-2">
								LM Studio and provider concurrency
							</h6>
							<p className="text-text-tertiary text-[11px] mt-0 mb-2">
								Cap how many sessions run at once on a provider, LM Studio host, endpoint pool, or specific
								model (canonical <code>provider:model:endpoint</code> id). A cap of 1 serializes; remove a row
								for no extra limit. These defaults compose with per-project overrides and the per-model registry
								limit.
							</p>
							<ConcurrencyEditor
								perProvider={concurrencyDefaults.perProvider}
								perModel={concurrencyDefaults.perModel}
								perHost={concurrencyDefaults.perHost}
								perEndpoint={concurrencyDefaults.perEndpoint}
								disabled={controlsDisabled}
								onChange={setConcurrencyDefaults}
							/>
						</div>

						{/* ---- NKlein ---- */}
						{selectedAgentId === "nklein" ? (
							<>
								<div data-settings-section="nklein" />
								<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
									<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
										<Bot size={16} className="text-text-secondary" />
										!Klein Provider &amp; Models
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
										llmfitCatalogUpdateMode={llmfitCatalogUpdateMode}
										onLlmfitCatalogUpdateModeChange={setLlmfitCatalogUpdateMode}
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
											Model capability gate
										</h6>
										<p className="m-0 mb-3 text-[12px] text-text-secondary">
											How !Klein treats a model the capability catalog flags as not-suitable (e.g.
											reasoning-only) or unknown for agentic tool use. A project can override this in its
											Project Settings.
										</p>
										<div className="grid gap-2 lg:grid-cols-2">
											<div className="min-w-0">
												<span className="mb-1 block text-[12px] text-text-secondary">
													Not-suitable model
												</span>
												<NativeSelect
													id="runtime-settings-model-gate-unsuitable"
													value={modelGateUnsuitable}
													onChange={(event) =>
														setModelGateUnsuitable(event.target.value as RuntimeModelGateAction)
													}
													disabled={controlsDisabled}
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
													id="runtime-settings-model-gate-unknown"
													value={modelGateUnknown}
													onChange={(event) =>
														setModelGateUnknown(event.target.value as RuntimeModelGateAction)
													}
													disabled={controlsDisabled}
													fill
												>
													<option value="reject">Reject (refuse to use)</option>
													<option value="warn">Warn (use with a caveat)</option>
													<option value="allow">Allow (use anyway)</option>
												</NativeSelect>
											</div>
										</div>
									</div>
									<div className="mt-4 border-t border-border pt-4">
										<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-2">
											Skill dynamics
										</h6>
										<p className="m-0 mb-3 text-[12px] text-text-secondary">
											How dynamic vs. strict !Klein’s per-task skill/prompt assignment is (§5.AE). A project
											can override this in its Project Settings.
										</p>
										<NativeSelect
											id="runtime-settings-skill-dynamics-level"
											value={skillDynamicsLevel}
											onChange={(event) =>
												setSkillDynamicsLevel(event.target.value as RuntimeSkillDynamicsLevel)
											}
											disabled={controlsDisabled}
											fill
										>
											<option value="fully_dynamic">
												Fully dynamic (auto skills + model, may vary per turn)
											</option>
											<option value="static_skills_auto_model">Static skills, auto model</option>
											<option value="assigned_skills">Assigned skills</option>
											<option value="fully_static">Fully static skills, model assignment unchanged</option>
										</NativeSelect>
									</div>
								</div>
							</>
						) : null}

						{/* ---- Code Intelligence ---- */}
						<div data-settings-section="code-intelligence" />
						<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
							<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
								<Braces size={16} className="text-text-secondary" />
								Code Intelligence
							</h2>
						</div>
						<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
							<p className="text-text-secondary text-[13px] mt-0 mb-0">
								Code-embedding provider used to index the workspace for semantic search. Applies to every agent
								(a project can override it in Project Settings).
							</p>
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

						{/* ---- Git ---- */}
						<div data-settings-section="git-prompts" />
						<div className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-surface-1 z-10">
							<h2 className="flex items-center gap-2 text-base font-semibold text-text-primary m-0">
								<GitCommit size={16} className="text-text-secondary" />
								Git
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
													style={{ background: currentThemeDef?.surface ?? "#0A0C10" }}
												/>
												<span
													className="flex-1"
													style={{ background: currentThemeDef?.accent ?? "#3FE0E0" }}
												/>
												<span
													className="flex-1"
													style={{ background: currentThemeDef?.accent2 ?? "#9D7BFF" }}
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
						{/* §5.BA guided-setup re-trigger (PROJECT). Scoped to this project's settings, NOT the global modal —
						    per the user directive. Only shown when a project is active (App passes onRunProjectSetupWizard). */}
						{onRunProjectSetupWizard ? (
							<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
								<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-1">
									Guided setup
								</h6>
								<div className="flex items-center justify-between gap-3">
									<p className="text-text-secondary text-[13px] m-0">
										Walk through the recommended settings for this project again.
									</p>
									<Button
										variant="default"
										size="sm"
										icon={<Wand2 size={14} />}
										onClick={onRunProjectSetupWizard}
										disabled={controlsDisabled}
									>
										Run setup wizard
									</Button>
								</div>
							</div>
						) : null}
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
												Object.keys(concurrencyDefaults.perModel).length +
												Object.keys(concurrencyDefaults.perHost).length +
												Object.keys(concurrencyDefaults.perEndpoint).length >
											0
												? `${Object.keys(concurrencyDefaults.perProvider).length} provider, ${Object.keys(concurrencyDefaults.perModel).length} model, ${Object.keys(concurrencyDefaults.perHost).length} host, ${Object.keys(concurrencyDefaults.perEndpoint).length} endpoint cap(s)`
												: "defaults"
										}
										isOverridden={concurrencyOverride !== null}
										onOverride={() =>
											setConcurrencyOverride({
												perProvider: { ...concurrencyDefaults.perProvider },
												perModel: { ...concurrencyDefaults.perModel },
												perHost: { ...concurrencyDefaults.perHost },
												perEndpoint: { ...concurrencyDefaults.perEndpoint },
											})
										}
										onRevert={() => setConcurrencyOverride(null)}
										disabled={controlsDisabled}
									>
										<ConcurrencyEditor
											perProvider={concurrencyOverride?.perProvider ?? {}}
											perModel={concurrencyOverride?.perModel ?? {}}
											perHost={concurrencyOverride?.perHost ?? {}}
											perEndpoint={concurrencyOverride?.perEndpoint ?? {}}
											disabled={controlsDisabled}
											onChange={setConcurrencyOverride}
										/>
									</OverrideRow>
									<OverrideRow
										label="Skill dynamics"
										inheritLabel={
											SKILL_DYNAMICS_LEVEL_LABELS[config.skillDynamicsLevelDefault ?? "fully_dynamic"]
										}
										isOverridden={skillDynamicsLevelOverride !== null}
										onOverride={() =>
											setSkillDynamicsLevelOverride(config.skillDynamicsLevelDefault ?? "fully_dynamic")
										}
										onRevert={() => setSkillDynamicsLevelOverride(null)}
										disabled={controlsDisabled}
									>
										<NativeSelect
											value={skillDynamicsLevelOverride ?? "fully_dynamic"}
											onChange={(event) =>
												setSkillDynamicsLevelOverride(event.target.value as RuntimeSkillDynamicsLevel)
											}
											disabled={controlsDisabled}
											fill
										>
											<option value="fully_dynamic">
												Fully dynamic (auto skills + model, may vary per turn)
											</option>
											<option value="static_skills_auto_model">Static skills, auto model</option>
											<option value="assigned_skills">Assigned skills</option>
											<option value="fully_static">Fully static skills, model assignment unchanged</option>
										</NativeSelect>
									</OverrideRow>
									<OverrideRow
										label="Code embeddings"
										inheritLabel={
											config.codeEmbeddingDefaults
												? formatCodeEmbeddingSettings(config.codeEmbeddingDefaults)
												: "Local lexical fallback"
										}
										isOverridden={codeEmbeddingOverrideEnabled}
										onOverride={() => {
											const defaults = config.codeEmbeddingDefaults;
											setCodeEmbeddingOverrideProvider(defaults?.provider ?? "local_lexical");
											setCodeEmbeddingOverrideModel(defaults?.model ?? LOCAL_CODE_EMBEDDING_MODEL);
											setCodeEmbeddingOverrideBaseUrl(defaults?.baseUrl ?? "");
											setCodeEmbeddingOverrideEnabled(true);
										}}
										onRevert={() => setCodeEmbeddingOverrideEnabled(false)}
										disabled={controlsDisabled}
									>
										<div className="grid gap-2 lg:grid-cols-[minmax(180px,0.8fr)_1fr]">
											<div className="min-w-0">
												<span className="mb-1 block text-[12px] text-text-secondary">Project provider</span>
												<NativeSelect
													value={codeEmbeddingOverrideProvider}
													onChange={(event) =>
														setCodeEmbeddingOverrideProvider(
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
												labelPrefix="Project"
												disabled={controlsDisabled}
												provider={codeEmbeddingOverrideProvider}
												baseUrl={codeEmbeddingOverrideBaseUrl}
												model={codeEmbeddingOverrideModel}
												suggestedBaseUrl={suggestedCodeEmbeddingBaseUrl}
												endpointPlaceholder={config.codeEmbeddingDefaults?.baseUrl || "Inherited endpoint"}
												modelPlaceholder={config.codeEmbeddingDefaults?.model || "Inherited model"}
												onBaseUrlChange={setCodeEmbeddingOverrideBaseUrl}
												onModelChange={setCodeEmbeddingOverrideModel}
												onError={setSaveError}
											/>
										</div>
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
