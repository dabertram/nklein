import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatToolCall } from "../../../src/chat/chat-agent-loop";
import type { ChatToolSet } from "../../../src/chat/chat-board-tools";
import { recordChatEgressAttempt } from "../../../src/chat/chat-egress-attempt-audit-store";
import type { ChatActionKind } from "../../../src/chat/chat-execution-mode";
import type { ChatSession } from "../../../src/chat/chat-session-store";
import { type RunPhase, runPhasePolicy } from "../../../src/core/run-state-machine";
import { buildChatAgentToolDepsResolver } from "../../../src/trpc/runtime-api/chat-agent-tool-deps-resolver";

vi.mock("../../../src/chat/local-chat-model", () => ({
	DEFAULT_LOCAL_CHAT_BASE_URL: "http://127.0.0.1:1234/v1",
	DEFAULT_LOCAL_CHAT_PROVIDER_ID: "lmstudio",
	discoverLoadedModelId: vi.fn(async () => "test-model"),
}));

vi.mock("../../../src/chat/chat-host-action-audit-store", () => ({
	recordChatHostAction: vi.fn(async () => undefined),
}));

vi.mock("../../../src/chat/chat-egress-attempt-audit-store", () => ({
	recordChatEgressAttempt: vi.fn(async () => undefined),
}));

vi.mock("../../../src/telemetry/model-behavior-profile-store", () => ({
	readCombinedModelBehaviorProfile: vi.fn(async () => null),
	persistModelBehaviorOutcome: vi.fn(async () => undefined),
}));

// klein_self resolves its workspace from the !Klein source repo (not getActiveWorkspacePath); point it at a tmp repo.
const mockKleinRepo = vi.hoisted(() => ({ path: null as string | null }));
vi.mock("../../../src/trpc/projects-api-helpers", () => ({
	resolveKleinSourceRepoPath: vi.fn(async () => mockKleinRepo.path),
}));

function makeSession(scope: ChatSession["scope"], sandboxWritablePaths: readonly string[] = []): ChatSession {
	return {
		schemaVersion: 1,
		id: `session-${scope}`,
		title: "Test chat",
		scope,
		role: "planner_architect",
		goal: null,
		riskAcknowledged: false,
		browserEnabled: false,
		sandboxWritablePaths,
		feedbackMuted: false,
		feedbackVerbosity: "normal",
		feedbackQuiet: false,
		ownedWorkspaceId: null,
		focus: null,
		outstandingAsks: [],
		selectedSkillIds: [],
		totalTokensUsed: 0,
		createdAt: 1,
		updatedAt: 1,
	};
}

function call(name: string, args: Record<string, unknown> = {}): ChatToolCall {
	return { id: "call-1", name, arguments: args };
}

function makeResolver(input: {
	workspacePath: string;
	getSandboxWorkspaceReadTools?: (session: ChatSession, workspacePath: string) => Promise<ChatToolSet | null>;
	getSandboxWorkspaceWriteTools?: (session: ChatSession, workspacePath: string) => Promise<ChatToolSet | null>;
	resolveRunPhase?: (session: ChatSession) => RunPhase | null;
}) {
	return buildChatAgentToolDepsResolver({
		getActiveWorkspacePath: () => input.workspacePath,
		getLocalChatBaseUrl: () => "http://127.0.0.1:1234/v1",
		isRemoteMode: false,
		...(input.getSandboxWorkspaceReadTools
			? { getSandboxWorkspaceReadTools: input.getSandboxWorkspaceReadTools }
			: {}),
		...(input.getSandboxWorkspaceWriteTools
			? { getSandboxWorkspaceWriteTools: input.getSandboxWorkspaceWriteTools }
			: {}),
		...(input.resolveRunPhase ? { resolveRunPhase: input.resolveRunPhase } : {}),
	});
}

function toolSet(
	entries: readonly { name: string; actionKind: ChatActionKind; run?: () => Promise<string> }[],
): ChatToolSet {
	return {
		tools: entries.map((entry) => ({
			name: entry.name,
			actionKind: entry.actionKind,
			run: entry.run ?? (async () => `${entry.name} ran`),
		})),
		definitions: entries.map((entry) => ({
			name: entry.name,
			description: `${entry.name} test tool`,
			parameters: { type: "object", properties: {} },
		})),
	};
}

describe("buildChatAgentToolDepsResolver — isolated read-only tool backing", () => {
	let tmpDir: string | null = null;

	afterEach(() => {
		vi.clearAllMocks();
		mockKleinRepo.path = null;
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
			tmpDir = null;
		}
	});

	function workspaceWithReadme(): string {
		tmpDir = mkdtempSync(join(tmpdir(), "nklein-chat-tools-"));
		writeFileSync(join(tmpDir, "README.md"), "# Host README");
		return tmpDir;
	}

	it("fails closed in chat_only when no sandbox read-tool provider is injected", async () => {
		const resolver = makeResolver({ workspacePath: workspaceWithReadme() });
		const deps = await resolver(makeSession("chat_only"));

		const result = await deps?.executeTool(call("read_file", { path: "README.md" }));

		expect(result?.content).toBe("Unknown tool: read_file");
	});

	it("uses the injected sandbox read-tool provider for chat_only", async () => {
		const sandboxReadTools: ChatToolSet = {
			tools: [
				{
					name: "read_file",
					actionKind: "sandbox_read",
					run: async () => "sandbox README",
				},
			],
			definitions: [],
		};
		const provider = vi.fn(async () => sandboxReadTools);
		const resolver = makeResolver({ workspacePath: workspaceWithReadme(), getSandboxWorkspaceReadTools: provider });
		const session = makeSession("chat_only");
		const deps = await resolver(session);

		const result = await deps?.executeTool(call("read_file", { path: "README.md" }));

		expect(provider).toHaveBeenCalledWith(session, tmpDir);
		expect(result?.content).toBe("sandbox README");
	});

	it("uses the injected sandbox write-tool provider for approved chat_only writable paths", async () => {
		const sandboxWriteTools: ChatToolSet = {
			tools: [
				{
					name: "write_file",
					actionKind: "sandbox_write",
					run: async () => "sandbox write",
				},
			],
			definitions: [],
		};
		const provider = vi.fn(async () => sandboxWriteTools);
		const resolver = makeResolver({
			workspacePath: workspaceWithReadme(),
			getSandboxWorkspaceWriteTools: provider,
		});
		const session = makeSession("chat_only", ["src"]);
		const deps = await resolver(session);

		const result = await deps?.executeTool(call("write_file", { path: "src/app.ts", content: "hello" }));

		expect(provider).toHaveBeenCalledWith(session, tmpDir);
		expect(result?.content).toBe("sandbox write");
	});

	it("refuses sandbox writes outside the approved path before the write tool runs", async () => {
		const run = vi.fn(async () => "should not run");
		const sandboxWriteTools: ChatToolSet = {
			tools: [
				{
					name: "write_file",
					actionKind: "sandbox_write",
					run,
				},
			],
			definitions: [],
		};
		const resolver = makeResolver({
			workspacePath: workspaceWithReadme(),
			getSandboxWorkspaceWriteTools: vi.fn(async () => sandboxWriteTools),
		});
		const deps = await resolver(makeSession("chat_only", ["src"]));

		const result = await deps?.executeTool(call("write_file", { path: "README.md", content: "hello" }));

		expect(result?.content).toContain("Not run (awaiting confirmation)");
		expect(run).not.toHaveBeenCalled();
	});

	it("does not offer sandbox write tools when the session has no approved writable paths", async () => {
		const provider = vi.fn(async (): Promise<ChatToolSet> => ({ tools: [], definitions: [] }));
		const resolver = makeResolver({
			workspacePath: workspaceWithReadme(),
			getSandboxWorkspaceWriteTools: provider,
		});
		const deps = await resolver(makeSession("chat_only"));

		const result = await deps?.executeTool(call("write_file", { path: "src/app.ts", content: "hello" }));

		expect(provider).not.toHaveBeenCalled();
		expect(result?.content).toBe("Unknown tool: write_file");
	});

	it("offers NO write/mutation/command tool for the read-only klein_self scope (F2.19b)", async () => {
		// klein_self is chatScopeCanAct === false: the resolver roots it in the !Klein source repo but must never
		// offer write_file / create_card / run_command / send_to_card — only the read + board + focus tools.
		mockKleinRepo.path = workspaceWithReadme();
		const readTools = toolSet([{ name: "read_file", actionKind: "sandbox_read" }]);
		const writeTools = toolSet([{ name: "write_file", actionKind: "sandbox_write" }]);
		const resolver = makeResolver({
			workspacePath: "/unused-active-path",
			getSandboxWorkspaceReadTools: vi.fn(async () => readTools),
			getSandboxWorkspaceWriteTools: vi.fn(async () => writeTools),
		});
		// A writable-paths grant must not leak a write tool in an inherently read-only scope.
		const deps = await resolver(makeSession("klein_self", ["src"]));

		expect(deps).not.toBeNull();
		const offered = deps?.offeredToolNames ?? [];
		expect(offered).toContain("read_file");
		for (const writeTool of ["write_file", "create_card", "run_command", "send_to_card"]) {
			expect(offered).not.toContain(writeTool);
		}
		expect((await deps?.executeTool(call("write_file", { path: "src/app.ts", content: "x" })))?.content).toBe(
			"Unknown tool: write_file",
		);
		expect((await deps?.executeTool(call("create_card", { title: "x" })))?.content).toBe("Unknown tool: create_card");
		expect((await deps?.executeTool(call("run_command", { command: "ls" })))?.content).toBe(
			"Unknown tool: run_command",
		);
	});

	it("keeps the existing host-backed workspace reads for host-capable project scopes", async () => {
		const resolver = makeResolver({ workspacePath: workspaceWithReadme() });
		const deps = await resolver(makeSession("project_sandboxed"));

		const result = await deps?.executeTool(call("read_file", { path: "README.md" }));

		expect(result?.content).toBe("# Host README");
	});

	it("wires egress_read tool decisions to the dedicated network-attempt audit sink", async () => {
		const resolver = makeResolver({ workspacePath: workspaceWithReadme() });
		const session = { ...makeSession("chat_only"), browserEnabled: true };
		const deps = await resolver(session);

		const result = await deps?.executeTool(call("browse_url", { url: "https://example.com/docs" }));

		expect(result?.content).toContain("Denied");
		expect(recordChatEgressAttempt).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: session.id,
				mode: "isolated_readonly",
				toolName: "browse_url",
				action: "egress_read",
				decision: "deny",
				confirmed: false,
				executed: false,
				targetKind: "url",
				target: "https://example.com/docs",
			}),
		);
	});

	it("threads run-phase tool subsets, offered names, and phase budget through the resolver", async () => {
		const readTools = toolSet([{ name: "read_file", actionKind: "sandbox_read" }]);
		const writeTools = toolSet([{ name: "write_file", actionKind: "sandbox_write" }]);
		const extraTools = toolSet([
			{ name: "create_phase_card", actionKind: "control_plane" },
			{ name: "host_phase_shell", actionKind: "host_command" },
		]);
		const session = makeSession("chat_only", ["src"]);
		const resolver = makeResolver({
			workspacePath: workspaceWithReadme(),
			getSandboxWorkspaceReadTools: vi.fn(async () => readTools),
			getSandboxWorkspaceWriteTools: vi.fn(async () => writeTools),
			resolveRunPhase: () => "execute_step",
		});

		const deps = await resolver(session, extraTools);

		expect(deps?.offeredToolNames).toEqual([
			"read_file",
			"write_file",
			"get_board",
			"get_board_status",
			"get_streams",
			"update_focus_chain",
		]);
		expect(deps?.maxIterations).toBe(runPhasePolicy("execute_step").maxToolCalls);
		expect((await deps?.executeTool(call("read_file")))?.content).toBe("read_file ran");
		expect((await deps?.executeTool(call("write_file", { path: "src/app.ts" })))?.content).toBe("write_file ran");
		expect((await deps?.executeTool(call("create_phase_card")))?.content).toBe("Unknown tool: create_phase_card");
		expect((await deps?.executeTool(call("host_phase_shell")))?.content).toBe("Unknown tool: host_phase_shell");
	});

	it("returns no offered tools for terminal run phases", async () => {
		const readTools = toolSet([{ name: "read_file", actionKind: "sandbox_read" }]);
		const resolver = makeResolver({
			workspacePath: workspaceWithReadme(),
			getSandboxWorkspaceReadTools: vi.fn(async () => readTools),
			resolveRunPhase: () => "done",
		});

		const deps = await resolver(makeSession("chat_only"));

		expect(deps?.offeredToolNames).toEqual([]);
		expect(deps?.maxIterations).toBe(0);
		expect((await deps?.executeTool(call("read_file")))?.content).toBe("Unknown tool: read_file");
	});
});
