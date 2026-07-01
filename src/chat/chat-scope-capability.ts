import type { ChatExecutionMode } from "./chat-execution-mode";
import type { ChatSessionScope } from "./chat-session-store";

/**
 * §5.M permission floor (extracted from the chat-agent tool-deps resolver so the scope→capability mapping is pinned by a
 * unit test, not buried in an I/O closure): a chat session's SCOPE is the control that decides the execution mode the
 * tool gate enforces. `chat_only` is the read-only floor (Docker-isolated, no writes/host); `host_access` runs on the
 * host; the project scopes run sandboxed with a per-action host escape.
 */
export function chatScopeToExecutionMode(scope: ChatSessionScope): ChatExecutionMode {
	if (scope === "chat_only") {
		return "isolated_readonly";
	}
	if (scope === "host_access") {
		return "host";
	}
	return "sandbox_with_host_escape"; // project_sandboxed | all_projects
}

/** Whether a scope may ACT (board mutations / run_command / browser) — every scope EXCEPT the read-only `chat_only` floor. */
export function chatScopeCanAct(scope: ChatSessionScope): boolean {
	return scope !== "chat_only";
}
