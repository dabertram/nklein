import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolApprovalRequest, ToolApprovalResult } from "@cline/sdk";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { buildAttemptEvent } from "../../../src/core/agent-attempt-ledger";
import {
	DEFAULT_RUNTIME_SWARM_GUARDRAILS,
	type RuntimeTaskImage,
	type RuntimeTaskSessionMode,
	type RuntimeTaskSessionSummary,
} from "../../../src/core/api-contract";
import { buildPromptShellKey } from "../../../src/core/cache-warmth";
import { AgentSandboxExecutionError, type AgentSandboxManager } from "../../../src/nklein-agent/nklein-agent-sandbox";
import { buildKanbanEfficiencyRules } from "../../../src/nklein-agent/nklein-kanban-efficiency-rules";
import type { NKleinRuntimeSetup } from "../../../src/nklein-agent/nklein-runtime-setup";
import type {
	CreateInMemoryNKleinSessionRuntimeOptions,
	NKleinPersistedTaskSessionSnapshot,
	NKleinSessionRuntime,
	StartNKleinSessionRuntimeRequest,
	StartNKleinSessionRuntimeResult,
} from "../../../src/nklein-agent/nklein-session-runtime";
import { createSessionId } from "../../../src/nklein-agent/nklein-session-state";
import type {
	CreateInMemoryNKleinTaskSessionServiceOptions,
	NKleinModelTurnAdmissionRequest,
	NKleinTaskSessionService,
} from "../../../src/nklein-agent/nklein-task-session-service";
import {
	computeRepeatedToolCallCandidate,
	createInMemoryNKleinTaskSessionService,
	formatRepeatedToolCallParkMessage,
} from "../../../src/nklein-agent/nklein-task-session-service";
import { createNKleinWatcherRegistry } from "../../../src/nklein-agent/nklein-watcher-registry";
import type { NKleinSdkPersistedMessage } from "../../../src/nklein-agent/sdk-runtime-boundary";
import { appendAgentLedgerEvent } from "../../../src/state/agent-attempt-ledger-store";

const originalArgv = [...process.argv];
const originalExecArgv = [...process.execArgv];
const originalExecPath = process.execPath;

const turnCheckpointMocks = vi.hoisted(() => ({
	captureTaskTurnCheckpoint: vi.fn(),
	deleteTaskTurnCheckpointRef: vi.fn(),
}));

const selfObservationMocks = vi.hoisted(() => ({
	recordSelfObservation: vi.fn(),
}));

const taskResultBranchMocks = vi.hoisted(() => ({
	applyTaskPatchToResultBranch: vi.fn(),
	resolveTaskResultBranchCommit: vi.fn(),
}));

vi.mock("../../../src/workspace/turn-checkpoints.js", () => ({
	captureTaskTurnCheckpoint: turnCheckpointMocks.captureTaskTurnCheckpoint,
	deleteTaskTurnCheckpointRef: turnCheckpointMocks.deleteTaskTurnCheckpointRef,
}));

vi.mock("../../../src/workspace/task-result-branches.js", () => ({
	applyTaskPatchToResultBranch: taskResultBranchMocks.applyTaskPatchToResultBranch,
	resolveTaskResultBranchCommit: taskResultBranchMocks.resolveTaskResultBranchCommit,
}));

vi.mock("../../../src/telemetry/self-observation-sink.js", () => ({
	recordSelfObservation: selfObservationMocks.recordSelfObservation,
}));

function createDeferred<T>() {
	let resolve: (value: T) => void = () => {};
	let reject: (error: unknown) => void = () => {};
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return {
		promise,
		resolve,
		reject,
	};
}

type StartTaskSessionMock = Mock<
	(request: StartNKleinSessionRuntimeRequest & { sessionId: string }) => Promise<StartNKleinSessionRuntimeResult>
>;
type SendTaskSessionInputMock = Mock<
	(
		taskId: string,
		prompt: string,
		mode?: RuntimeTaskSessionMode,
		images?: RuntimeTaskImage[],
		delivery?: "queue" | "steer",
	) => Promise<unknown>
>;
type StopTaskSessionMock = Mock<(taskId: string) => Promise<void>>;
type AbortTaskSessionMock = Mock<(taskId: string) => Promise<void>>;
type ClearTaskSessionsMock = Mock<(taskId: string) => Promise<void>>;
type ReadPersistedTaskSessionMock = Mock<(taskId: string) => Promise<NKleinPersistedTaskSessionSnapshot | null>>;
type DisposeMock = Mock<() => Promise<void>>;

interface FakeNKleinSessionRuntimeController {
	sessionIdByTaskId: Map<string, string>;
	taskIdBySessionId: Map<string, string>;
	startTaskSessionMock: StartTaskSessionMock;
	sendTaskSessionInputMock: SendTaskSessionInputMock;
	stopTaskSessionMock: StopTaskSessionMock;
	abortTaskSessionMock: AbortTaskSessionMock;
	clearTaskSessionsMock: ClearTaskSessionsMock;
	readPersistedTaskSessionMock: ReadPersistedTaskSessionMock;
	disposeMock: DisposeMock;
	createRuntime(options: CreateInMemoryNKleinSessionRuntimeOptions): NKleinSessionRuntime;
	getTaskSessionId(taskId: string): string | null;
	bindTaskSession(taskId: string, sessionId: string): void;
	emitAgentEvent(sessionId: string, event: unknown): void;
	emitChunk(sessionId: string, chunk: string, stream?: string): void;
	/**
	 * Simulate a runtime PROCESS restart: drop every in-memory session binding + cached launch request, as
	 * if the host process had restarted. The SDK session host's persisted records (returned by
	 * `readPersistedTaskSessionMock`) survive, so a subsequent send rebuilds from the persisted launch config.
	 */
	simulateProcessRestart(): void;
}

interface TaskSessionServiceHarness {
	service: NKleinTaskSessionService;
	runtime: FakeNKleinSessionRuntimeController;
}

interface FakeRuntimeSetupController {
	setup: NKleinRuntimeSetup;
	resolvePromptMock: Mock<(prompt: string) => string>;
	loadRulesMock: Mock<() => string>;
	requestToolApprovalMock: Mock<(request: ToolApprovalRequest) => Promise<ToolApprovalResult>>;
	createToolApprovalMock: Mock<NKleinRuntimeSetup["createToolApproval"]>;
	disposeMock: Mock<() => Promise<void>>;
}

interface FakeAgentSandboxManagerController {
	manager: AgentSandboxManager;
	assertAvailableMock: Mock<AgentSandboxManager["assertAvailable"]>;
	prepareWorkspaceMock: Mock<AgentSandboxManager["prepareWorkspace"]>;
	execMock: Mock<AgentSandboxManager["exec"]>;
	captureWorkspacePatchMock: Mock<AgentSandboxManager["captureWorkspacePatch"]>;
	disposeWorkspaceMock: Mock<AgentSandboxManager["disposeWorkspace"]>;
	hasWorkspaceMock: Mock<AgentSandboxManager["hasWorkspace"]>;
	isWorkspacePreparedMock: Mock<AgentSandboxManager["isWorkspacePrepared"]>;
	stopNowMock: Mock<AgentSandboxManager["stopNow"]>;
	updatePoolConfigMock: Mock<AgentSandboxManager["updatePoolConfig"]>;
}

function createFakeNKleinSessionRuntime(): FakeNKleinSessionRuntimeController {
	const sessionIdByTaskId = new Map<string, string>();
	const taskIdBySessionId = new Map<string, string>();
	const lastStartRequestByTaskId = new Map<
		string,
		Omit<StartNKleinSessionRuntimeRequest, "prompt" | "images" | "initialMessages">
	>();
	let onTaskEvent: ((taskId: string, event: unknown) => void) | null = null;

	const bindTaskSession = (taskId: string, sessionId: string) => {
		const previousSessionId = sessionIdByTaskId.get(taskId);
		if (previousSessionId) {
			taskIdBySessionId.delete(previousSessionId);
		}
		sessionIdByTaskId.set(taskId, sessionId);
		taskIdBySessionId.set(sessionId, taskId);
	};
	const clearTaskSessionBinding = (taskId: string) => {
		const sessionId = sessionIdByTaskId.get(taskId);
		if (!sessionId) {
			return;
		}
		sessionIdByTaskId.delete(taskId);
		taskIdBySessionId.delete(sessionId);
	};

	const startTaskSessionMock: StartTaskSessionMock = vi.fn(
		async (request: StartNKleinSessionRuntimeRequest & { sessionId: string }) => ({
			sessionId: request.sessionId,
			result: {},
		}),
	);
	const sendTaskSessionInputMock: SendTaskSessionInputMock = vi.fn(async () => ({}));
	const stopTaskSessionMock: StopTaskSessionMock = vi.fn(async () => {});
	const abortTaskSessionMock: AbortTaskSessionMock = vi.fn(async () => {});
	const clearTaskSessionsMock: ClearTaskSessionsMock = vi.fn(async (_taskId: string) => {});
	const readPersistedTaskSessionMock: ReadPersistedTaskSessionMock = vi.fn(async () => null);
	const disposeMock: DisposeMock = vi.fn(async () => {});

	const createRuntime = (options: CreateInMemoryNKleinSessionRuntimeOptions): NKleinSessionRuntime => {
		onTaskEvent = options.onTaskEvent ?? null;
		return {
			async startTaskSession(request: StartNKleinSessionRuntimeRequest): Promise<StartNKleinSessionRuntimeResult> {
				const requestedSessionId = createSessionId(request.taskId);
				lastStartRequestByTaskId.set(request.taskId, {
					taskId: request.taskId,
					cwd: request.cwd,
					providerId: request.providerId,
					modelId: request.modelId,
					mode: request.mode ?? "act",
					apiKey: request.apiKey,
					baseUrl: request.baseUrl,
					reasoningEffort: request.reasoningEffort,
					contextWindow: request.contextWindow,
					maxAgentWritableFileLines: request.maxAgentWritableFileLines,
					apiTimeoutMs: request.apiTimeoutMs,
					turnTimeoutMs: request.turnTimeoutMs,
					systemPrompt: request.systemPrompt,
					userInstructionService: request.userInstructionService,
					toolPolicies: request.toolPolicies,
					requestToolApproval: request.requestToolApproval,
					onDecompositionApplied: request.onDecompositionApplied,
				});
				bindTaskSession(request.taskId, requestedSessionId);

				let startResult: StartNKleinSessionRuntimeResult;
				try {
					startResult = await startTaskSessionMock({
						...request,
						sessionId: requestedSessionId,
					});
				} catch (error) {
					clearTaskSessionBinding(request.taskId);
					throw error;
				}

				bindTaskSession(request.taskId, startResult.sessionId);
				return startResult;
			},
			async restartTaskSession(input): Promise<StartNKleinSessionRuntimeResult> {
				const lastStartRequest = lastStartRequestByTaskId.get(input.taskId);
				if (!lastStartRequest) {
					throw new Error(`No previous NKlein session config is available for task ${input.taskId}.`);
				}
				return await this.startTaskSession({
					...lastStartRequest,
					...(input.launchConfigOverrides ?? {}),
					prompt: input.prompt,
					initialMessages: input.initialMessages,
					images: input.images,
					mode: input.mode ?? lastStartRequest.mode,
				});
			},
			async sendTaskSessionInput(
				taskId: string,
				prompt: string,
				mode?: RuntimeTaskSessionMode,
				images?: RuntimeTaskImage[],
				delivery?: "queue" | "steer",
				launchConfigOverrides?,
			): Promise<unknown> {
				const lastStartRequest = lastStartRequestByTaskId.get(taskId);
				if (lastStartRequest && launchConfigOverrides) {
					lastStartRequestByTaskId.set(taskId, {
						...lastStartRequest,
						...launchConfigOverrides,
					});
				}
				if (delivery) {
					return await sendTaskSessionInputMock(taskId, prompt, mode, images, delivery);
				}
				return await sendTaskSessionInputMock(taskId, prompt, mode, images);
			},
			requiresTaskSessionRestart(taskId, mode, launchConfigOverrides): boolean {
				const lastStartRequest = lastStartRequestByTaskId.get(taskId);
				if (!lastStartRequest) {
					return false;
				}
				if (mode && mode !== lastStartRequest.mode) {
					return true;
				}
				if (!launchConfigOverrides) {
					return false;
				}
				return (
					launchConfigOverrides.providerId !== lastStartRequest.providerId ||
					(launchConfigOverrides.apiKey ?? null) !== (lastStartRequest.apiKey ?? null) ||
					(launchConfigOverrides.baseUrl ?? null) !== (lastStartRequest.baseUrl ?? null) ||
					(launchConfigOverrides.reasoningEffort ?? null) !== (lastStartRequest.reasoningEffort ?? null) ||
					(launchConfigOverrides.contextWindow ?? null) !== (lastStartRequest.contextWindow ?? null) ||
					(launchConfigOverrides.apiTimeoutMs ?? null) !== (lastStartRequest.apiTimeoutMs ?? null) ||
					(launchConfigOverrides.turnTimeoutMs ?? null) !== (lastStartRequest.turnTimeoutMs ?? null)
				);
			},
			async resumeTaskSession(taskId: string): Promise<NKleinPersistedTaskSessionSnapshot | null> {
				const snapshot = await readPersistedTaskSessionMock(taskId);
				if (snapshot) {
					bindTaskSession(taskId, snapshot.record.sessionId);
				}
				return snapshot;
			},
			async stopTaskSession(taskId: string): Promise<void> {
				await stopTaskSessionMock(taskId);
				clearTaskSessionBinding(taskId);
			},
			async abortTaskSession(taskId: string): Promise<void> {
				await abortTaskSessionMock(taskId);
				clearTaskSessionBinding(taskId);
			},
			async clearTaskSessions(taskId: string): Promise<void> {
				await clearTaskSessionsMock(taskId);
				clearTaskSessionBinding(taskId);
			},
			getTaskSessionId(taskId: string): string | null {
				return sessionIdByTaskId.get(taskId) ?? null;
			},
			getTaskProviderId(taskId: string): string | null {
				return lastStartRequestByTaskId.get(taskId)?.providerId ?? null;
			},
			canRestartTaskSession(taskId: string): boolean {
				return lastStartRequestByTaskId.has(taskId);
			},
			getSessionTaintLabels: () => null,
			async readPersistedTaskSession(taskId: string): Promise<NKleinPersistedTaskSessionSnapshot | null> {
				return await readPersistedTaskSessionMock(taskId);
			},
			async releaseTaskMcpTools(_taskId: string): Promise<void> {},
			async dispose(): Promise<void> {
				sessionIdByTaskId.clear();
				taskIdBySessionId.clear();
				lastStartRequestByTaskId.clear();
				await disposeMock();
			},
		};
	};

	const emitAgentEvent = (sessionId: string, event: unknown) => {
		if (!onTaskEvent) {
			throw new Error("Fake runtime has not been attached to a task session service.");
		}
		const taskId = taskIdBySessionId.get(sessionId);
		if (!taskId) {
			throw new Error(`No task is bound to session ${sessionId}.`);
		}
		onTaskEvent(taskId, {
			type: "agent_event",
			payload: {
				sessionId,
				event,
			},
		});
	};

	const emitChunk = (sessionId: string, chunk: string, stream = "agent") => {
		if (!onTaskEvent) {
			throw new Error("Fake runtime has not been attached to a task session service.");
		}
		const taskId = taskIdBySessionId.get(sessionId);
		if (!taskId) {
			throw new Error(`No task is bound to session ${sessionId}.`);
		}
		onTaskEvent(taskId, {
			type: "chunk",
			payload: {
				sessionId,
				stream,
				chunk,
				ts: Date.now(),
			},
		});
	};

	return {
		sessionIdByTaskId,
		taskIdBySessionId,
		startTaskSessionMock,
		sendTaskSessionInputMock,
		stopTaskSessionMock,
		abortTaskSessionMock,
		clearTaskSessionsMock,
		readPersistedTaskSessionMock,
		disposeMock,
		createRuntime,
		getTaskSessionId(taskId: string): string | null {
			return sessionIdByTaskId.get(taskId) ?? null;
		},
		bindTaskSession,
		emitAgentEvent,
		emitChunk,
		simulateProcessRestart() {
			sessionIdByTaskId.clear();
			taskIdBySessionId.clear();
			lastStartRequestByTaskId.clear();
		},
	};
}

function createFakeRuntimeSetup(): FakeRuntimeSetupController {
	const resolvePromptMock = vi.fn((prompt: string) => `resolved:${prompt}`);
	const loadRulesMock = vi.fn(() => "Workspace rule");
	const requestToolApprovalMock = vi.fn(async (_request: ToolApprovalRequest) => ({
		approved: true,
		reason: "approved in test",
	}));
	const createToolApprovalMock = vi.fn(() => requestToolApprovalMock);
	const disposeMock = vi.fn(async () => {});
	const refreshTypeMock = vi.fn(async () => {});
	const listRecordsMock = vi.fn(() => []);
	const listRuntimeCommandsMock = vi.fn(() => []);
	const resolveRuntimeSlashCommandMock = vi.fn((prompt: string) => prompt);
	const hasConfiguredSkillsMock = vi.fn(() => false);
	const createExtensionMock = vi.fn(() => ({
		name: "test-user-instructions",
		manifest: { capabilities: ["rules"] },
	}));

	return {
		setup: {
			userInstructionService: {
				start: vi.fn(async () => {}),
				stop: vi.fn(() => {}),
				refreshType: refreshTypeMock,
				listRecords: listRecordsMock,
				listRuntimeCommands: listRuntimeCommandsMock,
				resolveRuntimeSlashCommand: resolveRuntimeSlashCommandMock,
				hasConfiguredSkills: hasConfiguredSkillsMock,
				createExtension: createExtensionMock,
			} as unknown as NKleinRuntimeSetup["userInstructionService"],
			resolvePrompt: resolvePromptMock,
			loadRules: loadRulesMock,
			toolPolicies: {
				read_files: { enabled: true, autoApprove: false },
				editor: { enabled: true, autoApprove: false },
				apply_patch: { enabled: true, autoApprove: false },
			},
			requestToolApproval: requestToolApprovalMock,
			createToolApproval: createToolApprovalMock,
			dispose: disposeMock,
		},
		resolvePromptMock,
		loadRulesMock,
		requestToolApprovalMock,
		createToolApprovalMock,
		disposeMock,
	};
}

function createFakeAgentSandboxManager(): FakeAgentSandboxManagerController {
	const assertAvailableMock: FakeAgentSandboxManagerController["assertAvailableMock"] = vi.fn(async () => {});
	const prepareWorkspaceMock: FakeAgentSandboxManagerController["prepareWorkspaceMock"] = vi.fn(async (input) => ({
		workdir: `/workspaces/${input.taskId}`,
		uid: 70_001,
	}));
	const execMock: FakeAgentSandboxManagerController["execMock"] = vi.fn(async () => ({
		exitCode: 0,
		stdout: "ok",
		stderr: "",
	}));
	const captureWorkspacePatchMock: FakeAgentSandboxManagerController["captureWorkspacePatchMock"] = vi.fn(
		async () => "diff --git a/README.md b/README.md\n",
	);
	const disposeWorkspaceMock: FakeAgentSandboxManagerController["disposeWorkspaceMock"] = vi.fn(async () => {});
	const hasWorkspaceMock: FakeAgentSandboxManagerController["hasWorkspaceMock"] = vi.fn(() => true);
	const isWorkspacePreparedMock: FakeAgentSandboxManagerController["isWorkspacePreparedMock"] = vi.fn(
		async () => true,
	);
	const stopNowMock: FakeAgentSandboxManagerController["stopNowMock"] = vi.fn(async () => {});
	const updatePoolConfigMock: FakeAgentSandboxManagerController["updatePoolConfigMock"] = vi.fn(async () => {});
	const manager = {
		assertAvailable: assertAvailableMock,
		prepareWorkspace: prepareWorkspaceMock,
		exec: execMock,
		captureWorkspacePatch: captureWorkspacePatchMock,
		disposeWorkspace: disposeWorkspaceMock,
		hasWorkspace: hasWorkspaceMock,
		isWorkspacePrepared: isWorkspacePreparedMock,
		stopNow: stopNowMock,
		updatePoolConfig: updatePoolConfigMock,
		// §5.AR: the sandbox-MCP feature is ON by default, so task start now queries the exec target; the fake has no
		// real container/placement, so it returns null (⇒ no curated servers offered — these tests don't exercise MCP).
		getSandboxExecTarget: () => null,
		// §5.AF: the skill-fragment path queries the pool memory limit for the MCP memory-fit gate — return the default.
		getContainerMemoryLimitMb: () => 4096,
	} as unknown as AgentSandboxManager;
	return {
		manager,
		assertAvailableMock,
		prepareWorkspaceMock,
		execMock,
		captureWorkspacePatchMock,
		disposeWorkspaceMock,
		hasWorkspaceMock,
		isWorkspacePreparedMock,
		stopNowMock,
		updatePoolConfigMock,
	};
}

/**
 * Flake fix (2026-07-19, §4A): `vi.waitFor`'s DEFAULT budget is 1s, which is too tight when the full suite runs
 * 1,099 files in parallel on a downclocked (low-power) machine — it produced three independent false-reds in this
 * file while every test passed 129/129 in isolation. A longer BUDGET weakens no assertion: waitFor resolves the
 * instant the condition holds, so this only stops the suite from lying under load. Kept below vitest's 15s
 * testTimeout so a genuine hang still fails with a useful message rather than a timeout-on-timeout.
 */
function waitForSettled<T>(check: () => T | Promise<T>): Promise<T> {
	return vi.waitFor(check, { timeout: 10_000, interval: 25 });
}

async function waitForTaskSessionId(runtime: FakeNKleinSessionRuntimeController, taskId: string): Promise<string> {
	await waitForSettled(() => {
		expect(runtime.getTaskSessionId(taskId)).toBeTruthy();
	});
	return runtime.getTaskSessionId(taskId) ?? "session-1";
}

function setKanbanProcessContext(): void {
	process.argv = ["node", "/Users/example/repo/dist/cli.js"];
	process.execArgv = [];
	Object.defineProperty(process, "execPath", {
		configurable: true,
		value: "/usr/local/bin/node",
	});
}

describe("InMemoryNKleinTaskSessionService", () => {
	const services: NKleinTaskSessionService[] = [];
	// Per-test temp root so the service's diagnostic writes (task-run summaries + the Agent Attempt Ledger) never
	// touch the real ~/.nklein home. Assigned in beforeEach, removed in afterEach.
	let diagnosticStoreRoot: string;

	// All service construction in this suite goes through this wrapper so the diagnostic-store root is always injected.
	function createDiagnosticIsolatedService(
		options: CreateInMemoryNKleinTaskSessionServiceOptions,
	): NKleinTaskSessionService {
		return createInMemoryNKleinTaskSessionService({
			...options,
			diagnosticStoreRoot,
		} as CreateInMemoryNKleinTaskSessionServiceOptions);
	}

	it("instructs large-file readers to verify stitching areas without requiring overlap", () => {
		const rules = buildKanbanEfficiencyRules({
			contextScope: "smart",
			contextWindow: 80_000,
			timeoutMode: "normal",
		});

		expect(rules).toContain("Prefer non-overlapping primary chunks");
		expect(rules).toContain("explicitly inspect stitching areas around each chunk boundary");
		expect(rules).toContain("deduplicate those lines when merging, summarizing, or deriving requirements");
		expect(rules).toContain("Use `read_large_file` only when the file must be read completely");
		expect(rules).toContain("the whole file would not fit in the available context/read budget");
		expect(rules).toContain("Use reasonably large safe chunks to minimize chunk count and stitching areas");
		expect(rules).not.toContain("use overlapping chunks");
		expect(rules).not.toContain("100 KB");
	});

	beforeEach(() => {
		diagnosticStoreRoot = mkdtempSync(join(tmpdir(), "nklein-svc-diag-"));
		turnCheckpointMocks.captureTaskTurnCheckpoint.mockReset();
		turnCheckpointMocks.deleteTaskTurnCheckpointRef.mockReset();
		selfObservationMocks.recordSelfObservation.mockReset();
		taskResultBranchMocks.applyTaskPatchToResultBranch.mockReset();
		taskResultBranchMocks.resolveTaskResultBranchCommit.mockReset();
		taskResultBranchMocks.applyTaskPatchToResultBranch.mockImplementation(async (input: { taskId: string }) => ({
			taskId: input.taskId,
			branchName: `nklein/tasks/${input.taskId}`,
			refName: `refs/heads/nklein/tasks/${input.taskId}`,
			baseCommit: "base-commit",
			headCommit: "result-commit",
		}));
		taskResultBranchMocks.resolveTaskResultBranchCommit.mockResolvedValue(null);
		turnCheckpointMocks.captureTaskTurnCheckpoint.mockImplementation(
			async (input: { taskId: string; turn: number }) => ({
				turn: input.turn,
				ref: `refs/kanban/checkpoints/${input.taskId}/turn/${input.turn}`,
				commit: `commit-${input.turn}`,
				createdAt: input.turn,
			}),
		);
		turnCheckpointMocks.deleteTaskTurnCheckpointRef.mockResolvedValue(undefined);
	});

	function createTrackedService(): TaskSessionServiceHarness {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		// Keep this suite fully in-process. Earlier Node 22 GitHub runner hangs
		// came from the real SDK session runtime booting a live child process
		// before Vitest could report a single test result from this file.
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			allowUnisolatedTestRuntime: true,
		});
		services.push(service);
		return {
			service,
			runtime,
		};
	}

	afterEach(async () => {
		await Promise.allSettled(
			services.splice(0).map(async (service) => {
				await service.dispose();
			}),
		);
		rmSync(diagnosticStoreRoot, { recursive: true, force: true });
		process.argv = [...originalArgv];
		process.execArgv = [...originalExecArgv];
		Object.defineProperty(process, "execPath", {
			configurable: true,
			value: originalExecPath,
		});
	});

	it("starts a nklein session and captures initial prompt as a user message", async () => {
		const { service } = createTrackedService();

		const summary = await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});

		expect(summary.taskId).toBe("task-1");
		expect(summary.agentId).toBe("nklein");
		expect(summary.state).toBe("running");
		expect(summary.workspacePath).toBe("/tmp/worktree");
		// A work card now opens with the §5.B Planning/Refinement system-prompt message; the user prompt follows it.
		expect(
			service
				.listMessages("task-1")
				.filter((message) => message.role !== "system")
				.map((message) => message.content),
		).toEqual(["Investigate startup"]);
	});

	it("stamps the resolved launch role on the session summary (todo §5.G/§5.U)", async () => {
		const { service } = createTrackedService();

		const workerSummary = await service.startTaskSession({
			taskId: "task-worker",
			cwd: "/tmp/worktree",
			prompt: "Implement the feature",
		});
		expect(workerSummary.role).toBe("worker");

		const reviewerSummary = await service.startTaskSession({
			taskId: "task-1::review",
			cwd: "/tmp/worktree",
			prompt: "Review the change",
		});
		expect(reviewerSummary.role).toBe("reviewer");
	});

	it("records the assembled prompt-SHELL key per model in the warmth ledger (§5.AQ cache-warmth routing)", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Implement the feature",
			providerId: "lmstudio",
			modelId: "warm-model",
			baseUrl: "http://localhost:1234/v1",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		// Worker card start ⇒ a "worker" shell for this workspace, keyed by the LAUNCH model id.
		const workerEntry = service.getPromptWarmthLedger().get("warm-model");
		expect(workerEntry?.shellKey).toBe(
			buildPromptShellKey({ sessionKind: "worker", workspacePath: "/tmp/worktree", modelId: "warm-model" }),
		);
		expect(workerEntry?.at).toBeGreaterThan(0);

		// A synthetic `::review` session on the same model overwrites the entry with the review shell — the ledger
		// tracks the LAST shell each model prefilled (that is what the next start's warmth lookup compares against).
		await service.startTaskSession({
			taskId: "task-1::review",
			cwd: "/tmp/worktree",
			prompt: "Review the change",
			providerId: "lmstudio",
			modelId: "warm-model",
			baseUrl: "http://localhost:1234/v1",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(2);
		});
		expect(service.getPromptWarmthLedger().get("warm-model")?.shellKey).toBe(
			buildPromptShellKey({ sessionKind: "review", workspacePath: "/tmp/worktree", modelId: "warm-model" }),
		);
	});

	it("records model-specific shared endpoint ids for local task sessions", async () => {
		const { service } = createTrackedService();

		const summary = await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			providerId: "lmstudio",
			modelId: "qwen3.5",
			baseUrl: "http://127.0.0.1:1234/v1",
		});

		expect(summary.sharedEndpointId).toBe("http://127.0.0.1:1234/v1#qwen3.5");
	});

	it("passes the decomposition-applied callback into NKlein session runtime starts", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const onDecompositionApplied = vi.fn(async () => {});
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			allowUnisolatedTestRuntime: true,
			onDecompositionApplied,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Decompose this project.",
		});

		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});
		const startRequest = runtime.startTaskSessionMock.mock.calls[0]?.[0];
		expect(Object.keys(startRequest ?? {})).toContain("onDecompositionApplied");
		expect(startRequest?.onDecompositionApplied).toBe(onDecompositionApplied);
	});

	it("passes card likely touched files into NKlein tool approval setup", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			allowUnisolatedTestRuntime: true,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Update the CLI flag parser.",
			filesLikelyTouched: ["src/index.ts"],
		});

		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});
		expect(runtimeSetup.createToolApprovalMock).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				filesLikelyTouched: ["src/index.ts"],
			}),
		);
	});

	it("requires an agent sandbox manager unless a unit test explicitly opts into the in-process runtime", () => {
		const invalidOptions = {
			createSessionRuntime: (options: CreateInMemoryNKleinSessionRuntimeOptions) =>
				createFakeNKleinSessionRuntime().createRuntime(options),
		} as unknown as CreateInMemoryNKleinTaskSessionServiceOptions;

		expect(() => createInMemoryNKleinTaskSessionService(invalidOptions)).toThrow(
			"NKlein task sessions require an AgentSandboxManager",
		);
	});

	it("prepares a sandbox workspace before starting the SDK session", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			baseRef: "main",
			prompt: "Investigate startup",
			startInPlanMode: true,
		});

		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});
		expect(sandboxManager.assertAvailableMock).toHaveBeenCalledTimes(1);
		expect(sandboxManager.prepareWorkspaceMock).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				projectRepoPath: "/tmp/project",
				baseRef: "main",
			}),
		);
		const assertAvailableCallOrder = sandboxManager.assertAvailableMock.mock.invocationCallOrder[0];
		const prepareWorkspaceCallOrder = sandboxManager.prepareWorkspaceMock.mock.invocationCallOrder[0];
		expect(assertAvailableCallOrder).toBeDefined();
		expect(prepareWorkspaceCallOrder).toBeDefined();
		expect(assertAvailableCallOrder ?? 0).toBeLessThan(prepareWorkspaceCallOrder ?? 0);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: "/workspaces/task-1",
				// The host workspace root must be forwarded distinctly from the container cwd so the trusted
				// control-plane decomposition tools resolve board/plan artifacts to the host owning workspace.
				workspaceRoot: "/tmp/project",
				systemPrompt: expect.stringContaining("!Klein decomposition workflow rules are applied by the runtime"),
				toolExecutors: expect.objectContaining({
					bash: expect.any(Function),
					applyPatch: expect.any(Function),
				}),
				extraTools: expect.arrayContaining([
					expect.objectContaining({ name: "repo_map", execute: expect.any(Function) }),
					expect.objectContaining({ name: "search_code", execute: expect.any(Function) }),
					expect.objectContaining({ name: "list_files", execute: expect.any(Function) }),
					expect.objectContaining({ name: "read_large_file", execute: expect.any(Function) }),
					expect.objectContaining({ name: "write_files", execute: expect.any(Function) }),
				]),
			}),
		);
	});

	// §5.AC — the egress-gated `research` tool (the retrieval LOOP; single online-retrieval path) at the session
	// seams (fail-closed by default; requires egress + a configured search backend).
	async function startAndReadExtraToolNames(input: {
		taskId: string;
		retrievalEgressEnabled?: boolean;
		retrievalSearchBackendUrl?: string | null;
		agentWebResearchAllowed?: boolean;
	}): Promise<string[]> {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
			...(input.retrievalEgressEnabled !== undefined
				? { retrievalEgressEnabled: input.retrievalEgressEnabled }
				: {}),
			...(input.retrievalSearchBackendUrl !== undefined
				? { retrievalSearchBackendUrl: input.retrievalSearchBackendUrl }
				: {}),
			...(input.agentWebResearchAllowed !== undefined
				? { agentWebResearchAllowed: input.agentWebResearchAllowed }
				: {}),
		});
		services.push(service);

		await service.startTaskSession({
			taskId: input.taskId,
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			prompt: "Check whether a newer library release exists",
		});

		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});
		const startRequest = runtime.startTaskSessionMock.mock.calls[0]?.[0];
		return (startRequest?.extraTools ?? []).map((tool) => tool.name);
	}

	it("fails closed by default: sessions get no research tool (§5.AC)", async () => {
		const toolNames = await startAndReadExtraToolNames({ taskId: "task-1" });
		expect(toolNames).toContain("repo_map");
		expect(toolNames).not.toContain("research");
	});

	// The retrieval LOOP requires a configured search backend (it searches). Egress-on WITHOUT a backend attaches
	// nothing — there is no online-retrieval path without search (the manual browse_url/web_search split is retired).
	it("attaches no research tool when egress is enabled without a backend (§5.AC)", async () => {
		const toolNames = await startAndReadExtraToolNames({
			taskId: "task-1",
			retrievalEgressEnabled: true,
			retrievalSearchBackendUrl: null,
		});
		expect(toolNames).not.toContain("research");
		expect(toolNames).not.toContain("web_search");
		expect(toolNames).not.toContain("browse_url");
	});

	it("attaches the research tool alongside the sandbox tools when egress is enabled with a backend (§5.AC)", async () => {
		const toolNames = await startAndReadExtraToolNames({
			taskId: "task-1",
			retrievalEgressEnabled: true,
			retrievalSearchBackendUrl: "http://searx.lan:8080",
		});
		expect(toolNames).toContain("repo_map");
		expect(toolNames).toContain("research");
		// The manual tools are retired.
		expect(toolNames).not.toContain("web_search");
		expect(toolNames).not.toContain("browse_url");
	});

	it("withholds the research tool when the capability ruleset denies web-research, even with egress + a backend (§5.L)", async () => {
		const toolNames = await startAndReadExtraToolNames({
			taskId: "task-1",
			retrievalEgressEnabled: true,
			retrievalSearchBackendUrl: "http://searx.lan:8080",
			agentWebResearchAllowed: false,
		});
		expect(toolNames).toContain("repo_map"); // the sandbox tools still attach
		expect(toolNames).not.toContain("research"); // the per-role gate withheld it
	});

	it("never attaches the research tool to synthetic sessions even when egress is enabled (§5.AC)", async () => {
		const toolNames = await startAndReadExtraToolNames({
			taskId: "task-1::review",
			retrievalEgressEnabled: true,
			retrievalSearchBackendUrl: "http://searx.lan:8080",
		});
		expect(toolNames).toContain("repo_map");
		expect(toolNames).not.toContain("research");
	});

	it("emits a queued summary while waiting for sandbox capacity", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		let releaseSandboxSlot: (() => void) | undefined;
		sandboxManager.prepareWorkspaceMock.mockImplementationOnce(async (input) => {
			input.onQueued?.();
			await new Promise<void>((resolve) => {
				releaseSandboxSlot = resolve;
			});
			return {
				workdir: `/workspaces/${input.taskId}`,
				uid: 70_001,
			};
		});
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);
		const summaries: RuntimeTaskSessionSummary[] = [];
		service.onSummary((summary) => {
			summaries.push(summary);
		});

		const startPromise = service.startTaskSession({
			taskId: "task-queued",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			prompt: "Investigate startup",
		});

		await waitForSettled(() => {
			expect(summaries.some((summary) => summary.state === "queued")).toBe(true);
		});
		const queuedSummary = summaries.find((summary) => summary.state === "queued");
		expect(queuedSummary).toMatchObject({
			taskId: "task-queued",
			workspacePath: "/tmp/worktree",
			latestHookActivity: expect.objectContaining({
				activityText: "Queued — waiting for sandbox capacity",
				hookEventName: "sandbox_queue",
			}),
		});
		expect(runtime.startTaskSessionMock).not.toHaveBeenCalled();

		if (!releaseSandboxSlot) {
			throw new Error("Expected queued sandbox slot release callback.");
		}
		releaseSandboxSlot();
		const startSummary = await startPromise;

		expect(startSummary).toMatchObject({
			state: "running",
			workspacePath: "/workspaces/task-queued",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});
		expect(service.getSummary("task-queued")).toMatchObject({
			state: "running",
			workspacePath: "/workspaces/task-queued",
		});
	});

	it("resumes trashed sandbox tasks from the task result branch when it exists", async () => {
		taskResultBranchMocks.resolveTaskResultBranchCommit.mockResolvedValue("result-branch-commit");
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-trash",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			baseRef: "main",
			prompt: "",
			resumeFromTrash: true,
		});

		expect(taskResultBranchMocks.resolveTaskResultBranchCommit).toHaveBeenCalledWith({
			repoPath: "/tmp/project",
			taskId: "task-trash",
		});
		expect(sandboxManager.prepareWorkspaceMock).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-trash",
				projectRepoPath: "/tmp/project",
				baseRef: "result-branch-commit",
			}),
		);
	});

	it("verifies acceptance checks through the configured sandbox manager", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);

		const result = await service.verifyTaskAcceptanceInSandbox({
			taskId: "task-acceptance",
			projectRepoPath: "/tmp/project",
			baseRef: "main",
			taskPrompt: "Acceptance check: npm test",
			timeoutMs: 1234,
		});

		expect(result).toMatchObject({
			present: true,
			command: "npm test",
			passed: true,
			exitCode: 0,
			output: "ok",
		});
		expect(sandboxManager.assertAvailableMock).toHaveBeenCalledTimes(1);
		// Its OWN ::acceptance session with a bounded slot wait (run19: colliding with the worker's placement
		// destroyed the live workspace; an unbounded wait froze the review seam). No result branch exists for this
		// task, so the base ref is the fallback tree. Each acceptance run also gets a UNIQUE `-<n>` discriminator so
		// two OVERLAPPING acceptance runs on one base task never share a session (det-bounce race fix).
		const prepareCalls = sandboxManager.prepareWorkspaceMock.mock.calls as unknown as ReadonlyArray<
			[{ taskId: string }]
		>;
		const acceptanceSession = prepareCalls[0]?.[0]?.taskId ?? "";
		expect(acceptanceSession).toMatch(/^task-acceptance::acceptance-\d+$/);
		expect(sandboxManager.prepareWorkspaceMock).toHaveBeenCalledWith({
			taskId: acceptanceSession,
			projectRepoPath: "/tmp/project",
			baseRef: "main",
			maxQueueWaitMs: 120_000,
		});
		expect(sandboxManager.execMock).toHaveBeenCalledWith(acceptanceSession, ["/bin/sh", "-c", "npm test"], {
			timeoutMs: 1234,
		});
		expect(sandboxManager.disposeWorkspaceMock).toHaveBeenCalledWith(acceptanceSession);
	});

	it("disposes a sandbox workspace when SDK start fails", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		runtime.startTaskSessionMock.mockRejectedValue(new Error("start failed"));
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});

		await waitForSettled(() => {
			expect(sandboxManager.disposeWorkspaceMock).toHaveBeenCalledWith("task-1");
		});
	});

	it("captures a sandbox patch to a task result branch on review and then disposes the workspace", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);
		const messages: string[] = [];
		service.onMessage((_taskId, message) => {
			messages.push(message.content);
		});

		await service.startTaskSession({
			taskId: "task-result",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			baseRef: "main",
			prompt: "Investigate result branch",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-result");

		runtime.emitAgentEvent(sessionId, {
			type: "done",
			text: "ready for review",
			reason: "completed",
		});

		await waitForSettled(() => {
			expect(taskResultBranchMocks.applyTaskPatchToResultBranch).toHaveBeenCalledWith({
				repoPath: "/tmp/project",
				taskId: "task-result",
				baseRef: "main",
				patch: "diff --git a/README.md b/README.md\n",
			});
		});
		await waitForSettled(() => {
			expect(sandboxManager.disposeWorkspaceMock).toHaveBeenCalledWith("task-result");
		});
		expect(sandboxManager.captureWorkspacePatchMock).toHaveBeenCalledWith("task-result", { baseRef: "main" });
		expect(turnCheckpointMocks.captureTaskTurnCheckpoint).not.toHaveBeenCalled();
		expect(service.getSummary("task-result")).toMatchObject({
			state: "awaiting_review",
			workspacePath: "/tmp/project",
			latestHookActivity: expect.objectContaining({
				hookEventName: "sandbox_patch_captured",
			}),
		});
		expect(
			messages.some((message) =>
				message.includes("Captured sandbox changes to task result branch nklein/tasks/task-result"),
			),
		).toBe(true);
	});

	it("emits awaiting_review before asynchronous result capture settles", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		const capture = createDeferred<string>();
		sandboxManager.captureWorkspacePatchMock.mockReturnValueOnce(capture.promise);
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);
		const reviewSummaries: RuntimeTaskSessionSummary[] = [];
		service.onSummary((summary) => {
			if (summary.taskId === "task-delayed-capture" && summary.state === "awaiting_review") {
				reviewSummaries.push(summary);
			}
		});

		await service.startTaskSession({
			taskId: "task-delayed-capture",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			baseRef: "main",
			prompt: "Investigate result branch timing",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-delayed-capture");
		runtime.emitAgentEvent(sessionId, {
			type: "done",
			text: "ready for review",
			reason: "completed",
		});

		await waitForSettled(() => expect(sandboxManager.captureWorkspacePatchMock).toHaveBeenCalled());
		expect(service.getSummary("task-delayed-capture")).toMatchObject({ state: "awaiting_review" });
		expect(service.getSummary("task-delayed-capture")?.latestHookActivity?.hookEventName).not.toBe(
			"sandbox_patch_captured",
		);
		expect(taskResultBranchMocks.applyTaskPatchToResultBranch).not.toHaveBeenCalledWith(
			expect.objectContaining({ taskId: "task-delayed-capture" }),
		);

		capture.resolve("diff --git a/README.md b/README.md\n");
		await waitForSettled(() => {
			expect(service.getSummary("task-delayed-capture")?.latestHookActivity?.hookEventName).toBe(
				"sandbox_patch_captured",
			);
		});
		expect(reviewSummaries.length).toBeGreaterThanOrEqual(2);
		expect(reviewSummaries.at(-1)?.latestHookActivity?.hookEventName).toBe("sandbox_patch_captured");
	});

	it("keeps a captured result authoritative when post-capture disposal reports an error", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		sandboxManager.disposeWorkspaceMock.mockRejectedValueOnce(new Error("workspace cleanup failed"));
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-cleanup-error",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			baseRef: "main",
			prompt: "Investigate result cleanup",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-cleanup-error");
		runtime.emitAgentEvent(sessionId, {
			type: "done",
			text: "ready for review",
			reason: "completed",
		});

		await waitForSettled(() => {
			expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
				expect.objectContaining({
					severity: "warning",
					taskId: "task-cleanup-error",
					metadata: { category: "agent_sandbox_result_cleanup" },
				}),
			);
		});
		expect(service.getSummary("task-cleanup-error")).toMatchObject({
			state: "awaiting_review",
			latestHookActivity: expect.objectContaining({ hookEventName: "sandbox_patch_captured" }),
		});
		expect(service.getSummary("task-cleanup-error")?.warningMessage ?? "").not.toContain("cleanup failed");
	});

	it("waits for host-side result-branch assembly before service disposal completes", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		const assembly = createDeferred<Awaited<ReturnType<typeof taskResultBranchMocks.applyTaskPatchToResultBranch>>>();
		taskResultBranchMocks.applyTaskPatchToResultBranch.mockReturnValueOnce(assembly.promise);
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);
		const emittedHooks: Array<string | null> = [];
		service.onSummary((summary) => {
			if (summary.taskId === "task-shutdown-assembly") {
				emittedHooks.push(summary.latestHookActivity?.hookEventName ?? null);
			}
		});

		await service.startTaskSession({
			taskId: "task-shutdown-assembly",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			baseRef: "main",
			prompt: "Capture before shutdown",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-shutdown-assembly");
		runtime.emitAgentEvent(sessionId, { type: "done", text: "ready", reason: "completed" });
		await waitForSettled(() => {
			expect(taskResultBranchMocks.applyTaskPatchToResultBranch).toHaveBeenCalledWith(
				expect.objectContaining({ taskId: "task-shutdown-assembly" }),
			);
		});

		let disposalSettled = false;
		const disposal = service.dispose().then(() => {
			disposalSettled = true;
		});
		await new Promise((resolve) => setImmediate(resolve));
		expect(disposalSettled).toBe(false);

		assembly.resolve({
			taskId: "task-shutdown-assembly",
			branchName: "nklein/tasks/task-shutdown-assembly",
			refName: "refs/heads/nklein/tasks/task-shutdown-assembly",
			baseCommit: "base-commit",
			headCommit: "result-commit",
		});
		await disposal;
		expect(emittedHooks).toContain("sandbox_patch_captured");
		expect(sandboxManager.stopNowMock).toHaveBeenCalledTimes(1);
		services.splice(services.indexOf(service), 1);
	});

	it("drains an interrupted prior-work rebound probe before service disposal", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		const priorResult = createDeferred<string | null>();
		taskResultBranchMocks.applyTaskPatchToResultBranch.mockResolvedValueOnce(null);
		taskResultBranchMocks.resolveTaskResultBranchCommit.mockReturnValueOnce(priorResult.promise);
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);
		const emittedHooks: Array<string | null> = [];
		service.onSummary((summary) => {
			if (summary.taskId === "task-shutdown-rebound") {
				emittedHooks.push(summary.latestHookActivity?.hookEventName ?? null);
			}
		});

		await service.startTaskSession({
			taskId: "task-shutdown-rebound",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			baseRef: "main",
			prompt: "Preserve prior work",
		});
		await waitForTaskSessionId(runtime, "task-shutdown-rebound");
		await service.stopTaskSession("task-shutdown-rebound");
		await waitForSettled(() => expect(taskResultBranchMocks.resolveTaskResultBranchCommit).toHaveBeenCalled());

		let disposalSettled = false;
		const disposal = service.dispose().then(() => {
			disposalSettled = true;
		});
		await new Promise((resolve) => setImmediate(resolve));
		expect(disposalSettled).toBe(false);

		priorResult.resolve("prior-result-commit");
		await disposal;
		expect(emittedHooks).toContain("interrupted_prior_work_rebound");
		services.splice(services.indexOf(service), 1);
	});

	it("holds a fast redrive until failed capture cleanup finishes", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		const capture = createDeferred<string>();
		sandboxManager.captureWorkspacePatchMock.mockReturnValueOnce(capture.promise);
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-failed-capture-redrive",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			baseRef: "main",
			prompt: "Capture then redrive",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-failed-capture-redrive");
		runtime.emitAgentEvent(sessionId, { type: "done", text: "ready", reason: "completed" });
		await waitForSettled(() => expect(sandboxManager.captureWorkspacePatchMock).toHaveBeenCalled());

		const redrive = service.sendTaskSessionInput("task-failed-capture-redrive", "Try again");
		await new Promise((resolve) => setImmediate(resolve));
		expect(runtime.sendTaskSessionInputMock).not.toHaveBeenCalled();
		expect(service.getSummary("task-failed-capture-redrive")?.state).toBe("awaiting_review");

		capture.reject(new Error("git add failed"));
		await redrive;
		await waitForSettled(() => expect(runtime.sendTaskSessionInputMock).toHaveBeenCalled());
		expect(sandboxManager.disposeWorkspaceMock).toHaveBeenCalledWith("task-failed-capture-redrive");
		expect(service.getSummary("task-failed-capture-redrive")?.state).toBe("running");
	});

	it("releases a stale sandbox placement before restoring a reviewed task for re-drive", async () => {
		taskResultBranchMocks.resolveTaskResultBranchCommit.mockResolvedValue("result-commit");
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-stale-redrive",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			baseRef: "main",
			prompt: "Investigate result branch",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-stale-redrive");
		runtime.emitAgentEvent(sessionId, {
			type: "done",
			text: "ready for review",
			reason: "completed",
		});
		await waitForSettled(() => {
			expect(sandboxManager.disposeWorkspaceMock).toHaveBeenCalledWith("task-stale-redrive");
		});

		sandboxManager.disposeWorkspaceMock.mockClear();
		sandboxManager.prepareWorkspaceMock.mockClear();
		sandboxManager.isWorkspacePreparedMock.mockResolvedValue(false);

		await service.sendTaskSessionInput("task-stale-redrive", "Address the review feedback");

		await waitForSettled(() => {
			expect(sandboxManager.disposeWorkspaceMock).toHaveBeenCalledWith("task-stale-redrive");
			expect(sandboxManager.prepareWorkspaceMock).toHaveBeenCalledWith({
				taskId: "task-stale-redrive",
				projectRepoPath: "/tmp/project",
				baseRef: "result-commit",
				maxQueueWaitMs: 120_000,
			});
		});
		const disposeOrder = sandboxManager.disposeWorkspaceMock.mock.invocationCallOrder[0] ?? 0;
		const prepareOrder = sandboxManager.prepareWorkspaceMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
		expect(disposeOrder).toBeLessThan(prepareOrder);
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "custom",
				severity: "info",
				taskId: "task-stale-redrive",
				metadata: expect.objectContaining({
					category: "sandbox_workspace_redrive_restore",
					fromResultBranch: true,
				}),
			}),
		);
	});

	it("rebuilds sandbox tools instead of sending into an old reviewed session after workspace restoration", async () => {
		taskResultBranchMocks.resolveTaskResultBranchCommit.mockResolvedValue("result-commit");
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-redrive-rebuild",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			baseRef: "main",
			prompt: "Investigate result branch",
			providerId: "lmstudio",
			modelId: "qwen3-8b",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-redrive-rebuild");
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});
		runtime.emitAgentEvent(sessionId, {
			type: "done",
			text: "ready for review",
			reason: "completed",
		});
		await waitForSettled(() => {
			expect(sandboxManager.disposeWorkspaceMock).toHaveBeenCalledWith("task-redrive-rebuild");
		});

		runtime.startTaskSessionMock.mockClear();
		runtime.sendTaskSessionInputMock.mockClear();
		sandboxManager.disposeWorkspaceMock.mockClear();
		sandboxManager.prepareWorkspaceMock.mockClear();
		sandboxManager.isWorkspacePreparedMock.mockResolvedValue(false);

		await service.sendTaskSessionInput("task-redrive-rebuild", "Address the review feedback");

		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
				expect.objectContaining({
					taskId: "task-redrive-rebuild",
					cwd: "/workspaces/task-redrive-rebuild",
					workspaceRoot: "/tmp/project",
					toolExecutors: expect.objectContaining({
						bash: expect.any(Function),
						applyPatch: expect.any(Function),
					}),
					extraTools: expect.arrayContaining([
						expect.objectContaining({ name: "repo_map", execute: expect.any(Function) }),
						expect.objectContaining({ name: "write_files", execute: expect.any(Function) }),
					]),
				}),
			);
		});
		expect(runtime.stopTaskSessionMock).toHaveBeenCalledWith("task-redrive-rebuild");
		expect(runtime.sendTaskSessionInputMock).not.toHaveBeenCalled();
		expect(sandboxManager.prepareWorkspaceMock).toHaveBeenCalledWith({
			taskId: "task-redrive-rebuild",
			projectRepoPath: "/tmp/project",
			baseRef: "result-commit",
			maxQueueWaitMs: 120_000,
		});
	});

	it("admits a reviewed re-drive through the model-turn gate before sending to the SDK", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const gateEntered = createDeferred<void>();
		const gateRelease = createDeferred<void>();
		const gateRequests: NKleinModelTurnAdmissionRequest[] = [];
		let gateInvocation = 0;
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			modelTurnAdmissionGate: async (request, run) => {
				gateInvocation += 1;
				if (gateInvocation === 1) {
					return await run(); // The initial turn now uses admission too; this test blocks only the reviewed re-drive.
				}
				gateRequests.push(request);
				gateEntered.resolve();
				await gateRelease.promise;
				return await run();
			},
			allowUnisolatedTestRuntime: true,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-gated-redrive",
			cwd: "/tmp/worktree",
			prompt: "Investigate gated re-drive",
			providerId: "lmstudio",
			modelId: "qwen3-8b",
			baseUrl: "http://127.0.0.1:1234/v1",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-gated-redrive");
		runtime.emitAgentEvent(sessionId, {
			type: "done",
			text: "ready for review",
			reason: "completed",
		});
		await waitForSettled(() => {
			expect(service.getSummary("task-gated-redrive")?.state).toBe("awaiting_review");
		});
		runtime.sendTaskSessionInputMock.mockClear();

		const summary = await service.sendTaskSessionInput("task-gated-redrive", "Address the review feedback");
		expect(summary?.state).toBe("running");
		await gateEntered.promise;

		expect(gateRequests).toEqual([
			expect.objectContaining({
				taskId: "task-gated-redrive",
				providerId: "lmstudio",
				modelId: "qwen3-8b",
				endpoint: "http://127.0.0.1:1234/v1",
				onWaiting: expect.any(Function),
			}),
		]);
		expect(runtime.sendTaskSessionInputMock).not.toHaveBeenCalled();
		expect(
			service
				.listMessages("task-gated-redrive")
				.some((message) => message.content === "Address the review feedback"),
		).toBe(false);
		await gateRequests[0]?.onWaiting?.({
			reason:
				'LM Studio host "m4mini" is at its 1 concurrent-session cap; another !Klein task on this host must finish first.',
			retryAfterMs: null,
		});
		expect(service.getSummary("task-gated-redrive")?.latestHookActivity).toMatchObject({
			activityText:
				'Waiting for model capacity — LM Studio host "m4mini" is at its 1 concurrent-session cap; another !Klein task on this host must finish first.',
			hookEventName: "model_turn_admission_wait",
			source: "nklein",
		});

		gateRelease.resolve();
		await waitForSettled(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith(
				"task-gated-redrive",
				"resolved:Address the review feedback",
				"act",
				undefined,
			);
		});
		expect(
			service
				.listMessages("task-gated-redrive")
				.some((message) => message.content === "Address the review feedback"),
		).toBe(true);
	});

	it("serializes initial turns through model admission while a decomposition seed is still unwinding", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const seedTurn = createDeferred<StartNKleinSessionRuntimeResult>();
		const gateRequests: NKleinModelTurnAdmissionRequest[] = [];
		let gateTail = Promise.resolve();
		runtime.startTaskSessionMock.mockImplementation(async (request) => {
			if (request.taskId === "decompose-seed") {
				return await seedTurn.promise;
			}
			return { sessionId: request.sessionId, result: {} };
		});
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			modelTurnAdmissionGate: async (request, run) => {
				gateRequests.push(request);
				const previous = gateTail;
				let releaseCurrent: () => void = () => {};
				const current = new Promise<void>((resolve) => {
					releaseCurrent = resolve;
				});
				gateTail = previous.catch(() => undefined).then(() => current);
				await previous.catch(() => undefined);
				try {
					return await run();
				} finally {
					releaseCurrent();
				}
			},
			allowUnisolatedTestRuntime: true,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "decompose-seed",
			cwd: "/tmp/worktree",
			prompt: "Decompose the project",
			providerId: "lmstudio",
			modelId: "qwen3-8b",
			baseUrl: "http://127.0.0.1:1234/v1",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		// This is the forced queued-drain shape: the decomposition callback has made the seed look terminal, but its
		// initial SDK turn has not returned yet. The child may prepare, but it must not re-enter the SDK/model runtime.
		await service.startTaskSession({
			taskId: "queued-child",
			cwd: "/tmp/worktree",
			prompt: "Implement the first leaf",
			providerId: "lmstudio",
			modelId: "qwen3-8b",
			baseUrl: "http://127.0.0.1:1234/v1",
		});
		await waitForSettled(() => {
			expect(gateRequests.map((request) => request.taskId)).toEqual(["decompose-seed", "queued-child"]);
		});
		expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);

		seedTurn.resolve({ sessionId: createSessionId("decompose-seed"), result: {} });
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(2);
		});
		expect(runtime.startTaskSessionMock.mock.calls[1]?.[0].taskId).toBe("queued-child");
	});

	it("does not dispatch a re-drive turn when stale sandbox restoration fails", async () => {
		taskResultBranchMocks.resolveTaskResultBranchCommit.mockResolvedValue("result-commit");
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-stale-restore-fail",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			baseRef: "main",
			prompt: "Investigate result branch",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-stale-restore-fail");
		runtime.emitAgentEvent(sessionId, {
			type: "done",
			text: "ready for review",
			reason: "completed",
		});
		await waitForSettled(() => {
			expect(sandboxManager.disposeWorkspaceMock).toHaveBeenCalledWith("task-stale-restore-fail");
		});

		sandboxManager.disposeWorkspaceMock.mockClear();
		sandboxManager.prepareWorkspaceMock.mockReset();
		sandboxManager.prepareWorkspaceMock.mockRejectedValueOnce(new Error("docker unavailable"));
		sandboxManager.isWorkspacePreparedMock.mockResolvedValue(false);
		runtime.sendTaskSessionInputMock.mockClear();

		await service.sendTaskSessionInput("task-stale-restore-fail", "Address the review feedback");

		await waitForSettled(() => {
			expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
				expect.objectContaining({
					signal: "runtime_error",
					severity: "warning",
					taskId: "task-stale-restore-fail",
					message: expect.stringContaining("Could not restore the sandbox workspace"),
				}),
			);
		});
		expect(sandboxManager.disposeWorkspaceMock).toHaveBeenCalledWith("task-stale-restore-fail");
		expect(sandboxManager.prepareWorkspaceMock).toHaveBeenCalledWith({
			taskId: "task-stale-restore-fail",
			projectRepoPath: "/tmp/project",
			baseRef: "result-commit",
			maxQueueWaitMs: 120_000,
		});
		expect(runtime.sendTaskSessionInputMock).not.toHaveBeenCalled();
	});

	it("surfaces sandbox patch capture failure when the workspace was disposed concurrently", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		sandboxManager.captureWorkspacePatchMock.mockRejectedValueOnce(
			new Error("No Docker sandbox workspace is prepared for task task-race."),
		);
		sandboxManager.hasWorkspaceMock.mockReturnValue(false);
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-race",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			baseRef: "main",
			prompt: "Investigate result branch",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-race");

		runtime.emitAgentEvent(sessionId, {
			type: "done",
			text: "ready for review",
			reason: "completed",
		});

		await waitForSettled(() => {
			expect(sandboxManager.captureWorkspacePatchMock).toHaveBeenCalledWith("task-race", { baseRef: "main" });
		});
		await waitForSettled(() => {
			expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
				expect.objectContaining({
					signal: "runtime_error",
					severity: "error",
					taskId: "task-race",
					metadata: expect.objectContaining({
						category: "agent_sandbox_result_patch",
						reason: "workspace_disposed_before_capture",
					}),
				}),
			);
		});
		expect(taskResultBranchMocks.applyTaskPatchToResultBranch).not.toHaveBeenCalledWith(
			expect.objectContaining({ taskId: "task-race" }),
		);
		const summary = service.getSummary("task-race");
		expect(summary?.state).toBe("failed");
		expect(summary).toMatchObject({
			warningMessage: expect.stringContaining("workspace_disposed_before_capture"),
			latestHookActivity: expect.objectContaining({ hookEventName: "sandbox_patch_capture_failed" }),
		});
	});

	it("surfaces sandbox patch capture failure when the workspace path disappeared", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		sandboxManager.captureWorkspacePatchMock.mockRejectedValueOnce(
			new AgentSandboxExecutionError("Could not stage sandbox workspace changes.", {
				exitCode: 1,
				stdout: "",
				stderr:
					'OCI runtime exec failed: exec failed: unable to start container process: chdir to cwd ("/workspaces/task-missing") failed: no such file or directory',
			}),
		);
		sandboxManager.hasWorkspaceMock.mockReturnValue(true);
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-missing",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			baseRef: "main",
			prompt: "Investigate result branch",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-missing");

		runtime.emitAgentEvent(sessionId, {
			type: "done",
			text: "ready for review",
			reason: "completed",
		});

		await waitForSettled(() => {
			expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
				expect.objectContaining({
					signal: "runtime_error",
					severity: "error",
					taskId: "task-missing",
					metadata: expect.objectContaining({
						category: "agent_sandbox_result_patch",
						reason: "workspace_missing_before_capture",
					}),
				}),
			);
		});
		expect(sandboxManager.disposeWorkspaceMock).toHaveBeenCalledWith("task-missing");
		expect(taskResultBranchMocks.applyTaskPatchToResultBranch).not.toHaveBeenCalledWith(
			expect.objectContaining({ taskId: "task-missing" }),
		);
		const summary = service.getSummary("task-missing");
		expect(summary?.state).toBe("failed");
		expect(summary).toMatchObject({
			warningMessage: expect.stringContaining("workspace_missing_before_capture"),
			latestHookActivity: expect.objectContaining({ hookEventName: "sandbox_patch_capture_failed" }),
		});
	});

	it("surfaces sandbox patch staging without a git workspace as a capture failure", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		sandboxManager.captureWorkspacePatchMock.mockRejectedValueOnce(
			new AgentSandboxExecutionError("Could not stage sandbox workspace changes.", {
				exitCode: 128,
				stdout: "",
				stderr:
					"fatal: not a git repository (or any parent up to mount point /)\nStopping at filesystem boundary (GIT_DISCOVERY_ACROSS_FILESYSTEM not set).",
			}),
		);
		sandboxManager.hasWorkspaceMock.mockReturnValue(true);
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-not-git",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			baseRef: "main",
			prompt: "Investigate result branch",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-not-git");

		runtime.emitAgentEvent(sessionId, {
			type: "done",
			text: "ready for review",
			reason: "completed",
		});

		await waitForSettled(() => {
			expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
				expect.objectContaining({
					signal: "runtime_error",
					severity: "error",
					taskId: "task-not-git",
					metadata: expect.objectContaining({
						category: "agent_sandbox_result_patch",
						reason: "workspace_missing_before_capture",
					}),
				}),
			);
		});
		expect(sandboxManager.disposeWorkspaceMock).toHaveBeenCalledWith("task-not-git");
		expect(taskResultBranchMocks.applyTaskPatchToResultBranch).not.toHaveBeenCalledWith(
			expect.objectContaining({ taskId: "task-not-git" }),
		);
		expect(service.getSummary("task-not-git")).toMatchObject({
			state: "failed",
			warningMessage: expect.stringContaining("workspace_missing_before_capture"),
			latestHookActivity: expect.objectContaining({ hookEventName: "sandbox_patch_capture_failed" }),
		});
	});

	it("keeps sandbox patch capture failures visible while the workspace still exists", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		sandboxManager.captureWorkspacePatchMock.mockRejectedValueOnce(new Error("git add failed"));
		sandboxManager.hasWorkspaceMock.mockReturnValue(true);
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-capture-error",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			baseRef: "main",
			prompt: "Investigate result branch",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-capture-error");

		runtime.emitAgentEvent(sessionId, {
			type: "done",
			text: "ready for review",
			reason: "completed",
		});

		await waitForSettled(() => {
			expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
				expect.objectContaining({
					signal: "runtime_error",
					severity: "error",
					taskId: "task-capture-error",
					message: "Could not capture sandbox task result patch: git add failed",
					metadata: expect.objectContaining({
						category: "agent_sandbox_result_patch",
					}),
				}),
			);
		});
		expect(service.getSummary("task-capture-error")).toMatchObject({
			state: "failed",
			warningMessage: "Could not capture sandbox task result patch: git add failed",
			latestHookActivity: expect.objectContaining({
				hookEventName: "sandbox_patch_capture_failed",
			}),
		});
		expect(sandboxManager.disposeWorkspaceMock).toHaveBeenCalledWith("task-capture-error");
	});

	it("releases sandbox workspaces on stop, clear, and service disposal", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-stop",
			cwd: "/tmp/worktree",
			prompt: "Investigate stop",
		});
		await waitForTaskSessionId(runtime, "task-stop");
		await service.stopTaskSession("task-stop");

		await service.startTaskSession({
			taskId: "task-clear",
			cwd: "/tmp/worktree",
			prompt: "Investigate clear",
		});
		await waitForTaskSessionId(runtime, "task-clear");
		await service.clearTaskSession("task-clear");

		await service.dispose();

		expect(sandboxManager.disposeWorkspaceMock).toHaveBeenCalledWith("task-stop");
		expect(sandboxManager.disposeWorkspaceMock).toHaveBeenCalledWith("task-clear");
		expect(sandboxManager.stopNowMock).toHaveBeenCalledTimes(1);
	});

	it("aborts a stalled stream and surfaces the configured timeout", async () => {
		vi.useFakeTimers();
		try {
			const { service, runtime } = createTrackedService();
			await service.startTaskSession({
				taskId: "task-1",
				cwd: "/tmp/worktree",
				prompt: "Investigate startup",
				streamTimeoutMs: 1_000,
			});
			await waitForTaskSessionId(runtime, "task-1");

			await vi.advanceTimersByTimeAsync(1_001);

			expect(runtime.abortTaskSessionMock).toHaveBeenCalledWith("task-1");
			expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
			expect(service.getSummary("task-1")?.warningMessage).toContain(
				"!Klein stream inactivity timeout after 1 seconds",
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it("clears the conversation timeout when a turn completes", async () => {
		vi.useFakeTimers();
		try {
			const { service, runtime } = createTrackedService();
			await service.startTaskSession({
				taskId: "task-1",
				cwd: "/tmp/worktree",
				prompt: "Investigate startup",
				conversationTimeoutMs: 1_000,
			});
			const sessionId = await waitForTaskSessionId(runtime, "task-1");

			runtime.emitAgentEvent(sessionId ?? "session-1", {
				type: "done",
				reason: "completed",
				text: "Done.",
			});
			await vi.advanceTimersByTimeAsync(1_001);

			expect(runtime.abortTaskSessionMock).not.toHaveBeenCalled();
			expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not extend a tool timeout for unrelated stream events", async () => {
		vi.useFakeTimers();
		try {
			const { service, runtime } = createTrackedService();
			await service.startTaskSession({
				taskId: "task-1",
				cwd: "/tmp/worktree",
				prompt: "Investigate startup",
				toolTimeoutMs: 1_000,
			});
			const sessionId = await waitForTaskSessionId(runtime, "task-1");

			runtime.emitAgentEvent(sessionId ?? "session-1", {
				type: "content_start",
				contentType: "tool",
				toolCallId: "tool-1",
				toolName: "read_file",
				input: { path: "README.md" },
			});
			await vi.advanceTimersByTimeAsync(500);
			runtime.emitChunk(sessionId ?? "session-1", "still working");
			await vi.advanceTimersByTimeAsync(501);

			expect(runtime.abortTaskSessionMock).toHaveBeenCalledWith("task-1");
			expect(service.getSummary("task-1")?.warningMessage).toContain(
				"!Klein tool execution timeout after 1 seconds",
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it("disposes cached runtime setups when the service shuts down", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const createRuntimeSetupMock = vi.fn(async (_workspacePath: string) => runtimeSetup.setup);
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: createRuntimeSetupMock,
			allowUnisolatedTestRuntime: true,
		});
		services.push(service);

		await service.listSlashCommands("/tmp/worktree");
		await service.dispose();

		expect(createRuntimeSetupMock).toHaveBeenCalledWith("/tmp/worktree");
		expect(runtimeSetup.disposeMock).toHaveBeenCalledTimes(1);
	});

	it("includes built-in clear slash command when listing commands", async () => {
		const { service } = createTrackedService();

		const commands = await service.listSlashCommands("/tmp/worktree");

		expect(commands).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "clear",
				}),
			]),
		);
	});

	it("reuses one runtime setup per workspace across services when sharing a watcher registry", async () => {
		const runtimeA = createFakeNKleinSessionRuntime();
		const runtimeB = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const createRuntimeSetupMock = vi.fn(async (_workspacePath: string) => runtimeSetup.setup);
		const watcherRegistry = createNKleinWatcherRegistry({
			createRuntimeSetup: createRuntimeSetupMock,
		});
		const serviceA = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtimeA.createRuntime(options),
			watcherRegistry,
			allowUnisolatedTestRuntime: true,
		});
		const serviceB = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtimeB.createRuntime(options),
			watcherRegistry,
			allowUnisolatedTestRuntime: true,
		});
		services.push(serviceA, serviceB);

		await serviceA.listSlashCommands("/tmp/worktree");
		await serviceB.listSlashCommands("/tmp/worktree");

		expect(createRuntimeSetupMock).toHaveBeenCalledTimes(1);

		await serviceA.dispose();
		expect(runtimeSetup.disposeMock).toHaveBeenCalledTimes(0);

		await serviceB.dispose();
		expect(runtimeSetup.disposeMock).toHaveBeenCalledTimes(1);
	});

	it("rebuilds a restarted task's runtime setup from the HOST root, never the sandbox cwd (§5.U / §5.A invariant #2)", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const createRuntimeSetupPaths: string[] = [];
		const watcherRegistry = createNKleinWatcherRegistry({
			createRuntimeSetup: async (workspacePath: string) => {
				createRuntimeSetupPaths.push(workspacePath);
				return runtimeSetup.setup;
			},
		});
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			watcherRegistry,
			allowUnisolatedTestRuntime: true,
		});
		services.push(service);

		// Start + complete a task so the service holds a settled (awaiting_review) entry with a cached launch
		// config. The cached config carries the HOST workspace root ("/host/project-root"); the first start's
		// cwd ("/host/initial") is deliberately a third, distinct path so the rebuild's host-root runtime setup
		// is a cache miss we can observe.
		await service.startTaskSession({
			taskId: "task-rebuild",
			cwd: "/host/initial",
			workspaceRoot: "/host/project-root",
			providerId: "lmstudio",
			modelId: "qwen3-8b",
			prompt: "Do the work",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-rebuild");
		runtime.emitAgentEvent(sessionId, { type: "done", reason: "completed", text: "done" });
		await waitForSettled(() => {
			expect(service.getSummary("task-rebuild")?.state).toBe("awaiting_review");
		});

		// Simulate a runtime process restart: the in-memory session + cached launch maps are gone, but the SDK
		// host still has the persisted record. Its `cwd` is the agent-perceived sandbox workdir, while the host
		// workspace root lives in the kanban launch-config metadata.
		runtime.simulateProcessRestart();
		createRuntimeSetupPaths.length = 0;
		runtime.startTaskSessionMock.mockClear();
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-rebuild-persisted",
				source: "core" as NKleinPersistedTaskSessionSnapshot["record"]["source"],
				status: "completed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "lmstudio",
				model: "qwen3-8b",
				cwd: "/workspaces/task-rebuild",
				workspaceRoot: "/host/project-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
				metadata: {
					kanban: {
						launchConfig: {
							providerId: "lmstudio",
							modelId: "qwen3-8b",
							workspaceRoot: "/host/project-root",
						},
					},
				},
			},
			messages: [],
		});

		// Sending input now rebuilds from the persisted launch config (no live session, no cached launch).
		await service.sendTaskSessionInput("task-rebuild", "Continue the work");

		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
				expect.objectContaining({
					taskId: "task-rebuild",
					// The agent still perceives the sandbox workdir as its cwd…
					cwd: "/workspaces/task-rebuild",
					// …but the host workspace root is threaded for the trusted control plane.
					workspaceRoot: "/host/project-root",
				}),
			);
		});
		// The runtime setup (rules / tool policy / system prompt, keyed on the workspace path) must resolve
		// against the HOST root, never the sandbox workdir — which does not exist on the host, so feeding it
		// here previously made a restarted isolated task silently load no rules/setup.
		expect(createRuntimeSetupPaths).toContain("/host/project-root");
		expect(createRuntimeSetupPaths).not.toContain("/workspaces/task-rebuild");
	});

	it("re-preps the Docker sandbox + passes sandbox tools when rebuilding a restarted isolated task (§5.A invariant #2)", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);

		// Start + complete an isolated task (the first start preps a sandbox).
		await service.startTaskSession({
			taskId: "task-iso-rebuild",
			cwd: "/host/project-root",
			workspaceRoot: "/host/project-root",
			providerId: "lmstudio",
			modelId: "qwen3-8b",
			prompt: "Do the work",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-iso-rebuild");
		runtime.emitAgentEvent(sessionId, { type: "done", reason: "completed", text: "done" });
		await waitForSettled(() => {
			expect(service.getSummary("task-iso-rebuild")?.state).toBe("awaiting_review");
		});

		// Simulate a process restart (in-memory session + launch maps gone), then resume.
		runtime.simulateProcessRestart();
		sandboxManager.prepareWorkspaceMock.mockClear();
		runtime.startTaskSessionMock.mockClear();
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-iso-rebuild-persisted",
				source: "core" as NKleinPersistedTaskSessionSnapshot["record"]["source"],
				status: "completed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "lmstudio",
				model: "qwen3-8b",
				cwd: "/workspaces/task-iso-rebuild",
				workspaceRoot: "/host/project-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
				metadata: {
					kanban: {
						launchConfig: { providerId: "lmstudio", modelId: "qwen3-8b", workspaceRoot: "/host/project-root" },
					},
				},
			},
			messages: [],
		});

		await service.sendTaskSessionInput("task-iso-rebuild", "Continue the work");

		// The rebuild must re-prep the sandbox for the task against the HOST repo path…
		await waitForSettled(() => {
			expect(sandboxManager.prepareWorkspaceMock).toHaveBeenCalledWith(
				expect.objectContaining({ taskId: "task-iso-rebuild", projectRepoPath: "/host/project-root" }),
			);
		});
		// …and start the session with the in-container sandbox workdir + sandbox-proxied tools, never host file
		// tools on a non-existent sandbox cwd (the invariant-#2 bug this locks).
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
				expect.objectContaining({
					taskId: "task-iso-rebuild",
					cwd: "/workspaces/task-iso-rebuild",
					workspaceRoot: "/host/project-root",
					extraTools: expect.anything(),
					toolExecutors: expect.anything(),
				}),
			);
		});
	});

	it("clears a task session, removes history, and allows a fresh turn", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});
		await waitForTaskSessionId(runtime, "task-1");

		const clearedSummary = await service.clearTaskSession("task-1");

		expect(runtime.clearTaskSessionsMock).toHaveBeenCalledWith("task-1");
		expect(clearedSummary?.state).toBe("idle");
		expect(clearedSummary?.workspacePath).toBe("/tmp/worktree");
		expect(service.listMessages("task-1")).toEqual([]);

		const nextSummary = await service.sendTaskSessionInput("task-1", "Fresh start");
		expect(nextSummary?.state).toBe("running");
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(2);
		});
		expect(runtime.startTaskSessionMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				prompt: "resolved:Fresh start",
			}),
		);
	});

	it("clears hydrated persisted history even when no live task entry exists", async () => {
		const { service, runtime } = createTrackedService();
		runtime.readPersistedTaskSessionMock
			.mockResolvedValueOnce({
				record: {
					sessionId: "task-1-persisted",
					source: "core" as NKleinPersistedTaskSessionSnapshot["record"]["source"],
					status: "completed",
					startedAt: "2026-03-17T10:00:00.000Z",
					updatedAt: "2026-03-17T10:05:00.000Z",
					interactive: true,
					provider: "anthropic",
					model: "claude-sonnet-4-6",
					cwd: "/tmp/worktree",
					workspaceRoot: "/tmp/workspace-root",
					enableTools: true,
					enableSpawn: false,
					enableTeams: false,
					isSubagent: false,
				},
				messages: [
					{
						role: "user",
						content: "Recovered prompt",
					},
					{
						role: "assistant",
						content: "Recovered answer",
					},
				],
			})
			.mockResolvedValue(null);

		expect((await service.loadTaskSessionMessages("task-1")).map((message) => message.content)).toEqual([
			"Recovered prompt",
			"Recovered answer",
		]);

		const clearedSummary = await service.clearTaskSession("task-1");

		expect(clearedSummary).toBeNull();
		expect(runtime.clearTaskSessionsMock).toHaveBeenCalledWith("task-1");
		expect(await service.loadTaskSessionMessages("task-1")).toEqual([]);
		expect(runtime.readPersistedTaskSessionMock).toHaveBeenCalledTimes(2);
	});

	it("keeps resume-from-trash sessions awaiting review until the user sends a message", async () => {
		const { service } = createTrackedService();

		const summary = await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
			resumeFromTrash: true,
		});

		expect(summary.state).toBe("awaiting_review");
		expect(summary.reviewReason).toBe("attention");
		expect(service.listMessages("task-1")).toEqual([]);
	});

	it("starts empty-prompt sessions idle until the user sends a message", async () => {
		const { service } = createTrackedService();

		const summary = await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		expect(summary.state).toBe("idle");
		expect(summary.reviewReason).toBeNull();
		expect(service.listMessages("task-1")).toEqual([]);
	});

	it("hydrates persisted chat history when resuming a task from trash", async () => {
		const { service, runtime } = createTrackedService();
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-1-persisted",
				source: "core" as NKleinPersistedTaskSessionSnapshot["record"]["source"],
				status: "completed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				cwd: "/tmp/worktree",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
			},
			messages: [
				{
					role: "user",
					content: "Recovered prompt",
				},
				{
					role: "assistant",
					content: "Recovered answer",
				},
			],
		});

		const summary = await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
			resumeFromTrash: true,
		});

		expect(summary.state).toBe("awaiting_review");
		expect(summary.reviewReason).toBe("attention");
		expect(service.listMessages("task-1").map((message) => message.content)).toEqual([
			"Recovered prompt",
			"Recovered answer",
		]);
		expect((await service.loadTaskSessionMessages("task-1")).map((message) => message.content)).toEqual([
			"Recovered prompt",
			"Recovered answer",
		]);
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: "resolved:",
					initialMessages: [
						{
							role: "user",
							content: "Recovered prompt",
						},
						{
							role: "assistant",
							content: "Recovered answer",
						},
					],
				}),
			);
		});
	});

	it("reinitializes chat history from persisted data when resuming a trashed task", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Original prompt",
		});
		const firstSessionId = await waitForTaskSessionId(runtime, "task-1");
		runtime.emitAgentEvent(firstSessionId, {
			type: "done",
			reason: "completed",
			text: "Original answer",
		});

		await waitForSettled(() => {
			expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		});
		expect(
			service
				.listMessages("task-1")
				.filter((message) => message.role !== "system")
				.map((message) => message.content),
		).toEqual(["Original prompt", "Original answer"]);

		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-1-persisted",
				source: "core" as NKleinPersistedTaskSessionSnapshot["record"]["source"],
				status: "completed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				cwd: "/tmp/worktree",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
			},
			messages: [
				{
					role: "user",
					content: "Recovered prompt",
				},
				{
					role: "assistant",
					content: "Recovered answer",
				},
			],
		});

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
			resumeFromTrash: true,
		});

		expect(service.listMessages("task-1").map((message) => message.content)).toEqual([
			"Recovered prompt",
			"Recovered answer",
		]);
	});

	it("does not default to the paid NKlein provider when provider is not explicitly configured", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "unconfigured",
				modelId: "unconfigured",
				systemPrompt: expect.stringContaining("You are NKlein, an AI coding agent."),
			}),
		);
	});

	it("injects prior failed attempt retry notes into the next task start prompt", async () => {
		await appendAgentLedgerEvent(
			buildAttemptEvent({
				workflowId: "task-1",
				taskId: "task-1",
				workspacePathHash: "workspace",
				role: "worker",
				attemptId: "task-1:a1",
				modelId: "lmstudio:qwen3-8b:local",
				outcome: "no_tool_call",
				simplificationLevel: 1,
				recordedAt: 1,
			}),
			{ rootDir: diagnosticStoreRoot },
		);
		await appendAgentLedgerEvent(
			buildAttemptEvent({
				workflowId: "other-task",
				taskId: "other-task",
				workspacePathHash: "workspace",
				role: "worker",
				attemptId: "other:a1",
				modelId: "lmstudio:qwen3-8b:local",
				outcome: "loop",
				recordedAt: 2,
			}),
			{ rootDir: diagnosticStoreRoot },
		);

		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});
		await waitForSettled(() => expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1));

		const startRequest = runtime.startTaskSessionMock.mock.calls[0]?.[0];
		expect(startRequest?.systemPrompt).toContain("Already attempted this task");
		expect(startRequest?.systemPrompt).toContain("do NOT repeat");
		expect(startRequest?.systemPrompt).toContain("reduced_tool_set");
		expect(startRequest?.systemPrompt).toContain("no_tool_call");
		expect(startRequest?.systemPrompt).not.toContain("loop");
	});

	it("forwards task images into the NKlein runtime start request", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			images: [
				{
					id: "img-1",
					data: "abc123",
					mimeType: "image/png",
				},
			],
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				images: [
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
			}),
		);
	});

	it("forwards attached images when sending follow-up chat input", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		await service.sendTaskSessionInput("task-1", "Continue", undefined, [
			{
				id: "img-1",
				data: "abc123",
				mimeType: "image/png",
			},
		]);

		await waitForSettled(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith(
				"task-1",
				"resolved:Continue",
				"act",
				[
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
				"queue",
			);
		});
	});

	it("queues follow-up chat input while the agent is still running", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		const nextSummary = await service.sendTaskSessionInput("task-1", "One more thing");

		expect(nextSummary?.state).toBe("running");
		await waitForSettled(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith(
				"task-1",
				"resolved:One more thing",
				"act",
				undefined,
				"queue",
			);
		});
		expect(service.listMessages("task-1").some((message) => message.content.includes("NKlein SDK send failed"))).toBe(
			false,
		);
	});

	it("resolves sandboxed follow-up input against the host project path", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const sandboxManager = createFakeAgentSandboxManager();
		const createRuntimeSetupMock = vi.fn(async (_workspacePath: string) => runtimeSetup.setup);
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: createRuntimeSetupMock,
			agentSandboxManager: sandboxManager.manager,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			workspaceRoot: "/tmp/project",
			baseRef: "main",
			prompt: "Investigate startup",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});
		expect(service.getSummary("task-1")?.workspacePath).toBe("/workspaces/task-1");
		createRuntimeSetupMock.mockClear();

		await service.sendTaskSessionInput("task-1", "One more thing");

		await waitForSettled(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith(
				"task-1",
				"resolved:One more thing",
				"act",
				undefined,
				"queue",
			);
		});
		expect(createRuntimeSetupMock).toHaveBeenCalledWith("/tmp/project");
		expect(createRuntimeSetupMock).not.toHaveBeenCalledWith("/workspaces/task-1");
		expect(service.listMessages("task-1").some((message) => message.content.includes("NKlein SDK send failed"))).toBe(
			false,
		);
	});

	it("reuses the current task mode when follow-up input does not provide a mode override", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			mode: "plan",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		await service.sendTaskSessionInput("task-1", "Continue");
		await waitForSettled(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith(
				"task-1",
				"resolved:Continue",
				"plan",
				undefined,
				"queue",
			);
		});
		expect(service.getSummary("task-1")?.mode).toBe("plan");
	});

	it("adds !Klein-managed planning guidance as system prompt when plan mode starts", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			startInPlanMode: true,
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "act",
				prompt: "resolved:Investigate startup",
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("!Klein decomposition workflow rules are applied by the runtime"),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("Do not call workflow names or slash commands as tools"),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("call the `decompose_project` tool directly"),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("Continue autonomously through the planning workflow"),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.not.stringContaining("ask for approval before making changes"),
			}),
		);
		expect(
			service.listMessages("task-1").find((message) => message.meta?.messageKind === "system_prompt"),
		).toMatchObject({
			role: "system",
			content: expect.stringContaining("!Klein decomposition workflow rules are applied by the runtime"),
		});
		expect(
			service.listMessages("task-1").find((message) => message.meta?.messageKind === "system_prompt")?.content,
		).not.toContain("/kanban-decompose");
		expect(service.listMessages("task-1").find((message) => message.role === "user")).toMatchObject({
			content: "Investigate startup",
		});
		expect(service.getSummary("task-1")?.mode).toBe("act");
	});

	it("uses tool-first instructions for explicit decomposition planning tasks", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt:
				"Read specification.md, call decompose_project with minimumTaskCount: 10, and apply the generated graph.",
			startInPlanMode: true,
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "act",
				prompt:
					"resolved:Read specification.md, call decompose_project with minimumTaskCount: 10, and apply the generated graph.",
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("then call the `decompose_project` tool"),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("When calling decompose_project, pass `minimumTaskCount: 10`."),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("Do not answer with a chat-only markdown plan"),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("Keep your thinking and any prose brief"),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("Reasoning or thinking alone is not an answer"),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("Keep every response short and to the point"),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("put the summary, assumptions, plan, and task graph"),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("continue directly to `decompose_project`"),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.not.stringContaining("produce a clear implementation plan only"),
			}),
		);
		expect(
			service.listMessages("task-1").find((message) => message.meta?.messageKind === "system_prompt")?.content,
		).not.toContain("/kanban-decompose");
	});

	it("uses tool-first decomposition guidance for implementation-card graph prompts", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt:
				"Create a deeply decomposed, dependency-linked implementation-card graph for the modern cross-platform DAW foundation release described in specification.md.",
			startInPlanMode: true,
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("then call the `decompose_project` tool"),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("Do not answer with a chat-only markdown plan"),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.not.stringContaining("produce a clear implementation plan only"),
			}),
		);
		expect(
			service.listMessages("task-1").find((message) => message.meta?.messageKind === "system_prompt")?.content,
		).not.toContain("/kanban-decompose");
	});

	it("interrupts chat-only decomposition reports and restarts with a tool-call correction", async () => {
		vi.useFakeTimers();
		try {
			const { service, runtime } = createTrackedService();

			await service.startTaskSession({
				taskId: "task-1",
				cwd: "/tmp/worktree",
				prompt:
					"Read specification.md, call decompose_project with minimumTaskCount: 10, and apply the generated graph.",
				startInPlanMode: true,
			});
			await waitForSettled(() => {
				expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
			});

			const sessionId = await waitForTaskSessionId(runtime, "task-1");
			runtime.emitAgentEvent(sessionId, {
				type: "assistant-text-delta",
				accumulatedText:
					"Perfect! Now I have a complete understanding of the requirements. Let me decompose this project using the !Klein decomposition tool with the specified structure.",
			});

			await vi.advanceTimersByTimeAsync(25_000);
			await waitForSettled(() => {
				expect(runtime.abortTaskSessionMock).toHaveBeenCalledWith("task-1");
				expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(2);
			});

			expect(runtime.startTaskSessionMock).toHaveBeenLastCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining("must be the `decompose_project` tool call itself"),
				}),
			);
			expect(runtime.startTaskSessionMock).toHaveBeenLastCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining("Do not continue that prose"),
				}),
			);
			expect(service.getSummary("task-1")?.state).toBe("running");
		} finally {
			vi.useRealTimers();
		}
	});

	it("restarts an idle session to apply a mode change and rejects changing an active turn", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		await expect(service.sendTaskSessionInput("task-1", "Switch while running", "plan")).rejects.toThrow(
			"Finish or cancel the active !Klein turn",
		);
		expect(service.listMessages("task-1").some((message) => message.content === "Switch while running")).toBe(false);

		const sessionId = await waitForTaskSessionId(runtime, "task-1");
		runtime.emitAgentEvent(sessionId, {
			type: "done",
			reason: "completed",
		});
		await waitForSettled(() => {
			expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		});

		await service.sendTaskSessionInput("task-1", "Switch mode", "plan");
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(2);
		});
		await service.sendTaskSessionInput("task-1", "Keep going");

		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenLastCalledWith(
				expect.objectContaining({
					prompt: "resolved:Switch mode",
					mode: "plan",
				}),
			);
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith(
				"task-1",
				"resolved:Keep going",
				"plan",
				undefined,
				"queue",
			);
		});
		expect(service.getSummary("task-1")?.mode).toBe("plan");
	});

	it("allows image-only follow-up chat input", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		await service.sendTaskSessionInput("task-1", "   ", undefined, [
			{
				id: "img-1",
				data: "abc123",
				mimeType: "image/png",
			},
		]);

		await waitForSettled(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith(
				"task-1",
				"resolved:",
				"act",
				[
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
				"queue",
			);
		});
	});

	it("surfaces startup warnings from the runtime on the session summary", async () => {
		const { service, runtime } = createTrackedService();
		runtime.startTaskSessionMock.mockResolvedValueOnce({
			sessionId: "task-1-runtime",
			result: {},
			warnings: ['Failed to load MCP server "linear": MCP server "linear" requires OAuth authorization.'],
		});

		const summary = await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});

		await waitForSettled(() => {
			expect(service.getSummary("task-1")?.warningMessage).toContain('Failed to load MCP server "linear"');
		});

		expect(summary.warningMessage).toBeNull();
	});

	it("appends !Klein sidebar instructions for home sessions", async () => {
		const { service, runtime } = createTrackedService();
		setKanbanProcessContext();

		await service.startTaskSession({
			taskId: "__home_agent__:workspace-1:nklein",
			cwd: "/tmp/worktree",
			prompt: "Add a task",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("You are NKlein, an AI coding agent."),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("!Klein sidebar agent"),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining(
					"'/usr/local/bin/node' '/Users/example/repo/dist/cli.js' task create",
				),
			}),
		);
	});

	it("mirrors runtime prompt resolution, rules, and approval wiring into the SDK start call", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const createRuntimeSetupMock = vi.fn(async (_workspacePath: string) => runtimeSetup.setup);
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: createRuntimeSetupMock,
			allowUnisolatedTestRuntime: true,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "/fix issue",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		expect(createRuntimeSetupMock).toHaveBeenCalledWith("/tmp/worktree");
		expect(runtimeSetup.resolvePromptMock).toHaveBeenCalledWith("/fix issue");
		expect(runtimeSetup.loadRulesMock).toHaveBeenCalledTimes(1);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "resolved:/fix issue",
				userInstructionService: runtimeSetup.setup.userInstructionService,
				requestToolApproval: runtimeSetup.setup.requestToolApproval,
				systemPrompt: expect.stringContaining("Workspace rule"),
			}),
		);
	});

	it("stores follow-up user input and keeps session running", async () => {
		const { service } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
			providerId: "nklein",
			modelId: "anthropic/claude-sonnet-4.6",
		});

		const nextSummary = await service.sendTaskSessionInput("task-1", "Continue\n");

		expect(nextSummary?.state).toBe("running");
		expect(
			service
				.listMessages("task-1")
				.filter((message) => message.role !== "system")
				.map((message) => message.content),
		).toEqual(["Initial prompt", "Continue"]);
	});

	it("rebinds a persisted session after restart and resumes chat on the next message", async () => {
		const { service, runtime } = createTrackedService();
		selfObservationMocks.recordSelfObservation.mockReset();
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-1-persisted",
				source: "core" as NKleinPersistedTaskSessionSnapshot["record"]["source"],
				status: "completed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				cwd: "task-1-persisted-cwd",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
			},
			messages: [
				{
					role: "user",
					content: "Recovered prompt",
				},
				{
					role: "assistant",
					content: "Recovered answer",
				},
			],
		});

		const reboundSummary = await service.rebindPersistedTaskSession("task-1");

		expect(reboundSummary?.state).toBe("awaiting_review");
		expect(reboundSummary?.reviewReason).toBe("attention");
		expect(reboundSummary?.workspacePath).toBe("task-1-persisted-cwd");
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "custom",
				severity: "info",
				taskId: "task-1",
				message: "Lost session rebound for review.",
				metadata: expect.objectContaining({
					operation: "lost_session_recovery",
					transition: "rebound_for_review",
				}),
			}),
		);
		expect(service.listMessages("task-1").map((message) => message.content)).toEqual([
			"Recovered prompt",
			"Recovered answer",
		]);

		const nextSummary = await service.sendTaskSessionInput("task-1", "Continue");

		expect(nextSummary?.state).toBe("running");
		await waitForSettled(() => {
			expect(service.listMessages("task-1").map((message) => message.content)).toEqual([
				"Recovered prompt",
				"Recovered answer",
				"Continue",
			]);
		});
	});

	it("resolves workflow prompts for follow-up input before sending to the SDK runtime", async () => {
		const runtime = createFakeNKleinSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const createRuntimeSetupMock = vi.fn(async (_workspacePath: string) => runtimeSetup.setup);
		const service = createDiagnosticIsolatedService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: createRuntimeSetupMock,
			allowUnisolatedTestRuntime: true,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
			providerId: "nklein",
			modelId: "anthropic/claude-sonnet-4.6",
		});
		await waitForTaskSessionId(runtime, "task-1");

		runtimeSetup.resolvePromptMock.mockImplementation((prompt: string) => `workflow:${prompt}`);
		await service.sendTaskSessionInput("task-1", "/continue");
		await waitForSettled(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith(
				"task-1",
				"workflow:/continue",
				"act",
				undefined,
				"queue",
			);
		});
	});
	it("marks session interrupted when stopped", async () => {
		const { service } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
			providerId: "nklein",
			modelId: "anthropic/claude-sonnet-4.6",
		});
		const existingEntry = (
			service as unknown as {
				messageRepository: {
					getTaskEntry: (taskId: string) => { summary: { heartbeatStatus: string | null } } | null;
				};
			}
		).messageRepository.getTaskEntry("task-1");
		if (!existingEntry) {
			throw new Error("Expected in-memory task entry.");
		}
		existingEntry.summary.heartbeatStatus = "lost";
		selfObservationMocks.recordSelfObservation.mockReset();

		const stopped = await service.stopTaskSession("task-1");

		expect(stopped?.state).toBe("interrupted");
		expect(stopped?.reviewReason).toBe("interrupted");
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "custom",
				severity: "info",
				taskId: "task-1",
				message: "Lost session marked interrupted.",
				metadata: expect.objectContaining({
					operation: "lost_session_recovery",
					transition: "marked_interrupted",
				}),
			}),
		);
	});

	it("rebinds persisted sessions before stopping when no in-memory entry exists", async () => {
		const { service, runtime } = createTrackedService();
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-1-persisted",
				source: "core" as NKleinPersistedTaskSessionSnapshot["record"]["source"],
				status: "completed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				cwd: "/tmp/worktree",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
			},
			messages: [
				{
					role: "user",
					content: "Recovered prompt",
				},
			],
		});

		const stopped = await service.stopTaskSession("task-1");

		expect(runtime.readPersistedTaskSessionMock).toHaveBeenCalledWith("task-1");
		expect(runtime.stopTaskSessionMock).toHaveBeenCalledWith("task-1");
		expect(stopped?.state).toBe("interrupted");
		expect(stopped?.reviewReason).toBe("interrupted");
	});

	it("cancels only the active turn without interrupting or trashing the task", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
			providerId: "nklein",
			modelId: "anthropic/claude-sonnet-4.6",
		});

		const canceled = await service.cancelTaskTurn("task-1");
		expect(canceled?.state).toBe("idle");
		expect(canceled?.reviewReason).toBeNull();
		expect(canceled?.latestHookActivity?.activityText).toBe("Turn canceled");

		const sessionId = await waitForTaskSessionId(runtime, "task-1");
		runtime.emitAgentEvent(sessionId, {
			type: "done",
			reason: "aborted",
		});

		expect(service.getSummary("task-1")?.state).toBe("idle");
		expect(service.getSummary("task-1")?.reviewReason).toBeNull();
	});

	it("uses agent_event text deltas for streaming and ignores serialized agent chunks", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		const sessionId = await waitForTaskSessionId(runtime, "task-1");
		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "text",
			text: "Hello",
			accumulated: "Hello",
		});

		runtime.emitChunk(sessionId, '{"type":"content_start","contentType":"text","text":"SHOULD_NOT_RENDER"}');

		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "text",
			text: " world",
			accumulated: "Hello world",
		});

		const assistantMessages = service
			.listMessages("task-1")
			.filter((message) => message.role === "assistant")
			.map((message) => message.content);

		expect(assistantMessages).toEqual(["Hello world"]);
	});

	it("shows assistant text when the SDK only emits the full response at content_end", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		runtime.emitAgentEvent(sessionId, {
			type: "content_end",
			contentType: "text",
			text: "Here is the complete response.",
		});

		const assistantMessages = service
			.listMessages("task-1")
			.filter((message) => message.role === "assistant")
			.map((message) => message.content);
		const summary = service.getSummary("task-1");

		expect(assistantMessages).toEqual(["Here is the complete response."]);
		expect(summary?.latestHookActivity?.activityText).toBe("Here is the complete response.");
		expect(summary?.latestHookActivity?.finalMessage).toBe("Here is the complete response.");
	});

	it("streams reasoning and tool lifecycle messages with stable ids", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "reasoning",
			reasoning: "Thinking",
		});
		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "reasoning",
			reasoning: "...",
		});
		runtime.emitAgentEvent(sessionId, {
			type: "content_end",
			contentType: "reasoning",
			reasoning: "Thinking...",
		});
		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "tool",
			toolCallId: "tool-1",
			toolName: "Read",
			input: { file: "a.ts" },
		});
		runtime.emitAgentEvent(sessionId, {
			type: "content_end",
			contentType: "tool",
			toolCallId: "tool-1",
			toolName: "Read",
			output: { ok: true },
			durationMs: 25,
		});

		const messages = service.listMessages("task-1");
		const reasoningMessages = messages.filter((message) => message.role === "reasoning");
		const toolMessages = messages.filter((message) => message.role === "tool");

		expect(reasoningMessages).toHaveLength(1);
		expect(reasoningMessages[0]?.content).toBe("Thinking...");
		expect(reasoningMessages[0]?.meta?.hookEventName).toBe("reasoning_end");
		expect(toolMessages).toHaveLength(1);
		expect(toolMessages[0]?.meta?.hookEventName).toBe("tool_call_end");
		expect(toolMessages[0]?.content).toContain("Tool: Read");
		expect(toolMessages[0]?.content).toContain("Input:");
		expect(toolMessages[0]?.content).toContain("Output:");
	});

	it("bounds oversized tool outputs in the task transcript", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		const sessionId = await waitForTaskSessionId(runtime, "task-1");
		const largeOutput = `${"x".repeat(13_000)}TAIL_SHOULD_NOT_APPEAR`;

		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "tool",
			toolCallId: "tool-1",
			toolName: "Read",
			input: { file: "large.log" },
		});
		runtime.emitAgentEvent(sessionId, {
			type: "content_end",
			contentType: "tool",
			toolCallId: "tool-1",
			toolName: "Read",
			output: largeOutput,
			durationMs: 25,
		});

		const toolMessage = service.listMessages("task-1").find((message) => message.role === "tool");

		expect(toolMessage?.content).toContain("Tool: Read");
		expect(toolMessage?.content).toContain("[tool output truncated after 12,000 characters;");
		expect(toolMessage?.content).not.toContain("TAIL_SHOULD_NOT_APPEAR");
		expect(toolMessage?.content.length).toBeLessThan(12_500);
	});

	it("summarizes tool errors without raw stack-frame noise", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "tool",
			toolCallId: "tool-1",
			toolName: "Bash",
			input: { command: "npm test" },
		});
		runtime.emitAgentEvent(sessionId, {
			type: "content_end",
			contentType: "tool",
			toolCallId: "tool-1",
			toolName: "Bash",
			error: [
				"AssertionError: expected 1 to equal 2",
				"    at Object.<anonymous> (/repo/test/example.test.ts:12:5)",
				"    at async runSuite (node:internal/test_runner:310:7)",
				"See /repo/test/example.test.ts:12",
			].join("\n"),
			durationMs: 25,
		});

		const toolMessage = service.listMessages("task-1").find((message) => message.role === "tool");

		expect(toolMessage?.content).toContain("Error:");
		expect(toolMessage?.content).toContain("AssertionError: expected 1 to equal 2");
		expect(toolMessage?.content).toContain("See /repo/test/example.test.ts:12");
		expect(toolMessage?.content).toContain("Next step:");
		expect(toolMessage?.content).not.toContain("Object.<anonymous>");
		expect(toolMessage?.content).not.toContain("node:internal/test_runner");
	});

	it("transitions between running and awaiting_review for user-attention tools", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "tool",
			toolCallId: "tool-1",
			toolName: "ask_followup_question",
			input: { question: "Need approval" },
		});

		expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		expect(service.getSummary("task-1")?.reviewReason).toBe("hook");

		runtime.emitAgentEvent(sessionId, {
			type: "content_end",
			contentType: "tool",
			toolCallId: "tool-1",
			toolName: "ask_followup_question",
			output: { ok: true },
		});

		expect(service.getSummary("task-1")?.state).toBe("running");
		expect(service.getSummary("task-1")?.reviewReason).toBeNull();
	});

	it("moves to awaiting_review when SDK emits done for a completed turn", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});
		service.applyTurnCheckpoint("task-1", {
			turn: 1,
			ref: "refs/kanban/checkpoints/task-1/turn/1",
			commit: "commit-1",
			createdAt: 1,
		});

		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		runtime.emitAgentEvent(sessionId, {
			type: "done",
			reason: "completed",
			text: "Done. Added the comment.",
		});

		const summary = service.getSummary("task-1");
		expect(summary?.state).toBe("awaiting_review");
		expect(summary?.reviewReason).toBe("hook");
		expect(summary?.latestHookActivity?.hookEventName).toBe("agent_end");
		expect(summary?.latestHookActivity?.finalMessage).toBe("Done. Added the comment.");
		await waitForSettled(() => {
			expect(turnCheckpointMocks.captureTaskTurnCheckpoint).toHaveBeenCalledWith({
				cwd: "/tmp/worktree",
				taskId: "task-1",
				turn: 2,
			});
		});
		expect(service.getSummary("task-1")?.previousTurnCheckpoint?.commit).toBe("commit-1");
		expect(service.getSummary("task-1")?.latestTurnCheckpoint?.commit).toBe("commit-2");
	});

	it("re-prompts an explicit decomposition turn that ended with no decompose_project tool call", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Plan this. When calling decompose_project, pass minimumTaskCount: 5.",
			startInPlanMode: true,
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-1");
		runtime.sendTaskSessionInputMock.mockClear();

		// A reasoning model ends its turn with no content and no tool call.
		runtime.emitAgentEvent(sessionId, { type: "done", reason: "completed", text: "" });

		await waitForSettled(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith(
				"task-1",
				expect.stringContaining("Your previous turn ended without calling a tool"),
				"act",
				undefined,
			);
		});
	});

	it("does not re-prompt a non-decomposition turn that ended with no tool call", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Just answer in chat.",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-1");
		runtime.sendTaskSessionInputMock.mockClear();

		runtime.emitAgentEvent(sessionId, { type: "done", reason: "completed", text: "" });

		// Give any async continuation a tick; it must not fire for a non-decomposition task.
		await Promise.resolve();
		expect(runtime.sendTaskSessionInputMock).not.toHaveBeenCalled();
	});

	it("moves to awaiting_review when SDK emits aborted done with a final message and no user cancel", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		runtime.emitAgentEvent(sessionId, {
			type: "done",
			reason: "aborted",
			text: "I completed the requested file.",
		});

		const summary = service.getSummary("task-1");
		expect(summary?.state).toBe("awaiting_review");
		expect(summary?.reviewReason).toBe("hook");
		expect(summary?.latestHookActivity?.hookEventName).toBe("agent_end");
		expect(summary?.latestHookActivity?.finalMessage).toBe("I completed the requested file.");
	});

	it("parks a task when the autonomous turn budget is reached", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Keep working autonomously.",
			providerId: "lmstudio",
			modelId: "qwen3",
		});

		const summary = service.applyTurnCheckpoint("task-1", {
			turn: 12,
			ref: "refs/kanban/checkpoints/task-1/turn/12",
			commit: "commit-12",
			createdAt: 12,
		});

		expect(summary).toMatchObject({
			state: "awaiting_review",
			reviewReason: "attention",
			warningMessage: expect.stringContaining("12 autonomous turns"),
			latestTurnCheckpoint: {
				turn: 12,
				commit: "commit-12",
			},
			latestHookActivity: {
				hookEventName: "guardrail",
				source: "kanban",
			},
		});
		expect(runtime.abortTaskSessionMock).toHaveBeenCalledWith("task-1");
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "budget_wall",
				severity: "warning",
				taskId: "task-1",
				providerId: "lmstudio",
				modelId: "qwen3",
				metadata: expect.objectContaining({
					guardrail: "max_autonomous_turns",
					turn: 12,
					limit: 12,
				}),
			}),
		);
		expect(service.listMessages("task-1").at(-1)?.content).toContain("paused this task");
	});

	it("honors a lowered configurable autonomous-turn guardrail", async () => {
		const { service, runtime } = createTrackedService();
		// Operator tightens the turn budget below the default 12.
		service.setSwarmGuardrails({ ...DEFAULT_RUNTIME_SWARM_GUARDRAILS, maxAutonomousTurnsPerTask: 3 });
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Keep working autonomously.",
			providerId: "lmstudio",
			modelId: "qwen3",
		});

		const summary = service.applyTurnCheckpoint("task-1", {
			turn: 3,
			ref: "refs/kanban/checkpoints/task-1/turn/3",
			commit: "commit-3",
			createdAt: 3,
		});

		expect(summary).toMatchObject({
			state: "awaiting_review",
			reviewReason: "attention",
			warningMessage: expect.stringContaining("3 autonomous turns"),
		});
		expect(runtime.abortTaskSessionMock).toHaveBeenCalledWith("task-1");
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ guardrail: "max_autonomous_turns", turn: 3, limit: 3 }),
			}),
		);
	});

	it("honors a raised configurable autonomous-turn guardrail (does not park at the default limit)", async () => {
		const { service, runtime } = createTrackedService();
		// Operator loosens the turn budget above the default 12.
		service.setSwarmGuardrails({ ...DEFAULT_RUNTIME_SWARM_GUARDRAILS, maxAutonomousTurnsPerTask: 20 });
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Keep working autonomously.",
			providerId: "lmstudio",
			modelId: "qwen3",
		});

		const summary = service.applyTurnCheckpoint("task-1", {
			turn: 12,
			ref: "refs/kanban/checkpoints/task-1/turn/12",
			commit: "commit-12",
			createdAt: 12,
		});

		// At turn 12 the default would have parked, but the raised limit lets it keep running.
		expect(summary?.state).not.toBe("awaiting_review");
		expect(runtime.abortTaskSessionMock).not.toHaveBeenCalled();
	});

	it("parks a running task as paused at a checkpoint and resumes it when unpaused", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Keep working until paused.",
			providerId: "lmstudio",
			modelId: "qwen3",
		});

		service.setBoardPaused(true);
		const pausedSummary = service.applyTurnCheckpoint("task-1", {
			turn: 1,
			ref: "refs/kanban/checkpoints/task-1/turn/1",
			commit: "commit-1",
			createdAt: 1,
		});

		expect(pausedSummary).toMatchObject({
			state: "paused",
			reviewReason: null,
			warningMessage: null,
			latestHookActivity: {
				hookEventName: "operator_pause",
				source: "kanban",
			},
		});
		expect(runtime.abortTaskSessionMock).toHaveBeenCalledWith("task-1");

		service.setBoardPaused(false);
		const resumed = await service.resumePausedTasks();

		expect(resumed).toHaveLength(1);
		expect(resumed[0]?.state).toBe("running");
		await waitForSettled(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith(
				"task-1",
				"resolved:Continue from the paused checkpoint.",
				"act",
				undefined,
			);
		});
	});

	it("parks and aborts running tasks immediately when the board is paused", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Keep working until paused.",
			providerId: "lmstudio",
			modelId: "qwen3",
		});

		service.setBoardPaused(true);

		expect(service.getSummary("task-1")).toMatchObject({
			state: "paused",
			latestHookActivity: {
				hookEventName: "operator_pause",
				source: "kanban",
			},
		});
		expect(runtime.abortTaskSessionMock).toHaveBeenCalledWith("task-1");
	});

	it("does not dispatch queued input to the SDK while the board is paused", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Keep working until paused.",
			providerId: "lmstudio",
			modelId: "qwen3",
		});
		service.setBoardPaused(true);
		runtime.sendTaskSessionInputMock.mockClear();

		await service.sendTaskSessionInput("task-1", "Do not send until resumed.");
		await Promise.resolve();

		expect(runtime.sendTaskSessionInputMock).not.toHaveBeenCalled();

		service.setBoardPaused(false);
		await waitForSettled(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith(
				"task-1",
				"resolved:Do not send until resumed.",
				"act",
				undefined,
			);
		});
	});

	it.each(["stop", "abort"] as const)("rejects queued pause waits when a task is %sed", async (action) => {
		const { service } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Keep working until paused.",
			providerId: "lmstudio",
			modelId: "qwen3",
		});

		service.setCardPaused("task-1", true);
		const pending = service.waitUntilTaskResumed("task-1");
		const rejection = expect(pending).rejects.toThrow("Task pause wait was aborted.");

		if (action === "stop") {
			await service.stopTaskSession("task-1");
		} else {
			await service.abortTaskSession("task-1");
		}

		await rejection;
	});

	it("parks a task when the autonomous wall-time budget is reached", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
		try {
			const { service, runtime } = createTrackedService();
			await service.startTaskSession({
				taskId: "task-1",
				cwd: "/tmp/worktree",
				prompt: "Keep working autonomously.",
				providerId: "lmstudio",
				modelId: "qwen3",
			});

			nowSpy.mockReturnValue(1_000 + 2 * 60 * 60 * 1000 + 60_000);
			const summary = service.applyTurnCheckpoint("task-1", {
				turn: 3,
				ref: "refs/kanban/checkpoints/task-1/turn/3",
				commit: "commit-3",
				createdAt: 3,
			});

			expect(summary).toMatchObject({
				state: "awaiting_review",
				reviewReason: "attention",
				warningMessage: expect.stringContaining("autonomous wall time"),
				latestTurnCheckpoint: {
					turn: 3,
					commit: "commit-3",
				},
				latestHookActivity: {
					hookEventName: "guardrail",
					source: "kanban",
				},
			});
			expect(runtime.abortTaskSessionMock).toHaveBeenCalledWith("task-1");
			expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
				expect.objectContaining({
					signal: "budget_wall",
					severity: "warning",
					taskId: "task-1",
					providerId: "lmstudio",
					modelId: "qwen3",
					metadata: expect.objectContaining({
						guardrail: "max_autonomous_wall_time",
						elapsedMs: 2 * 60 * 60 * 1000 + 60_000,
						limitMs: 2 * 60 * 60 * 1000,
						turn: 3,
					}),
				}),
			);
			expect(service.listMessages("task-1").at(-1)?.content).toContain("autonomous wall time");
		} finally {
			nowSpy.mockRestore();
		}
	});

	it("parks a task after repeated no-diff checkpoints", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Keep working autonomously.",
			providerId: "lmstudio",
			modelId: "qwen3",
		});

		for (let turn = 1; turn <= 3; turn += 1) {
			const summary = service.applyTurnCheckpoint("task-1", {
				turn,
				ref: `refs/kanban/checkpoints/task-1/turn/${turn}`,
				commit: "same-commit",
				createdAt: turn,
			});
			expect(summary?.state).toBe("running");
		}

		const summary = service.applyTurnCheckpoint("task-1", {
			turn: 4,
			ref: "refs/kanban/checkpoints/task-1/turn/4",
			commit: "same-commit",
			createdAt: 4,
		});

		expect(summary).toMatchObject({
			state: "awaiting_review",
			reviewReason: "attention",
			warningMessage: expect.stringContaining("no new diff commit"),
			latestTurnCheckpoint: {
				turn: 4,
				commit: "same-commit",
			},
			latestHookActivity: {
				hookEventName: "guardrail",
				source: "kanban",
			},
		});
		expect(runtime.abortTaskSessionMock).toHaveBeenCalledWith("task-1");
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "budget_wall",
				severity: "warning",
				taskId: "task-1",
				providerId: "lmstudio",
				modelId: "qwen3",
				metadata: expect.objectContaining({
					guardrail: "repeated_no_diff_checkpoints",
					count: 4,
					limit: 4,
					turn: 4,
					checkpointCommit: "same-commit",
				}),
			}),
		);
		expect(service.listMessages("task-1").at(-1)?.content).toContain("no new diff commit");
	});

	it("parks a task after repeated tool calls with the same input", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Keep working autonomously.",
			providerId: "lmstudio",
			modelId: "qwen3",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		for (let index = 1; index <= 2; index += 1) {
			runtime.emitAgentEvent(sessionId, {
				type: "content_start",
				contentType: "tool",
				toolCallId: `tool-${index}`,
				toolName: "Read",
				input: { file: "a.ts" },
			});
			expect(service.getSummary("task-1")?.state).toBe("running");
		}

		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "tool",
			toolCallId: "tool-3",
			toolName: "Read",
			input: { file: "a.ts" },
		});

		const summary = service.getSummary("task-1");
		expect(summary).toMatchObject({
			state: "awaiting_review",
			reviewReason: "attention",
			warningMessage: expect.stringContaining("repeated Read tool calls"),
			latestHookActivity: {
				hookEventName: "guardrail",
				source: "kanban",
			},
		});
		expect(runtime.abortTaskSessionMock).toHaveBeenCalledWith("task-1");
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "budget_wall",
				severity: "warning",
				taskId: "task-1",
				providerId: "lmstudio",
				modelId: "qwen3",
				metadata: expect.objectContaining({
					guardrail: "repeated_tool_calls",
					count: 3,
					limit: 3,
					toolName: "Read",
					toolInputSummary: expect.stringContaining("a.ts"),
				}),
			}),
		);
		expect(service.listMessages("task-1").at(-1)?.content).toContain("repeated Read tool calls");
	});

	it("does NOT park decompose_project across question-resolution progress (real evidence regression)", async () => {
		// The architect re-calls decompose_project as it resolves open clarifying questions one at a time. By slug
		// alone these looked identical and the guard paused at the 3rd call — even though that call applied the
		// decomposition. The progress-aware summary gives each step a distinct fingerprint, so no false pause.
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Decompose autonomously.",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		const progressingCalls = [
			{ slug: "professional-daw", tasks: [{}], questions: [{ id: "audio-core", status: "open" }] },
			{
				slug: "professional-daw",
				tasks: [{}],
				questions: [
					{ id: "audio-core", status: "assumed-default" },
					{ id: "webgpu-integration", status: "open" },
				],
			},
			{
				slug: "professional-daw",
				tasks: [{}],
				questions: [
					{ id: "audio-core", status: "assumed-default" },
					{ id: "webgpu-integration", status: "assumed-default" },
				],
			},
		];
		for (const [index, input] of progressingCalls.entries()) {
			runtime.emitAgentEvent(sessionId, {
				type: "content_start",
				contentType: "tool",
				toolCallId: `decompose-${index}`,
				toolName: "decompose_project",
				input,
			});
		}

		expect(service.getSummary("task-1")?.state).toBe("running");
		expect(runtime.abortTaskSessionMock).not.toHaveBeenCalled();
	});

	it("does NOT pause an unknown/future workflow tool whose FULL input advances (structural guarantee)", async () => {
		// The guard now keys on the lossless full-input fingerprint computed in the event adapter, so ANY tool —
		// including ones with no bespoke display summarizer — is immune to the false-pause as long as its input
		// actually changes. A field a lossy summary might have keyed on (`title`) stays constant here on purpose.
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({ taskId: "task-1", cwd: "/tmp/worktree", prompt: "Work." });
		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		for (let index = 1; index <= 4; index += 1) {
			runtime.emitAgentEvent(sessionId, {
				type: "content_start",
				contentType: "tool",
				toolCallId: `wf-${index}`,
				toolName: "some_workflow_tool",
				input: { title: "constant-title", step: index, payload: { nested: index * 7 } },
			});
		}

		expect(service.getSummary("task-1")?.state).toBe("running");
		expect(runtime.abortTaskSessionMock).not.toHaveBeenCalled();
	});

	it("STILL pauses an unknown/future tool called with genuinely identical input (true loop preserved)", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({ taskId: "task-1", cwd: "/tmp/worktree", prompt: "Work." });
		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		for (let index = 1; index <= 3; index += 1) {
			runtime.emitAgentEvent(sessionId, {
				type: "content_start",
				contentType: "tool",
				toolCallId: `wf-${index}`,
				toolName: "some_workflow_tool",
				input: { title: "constant-title", payload: { nested: 42 } },
			});
		}

		const summary = service.getSummary("task-1");
		expect(summary?.state).toBe("awaiting_review");
		expect(summary?.reviewReason).toBe("attention");
		expect(summary?.warningMessage).toContain("repeated some_workflow_tool tool calls");
		expect(runtime.abortTaskSessionMock).toHaveBeenCalledWith("task-1");
	});

	it("resets repeated tool-call tracking when the tool input changes", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Keep working autonomously.",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		for (let index = 1; index <= 2; index += 1) {
			runtime.emitAgentEvent(sessionId, {
				type: "content_start",
				contentType: "tool",
				toolCallId: `tool-a-${index}`,
				toolName: "Read",
				input: { file: "a.ts" },
			});
		}
		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "tool",
			toolCallId: "tool-b-1",
			toolName: "Read",
			input: { file: "b.ts" },
		});

		expect(service.getSummary("task-1")?.state).toBe("running");
		expect(runtime.abortTaskSessionMock).not.toHaveBeenCalled();
	});

	it("allows extra file and command tools more repeated calls before parking", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Keep working autonomously.",
			providerId: "lmstudio",
			modelId: "qwen3",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		for (let index = 1; index <= 5; index += 1) {
			runtime.emitAgentEvent(sessionId, {
				type: "content_start",
				contentType: "tool",
				toolCallId: `tool-${index}`,
				toolName: "run_commands",
				input: { command: "node --test test/plugin.test.js" },
			});
			expect(service.getSummary("task-1")?.state).toBe("running");
		}

		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "tool",
			toolCallId: "tool-6",
			toolName: "run_commands",
			input: { command: "node --test test/plugin.test.js" },
		});

		const summary = service.getSummary("task-1");
		expect(summary).toMatchObject({
			state: "awaiting_review",
			reviewReason: "attention",
			warningMessage: expect.stringContaining("repeated run_commands tool calls"),
		});
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({
					guardrail: "repeated_tool_calls",
					count: 6,
					limit: 6,
					toolName: "run_commands",
				}),
			}),
		);
	});

	it("parks a task after repeated failed plan artifact inspections across different tools", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Decompose the project.",
			providerId: "lmstudio",
			modelId: "qwen3",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-1");
		const planPath = ".nklein/nklein/plans/habit-product/tasks.json";
		const toolCalls = [
			{
				toolName: "run_commands",
				input: { commands: [`ls -la ${planPath}`] },
			},
			{
				toolName: "find_files",
				input: { path: planPath, pattern: "*" },
			},
			{
				toolName: "list_files",
				input: { path: planPath, recursive: true },
			},
			{
				toolName: "read_files",
				input: { files: [{ path: planPath }] },
			},
		];

		for (const [index, call] of toolCalls.entries()) {
			const toolCallId = `tool-${index + 1}`;
			runtime.emitAgentEvent(sessionId, {
				type: "content_start",
				contentType: "tool",
				toolCallId,
				toolName: call.toolName,
				input: call.input,
			});
			runtime.emitAgentEvent(sessionId, {
				type: "content_end",
				contentType: "tool",
				toolCallId,
				toolName: call.toolName,
				error: "Sandbox tool failed.",
				output: { error: "Sandbox tool failed." },
			});
		}

		const summary = service.getSummary("task-1");
		expect(summary).toMatchObject({
			state: "awaiting_review",
			reviewReason: "attention",
			warningMessage: expect.stringContaining("failed attempts to inspect the same plan artifact path"),
			latestHookActivity: {
				hookEventName: "guardrail",
				source: "kanban",
			},
		});
		expect(runtime.abortTaskSessionMock).toHaveBeenCalledWith("task-1");
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "budget_wall",
				severity: "warning",
				taskId: "task-1",
				providerId: "lmstudio",
				modelId: "qwen3",
				metadata: expect.objectContaining({
					guardrail: "repeated_plan_artifact_failures",
					count: 4,
					limit: 4,
					targetSummary: planPath,
					toolNames: ["run_commands", "find_files", "list_files", "read_files"],
				}),
			}),
		);
	});

	it("parks a task after repeated decompose_project graph-validation failures (varied input)", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Decompose the project.",
			providerId: "lmstudio",
			modelId: "qwen3",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		// The model re-submits a slightly *different* graph each time (so the identical-full-input guard never
		// fires) but keeps failing the same coherence validation. The decomposition-failure breaker fingerprints by
		// the tool, so the consecutive failures accumulate and park the task instead of looping forever.
		for (let attempt = 1; attempt <= 4; attempt += 1) {
			const toolCallId = `decompose-${attempt}`;
			const input = {
				slug: "professional-daw-core",
				tasks: [{ id: `t${attempt}`, title: `Implement layer ${attempt}`, dependsOn: [] }],
			};
			runtime.emitAgentEvent(sessionId, {
				type: "content_start",
				contentType: "tool",
				toolCallId,
				toolName: "decompose_project",
				input,
			});
			runtime.emitAgentEvent(sessionId, {
				type: "content_end",
				contentType: "tool",
				toolCallId,
				toolName: "decompose_project",
				error: "Task graph failed dependency-coherence validation.",
				output: { error: "Task graph failed dependency-coherence validation." },
			});
		}

		const summary = service.getSummary("task-1");
		expect(summary).toMatchObject({
			state: "awaiting_review",
			reviewReason: "attention",
			warningMessage: expect.stringContaining("decomposition attempts that kept failing graph validation"),
		});
		expect(runtime.abortTaskSessionMock).toHaveBeenCalledWith("task-1");
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({
					guardrail: "repeated_decomposition_failures",
					count: 4,
					limit: 4,
				}),
			}),
		);
	});

	it("creates task entry and session mapping before start() resolves", async () => {
		const { service, runtime } = createTrackedService();
		const startDeferred = createDeferred<StartNKleinSessionRuntimeResult>();
		runtime.startTaskSessionMock.mockImplementationOnce(
			async (_request: StartNKleinSessionRuntimeRequest & { sessionId: string }) => await startDeferred.promise,
		);

		const summary = await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "start",
		});

		expect(summary.state).toBe("running");
		const mappedSessionId = await waitForTaskSessionId(runtime, "task-1");

		runtime.emitAgentEvent(mappedSessionId ?? "session-1", {
			type: "content_start",
			contentType: "text",
			text: "Streaming",
			accumulated: "Streaming",
		});

		expect(
			service
				.listMessages("task-1")
				.filter((message) => message.role === "assistant")
				.map((message) => message.content),
		).toEqual(["Streaming"]);

		startDeferred.resolve({
			sessionId: mappedSessionId ?? "session-1",
			result: {},
		});
		await Promise.resolve();
	});

	it("does not block sendTaskSessionInput on full-turn SDK send completion", async () => {
		const { service, runtime } = createTrackedService();
		const sendDeferred = createDeferred<unknown>();
		runtime.sendTaskSessionInputMock.mockImplementationOnce(async () => await sendDeferred.promise);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		const response = await Promise.race([
			service.sendTaskSessionInput("task-1", "Continue"),
			new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
		]);

		expect(response).not.toBeNull();
		await waitForSettled(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledTimes(1);
		});
		sendDeferred.resolve({ text: "done" });
	});

	it("keeps the task resumable when native NKlein startup throws", async () => {
		const { service, runtime } = createTrackedService();
		runtime.startTaskSessionMock.mockRejectedValueOnce(new Error('Missing API key for provider "nklein".'));

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
			providerId: "nklein",
			modelId: "anthropic/claude-sonnet-4.6",
		});

		await waitForSettled(() => {
			expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		});

		expect(service.getSummary("task-1")?.reviewReason).toBe("error");
		expect(service.getSummary("task-1")?.warningMessage).toContain("Missing API key");
		expect(service.getSummary("task-1")?.latestHookActivity?.hookEventName).toBe("agent_error");
		expect(service.getSummary("task-1")?.latestHookActivity?.finalMessage).toContain("Missing API key");
		expect(
			service.listMessages("task-1").some((message) => message.content.includes("NKlein SDK start failed")),
		).toBe(true);
	});

	it("suppresses generic startup failure warnings for insufficient-balance errors", async () => {
		const { service, runtime } = createTrackedService();
		const insufficientBalanceError = new Error("402 Insufficient balance. Your NKlein Credits balance is $0.00");
		runtime.startTaskSessionMock.mockRejectedValueOnce(insufficientBalanceError);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
			providerId: "nklein",
			modelId: "anthropic/claude-sonnet-4.6",
		});

		await waitForSettled(() => {
			expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		});

		expect(service.getSummary("task-1")?.warningMessage).toBeNull();
		expect(
			service.listMessages("task-1").some((message) => message.content.includes("NKlein SDK start failed")),
		).toBe(false);
	});

	it("sets credit_limit notificationType on start/send failure path for insufficient-balance errors", async () => {
		const { service, runtime } = createTrackedService();
		runtime.startTaskSessionMock.mockRejectedValueOnce(
			new Error("402 Insufficient balance. Your NKlein Credits balance is $0.00"),
		);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
			providerId: "nklein",
			modelId: "anthropic/claude-sonnet-4.6",
		});

		await waitForSettled(() => {
			expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		});

		expect(service.getSummary("task-1")?.latestHookActivity?.notificationType).toBe("credit_limit");
	});

	it("aborts the task session when an agent event signals credit exhaustion", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			providerId: "nklein",
			modelId: "anthropic/claude-sonnet-4.6",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		runtime.emitAgentEvent(sessionId, {
			type: "error",
			error: new Error("402 Insufficient balance. Your NKlein Credits balance is $0.00"),
			recoverable: false,
			iteration: 1,
		});

		await waitForSettled(() => {
			expect(runtime.abortTaskSessionMock).toHaveBeenCalledWith("task-1");
		});
		expect(service.getSummary("task-1")?.latestHookActivity?.notificationType).toBe("credit_limit");
	});

	it("allows follow-up input after a startup error", async () => {
		const { service, runtime } = createTrackedService();
		runtime.startTaskSessionMock.mockRejectedValueOnce(new Error("Maximum consecutive mistakes reached."));

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});

		await waitForSettled(() => {
			expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		});

		const nextSummary = await service.sendTaskSessionInput("task-1", "Try again");

		expect(nextSummary?.state).toBe("running");
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(2);
		});
		expect(runtime.sendTaskSessionInputMock).not.toHaveBeenCalled();
		expect(service.listMessages("task-1").map((message) => message.content)).toContain("Try again");
	});

	it("parks a task after repeated identical restart failures", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		runtime.startTaskSessionMock.mockRejectedValue(new Error("No previous NKlein session config is available."));

		await service.reloadTaskSession("task-1");
		await service.reloadTaskSession("task-1");
		await service.reloadTaskSession("task-1");

		expect(service.getSummary("task-1")?.state).toBe("failed");
		expect(service.getSummary("task-1")?.latestHookActivity?.activityText).toContain(
			"parked after repeated failures",
		);
		expect(service.listMessages("task-1").at(-1)?.content).toContain("!Klein parked this task");
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "runtime_error",
				metadata: expect.objectContaining({
					consecutiveFailures: 3,
					parked: true,
				}),
			}),
		);
		const observationCountAfterParking = selfObservationMocks.recordSelfObservation.mock.calls.length;

		await service.reloadTaskSession("task-1");

		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledTimes(observationCountAfterParking);
	});

	it("records session recovery telemetry when reload restart fails", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});
		selfObservationMocks.recordSelfObservation.mockReset();
		runtime.startTaskSessionMock.mockRejectedValueOnce(new Error("No previous NKlein session config is available."));

		const summary = await service.reloadTaskSession("task-1");

		expect(summary?.state).toBe("awaiting_review");
		expect(summary?.warningMessage).toContain("No previous NKlein session config is available");
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "runtime_error",
				severity: "warning",
				taskId: "task-1",
				message: expect.stringContaining("NKlein session recovery failed during reload_task_session"),
				metadata: expect.objectContaining({
					operation: "reload_task_session",
					recoveryAction: true,
				}),
			}),
		);
	});

	it("compacts persisted history and retries send when context window is exceeded", async () => {
		const { service, runtime } = createTrackedService();
		runtime.sendTaskSessionInputMock.mockRejectedValueOnce(
			new Error(
				"Anthropic request was rejected (HTTP 400). Maximum prompt length exceeded: 1102640 tokens exceeds the 1000000 token limit.",
			),
		);
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-1-failed",
				source: "core" as NKleinPersistedTaskSessionSnapshot["record"]["source"],
				status: "failed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				cwd: "/tmp/worktree",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
			},
			messages: [
				{ role: "user", content: "Initial prompt" },
				{ role: "assistant", content: "Step 1 response" },
				{ role: "user", content: "Step 2 request" },
				{ role: "assistant", content: "Step 2 response" },
				{ role: "assistant", content: "Tool output summary" },
				{ role: "user", content: "Latest user request" },
				{ role: "assistant", content: "Latest response" },
			],
		});

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		const nextSummary = await service.sendTaskSessionInput("task-1", "Try again");

		expect(nextSummary?.state).toBe("running");
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(2);
		});
		expect(runtime.stopTaskSessionMock).toHaveBeenCalledWith("task-1");
		expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledTimes(1);
		const restartCall = runtime.startTaskSessionMock.mock.calls[1]?.[0];
		expect(restartCall?.prompt).toBe("resolved:Try again");
		const compactedMessages = restartCall?.initialMessages;
		expect(Array.isArray(compactedMessages)).toBe(true);
		expect((compactedMessages ?? []).length).toBeLessThan(7);
		expect(compactedMessages?.[0]?.role).toBe("user");
		const compactedFirstContent =
			typeof compactedMessages?.[0]?.content === "string"
				? compactedMessages[0].content
				: JSON.stringify(compactedMessages?.[0]?.content ?? "");
		expect(compactedFirstContent).toContain("Previous conversation history was removed due to context window limits");
		expect(compactedFirstContent).not.toContain("[[");
		expect(compactedFirstContent).toContain("[Previous conversation history");
		expect(compactedFirstContent).toContain("Initial prompt");
		expect(service.listMessages("task-1").some((message) => message.content.includes("NKlein SDK send failed"))).toBe(
			false,
		);
	});

	it("restarts from persisted launch metadata after compaction when runtime config cache is empty", async () => {
		const { service, runtime } = createTrackedService();
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-1-persisted",
				source: "core" as NKleinPersistedTaskSessionSnapshot["record"]["source"],
				status: "completed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "lmstudio",
				model: "qwen-local",
				cwd: "/tmp/worktree",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
				metadata: {
					kanban: {
						launchConfig: {
							providerId: "lmstudio",
							modelId: "qwen-local",
							baseUrl: "http://127.0.0.1:1234/v1",
							contextWindow: 8_000,
							maxAgentWritableFileLines: 900,
							apiTimeoutMs: 3_600_000,
							turnTimeoutMs: null,
						},
					},
				},
			},
			messages: [
				{ role: "user", content: `Initial prompt ${"a".repeat(40_000)}` },
				{ role: "assistant", content: `First response ${"b".repeat(40_000)}` },
				{ role: "user", content: `Second request ${"c".repeat(40_000)}` },
				{ role: "assistant", content: `Second response ${"d".repeat(40_000)}` },
			],
		});

		const reboundSummary = await service.rebindPersistedTaskSession("task-1");
		expect(reboundSummary?.state).toBe("awaiting_review");

		const nextSummary = await service.sendTaskSessionInput("task-1", "Try again");

		expect(nextSummary?.state).toBe("running");
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});
		expect(runtime.stopTaskSessionMock).toHaveBeenCalledWith("task-1");
		const startCall = runtime.startTaskSessionMock.mock.calls[0]?.[0];
		expect(startCall).toEqual(
			expect.objectContaining({
				providerId: "lmstudio",
				modelId: "qwen-local",
				baseUrl: "http://127.0.0.1:1234/v1",
				contextWindow: 8_000,
				maxAgentWritableFileLines: 900,
				apiTimeoutMs: 3_600_000,
				turnTimeoutMs: null,
				prompt: "resolved:Try again",
			}),
		);
		expect(startCall?.systemPrompt).toContain("Model context window: 8,000 tokens");
		expect(startCall?.initialMessages?.length).toBeLessThan(4);
		expect(
			service.listMessages("task-1").some((message) => message.content.includes("No previous NKlein session")),
		).toBe(false);
	});

	it("blocks persisted cloud launch metadata on the overflow restart path", async () => {
		const { service, runtime } = createTrackedService();
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-1-persisted-cloud",
				source: "core" as NKleinPersistedTaskSessionSnapshot["record"]["source"],
				status: "completed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "openrouter",
				model: "cloud-model",
				cwd: "/tmp/worktree",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
				metadata: {
					kanban: {
						launchConfig: {
							providerId: "openrouter",
							modelId: "cloud-model",
							baseUrl: "https://openrouter.ai/api/v1",
							contextWindow: 8_000,
							maxAgentWritableFileLines: 900,
							apiTimeoutMs: 3_600_000,
							turnTimeoutMs: null,
						},
					},
				},
			},
			messages: [
				{ role: "user", content: `Initial prompt ${"a".repeat(40_000)}` },
				{ role: "assistant", content: `First response ${"b".repeat(40_000)}` },
				{ role: "user", content: `Second request ${"c".repeat(40_000)}` },
				{ role: "assistant", content: `Second response ${"d".repeat(40_000)}` },
			],
		});

		const reboundSummary = await service.rebindPersistedTaskSession("task-1");
		expect(reboundSummary?.state).toBe("awaiting_review");

		const nextSummary = await service.sendTaskSessionInput("task-1", "Try again");

		expect(nextSummary?.state).toBe("running");
		await waitForSettled(() => {
			expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		});
		expect(runtime.startTaskSessionMock).not.toHaveBeenCalled();
		expect(runtime.stopTaskSessionMock).toHaveBeenCalledWith("task-1");
		expect(service.getSummary("task-1")?.warningMessage).toContain("Cloud models are disabled");
		expect(
			service.listMessages("task-1").some((message) => message.content.includes("Cloud models are disabled")),
		).toBe(true);
	});

	it("proactively compacts before sending when projected context budget is too high", async () => {
		const { service, runtime } = createTrackedService();
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-1-live",
				source: "core" as NKleinPersistedTaskSessionSnapshot["record"]["source"],
				status: "running",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "lmstudio",
				model: "model-1",
				cwd: "/tmp/worktree",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
			},
			messages: [
				{ role: "user", content: `Initial prompt ${"a".repeat(10_000)}` },
				{ role: "assistant", content: `First response ${"b".repeat(10_000)}` },
				{ role: "user", content: `Second request ${"c".repeat(10_000)}` },
				{ role: "assistant", content: `Second response ${"d".repeat(10_000)}` },
			],
		});

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
			contextWindow: 8_000,
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-1");
		runtime.emitAgentEvent(sessionId, {
			type: "done",
			reason: "completed",
		});
		await waitForSettled(() => {
			expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		});

		const summary = await service.sendTaskSessionInput("task-1", "x".repeat(1_000), undefined, undefined, {
			providerId: "lmstudio",
			modelId: "new-model",
			apiKey: "local-key",
			baseUrl: "http://127.0.0.1:1234/v1",
			reasoningEffort: null,
			contextWindow: 8_000,
		});
		expect(summary?.state).toBe("running");

		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(2);
		});
		expect(runtime.startTaskSessionMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				providerId: "lmstudio",
				modelId: "new-model",
				apiKey: "local-key",
				baseUrl: "http://127.0.0.1:1234/v1",
				reasoningEffort: null,
			}),
		);
		expect(runtime.stopTaskSessionMock).toHaveBeenCalledWith("task-1");
		expect(runtime.sendTaskSessionInputMock).not.toHaveBeenCalled();
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "context_overflow",
				severity: "warning",
				taskId: "task-1",
				metadata: expect.objectContaining({
					action: "compacted",
					contextWindow: 8_000,
				}),
			}),
		);
	});

	it("keeps large advertised context windows end-to-end", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
			providerId: "lmstudio",
			modelId: "huge-advertised-model",
			baseUrl: "http://127.0.0.1:1234/v1",
			contextWindow: 1_000_000,
		});

		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});
		const startCall = runtime.startTaskSessionMock.mock.calls[0]?.[0];
		expect(startCall?.contextWindow).toBe(1_000_000);
		expect(startCall?.systemPrompt).toContain("Model context window: 1,000,000 tokens");
		const breakdown = service.getSummary("task-1")?.contextBudgetBreakdown;
		expect(breakdown).toEqual(
			expect.objectContaining({
				effectiveContextWindow: 1_000_000,
				projectedTokens: expect.any(Number),
				reservedOutputTokens: expect.any(Number),
			}),
		);
		expect(breakdown?.systemPromptTokens).toBeGreaterThan(0);
		expect(breakdown?.toolSchemaTokens).toBeGreaterThan(0);
	});

	it("segments retained read_files tool output in the context budget breakdown", async () => {
		const { service, runtime } = createTrackedService();
		const initialMessages: NKleinSdkPersistedMessage[] = [
			{
				role: "user",
				content: "Please inspect the file.",
			},
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "read-1",
						name: "read_files",
						input: {
							files: [{ path: "src/index.ts", start_line: 1, end_line: 3 }],
						},
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						name: "read_files",
						tool_use_id: "read-1",
						content: "export function run() {\n  return true;\n}\n",
					},
				],
			},
		];

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Continue from the file context",
			providerId: "lmstudio",
			modelId: "local-model",
			baseUrl: "http://127.0.0.1:1234/v1",
			contextWindow: 80_000,
			initialMessages,
		});

		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});
		const breakdown = service.getSummary("task-1")?.contextBudgetBreakdown;
		expect(breakdown?.includedFileContentTokens).toBeGreaterThan(0);
		expect(breakdown?.userMessageTokens).toBeGreaterThan(0);
		expect(breakdown?.projectedTokens).toBe(
			(breakdown?.systemPromptTokens ?? 0) +
				(breakdown?.toolSchemaTokens ?? 0) +
				(breakdown?.taskPromptTokens ?? 0) +
				(breakdown?.userMessageTokens ?? 0) +
				(breakdown?.includedFileContentTokens ?? 0) +
				(breakdown?.otherHistoryTokens ?? 0) +
				(breakdown?.reservedPromptOverheadTokens ?? 0) +
				(breakdown?.reservedOutputTokens ?? 0),
		);
	});

	it("blocks a prompt-only overflow before starting the SDK runtime", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: `Oversized request ${"overflow ".repeat(20_000)}`,
			providerId: "lmstudio",
			modelId: "small-local-model",
			baseUrl: "http://127.0.0.1:1234/v1",
			contextWindow: 8_000,
		});

		await waitForSettled(() => {
			expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		});
		expect(runtime.startTaskSessionMock).not.toHaveBeenCalled();
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "context_overflow",
				severity: "error",
				taskId: "task-1",
				providerId: "lmstudio",
				modelId: "small-local-model",
				metadata: expect.objectContaining({
					action: "blocked",
					contextWindow: 8_000,
					effectiveContextWindow: 8_000,
				}),
			}),
		);
		expect(
			service
				.listMessages("task-1")
				.some(
					(message) =>
						message.content.includes("Your message") && message.content.includes("larger than this model"),
				),
		).toBe(true);
	});

	it("does not interrupt an active turn to compact a critically large queued prompt", async () => {
		const { service, runtime } = createTrackedService();
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-1-live",
				source: "core" as NKleinPersistedTaskSessionSnapshot["record"]["source"],
				status: "running",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "nklein",
				model: "model-1",
				cwd: "/tmp/worktree",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
			},
			messages: [{ role: "user", content: "Only one message means no compaction possible" }],
		});

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
			contextWindow: 8_000,
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		await service.sendTaskSessionInput("task-1", "x".repeat(50_000));

		await waitForSettled(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith(
				"task-1",
				expect.stringContaining("x"),
				"act",
				undefined,
				"queue",
			);
		});
		expect(runtime.stopTaskSessionMock).not.toHaveBeenCalled();
		expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
	});

	it("restarts the live session from persisted history after the SDK ends the task on send failure", async () => {
		const { service, runtime } = createTrackedService();
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-1-failed",
				source: "core" as NKleinPersistedTaskSessionSnapshot["record"]["source"],
				status: "failed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				cwd: "/tmp/worktree",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
			},
			messages: [
				{
					role: "user",
					content: "Initial prompt",
				},
				{
					role: "assistant",
					content: "Previous reply",
				},
			],
		});

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		const liveSessionId = runtime.getTaskSessionId("task-1");
		expect(liveSessionId).toBeTruthy();
		runtime.sessionIdByTaskId.delete("task-1");
		if (liveSessionId) {
			runtime.taskIdBySessionId.delete(liveSessionId);
		}

		const nextSummary = await service.sendTaskSessionInput("task-1", "Try again");

		expect(nextSummary?.state).toBe("running");
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(2);
		});
		expect(runtime.sendTaskSessionInputMock).not.toHaveBeenCalled();
		expect(runtime.startTaskSessionMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				prompt: "resolved:Try again",
				initialMessages: [
					{
						role: "user",
						content: "Initial prompt",
					},
					{
						role: "assistant",
						content: "Previous reply",
					},
				],
			}),
		);
		expect(service.listMessages("task-1").map((message) => message.content)).toContain("Try again");
	});

	it("reloads by restarting after stop instead of sending into the just-stopped session", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});
		await waitForSettled(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		const summary = await service.reloadTaskSession("task-1");

		expect(summary?.state).toBe("idle");
		expect(runtime.stopTaskSessionMock).toHaveBeenCalledWith("task-1");
		expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(2);
		expect(runtime.sendTaskSessionInputMock).not.toHaveBeenCalled();
	});

	it("returns null for restored home sessions without cached start config so the caller can start fresh", async () => {
		const { service, runtime } = createTrackedService();
		const taskId = "__home_agent__:workspace-1:nklein";
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "persisted-home-session",
				source: "core" as NKleinPersistedTaskSessionSnapshot["record"]["source"],
				status: "completed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "openrouter",
				model: "openrouter/auto",
				cwd: "/tmp/worktree",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
			},
			messages: [
				{
					role: "user",
					content: "Initial prompt",
				},
				{
					role: "assistant",
					content: "Initial reply",
				},
			],
		});

		const reboundSummary = await service.rebindPersistedTaskSession(taskId);
		expect(reboundSummary?.taskId).toBe(taskId);
		expect(runtime.startTaskSessionMock).not.toHaveBeenCalled();

		const sendSummary = await service.sendTaskSessionInput(taskId, "Continue");
		expect(sendSummary).toBeNull();
		expect(runtime.startTaskSessionMock).not.toHaveBeenCalled();
		expect(service.listMessages(taskId).map((message) => message.content)).not.toContain("Continue");

		const reloadSummary = await service.reloadTaskSession(taskId);
		expect(reloadSummary).toBeNull();
		expect(runtime.startTaskSessionMock).not.toHaveBeenCalled();
	});

	it("does not duplicate assistant output when stream and send result both include final text", async () => {
		const { service, runtime } = createTrackedService();
		const sendDeferred = createDeferred<unknown>();
		runtime.sendTaskSessionInputMock.mockImplementationOnce(async () => await sendDeferred.promise);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		await service.sendTaskSessionInput("task-1", "Continue");
		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "text",
			text: "Done.",
			accumulated: "Done.",
		});

		sendDeferred.resolve({ text: "Done." });
		await Promise.resolve();

		const assistantMessages = service
			.listMessages("task-1")
			.filter((message) => message.role === "assistant")
			.map((message) => message.content);
		expect(assistantMessages).toEqual(["Done."]);
	});

	it("does not duplicate final assistant text when content_end and done carry the same text", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "text",
			text: "Done.",
			accumulated: "Done.",
		});
		runtime.emitAgentEvent(sessionId, {
			type: "content_end",
			contentType: "text",
			text: "Done.",
		});
		runtime.emitAgentEvent(sessionId, {
			type: "done",
			reason: "completed",
			text: "Done.",
		});

		const assistantMessages = service
			.listMessages("task-1")
			.filter((message) => message.role === "assistant")
			.map((message) => message.content);
		expect(assistantMessages).toEqual(["Done."]);
	});
});

describe("formatRepeatedToolCallParkMessage", () => {
	it("gives a diagnostic, remedy-oriented message for repeated empty decompose_project calls", () => {
		const message = formatRepeatedToolCallParkMessage({
			toolName: "decompose_project",
			count: 3,
			toolInputSummary: null,
		});
		expect(message).toMatch(/empty arguments/i);
		expect(message).toMatch(/reasoning/i);
		expect(message).toMatch(/more capable model|Architect/i);
		// Not the generic "same input" notice.
		expect(message).not.toMatch(/same input/i);
	});

	it("uses the generic message when decompose_project repeats with non-empty input", () => {
		const message = formatRepeatedToolCallParkMessage({
			toolName: "decompose_project",
			count: 3,
			toolInputSummary: "slug=daw",
		});
		expect(message).toMatch(/same input/i);
		expect(message).toMatch(/slug=daw/);
	});

	it("uses the generic message for other repeated tools", () => {
		const message = formatRepeatedToolCallParkMessage({ toolName: "read_files", count: 6, toolInputSummary: null });
		expect(message).toMatch(/repeated read_files tool calls/i);
	});
});

describe("computeRepeatedToolCallCandidate", () => {
	const activity = (overrides: Record<string, unknown> = {}) => ({
		activityText: null,
		toolName: "read_files",
		toolInputSummary: "src/a.ts",
		finalMessage: null,
		hookEventName: "tool_call",
		notificationType: null,
		source: "nklein-sdk",
		...overrides,
	});

	it("fingerprints an ordinary tool call by name + input summary when no full-input fingerprint is present", () => {
		const candidate = computeRepeatedToolCallCandidate(activity() as never);
		expect(candidate).toEqual({
			fingerprint: "read_files\nsrc/a.ts",
			toolName: "read_files",
			toolInputSummary: "src/a.ts",
		});
	});

	it("PREFERS the lossless full-input fingerprint over the lossy summary when present (future-tool safety)", () => {
		const candidate = computeRepeatedToolCallCandidate(
			activity({ toolInputFingerprint: "abc123", toolInputSummary: "src/a.ts" }) as never,
		);
		expect(candidate).toEqual({
			fingerprint: "read_files\nabc123",
			toolName: "read_files",
			toolInputSummary: "src/a.ts",
		});
	});

	it("does NOT collide when two calls share a summary but differ in full input (the structural guarantee)", () => {
		// This is exactly the false-pause failure mode: a lossy summary that looked identical across calls that
		// were actually different. With distinct full-input fingerprints the guard sees them as distinct.
		const first = computeRepeatedToolCallCandidate(
			activity({ toolName: "decompose_project", toolInputSummary: "daw", toolInputFingerprint: "fp-open" }) as never,
		);
		const second = computeRepeatedToolCallCandidate(
			activity({
				toolName: "decompose_project",
				toolInputSummary: "daw",
				toolInputFingerprint: "fp-resolved",
			}) as never,
		);
		expect(first?.fingerprint).not.toBe(second?.fingerprint);
	});

	it("still collides for genuinely identical calls (true loop detection preserved)", () => {
		const first = computeRepeatedToolCallCandidate(
			activity({ toolName: "some_future_tool", toolInputSummary: "x", toolInputFingerprint: "same" }) as never,
		);
		const second = computeRepeatedToolCallCandidate(
			activity({ toolName: "some_future_tool", toolInputSummary: "x", toolInputFingerprint: "same" }) as never,
		);
		expect(first?.fingerprint).toBe(second?.fingerprint);
	});

	it("EXCLUDES read_large_file from the guard — it is a stateful cursor workflow, not a repeat", () => {
		// Regression: read_large_file progresses start → read:<line> → stitch:<l>/<r>; the generic identical-input
		// guard must never pause it (the workflow rejects stale cursors + the autonomy budget bounds true loops).
		expect(
			computeRepeatedToolCallCandidate(
				activity({ toolName: "read_large_file", toolInputSummary: "specification.md" }) as never,
			),
		).toBeNull();
		expect(computeRepeatedToolCallCandidate(activity({ toolName: "READ_LARGE_FILE" }) as never)).toBeNull();
	});

	it("skips non-tool-call activities, missing source, and user-attention tools", () => {
		expect(computeRepeatedToolCallCandidate(null)).toBeNull();
		expect(computeRepeatedToolCallCandidate(activity({ source: "other" }) as never)).toBeNull();
		expect(computeRepeatedToolCallCandidate(activity({ hookEventName: "tool_result" }) as never)).toBeNull();
		expect(computeRepeatedToolCallCandidate(activity({ toolName: "ask_followup_question" }) as never)).toBeNull();
	});
});
