import { createHash } from "node:crypto";
import type { ToolExecutors } from "@cline/sdk";
import {
	type ActionFanoutLimits,
	type ActionFanoutState,
	checkActionFanout,
	emptyActionFanoutState,
	hasAnyFanoutLimit,
	recordAction,
} from "../core/action-fanout-cap";
import { decideCapabilityBrokerGate } from "../core/capability-broker-gate";
import { decideEgressProvenance, extractHostsFromContent } from "../core/egress-provenance-gate";
import { decideOutwardActionApproval } from "../core/outward-action-approval";
import { redactArgsSummary } from "../core/outward-action-queue";
import {
	mcpToolNamesInclude,
	type SwarmToolOutputTaintOptions,
	swarmToolManifest,
	swarmToolOutputTaint,
} from "../core/swarm-tool-capability";
import { isTainted, propagateTaint, type TaintLabel } from "../core/taint-labels";
import {
	explainTaintProvenance,
	recordTaintProvenance,
	type TaintProvenanceEntry,
	taintProvenanceEntry,
} from "../core/taint-provenance";
import { fenceUntrustedContent } from "../core/untrusted-content-boundary";
import { enqueueOutwardAction } from "../state/outward-action-queue-store";
import type { AgentTool, AgentToolContext } from "./sdk-agent-types";

export interface SwarmToolBrokerState {
	taintLabels: readonly TaintLabel[];
	/**
	 * S5: the PROVENANCE ledger riding alongside {@link taintLabels} — which concrete source (tool name) introduced
	 * each taint label. The labels decide allow/deny; this names the culprit source when a gate fires and feeds S8/S11.
	 */
	provenance: readonly TaintProvenanceEntry[];
	/**
	 * S8: the distinct hosts that appeared in UNTRUSTED (web / MCP) tool output this turn — i.e. hosts "introduced by"
	 * untrusted content. An egress to one of these while sensitive data is in context is refused as an exfiltration risk.
	 */
	untrustedHosts: readonly string[];
	/** S9: accumulated OUTWARD-action counts (per outward tool) for the anti-fan-out cap. */
	fanout: ActionFanoutState;
	/** S9: the configured fan-out ceilings (opt-in; empty ⇒ no cap — a byte-identical no-op). */
	fanoutLimits: ActionFanoutLimits;
	/**
	 * S3: tool names that perform an OUTWARD-WRITE (post a comment/PR, etc.) and so get the human-in-loop approval
	 * decision. Opt-in — the operator declares them (a tool name can't be classified read-vs-write generically). Empty ⇒
	 * no tool is treated as outward-write (byte-identical).
	 */
	outwardWriteToolNames: ReadonlySet<string>;
	/** S3: outward-write tools PRE-AUTHORIZED by a narrowly-scoped policy — these proceed without queuing. */
	preAuthorizedOutwardTools: ReadonlySet<string>;
	/** S3 test seam: override the outward-action review-queue store root. */
	outwardQueueRootDir?: string;
}

/** Opt-in S3 outward-action config for {@link createSwarmToolBrokerState}. */
export interface SwarmBrokerOutwardConfig {
	outwardWriteToolNames?: Iterable<string>;
	preAuthorizedOutwardTools?: Iterable<string>;
	outwardQueueRootDir?: string;
}

export function createSwarmToolBrokerState(
	initialTaint: readonly TaintLabel[] = [],
	fanoutLimits: ActionFanoutLimits = {},
	outward: SwarmBrokerOutwardConfig = {},
): SwarmToolBrokerState {
	return {
		taintLabels: propagateTaint([], initialTaint),
		provenance: [],
		untrustedHosts: [],
		fanout: emptyActionFanoutState(),
		fanoutLimits,
		outwardWriteToolNames: new Set(outward.outwardWriteToolNames ?? []),
		preAuthorizedOutwardTools: new Set(outward.preAuthorizedOutwardTools ?? []),
		outwardQueueRootDir: outward.outwardQueueRootDir,
	};
}

/** Egress URL-fetching tools whose target host must be checked against untrusted-introduced hosts (S8). */
const EGRESS_URL_TOOL_NAMES = new Set(["browse_url", "fetch_web_content", "fetch_url"]);

/** OUTWARD tools whose calls count against the S9 fan-out cap: egress reads/fetches + any external MCP tool. */
const OUTWARD_EGRESS_TOOL_NAMES = new Set(["web_search", "browse_url", "fetch_web_content", "fetch_url"]);

/** Taint labels whose content is EXTERNAL-untrusted and can "introduce" an exfiltration host (S8). */
const HOST_INTRODUCING_LABELS: ReadonlySet<TaintLabel> = new Set<TaintLabel>(["web", "mcp"]);

export function wrapSwarmAgentTools(
	tools: readonly AgentTool[],
	state: SwarmToolBrokerState,
	options: SwarmToolOutputTaintOptions = {},
): AgentTool[] {
	return tools.map((tool) => ({
		...tool,
		async execute(input: unknown, context: AgentToolContext): Promise<unknown> {
			const denied = brokerDenialResult(tool.name, state, options);
			if (denied) {
				return denied;
			}
			const approvalBlock = outwardApprovalGate(tool.name, input, state);
			if (approvalBlock) {
				return approvalBlock;
			}
			const egressDenied = egressProvenanceDenial(tool.name, input, state);
			if (egressDenied) {
				return egressDenied;
			}
			const fanoutDenied = fanoutDenial(tool.name, state, options);
			if (fanoutDenied) {
				return fanoutDenied;
			}
			const output = await tool.execute(input, context);
			recordSwarmToolOutputTaint(tool.name, output, state, options);
			return fenceMcpToolOutput(tool.name, output, options);
		},
	}));
}

/**
 * Phase 7S / S6: an EXTERNAL MCP server's tool output is attacker-authorable (untrusted) and flows straight into the
 * native agent's turn. Fence string output structurally so an MCP result that reads like an instruction ("ignore
 * previous instructions…") can't hijack the agent — the fence wraps it in the `<<<BEGIN/END UNTRUSTED CONTENT>>>`
 * boundary with a data-not-commands preamble and neutralizes any hidden fence markers. `screen: false` is deliberate:
 * MCP output is FUNCTIONAL data the agent must operate on (e.g. an issue-tracker tool returning issue text that
 * legitimately quotes an injection example), so blocking/withholding it would break the tool; the structural boundary —
 * not withholding — is the defense. Non-string output (structured results) is left untouched; the taint label already
 * marks it. Non-MCP tools (repo file/search/host tools operating on the trusted workspace) are returned unchanged.
 */
function fenceMcpToolOutput(toolName: string, output: unknown, options: SwarmToolOutputTaintOptions): unknown {
	if (typeof output !== "string" || !mcpToolNamesInclude(options.mcpToolNames, toolName)) {
		return output;
	}
	return fenceUntrustedContent(output, { source: `mcp:${toolName}`, screen: false }).text;
}

export function wrapSwarmToolExecutors(
	executors: Partial<ToolExecutors> | undefined,
	state: SwarmToolBrokerState,
	options: SwarmToolOutputTaintOptions = {},
): Partial<ToolExecutors> | undefined {
	if (!executors) {
		return undefined;
	}
	const wrapped: Partial<ToolExecutors> = { ...executors };
	if (executors.readFile) {
		const readFile = executors.readFile;
		wrapped.readFile = async (...args: Parameters<NonNullable<ToolExecutors["readFile"]>>) => {
			const denied = brokerDenialResult("read_files", state, options);
			if (denied) {
				return denied;
			}
			const output = await readFile(...args);
			recordSwarmToolOutputTaint("read_files", output, state, options);
			return output;
		};
	}
	if (executors.search) {
		const search = executors.search;
		wrapped.search = async (...args: Parameters<NonNullable<ToolExecutors["search"]>>) => {
			const denied = brokerDenialResult("search_codebase", state, options);
			if (denied) {
				return denied;
			}
			const output = await search(...args);
			recordSwarmToolOutputTaint("search_codebase", output, state, options);
			return output;
		};
	}
	if (executors.bash) {
		const bash = executors.bash;
		wrapped.bash = async (...args: Parameters<NonNullable<ToolExecutors["bash"]>>) => {
			const denied = brokerDenialResult("run_commands", state, options);
			if (denied) {
				return denied;
			}
			const output = await bash(...args);
			recordSwarmToolOutputTaint("run_commands", output, state, options);
			return output;
		};
	}
	if (executors.webFetch) {
		const webFetch = executors.webFetch;
		wrapped.webFetch = async (...args: Parameters<NonNullable<ToolExecutors["webFetch"]>>) => {
			const denied = brokerDenialResult("fetch_web_content", state, options);
			if (denied) {
				return denied;
			}
			const output = await webFetch(...args);
			recordSwarmToolOutputTaint("fetch_web_content", output, state, options);
			return output;
		};
	}
	if (executors.editor) {
		const editor = executors.editor;
		wrapped.editor = async (...args: Parameters<NonNullable<ToolExecutors["editor"]>>) => {
			const denied = brokerDenialResult("editor", state, options);
			if (denied) {
				return denied;
			}
			const output = await editor(...args);
			recordSwarmToolOutputTaint("editor", output, state, options);
			return output;
		};
	}
	if (executors.applyPatch) {
		const applyPatch = executors.applyPatch;
		wrapped.applyPatch = async (...args: Parameters<NonNullable<ToolExecutors["applyPatch"]>>) => {
			const denied = brokerDenialResult("apply_patch", state, options);
			if (denied) {
				return denied;
			}
			const output = await applyPatch(...args);
			recordSwarmToolOutputTaint("apply_patch", output, state, options);
			return output;
		};
	}
	return wrapped;
}

function decideSwarmToolDenial(
	toolName: string,
	state: SwarmToolBrokerState,
	options: SwarmToolOutputTaintOptions = {},
): string | null {
	const manifest = swarmToolManifest(toolName, options);
	if (!manifest) {
		return null;
	}
	const gate = decideCapabilityBrokerGate({ manifest, taintLabels: state.taintLabels });
	return gate.allow ? null : (gate.reason ?? "capability broker refused the tool call");
}

function recordSwarmToolOutputTaint(
	toolName: string,
	output: unknown,
	state: SwarmToolBrokerState,
	options: SwarmToolOutputTaintOptions,
): void {
	const outputTaint = swarmToolOutputTaint(toolName, output, options);
	if (outputTaint.length > 0) {
		state.taintLabels = propagateTaint(state.taintLabels, outputTaint);
		// S5: record the SOURCE (this tool) for each label, so a later gate denial / audit can name the origin.
		state.provenance = recordTaintProvenance(
			state.provenance,
			outputTaint.map((label) => taintProvenanceEntry(label, toolName)),
		);
		// S8: if this output is EXTERNAL-untrusted (web/mcp), the hosts it names are "introduced by untrusted content"
		// — accumulate them so a later egress to one (while sensitive data is in context) can be refused.
		if (outputTaint.some((label) => HOST_INTRODUCING_LABELS.has(label))) {
			const hosts = extractHostsFromContent(renderOutputText(output));
			if (hosts.length > 0) {
				state.untrustedHosts = dedupeAppend(state.untrustedHosts, hosts);
			}
		}
	}
}

/** Render a tool output to searchable text for host extraction (strings as-is; structured output JSON-stringified). */
function renderOutputText(output: unknown): string {
	if (typeof output === "string") {
		return output;
	}
	try {
		return JSON.stringify(output) ?? "";
	} catch {
		return "";
	}
}

/** Append new items to an accumulating string list, de-duplicated, order-stable. */
function dedupeAppend(existing: readonly string[], incoming: readonly string[]): string[] {
	const seen = new Set(existing);
	const result = [...existing];
	for (const item of incoming) {
		if (!seen.has(item)) {
			seen.add(item);
			result.push(item);
		}
	}
	return result;
}

/**
 * S9: refuse an OUTWARD tool call (MCP / egress) that would exceed the session's configured fan-out ceilings, so an
 * injection can't drive spam across many targets. Returns null (allow) when no ceiling is configured, the tool is not
 * outward, or the call is within limits — and RECORDS the action on the state when it allows (so the count advances only
 * for calls actually dispatched). The target granularity is the tool name (caps repeated calls to one outward tool +
 * total outward calls + distinct outward tools).
 */
function fanoutDenial(
	toolName: string,
	state: SwarmToolBrokerState,
	options: SwarmToolOutputTaintOptions,
): string | null {
	if (!hasAnyFanoutLimit(state.fanoutLimits) || !isOutwardTool(toolName, options)) {
		return null;
	}
	const verdict = checkActionFanout(state.fanout, toolName, state.fanoutLimits);
	if (!verdict.allow) {
		return deniedToolResult(toolName, verdict.reason ?? "outward action refused by fan-out cap");
	}
	state.fanout = recordAction(state.fanout, toolName);
	return null;
}

/** Whether a tool reaches OUTWARD (an egress read/fetch or an external MCP tool) and so counts against the fan-out cap. */
function isOutwardTool(toolName: string, options: SwarmToolOutputTaintOptions): boolean {
	return OUTWARD_EGRESS_TOOL_NAMES.has(toolName) || mcpToolNamesInclude(options.mcpToolNames, toolName);
}

/**
 * S3 human-in-loop gate for a declared OUTWARD-WRITE tool (post a comment/PR, etc.). Applies the approval decision
 * ({@link decideOutwardActionApproval}) using the current taint + the pre-authorization policy:
 *  - `allow` (pre-authorized) → null, the call proceeds.
 *  - `deny` (tainted context, no plan — injection-suspected) → a denial string; the call is refused, NOT queued.
 *  - `require_approval` (novel outward action) → the intended call is RECORDED to the review queue (best-effort,
 *    fire-and-forget) and a "queued for operator review" string is returned; the call is NOT performed.
 * Returns null when the tool is not a declared outward-write (byte-identical for every other tool).
 */
function outwardApprovalGate(toolName: string, input: unknown, state: SwarmToolBrokerState): string | null {
	if (!state.outwardWriteToolNames.has(toolName)) {
		return null;
	}
	const decision = decideOutwardActionApproval({
		isOutwardOrIrreversible: true,
		contextTainted: isTainted(state.taintLabels),
		backedByTrustedPlan: false,
		preAuthorized: state.preAuthorizedOutwardTools.has(toolName),
	});
	if (decision.decision === "allow") {
		return null;
	}
	if (decision.decision === "deny") {
		return deniedToolResult(toolName, decision.reason);
	}
	// require_approval → queue the intended action for out-of-band operator review (David's chosen S3 model).
	const at = Date.now();
	const argsSummary = redactArgsSummary(input);
	const id = createHash("sha256").update(`${toolName}|${argsSummary}|${at}`).digest("hex").slice(0, 12);
	void enqueueOutwardAction(
		{
			id,
			toolName,
			target: outwardTargetFromInput(input) ?? toolName,
			argsSummary,
			reason: decision.reason,
			status: "pending",
			at,
		},
		state.outwardQueueRootDir ? { rootDir: state.outwardQueueRootDir } : undefined,
	).catch(() => {});
	return (
		`Queued for operator review (id ${id}): ${toolName} was NOT performed — ${decision.reason} ` +
		`The operator will approve or reject it out-of-band; continue with other work.`
	);
}

/** Best-effort target label for a queued outward action, from common input keys (issue/pr/url/target). */
function outwardTargetFromInput(input: unknown): string | null {
	const record = input as Record<string, unknown> | null | undefined;
	if (!record || typeof record !== "object") {
		return null;
	}
	for (const key of ["target", "url", "issue", "issue_number", "number", "pr", "path", "repo"]) {
		const value = record[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim().slice(0, 120);
		}
		if (typeof value === "number") {
			return String(value);
		}
	}
	return null;
}

/**
 * S8: refuse an egress URL-tool call whose target host was introduced by untrusted content this turn AND sensitive data
 * is in context (an exfiltration risk). Non-egress tools, a missing/malformed url, or a clean context return null (allow).
 * The `secret_like` taint IS the "sensitive data in context" signal.
 */
function egressProvenanceDenial(toolName: string, input: unknown, state: SwarmToolBrokerState): string | null {
	if (!EGRESS_URL_TOOL_NAMES.has(toolName)) {
		return null;
	}
	const url = (input as { url?: unknown } | null | undefined)?.url;
	if (typeof url !== "string" || url.trim().length === 0) {
		return null;
	}
	let targetHost: string;
	try {
		targetHost = new URL(url.trim()).hostname;
	} catch {
		return null;
	}
	const verdict = decideEgressProvenance({
		targetHost,
		untrustedHosts: state.untrustedHosts,
		contextCarriesSensitiveData: state.taintLabels.includes("secret_like"),
	});
	return verdict.allow ? null : deniedToolResult(toolName, verdict.reason ?? "egress refused by provenance gate");
}

/**
 * Compute the broker's denial for a tool call, or null if allowed. When it denies, the reason is ENRICHED (S5) with the
 * untrusted source(s) currently tainting the turn, so the message names the culprit — e.g. "…untrusted content in this
 * context originated from: browse_url" — instead of only the abstract taint class.
 */
function brokerDenialResult(
	toolName: string,
	state: SwarmToolBrokerState,
	options: SwarmToolOutputTaintOptions = {},
): string | null {
	const denial = decideSwarmToolDenial(toolName, state, options);
	if (!denial) {
		return null;
	}
	const provenance = explainTaintProvenance(state.provenance);
	return deniedToolResult(toolName, provenance ? `${denial} — ${provenance}` : denial);
}

function deniedToolResult(toolName: string, reason: string): string {
	return `Denied by capability broker for ${toolName}: ${reason}`;
}
