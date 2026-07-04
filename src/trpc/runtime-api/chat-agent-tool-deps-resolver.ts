// Builds the chat-agent tool-dependency resolver for the runtime API (extracted from runtime-api.ts, §5.U).
// This is the §5.M permission-model seam: it maps a chat session's scope to the execution mode + tool set the
// agent gets, wires the local-LLM client/model, and assembles the confirm/audit gate. Kept as a focused module
// so the scope→capability mapping lives in one named place rather than inside the giant createRuntimeApi factory.
import type { ChatAgentModelResponse } from "../../chat/chat-agent-loop";
import {
	type ChatToolSet,
	createBoardMutationTools,
	createBoardReadTools,
	createCardRelayTools,
} from "../../chat/chat-board-tools";
import { createBrowserTools } from "../../chat/chat-browser-tool";
import { createCommandRunTool } from "../../chat/chat-command-tool";
import type { ChatExecutionMode } from "../../chat/chat-execution-mode";
import { createFocusChainTools, readChatFocusChain } from "../../chat/chat-focus-chain";
import { recordChatHostAction } from "../../chat/chat-host-action-audit-store";
import { appendChatToolExchange, createChatAgentModel, createChatModelDeps } from "../../chat/chat-local-llm-adapter";
import { chatScopeCanAct, chatScopeToExecutionMode } from "../../chat/chat-scope-capability";
import type { ChatAgentToolDeps } from "../../chat/chat-service";
import type { ChatSession } from "../../chat/chat-session-store";
import { resolveChatToolConfirmation } from "../../chat/chat-tool-confirmation";
import { createGatedChatToolExecutor } from "../../chat/chat-tool-executor";
import type { ChatPromptMessage } from "../../chat/chat-turn-context";
import { createWebSearchTools } from "../../chat/chat-web-search-tool";
import { createWorkspaceReadTools } from "../../chat/chat-workspace-tools";
import {
	DEFAULT_LOCAL_CHAT_BASE_URL,
	DEFAULT_LOCAL_CHAT_PROVIDER_ID,
	discoverLoadedModelId,
} from "../../chat/local-chat-model";
import { resolveSelectedSkillsApiProfile } from "../../core/chat-session-skill-profile";
import { LocalLlmClient } from "../../nklein-agent/nklein-local-llm-client";
import { createSearxngWebSearchClient } from "../../server/web-search-searxng";
import { appendCardMailboxNote, countPendingCardMailbox } from "../../state/card-mailbox-store";
import { loadWorkspaceState } from "../../state/workspace-state";

export function buildChatAgentToolDepsResolver(input: {
	getActiveWorkspacePath: () => string | null;
	getLocalChatBaseUrl: () => string | null;
	/** Forwarded to `createBrowserTools` for §5.Y #5 SSRF protection. */
	isRemoteMode: boolean;
	/** §5.AU relay deps: the ACTIVE workspace's live task-session view (null ⇒ no live delivery; mailbox still works).
	 *  Injected so this resolver stays decoupled from the task-session service's construction. */
	getActiveTaskSessions?: () => {
		listActiveTaskIds: () => ReadonlySet<string>;
		sendInput: (taskId: string, text: string) => Promise<boolean>;
	} | null;
	/** §5.AU mailbox writer (defaults live inside the tool wiring; injected for tests). */
	queueCardMailboxNote?: (taskId: string, text: string) => Promise<number>;
	/** §5.L: current capability-broker opt-in (read per-turn so a config flip takes effect next turn). Absent ⇒ off. */
	getCapabilityBrokerEnabled?: () => Promise<boolean>;
	/**
	 * §5.AC/decision-2: the retrieval egress config (read per-turn). The chat `web_search` tool is offered ONLY when
	 * the session opted into internet tools (`browserEnabled`) AND egress is on AND a SearXNG backend is configured —
	 * OFF by default. Absent ⇒ egress off / no backend ⇒ web_search is never offered.
	 */
	getRetrievalConfig?: () => Promise<{ egressEnabled: boolean; searchBackendUrl: string | null }>;
}): (session: ChatSession, extra?: ChatToolSet) => Promise<ChatAgentToolDeps | null> {
	return async (session, extra) => {
		const workspacePath = input.getActiveWorkspacePath();
		if (!workspacePath) {
			return null;
		}
		const baseUrl = input.getLocalChatBaseUrl()?.trim() || DEFAULT_LOCAL_CHAT_BASE_URL;
		const modelId = await discoverLoadedModelId(baseUrl);
		if (!modelId) {
			// No loaded model: stay on the plain path (which resolves its own deps and surfaces a clear error).
			return null;
		}
		// LocalLlmClient fails closed against cloud (invariant #1) in its constructor.
		const client = new LocalLlmClient({ providerId: DEFAULT_LOCAL_CHAT_PROVIDER_ID, modelId, baseUrl });
		// Scope-driven capability (§5.M permission model). The session scope is the control: "chat only" is the
		// read-only floor; current/all-projects/host can act. Map scope → the execution mode the gate enforces.
		// read_file/list_dir/get_board/update_focus_chain are always offered (sandbox_read = always allowed);
		// create_card (control_plane) + run_command (host_command) are offered only to can-act scopes. run_command is
		// confirm-gated: the `confirm` callback below auto-approves commands the allowlist classifier deems SAFE and
		// denies UNSAFE ones (until the general risk-acknowledgement toggle lands — todo §5.M G3b).
		const mode: ChatExecutionMode = chatScopeToExecutionMode(session.scope);
		const canAct = chatScopeCanAct(session.scope);
		const read = createWorkspaceReadTools(workspacePath);
		const board = createBoardReadTools(workspacePath);
		const focus = createFocusChainTools(session.id);
		const mutations = canAct ? createBoardMutationTools(workspacePath) : { tools: [], definitions: [] };
		// §5.AU relay: `send_to_card` for can-act scopes (control_plane, like create_card). Live delivery needs the
		// active task-session view; without it (or with no live session) messages fall back to the durable mailbox.
		const taskSessions = input.getActiveTaskSessions?.() ?? null;
		const relay = canAct
			? createCardRelayTools(workspacePath, {
					loadBoard: async (projectPath) => (await loadWorkspaceState(projectPath)).board,
					listActiveSessionTaskIds: () => taskSessions?.listActiveTaskIds() ?? new Set<string>(),
					deliverLive: (taskId, text) => taskSessions?.sendInput(taskId, text) ?? Promise.resolve(false),
					queueMailbox:
						input.queueCardMailboxNote ??
						(async (taskId, text) => {
							await appendCardMailboxNote({ taskId, text, source: "chat" });
							return countPendingCardMailbox(taskId);
						}),
				})
			: { tools: [], definitions: [] };
		const commands = canAct ? createCommandRunTool(workspacePath) : { tools: [], definitions: [] };
		// §5.M G6: the headless-browser tool is an orthogonal, per-session opt-in (`browserEnabled`). It's a host_command
		// (reaching the internet is a host action), so the mode gate denies it in chat-only and confirms it in the
		// host-capable scopes — the toggle is that confirmation (approved in the `confirm` callback below).
		// §5.Y #5: pass isRemoteMode so the tool blocks SSRF-risk internal addresses in remote (--host) mode.
		const browser = session.browserEnabled
			? createBrowserTools({ isRemoteMode: input.isRemoteMode })
			: { tools: [], definitions: [] };
		// decision-2: the chat `web_search` tool, reusing the swarm's fail-closed SearXNG client. OFF by default — offered
		// only when the session opted into internet tools AND egress is on AND a backend URL is configured. egress_read,
		// so it's egress-gated + confirm-gated (the same `confirm` toggle as browse) but never a taint sink.
		const retrieval = (await input.getRetrievalConfig?.()) ?? { egressEnabled: false, searchBackendUrl: null };
		const webSearch =
			session.browserEnabled && retrieval.egressEnabled && retrieval.searchBackendUrl
				? createWebSearchTools({
						search: (query) =>
							createSearxngWebSearchClient({
								backendBaseUrl: retrieval.searchBackendUrl,
								egressEnabled: retrieval.egressEnabled,
							}).search(query),
					})
				: { tools: [], definitions: [] };
		const tools = [
			...read.tools,
			...board.tools,
			...focus.tools,
			...mutations.tools,
			...relay.tools,
			...commands.tools,
			...browser.tools,
			...webSearch.tools,
			// Autonomous mode (todo §5.0.1) merges in the per-turn control tools (request_user_input /
			// declare_goal_complete); interactive chat passes no extras.
			...(extra?.tools ?? []),
		];
		const definitions = [
			...read.definitions,
			...board.definitions,
			...focus.definitions,
			...mutations.definitions,
			...relay.definitions,
			...commands.definitions,
			...browser.definitions,
			...webSearch.definitions,
			...(extra?.definitions ?? []),
		];

		const capabilityBrokerEnabled = (await input.getCapabilityBrokerEnabled?.()) ?? false;
		const executeTool = createGatedChatToolExecutor({
			sessionId: session.id,
			mode,
			// §5.L: opt-in capability broker — when on, a protected-sink tool call made after untrusted content entered the
			// turn is refused fail-closed (prompt-injection defense). Default off ⇒ byte-identical (the executor skips it).
			capabilityBrokerEnabled,
			tools,
			// §5.AA: thread the tools' JSON-Schema definitions so the executor can coerce a weak model's malformed
			// arguments (e.g. a stringified number) against the matching schema before dispatch — and refuse a
			// genuinely-broken call instead of feeding it raw. A tool without a strict schema degrades to pass-through.
			definitions,
			// §5.M G3b safe/unsafe risk model: run_command is a confirm-gated host_command in can-act modes. A command
			// the allowlist classifier rules SAFE (build/test/inspection) auto-approves; an UNSAFE one runs only when
			// the user has acknowledged the risk for this session (`riskAcknowledged`, the general-ack toggle) —
			// otherwise it's denied. Other confirm-gated actions stay denied for now (no web-ui confirm dialog yet).
			confirm: async (call) =>
				resolveChatToolConfirmation({
					name: call.name,
					command: call.arguments.command,
					riskAcknowledged: session.riskAcknowledged,
					browserEnabled: session.browserEnabled,
				}),
			recordAudit: async (record) => {
				await recordChatHostAction({ ...record });
			},
		});

		// §5.AE: fold the user-selected skills' merged apiProfile into the model call (David decision 2026-07-04 —
		// chat-session skills are user-selected). Empty selection ⇒ `{}` ⇒ byte-identical current behavior.
		const skillApiProfile = resolveSelectedSkillsApiProfile(session.selectedSkillIds);
		const toolModel = createChatAgentModel(client, definitions, { modelId, apiProfile: skillApiProfile });
		// Streaming final-answer dep: the tools-disabled final reply streams via the plain SSE completion (no tools);
		// tool-discovery turns use the non-streaming tools-aware completion so the model can still request tools.
		const streamComplete = createChatModelDeps(client).complete;
		const model = async (
			messages: readonly ChatPromptMessage[],
			allowTools: boolean,
			onToken?: (delta: string) => void,
		): Promise<ChatAgentModelResponse> => {
			if (onToken) {
				const text = await streamComplete([...messages], onToken);
				return { text, toolCalls: [] };
			}
			return toolModel(messages, allowTools);
		};

		return {
			model,
			executeTool,
			appendToolExchange: appendChatToolExchange,
			readFocusChain: (sessionId: string) => readChatFocusChain(sessionId),
		};
	};
}
