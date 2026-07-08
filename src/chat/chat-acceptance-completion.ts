import type { ChatAgentStep } from "./chat-agent-loop";

/**
 * §5.AA controller evidence-gate, ACCEPTANCE flavor — completion judged by the task's own acceptance spec instead of
 * the model's self-report. When the instruction carries an `Acceptance check: <command>` line (the same card
 * convention the plan-integration gate reads), the loop must not accept a premature "done": the turn is complete only
 * when a `run_command` step actually RAN that command and it exited 0. Pure over the loop's recorded steps — the
 * evidence is what executed, never what the model claims.
 */

/** The card/prompt convention: one `Acceptance check: <command>` line (mirrors plan-integration-gate). */
const ACCEPTANCE_CHECK_PATTERN = /^Acceptance check:\s*(.+?)\s*$/im;

export function extractAcceptanceCommand(instruction: string): string | null {
	const command = instruction.match(ACCEPTANCE_CHECK_PATTERN)?.[1]?.trim();
	return command && command.length > 0 ? command : null;
}

/** The success header `formatResult` emits for a zero-exit run (chat-command-tool.ts). */
const SUCCESS_HEADER = "Command exited with code 0.";

function normalizeCommand(command: string): string {
	return command.replace(/\s+/g, " ").trim();
}

/**
 * Build the loop's `assessCompletion` for an acceptance-carrying instruction: true only when some `run_command` step
 * ran the acceptance command (normalized whitespace; the step may wrap it, e.g. `cd app && <cmd>`) AND its result
 * reports exit code 0. A failed or missing acceptance run keeps the evidence-gate nudging the model onward.
 */
export function buildAcceptanceCompletionGate(acceptanceCommand: string): (steps: readonly ChatAgentStep[]) => boolean {
	const needle = normalizeCommand(acceptanceCommand);
	return (steps) =>
		steps.some((step) => {
			if (step.toolCall.name !== "run_command") {
				return false;
			}
			const ran = step.toolCall.arguments.command;
			if (typeof ran !== "string" || !normalizeCommand(ran).includes(needle)) {
				return false;
			}
			return step.result.content.startsWith(SUCCESS_HEADER);
		});
}
