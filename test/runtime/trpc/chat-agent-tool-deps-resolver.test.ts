import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatToolCall } from "../../../src/chat/chat-agent-loop";
import type { ChatToolSet } from "../../../src/chat/chat-board-tools";
import type { ChatSession } from "../../../src/chat/chat-session-store";
import { buildChatAgentToolDepsResolver } from "../../../src/trpc/runtime-api/chat-agent-tool-deps-resolver";

vi.mock("../../../src/chat/local-chat-model", () => ({
	DEFAULT_LOCAL_CHAT_BASE_URL: "http://127.0.0.1:1234/v1",
	DEFAULT_LOCAL_CHAT_PROVIDER_ID: "lmstudio",
	discoverLoadedModelId: vi.fn(async () => "test-model"),
}));

vi.mock("../../../src/chat/chat-host-action-audit-store", () => ({
	recordChatHostAction: vi.fn(async () => undefined),
}));

vi.mock("../../../src/telemetry/model-behavior-profile-store", () => ({
	readModelBehaviorProfile: vi.fn(async () => null),
	persistModelBehaviorOutcome: vi.fn(async () => undefined),
}));

function makeSession(scope: ChatSession["scope"]): ChatSession {
	return {
		schemaVersion: 1,
		id: `session-${scope}`,
		title: "Test chat",
		scope,
		role: "planner_architect",
		goal: null,
		riskAcknowledged: false,
		browserEnabled: false,
		feedbackMuted: false,
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
}) {
	return buildChatAgentToolDepsResolver({
		getActiveWorkspacePath: () => input.workspacePath,
		getLocalChatBaseUrl: () => "http://127.0.0.1:1234/v1",
		isRemoteMode: false,
		...(input.getSandboxWorkspaceReadTools
			? { getSandboxWorkspaceReadTools: input.getSandboxWorkspaceReadTools }
			: {}),
	});
}

describe("buildChatAgentToolDepsResolver — isolated read-only tool backing", () => {
	let tmpDir: string | null = null;

	afterEach(() => {
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

	it("keeps the existing host-backed workspace reads for host-capable project scopes", async () => {
		const resolver = makeResolver({ workspacePath: workspaceWithReadme() });
		const deps = await resolver(makeSession("project_sandboxed"));

		const result = await deps?.executeTool(call("read_file", { path: "README.md" }));

		expect(result?.content).toBe("# Host README");
	});
});
