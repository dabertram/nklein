/**
 * !Klein native agent core — a constrained tool-calling loop that does NOT depend on the NKlein SDK.
 *
 * This is the foundation of !Klein's own backend (the decision to grow beyond a NKlein-only runtime is recorded
 * in THIRD_PARTY_NOTICES.md and plan.md). The loop is the well-trodden ReAct / tool-calling pattern (Yao et al.,
 * ReAct, arXiv:2210.03629), adapted for small/quantized local models: the *next action* is produced via
 * constrained JSON decoding (see `LocalLlmClient.generateStructured`), so the model reliably emits a valid
 * tool selection instead of malformed free-text — the single biggest failure mode for weak models.
 *
 * Design is deliberately decoupled and testable: the loop takes an injected `decideAction` (so it can be unit-
 * tested with a scripted decider) and a list of `AgentCoreTool`s (structurally satisfied by !Klein's existing
 * tools: edit_file, write_files, read, search, repo_map, …). `createLocalLlmActionDecider` wires a real
 * `LocalLlmClient` to `decideAction`.
 */

export interface AgentCoreTool {
	name: string;
	description: string;
	inputSchema?: unknown;
	execute(input: unknown, context?: unknown): Promise<unknown> | unknown;
}

export interface AgentToolAction {
	kind: "tool";
	thought?: string;
	tool: string;
	input: unknown;
}

export interface AgentFinalAction {
	kind: "final";
	thought?: string;
	message: string;
}

export type AgentAction = AgentToolAction | AgentFinalAction;

export interface AgentTranscriptEntry {
	turn: number;
	thought?: string;
	/** The action the model chose this turn. */
	action: AgentAction;
	/** Tool observation (stringified, truncated) when the action was a tool call. */
	observation?: string;
	error?: string;
}

export type AgentRunStatus = "completed" | "max_turns" | "stalled" | "error";

export interface AgentRunResult {
	status: AgentRunStatus;
	finalMessage: string | null;
	transcript: AgentTranscriptEntry[];
	turns: number;
}

export interface DecideActionInput {
	task: string;
	tools: AgentCoreTool[];
	transcript: AgentTranscriptEntry[];
}

export type DecideAction = (input: DecideActionInput) => Promise<AgentAction>;

export interface RunAgentLoopOptions {
	task: string;
	tools: AgentCoreTool[];
	decideAction: DecideAction;
	maxTurns?: number;
	/** Consecutive identical tool actions after which the run is parked as stalled. */
	repeatedActionLimit?: number;
	/** Max characters of a tool observation fed back to the model. */
	maxObservationChars?: number;
	onEntry?: (entry: AgentTranscriptEntry) => void;
}

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_REPEATED_ACTION_LIMIT = 3;
const DEFAULT_MAX_OBSERVATION_CHARS = 4_000;

function stringifyObservation(value: unknown, maxChars: number): string {
	let text: string;
	if (typeof value === "string") {
		text = value;
	} else {
		try {
			text = JSON.stringify(value);
		} catch {
			text = String(value);
		}
	}
	return text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated]` : text;
}

function actionFingerprint(action: AgentAction): string {
	if (action.kind === "final") {
		return "final";
	}
	let inputKey: string;
	try {
		inputKey = JSON.stringify(action.input);
	} catch {
		inputKey = String(action.input);
	}
	return `${action.tool}:${inputKey}`;
}

export async function runAgentLoop(options: RunAgentLoopOptions): Promise<AgentRunResult> {
	const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
	const repeatedActionLimit = options.repeatedActionLimit ?? DEFAULT_REPEATED_ACTION_LIMIT;
	const maxObservationChars = options.maxObservationChars ?? DEFAULT_MAX_OBSERVATION_CHARS;
	const toolsByName = new Map(options.tools.map((tool) => [tool.name, tool]));
	const transcript: AgentTranscriptEntry[] = [];

	let lastFingerprint: string | null = null;
	let repeatCount = 0;

	for (let turn = 1; turn <= maxTurns; turn += 1) {
		let action: AgentAction;
		try {
			action = await options.decideAction({ task: options.task, tools: options.tools, transcript });
		} catch (error) {
			const entry: AgentTranscriptEntry = {
				turn,
				action: { kind: "final", message: "" },
				error: error instanceof Error ? error.message : String(error),
			};
			transcript.push(entry);
			options.onEntry?.(entry);
			return { status: "error", finalMessage: null, transcript, turns: turn };
		}

		if (action.kind === "final") {
			const entry: AgentTranscriptEntry = { turn, thought: action.thought, action };
			transcript.push(entry);
			options.onEntry?.(entry);
			return { status: "completed", finalMessage: action.message, transcript, turns: turn };
		}

		// Stall guard: the same tool+input repeated too many times means the model is looping.
		const fingerprint = actionFingerprint(action);
		repeatCount = fingerprint === lastFingerprint ? repeatCount + 1 : 1;
		lastFingerprint = fingerprint;
		if (repeatCount >= repeatedActionLimit) {
			const entry: AgentTranscriptEntry = {
				turn,
				thought: action.thought,
				action,
				error: `Repeated the same ${action.tool} call ${repeatCount} times; parking to avoid a loop.`,
			};
			transcript.push(entry);
			options.onEntry?.(entry);
			return { status: "stalled", finalMessage: null, transcript, turns: turn };
		}

		const tool = toolsByName.get(action.tool);
		const entry: AgentTranscriptEntry = { turn, thought: action.thought, action };
		if (!tool) {
			entry.observation = `Error: unknown tool "${action.tool}". Available tools: ${options.tools
				.map((candidate) => candidate.name)
				.join(", ")}.`;
			transcript.push(entry);
			options.onEntry?.(entry);
			continue;
		}
		try {
			const result = await tool.execute(action.input, { agentId: "nklein-agent-core", iteration: turn });
			entry.observation = stringifyObservation(result, maxObservationChars);
		} catch (error) {
			entry.observation = `Error: ${error instanceof Error ? error.message : String(error)}`;
		}
		transcript.push(entry);
		options.onEntry?.(entry);
	}

	return { status: "max_turns", finalMessage: null, transcript, turns: maxTurns };
}
