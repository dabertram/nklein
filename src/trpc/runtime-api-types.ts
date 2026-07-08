import type { ChatToolSet } from "../chat/chat-board-tools";
import type { ChatService } from "../chat/chat-service";
import type { ChatSession } from "../chat/chat-session-store";
import type { RuntimeConfigState } from "../config/runtime-config";
import type {
	RuntimeAgentSandboxStatus,
	RuntimeCommandRunResponse,
	RuntimeRunUpdateResponse,
	RuntimeUpdateStatusResponse,
} from "../core/api-contract";
import type { createNKleinMcpRuntimeService } from "../nklein-agent/nklein-mcp-runtime-service";
import type { NKleinTaskSessionService } from "../nklein-agent/nklein-task-session-service";
import type { TerminalSessionManager } from "../terminal/session-manager";
import type { RuntimeTrpcWorkspaceScope } from "./app-router";
import type { RuntimeTaskStartQueue } from "./runtime-task-start-queue";

export interface CreateRuntimeApiDependencies {
	getActiveWorkspaceId: () => string | null;
	/** The active workspace's repo root, or null when no project is active. Drives the chat agent's read-only tools
	 *  (todo §5.M G3a): with an active workspace the chat routes through the tool-using loop; without one it stays
	 *  plain. */
	getActiveWorkspacePath: () => string | null;
	getActiveRuntimeConfig?: () => RuntimeConfigState;
	loadScopedRuntimeConfig: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeConfigState>;
	setActiveRuntimeConfig: (config: RuntimeConfigState) => void;
	getScopedTerminalManager: (scope: RuntimeTrpcWorkspaceScope) => Promise<TerminalSessionManager>;
	getScopedNKleinTaskSessionService: (scope: RuntimeTrpcWorkspaceScope) => Promise<NKleinTaskSessionService>;
	getLoadedScopedNKleinTaskSessionService?: (scope: RuntimeTrpcWorkspaceScope) => NKleinTaskSessionService | null;
	/**
	 * Docker-backed read tools for isolated chat scopes. Optional by design: if absent, isolated read-only sessions
	 * fail closed and receive no workspace filesystem tools rather than falling back to host reads.
	 */
	getSandboxWorkspaceReadTools?: (session: ChatSession, workspacePath: string) => Promise<ChatToolSet | null>;
	resolveInteractiveShellCommand: () => { binary: string; args: string[] };
	runCommand: (command: string, cwd: string) => Promise<RuntimeCommandRunResponse>;
	broadcastNKleinMcpAuthStatusesUpdated?: (
		statuses: Awaited<ReturnType<ReturnType<typeof createNKleinMcpRuntimeService>["getAuthStatuses"]>>,
	) => void;
	broadcastTaskChatCleared?: (workspaceId: string, taskId: string) => void;
	bumpNKleinSessionContextVersion?: () => void;
	prepareForStateReset?: () => Promise<void>;
	taskStartQueue?: RuntimeTaskStartQueue;
	getDogfoodTelemetryRoot?: () => string;
	getEvidenceBundleRoot?: () => string;
	getUpdateStatus: () => RuntimeUpdateStatusResponse;
	runUpdateNow: () => Promise<RuntimeRunUpdateResponse>;
	getAgentSandboxStatus?: () => RuntimeAgentSandboxStatus;
	refreshAgentSandboxStatus?: () => Promise<RuntimeAgentSandboxStatus>;
	/** Board-independent chat service (todo §5.M); defaults to the real runtime home. Injected in tests. */
	chatService?: ChatService;
	/**
	 * True when the runtime is bound to a non-loopback host (remote/`--host` mode).
	 * Both `runCommand` and `openFile` refuse in remote mode because they execute
	 * host-local actions that only make sense on the server host, not on a remote
	 * browser client's machine. Defaults to `false` (local mode) when omitted so
	 * test helpers that do not set it continue to work.
	 */
	isRemoteMode?: boolean;
}
