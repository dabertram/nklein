// Builds the chat-agent tool-dependency resolver for the runtime API (extracted from runtime-api.ts, §5.U).
// This is the §5.M permission-model seam: it maps a chat session's scope to the execution mode + tool set the
// agent gets, wires the local-LLM client/model, and assembles the confirm/audit gate. Kept as a focused module
// so the scope→capability mapping lives in one named place rather than inside the giant createRuntimeApi factory.
import type { ChatAgentModelResponse } from "../../chat/chat-agent-loop";
import { type ChatToolSet, createBoardMutationTools, createBoardReadTools } from "../../chat/chat-board-tools";
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
import { createWorkspaceReadTools } from "../../chat/chat-workspace-tools";
import {
	DEFAULT_LOCAL_CHAT_BASE_URL,
	DEFAULT_LOCAL_CHAT_PROVIDER_ID,
	discoverLoadedModelId,
} from "../../chat/local-chat-model";
import { LocalLlmClient } from "../../nklein-agent/nklein-local-llm-client";

export function buildChatAgentToolDepsResolver(input: {
	getActiveWorkspacePath: () => string | null;
	getLocalChatBaseUrl: () => string | null;
	/** Forwarded to `createBrowserTools` for §5.Y #5 SSRF protection. */
	isRemoteMode: boolean;
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
		const commands = canAct ? createCommandRunTool(workspacePath) : { tools: [], definitions: [] };
		// §5.M G6: the headless-browser tool is an orthogonal, per-session opt-in (`browserEnabled`). It's a host_command
		// (reaching the internet is a host action), so the mode gate denies it in chat-only and confirms it in the
		// host-capable scopes — the toggle is that confirmation (approved in the `confirm` callback below).
		// §5.Y #5: pass isRemoteMode so the tool blocks SSRF-risk internal addresses in remote (--host) mode.
		const browser = session.browserEnabled
			? createBrowserTools({ isRemoteMode: input.isRemoteMode })
			: { tools: [], definitions: [] };
		const tools = [
			...read.tools,
			...board.tools,
			...focus.tools,
			...mutations.tools,
			...commands.tools,
			...browser.tools,
			// Autonomous mode (todo §5.0.1) merges in the per-turn control tools (request_user_input /
			// declare_goal_complete); interactive chat passes no extras.
			...(extra?.tools ?? []),
		];
		const definitions = [
			...read.definitions,
			...board.definitions,
			...focus.definitions,
			...mutations.definitions,
			...commands.definitions,
			...browser.definitions,
			...(extra?.definitions ?? []),
		];

		const executeTool = createGatedChatToolExecutor({
			sessionId: session.id,
			mode,
			tools,
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

		const toolModel = createChatAgentModel(client, definitions, { modelId });
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
