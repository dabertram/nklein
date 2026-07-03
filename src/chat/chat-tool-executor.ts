import {
	assessToolArgumentRepair,
	dispatchArgumentsAfterRepair,
	isDispatchableAfterRepair,
} from "../core/tool-argument-repair";
import { decideManifestChatAccess, manifestForChatAction } from "../core/tool-capability-manifest";
import type { LocalLlmToolDefinition } from "../nklein-agent/nklein-local-llm-client";
import type { ChatToolCall, ChatToolResult } from "./chat-agent-loop";
import { buildAuditDetail } from "./chat-audit-detail";
import type { ChatActionKind, ChatExecutionMode } from "./chat-execution-mode";

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
	/**
	 * §5.AA tool-argument repair (OPT-IN): the offered tools' JSON-Schema definitions, keyed by `name`. When supplied,
	 * each call's `arguments` are assessed against the matching schema BEFORE the tool runs — a losslessly-coercible
	 * value (a stringified number/boolean, a JSON-encoded object) is repaired in place, and a genuinely-malformed call
	 * (an un-coercible/missing REQUIRED field against a strict schema) is refused with a re-ask list instead of being
	 * fed raw to the tool. ABSENT (or no matching definition, or a permissive schema) ⇒ byte-identical pass-through of
	 * the original `call.arguments`, exactly as before this seam existed.
	 */
	definitions?: readonly LocalLlmToolDefinition[];
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

		// §5.AA tool-argument repair (opt-in). Only when the caller supplied definitions AND this tool has a matching
		// one do we assess: a permissive/absent schema yields `usable` (→ original args, byte-identical), a losslessly-
		// coercible defect yields `repairable` (→ coerced args), and a genuinely-malformed strict call is refused
		// before it can reach `tool.run`. With no definition for this tool we fall through to today's pass-through so a
		// tool without a declared schema behaves exactly as before.
		const definition = input.definitions?.find((candidate) => candidate.name === call.name);
		let args: Record<string, unknown> = call.arguments;
		if (definition) {
			const assessment = assessToolArgumentRepair({ name: call.name, arguments: call.arguments }, definition);
			if (isDispatchableAfterRepair(assessment)) {
				// `usable` → the original args; `repairable` → the coerced object.
				args =
					dispatchArgumentsAfterRepair({ name: call.name, arguments: call.arguments }, assessment) ??
					call.arguments;
			} else {
				// `reprompt`/`reject`: don't run — surface the fields to re-ask (mirrors the error-return shape). This
				// path is only reachable for args that would otherwise throw/misbehave against a strict schema.
				const fields = assessment.fieldsToReask;
				const detail = fields.length > 0 ? `re-ask required field(s): ${fields.join(", ")}` : assessment.reason;
				return { callId: call.id, content: `Invalid arguments for ${call.name}: ${detail}` };
			}
		}

		const access = decideManifestChatAccess(manifestForChatAction(tool.actionKind), input.mode);

		let confirmed = false;
		let executed = false;
		let content: string;
		if (access.decision === "deny") {
			content = `Denied: ${access.reason}`;
		} else if (access.decision === "confirm") {
			confirmed = input.confirm ? await input.confirm(call, tool) : false;
			if (confirmed) {
				content = await tool.run(args);
				executed = true;
			} else {
				content = `Not run (awaiting confirmation): ${access.reason}`;
			}
		} else {
			content = await tool.run(args);
			executed = true;
		}

		await input.recordAudit?.({
			sessionId: input.sessionId,
			mode: input.mode,
			action: tool.actionKind,
			decision: access.decision,
			confirmed,
			executed,
			detail: buildAuditDetail(tool.name, args),
		});

		return { callId: call.id, content };
	};
}
