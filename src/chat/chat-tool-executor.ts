import type { ChatToolCall, ChatToolResult } from "./chat-agent-loop";
import { type ChatActionKind, type ChatExecutionMode, decideChatActionAccess } from "./chat-execution-mode";

/**
 * Gated chat tool executor (todo §5.M) — the governance wrapper the agent loop's `executeTool` uses. For each
 * tool call it applies the execution-mode policy gate ([chat-execution-mode.ts](./chat-execution-mode.ts)):
 * `allow` runs the tool, `confirm` runs it only after an explicit (typed) confirmation, `deny` refuses — and it
 * records **every** call to the audit log ([chat-host-action-audit-store.ts](./chat-host-action-audit-store.ts))
 * whether or not it executed (the §5.M invariant: host access never default, always confirmed + logged). The
 * tools' side effects, the confirmation prompt, and the audit sink are injected, so this is fully unit-testable;
 * the autonomous swarm never reaches any of this.
 */

export interface ChatTool {
	name: string;
	/** The action kind this tool performs, used by the execution-mode gate. */
	actionKind: ChatActionKind;
	run: (args: Record<string, unknown>) => Promise<string>;
}

export interface ChatToolAuditRecord {
	sessionId: string;
	mode: ChatExecutionMode;
	action: ChatActionKind;
	decision: "allow" | "confirm" | "deny";
	confirmed: boolean;
	executed: boolean;
	detail: string | null;
}

export interface GatedChatToolExecutorInput {
	sessionId: string;
	mode: ChatExecutionMode;
	tools: readonly ChatTool[];
	/** Prompt for a `confirm`-gated call; returns whether the user approved. Absent ⇒ treated as not confirmed. */
	confirm?: (call: ChatToolCall, tool: ChatTool) => Promise<boolean>;
	/** Sink for the audit log (the live wiring passes `recordChatHostAction`). */
	recordAudit?: (record: ChatToolAuditRecord) => Promise<void>;
}

export function createGatedChatToolExecutor(
	input: GatedChatToolExecutorInput,
): (call: ChatToolCall) => Promise<ChatToolResult> {
	return async (call) => {
		const tool = input.tools.find((candidate) => candidate.name === call.name);
		if (!tool) {
			return { callId: call.id, content: `Unknown tool: ${call.name}` };
		}
		const access = decideChatActionAccess(input.mode, tool.actionKind);

		let confirmed = false;
		let executed = false;
		let content: string;
		if (access.decision === "deny") {
			content = `Denied: ${access.reason}`;
		} else if (access.decision === "confirm") {
			confirmed = input.confirm ? await input.confirm(call, tool) : false;
			if (confirmed) {
				content = await tool.run(call.arguments);
				executed = true;
			} else {
				content = `Not run (awaiting confirmation): ${access.reason}`;
			}
		} else {
			content = await tool.run(call.arguments);
			executed = true;
		}

		await input.recordAudit?.({
			sessionId: input.sessionId,
			mode: input.mode,
			action: tool.actionKind,
			decision: access.decision,
			confirmed,
			executed,
			detail: tool.name,
		});

		return { callId: call.id, content };
	};
}
