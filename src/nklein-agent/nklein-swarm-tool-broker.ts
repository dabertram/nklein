import type { ToolExecutors } from "@cline/sdk";
import { decideCapabilityBrokerGate } from "../core/capability-broker-gate";
import {
	mcpToolNamesInclude,
	type SwarmToolOutputTaintOptions,
	swarmToolManifest,
	swarmToolOutputTaint,
} from "../core/swarm-tool-capability";
import { propagateTaint, type TaintLabel } from "../core/taint-labels";
import { fenceUntrustedContent } from "../core/untrusted-content-boundary";
import type { AgentTool, AgentToolContext } from "./sdk-agent-types";

export interface SwarmToolBrokerState {
	taintLabels: readonly TaintLabel[];
}

export function createSwarmToolBrokerState(initialTaint: readonly TaintLabel[] = []): SwarmToolBrokerState {
	return { taintLabels: propagateTaint([], initialTaint) };
}

export function wrapSwarmAgentTools(
	tools: readonly AgentTool[],
	state: SwarmToolBrokerState,
	options: SwarmToolOutputTaintOptions = {},
): AgentTool[] {
	return tools.map((tool) => ({
		...tool,
		async execute(input: unknown, context: AgentToolContext): Promise<unknown> {
			const denial = decideSwarmToolDenial(tool.name, state, options);
			if (denial) {
				return deniedToolResult(tool.name, denial);
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
			const denial = decideSwarmToolDenial("read_files", state);
			if (denial) {
				return deniedToolResult("read_files", denial);
			}
			const output = await readFile(...args);
			recordSwarmToolOutputTaint("read_files", output, state, options);
			return output;
		};
	}
	if (executors.search) {
		const search = executors.search;
		wrapped.search = async (...args: Parameters<NonNullable<ToolExecutors["search"]>>) => {
			const denial = decideSwarmToolDenial("search_codebase", state);
			if (denial) {
				return deniedToolResult("search_codebase", denial);
			}
			const output = await search(...args);
			recordSwarmToolOutputTaint("search_codebase", output, state, options);
			return output;
		};
	}
	if (executors.bash) {
		const bash = executors.bash;
		wrapped.bash = async (...args: Parameters<NonNullable<ToolExecutors["bash"]>>) => {
			const denial = decideSwarmToolDenial("run_commands", state);
			if (denial) {
				return deniedToolResult("run_commands", denial);
			}
			const output = await bash(...args);
			recordSwarmToolOutputTaint("run_commands", output, state, options);
			return output;
		};
	}
	if (executors.webFetch) {
		const webFetch = executors.webFetch;
		wrapped.webFetch = async (...args: Parameters<NonNullable<ToolExecutors["webFetch"]>>) => {
			const denial = decideSwarmToolDenial("fetch_web_content", state);
			if (denial) {
				return deniedToolResult("fetch_web_content", denial);
			}
			const output = await webFetch(...args);
			recordSwarmToolOutputTaint("fetch_web_content", output, state, options);
			return output;
		};
	}
	if (executors.editor) {
		const editor = executors.editor;
		wrapped.editor = async (...args: Parameters<NonNullable<ToolExecutors["editor"]>>) => {
			const denial = decideSwarmToolDenial("editor", state);
			if (denial) {
				return deniedToolResult("editor", denial);
			}
			const output = await editor(...args);
			recordSwarmToolOutputTaint("editor", output, state, options);
			return output;
		};
	}
	if (executors.applyPatch) {
		const applyPatch = executors.applyPatch;
		wrapped.applyPatch = async (...args: Parameters<NonNullable<ToolExecutors["applyPatch"]>>) => {
			const denial = decideSwarmToolDenial("apply_patch", state);
			if (denial) {
				return deniedToolResult("apply_patch", denial);
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
	}
}

function deniedToolResult(toolName: string, reason: string): string {
	return `Denied by capability broker for ${toolName}: ${reason}`;
}
