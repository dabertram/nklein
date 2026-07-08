import { decideCapabilityBrokerGate } from "../core/capability-broker-gate";
import { propagateTaint, type TaintLabel } from "../core/taint-labels";
import {
	assessToolArgumentRepair,
	dispatchArgumentsAfterRepair,
	isDispatchableAfterRepair,
} from "../core/tool-argument-repair";
import { decideManifestChatAccess, manifestForChatAction } from "../core/tool-capability-manifest";
import type { LocalLlmToolDefinition } from "../nklein-agent/nklein-local-llm-client";
import type { ChatToolCall, ChatToolResult } from "./chat-agent-loop";
import { buildAuditDetail } from "./chat-audit-detail";
import type { ChatEgressAttemptAuditRecord, ChatEgressAttemptTargetKind } from "./chat-egress-attempt-audit-store";
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
	/**
	 * §5.L: the taint labels this tool's OUTPUT carries into the turn's context (e.g. `["web"]` for a page fetch,
	 * `["mcp"]` for an MCP server result). Absent ⇒ the output is trusted (no external taint). Folded into the executor's
	 * running taint window (opt-in) so a later protected-sink call in the same turn can be broker-gated. A static
	 * source-kind label for now; content-derived labels (`secret_like`) are a later slice.
	 */
	taint?: readonly TaintLabel[];
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
	/** Sink for the dedicated network-attempt audit log; called for every `egress_read` tool decision. */
	recordEgressAttempt?: (record: ChatEgressAttemptAuditRecord) => Promise<void>;
	/**
	 * §5.L capability broker (OPT-IN, default off ⇒ byte-identical). When true, BEFORE the execution-mode gate the
	 * executor refuses a tool call whose manifest touches a PROTECTED influence sink (host write / egress / elevated
	 * approval) if the turn already ingested untrusted content (accumulated from prior tool outputs' {@link ChatTool.taint})
	 * and no trusted plan backs it — the fail-closed prompt-injection defense. A tool touching no protected sink is never
	 * blocked, and with the flag off none of this runs.
	 */
	capabilityBrokerEnabled?: boolean;
}

export function createGatedChatToolExecutor(
	input: GatedChatToolExecutorInput,
): (call: ChatToolCall) => Promise<ChatToolResult> {
	// §5.L per-executor taint window: the accumulated labels of prior tool outputs this executor has run. The resolver
	// builds one executor per turn, so this is the turn's trust window — a tainted page read then a protected-sink call
	// within the SAME turn is caught. Accumulate-only (never launders); empty + inert unless capabilityBrokerEnabled.
	let accumulatedTaint: readonly TaintLabel[] = [];
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

		const manifest = manifestForChatAction(tool.actionKind);

		// §5.L capability broker (opt-in, fail-closed): BEFORE the execution-mode gate, refuse a tool call whose manifest
		// touches a PROTECTED influence sink when the turn's accumulated taint is untrusted and no trusted plan backs it.
		// baseline === requested at this seam (there is no per-call requested manifest), so the broker's escalation +
		// egress gates are structural no-ops — the live rule is the taint-influence one. A tool touching no protected sink
		// yields no sinks to check and is never blocked here.
		if (input.capabilityBrokerEnabled) {
			const gate = decideCapabilityBrokerGate({ manifest, taintLabels: accumulatedTaint });
			if (!gate.allow) {
				const detail = buildAuditDetail(tool.name, args);
				await input.recordAudit?.({
					sessionId: input.sessionId,
					mode: input.mode,
					action: tool.actionKind,
					decision: "deny",
					confirmed: false,
					executed: false,
					detail,
				});
				await recordEgressAttempt(input, tool, args, "deny", false, false, detail);
				return { callId: call.id, content: `Denied by capability broker: ${gate.reason}` };
			}
		}

		const access = decideManifestChatAccess(manifest, input.mode);

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

		const detail = buildAuditDetail(tool.name, args);
		await input.recordAudit?.({
			sessionId: input.sessionId,
			mode: input.mode,
			action: tool.actionKind,
			decision: access.decision,
			confirmed,
			executed,
			detail,
		});
		await recordEgressAttempt(input, tool, args, access.decision, confirmed, executed, detail);

		// §5.L: fold this call's output taint into the running window (opt-in) so a LATER protected-sink call in the same
		// turn is gated against it. Accumulate-only; a tool that ran with no taint label leaves the window unchanged.
		if (input.capabilityBrokerEnabled && executed && tool.taint && tool.taint.length > 0) {
			accumulatedTaint = propagateTaint(accumulatedTaint, tool.taint);
		}

		return { callId: call.id, content };
	};
}

function egressTargetForTool(
	toolName: string,
	args: Record<string, unknown>,
): { targetKind: ChatEgressAttemptTargetKind; target: string | null } {
	if (toolName === "browse_url") {
		const url = typeof args.url === "string" ? args.url.trim() : "";
		return url ? { targetKind: "url", target: url } : { targetKind: "unknown", target: null };
	}
	if (toolName === "web_search") {
		const query = typeof args.query === "string" ? args.query.trim() : "";
		return query ? { targetKind: "search_query", target: query } : { targetKind: "unknown", target: null };
	}
	return { targetKind: "unknown", target: null };
}

async function recordEgressAttempt(
	input: GatedChatToolExecutorInput,
	tool: ChatTool,
	args: Record<string, unknown>,
	decision: "allow" | "confirm" | "deny",
	confirmed: boolean,
	executed: boolean,
	detail: string | null,
): Promise<void> {
	if (tool.actionKind !== "egress_read") {
		return;
	}
	const target = egressTargetForTool(tool.name, args);
	await input.recordEgressAttempt?.({
		sessionId: input.sessionId,
		mode: input.mode,
		toolName: tool.name,
		action: "egress_read",
		decision,
		confirmed,
		executed,
		...target,
		detail,
	});
}
