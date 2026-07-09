import { DEFAULT_RUNTIME_SWARM_GUARDRAILS } from "@runtime-contract";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeConfigResponse } from "@/runtime/types";
import { type UseRuntimeProjectConfigResult, useRuntimeProjectConfig } from "@/runtime/use-runtime-project-config";

const fetchRuntimeConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/runtime-config-query", () => ({
	fetchRuntimeConfig: fetchRuntimeConfigMock,
}));

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, resolve, reject };
}

function createRuntimeConfigResponse(
	selectedAgentId: RuntimeConfigResponse["selectedAgentId"],
	shortcuts: RuntimeConfigResponse["shortcuts"],
): RuntimeConfigResponse {
	return {
		selectedAgentId,
		selectedShortcutLabel: shortcuts[0]?.label ?? null,
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
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project/.nklein/nklein/config.json",
		readyForReviewNotificationsEnabled: true,
		detectedCommands: [selectedAgentId],
		agents: [
			{
				id: "claude",
				label: "Claude Code",
				binary: "claude",
				command: "claude",
				defaultArgs: [],
				installed: selectedAgentId === "claude",
				configured: selectedAgentId === "claude",
			},
			{
				id: "codex",
				label: "OpenAI Codex",
				binary: "codex",
				command: "codex",
				defaultArgs: [],
				installed: selectedAgentId === "codex",
				configured: selectedAgentId === "codex",
			},
		],
		shortcuts,
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
	};
}

type HookSnapshot = UseRuntimeProjectConfigResult;

function findLatestLoadedSnapshot(snapshots: HookSnapshot[]): HookSnapshot | null {
	for (let index = snapshots.length - 1; index >= 0; index -= 1) {
		const snapshot = snapshots[index];
		if (snapshot && snapshot.config !== null) {
			return snapshot;
		}
	}
	return null;
}

function HookHarness({
	workspaceId,
	onSnapshot,
}: {
	workspaceId: string | null;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const snapshot = useRuntimeProjectConfig(workspaceId);

	useEffect(() => {
		onSnapshot(snapshot);
	}, [onSnapshot, snapshot]);

	return null;
}

describe("useRuntimeProjectConfig", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		fetchRuntimeConfigMock.mockReset();
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

	it("clears the previous project config immediately when switching workspaces", async () => {
		const projectAConfig = createRuntimeConfigResponse("claude", [
			{ label: "Ship it", command: "npm run ship", icon: "rocket" },
		]);
		const projectBDeferred = createDeferred<RuntimeConfigResponse>();
		fetchRuntimeConfigMock.mockResolvedValueOnce(projectAConfig);
		fetchRuntimeConfigMock.mockImplementationOnce(() => projectBDeferred.promise);

		let snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					workspaceId="project-a"
					onSnapshot={(snapshot) => {
						snapshots = [...snapshots, snapshot];
					}}
				/>,
			);
			await Promise.resolve();
		});

		const loadedProjectASnapshot = findLatestLoadedSnapshot(snapshots);
		expect(fetchRuntimeConfigMock).toHaveBeenCalledWith("project-a");
		expect(loadedProjectASnapshot?.config?.shortcuts).toHaveLength(1);

		await act(async () => {
			root.render(
				<HookHarness
					workspaceId="project-b"
					onSnapshot={(snapshot) => {
						snapshots = [...snapshots, snapshot];
					}}
				/>,
			);
		});

		expect(fetchRuntimeConfigMock).toHaveBeenCalledWith("project-b");
		expect(snapshots.at(-1)?.config).toBeNull();

		await act(async () => {
			projectBDeferred.resolve(createRuntimeConfigResponse("codex", []));
			await projectBDeferred.promise;
		});

		expect(snapshots.at(-1)?.config?.shortcuts).toEqual([]);
	});

	it("loads runtime config without a selected project", async () => {
		const startupConfig = createRuntimeConfigResponse("codex", []);
		fetchRuntimeConfigMock.mockResolvedValue(startupConfig);
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					workspaceId={null}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await Promise.resolve();
		});

		expect(fetchRuntimeConfigMock).toHaveBeenCalledWith(null);
		if (latestSnapshot === null) {
			throw new Error("Expected a runtime project config snapshot.");
		}
		const snapshot = latestSnapshot as HookSnapshot;
		expect(snapshot.config?.selectedAgentId).toBe("codex");
		expect(snapshot.isLoading).toBe(false);
	});
});
