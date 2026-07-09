import { DEFAULT_RUNTIME_SWARM_GUARDRAILS } from "@runtime-contract";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type UseStartupOnboardingResult, useStartupOnboarding } from "@/hooks/use-startup-onboarding";
import type { RuntimeConfigResponse } from "@/runtime/types";
import { LocalStorageKey } from "@/storage/local-storage-store";

const saveRuntimeConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/runtime-config-query", () => ({
	saveRuntimeConfig: saveRuntimeConfigMock,
}));

type HookSnapshot = UseStartupOnboardingResult;

function createRuntimeConfigResponse(
	selectedAgentId: RuntimeConfigResponse["selectedAgentId"],
	overrides: Partial<RuntimeConfigResponse> = {},
): RuntimeConfigResponse {
	return {
		selectedAgentId,
		selectedShortcutLabel: null,
		workspaceBaseDir: null,
		agentAutonomousModeEnabled: true,
		agentTimeoutMode: "normal",
		agentTimeoutProfile: "cloud",
		requestTimeoutMs: 300_000,
		streamTimeoutMs: 180_000,
		toolTimeoutMs: 600_000,
		agentTimeoutMs: 3_600_000,
		conversationTimeoutMs: 7_200_000,
		maxAgentWritableFileLines: 1000,
		maxConcurrentTasks: 3,
		maxConcurrentTasksOverride: null,
		effectiveMaxConcurrentTasks: 3,
		selectedAgentIdOverride: null,
		effectiveSelectedAgentId: selectedAgentId,
		sandboxMaxContainers: 1,
		sandboxMaxConcurrentExec: 2,
		sandboxAgentsPerContainer: 0,
		sandboxMemoryPerContainerMb: 4096,
		sandboxCpusPerContainer: 2,
		sandboxIdleTimeoutMinutes: 10,
		sandboxIsolationProfileDefault: "lean_shared",
		sandboxIsolationProfileOverride: null,
		effectiveSandboxIsolationProfile: "lean_shared",
		agentSandboxStatus: {
			state: "ready",
			dockerAvailable: true,
			imageAvailable: true,
			image: "nklein/agent-sandbox:0.0.1",
			message: null,
			checkedAt: 1,
		},
		lostHeartbeatPolicy: "park",
		decompositionAutoApplyEnabled: true,
		hardTaskRoutingMode: "attempt_with_available",
		testDrivenModeEnabled: false,
		secondOpinionReviewEnabled: true,
		reviewMaxRounds: 20,
		codeEmbeddingDefaults: {
			provider: "local_lexical",
			model: "kanban-local-lexical-vector-v1",
			baseUrl: null,
		},
		codeEmbeddingOverride: null,
		concurrencyDefaults: { perProvider: {}, perModel: {} },
		concurrencyOverride: null,
		effectiveCodeEmbeddingSettings: {
			provider: "local_lexical",
			model: "kanban-local-lexical-vector-v1",
			baseUrl: null,
		},
		modelSuitabilityPolicyDefaults: { onUnsuitable: "reject", onUnknown: "warn" },
		modelSuitabilityPolicyOverride: null,
		effectiveModelSuitabilityPolicy: { onUnsuitable: "reject", onUnknown: "warn" },
		skillDynamicsLevelDefault: "fully_dynamic",
		skillDynamicsLevelOverride: null,
		effectiveSkillDynamicsLevel: "fully_dynamic",
		effectiveCommand: selectedAgentId,
		globalConfigPath: "/tmp/.nklein/nklein/config.json",
		projectConfigPath: "/tmp/project/.nklein/nklein/config.json",
		readyForReviewNotificationsEnabled: true,
		detectedCommands: ["codex"],
		agents: [
			{
				id: "codex",
				label: "OpenAI Codex",
				binary: "codex",
				command: "codex",
				defaultArgs: [],
				installed: true,
				configured: selectedAgentId === "codex",
			},
		],
		shortcuts: [],
		modelRoles: {},
		agentRulesetsOverride: null,
		swarmGuardrails: DEFAULT_RUNTIME_SWARM_GUARDRAILS,
		nkleinProviderSettings: {
			providerId: null,
			modelId: null,
			baseUrl: null,
			apiKeyConfigured: false,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		},
		commitPromptTemplate: "",
		openPrPromptTemplate: "",
		commitPromptTemplateDefault: "",
		openPrPromptTemplateDefault: "",
		...overrides,
	};
}

function HookHarness({
	currentProjectId,
	runtimeProjectConfig,
	isRuntimeProjectConfigLoading,
	isTaskAgentReady,
	onSnapshot,
}: {
	currentProjectId: string | null;
	runtimeProjectConfig: RuntimeConfigResponse | null;
	isRuntimeProjectConfigLoading: boolean;
	isTaskAgentReady: boolean | null;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const snapshot = useStartupOnboarding({
		currentProjectId,
		runtimeProjectConfig,
		isRuntimeProjectConfigLoading,
		isTaskAgentReady,
		refreshRuntimeProjectConfig: () => {},
		refreshSettingsRuntimeProjectConfig: () => {},
	});

	useEffect(() => {
		onSnapshot(snapshot);
	}, [onSnapshot, snapshot]);

	return null;
}

describe("useStartupOnboarding", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		window.localStorage.clear();
		saveRuntimeConfigMock.mockReset();
		saveRuntimeConfigMock.mockResolvedValue(createRuntimeConfigResponse("codex"));
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("opens startup onboarding on first launch even before any project exists", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId={null}
					runtimeProjectConfig={null}
					isRuntimeProjectConfigLoading={false}
					isTaskAgentReady={null}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a startup onboarding snapshot.");
		}

		const snapshot = latestSnapshot as HookSnapshot;
		expect(snapshot.isStartupOnboardingDialogOpen).toBe(true);
	});

	it("saves the selected agent without requiring a project", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId={null}
					runtimeProjectConfig={createRuntimeConfigResponse("nklein")}
					isRuntimeProjectConfigLoading={false}
					isTaskAgentReady={false}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a startup onboarding snapshot.");
		}

		const snapshot = latestSnapshot as HookSnapshot;
		const result = await snapshot.handleSelectOnboardingAgent("codex");

		expect(result).toEqual({ ok: true });
		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(null, { selectedAgentId: "codex" });
	});

	it("waits for runtime config to finish loading before opening onboarding", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId={null}
					runtimeProjectConfig={null}
					isRuntimeProjectConfigLoading={true}
					isTaskAgentReady={null}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a startup onboarding snapshot.");
		}

		const snapshot = latestSnapshot as HookSnapshot;
		expect(snapshot.isStartupOnboardingDialogOpen).toBe(false);
	});

	it("reopens once onboarding has already been shown when NKlein has no local model configured", async () => {
		window.localStorage.setItem(LocalStorageKey.OnboardingDialogShown, "true");
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId={"project-1"}
					runtimeProjectConfig={createRuntimeConfigResponse("nklein")}
					isRuntimeProjectConfigLoading={false}
					isTaskAgentReady={false}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a startup onboarding snapshot.");
		}

		const snapshot = latestSnapshot as HookSnapshot;
		expect(snapshot.isStartupOnboardingDialogOpen).toBe(true);
	});

	it("stays closed once onboarding has already been shown and NKlein has a local model configured", async () => {
		window.localStorage.setItem(LocalStorageKey.OnboardingDialogShown, "true");
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId={"project-1"}
					runtimeProjectConfig={createRuntimeConfigResponse("nklein", {
						nkleinProviderSettings: {
							providerId: "ollama",
							modelId: "qwen3",
							baseUrl: null,
							apiKeyConfigured: false,
							oauthProvider: null,
							oauthAccessTokenConfigured: false,
							oauthRefreshTokenConfigured: false,
							oauthAccountId: null,
							oauthExpiresAt: null,
						},
					})}
					isRuntimeProjectConfigLoading={false}
					isTaskAgentReady={true}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a startup onboarding snapshot.");
		}

		const snapshot = latestSnapshot as HookSnapshot;
		expect(snapshot.isStartupOnboardingDialogOpen).toBe(false);
	});

	it("reopens after closing when a project still needs local NKlein setup", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId={null}
					runtimeProjectConfig={createRuntimeConfigResponse("nklein")}
					isRuntimeProjectConfigLoading={false}
					isTaskAgentReady={false}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a startup onboarding snapshot.");
		}

		let snapshot = latestSnapshot as HookSnapshot;
		expect(snapshot.isStartupOnboardingDialogOpen).toBe(true);

		await act(async () => {
			snapshot.handleCloseStartupOnboardingDialog();
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a startup onboarding snapshot.");
		}

		snapshot = latestSnapshot as HookSnapshot;
		expect(snapshot.isStartupOnboardingDialogOpen).toBe(false);

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId={"project-1"}
					runtimeProjectConfig={createRuntimeConfigResponse("nklein")}
					isRuntimeProjectConfigLoading={false}
					isTaskAgentReady={false}
					onSnapshot={(nextSnapshot) => {
						latestSnapshot = nextSnapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a startup onboarding snapshot.");
		}

		snapshot = latestSnapshot as HookSnapshot;
		expect(snapshot.isStartupOnboardingDialogOpen).toBe(true);
	});

	it("can be manually opened from debug tools even when normal criteria would keep it closed", async () => {
		window.localStorage.setItem(LocalStorageKey.OnboardingDialogShown, "true");
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					currentProjectId={"project-1"}
					runtimeProjectConfig={createRuntimeConfigResponse("codex")}
					isRuntimeProjectConfigLoading={false}
					isTaskAgentReady={true}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a startup onboarding snapshot.");
		}

		let snapshot = latestSnapshot as HookSnapshot;
		expect(snapshot.isStartupOnboardingDialogOpen).toBe(false);

		await act(async () => {
			snapshot.handleOpenStartupOnboardingDialog();
			await Promise.resolve();
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a startup onboarding snapshot.");
		}

		snapshot = latestSnapshot as HookSnapshot;
		expect(snapshot.isStartupOnboardingDialogOpen).toBe(true);
	});
});
