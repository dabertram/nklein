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

/**
 * The nudge the loop must send while {@link buildAcceptanceCompletionGate} is still unsatisfied.
 *
 * ── WHY THIS EXISTS (live 2026-09-08, P1.RESPONDERLEADS lead (a)) ──
 * The gate demands one specific fact — the acceptance command RAN in this turn and exited 0 — but the loop's generic
 * "you have not completed all the required steps" nudge never said which fact. A card whose acceptance was already
 * green at start therefore livelocked: the model had nothing to implement, stopped cleanly, the gate saw no
 * `run_command` step, nudged, and the model stopped cleanly again — for round after round until the iteration cap.
 * The model was not being stubborn; it was never told what would count.
 *
 * The fix is NOT to waive the evidence for an already-satisfied card. It is to name the command, so the card leaves
 * with the acceptance proven rather than assumed — one more turn instead of ten wasted ones.
 */
export function acceptanceEvidenceNudge(acceptanceCommand: string): string {
	return [
		`This task's completion is judged by EVIDENCE, and the required evidence is missing: \`${acceptanceCommand}\` has not been run to a zero exit in this turn.`,
		`Run \`${acceptanceCommand}\` now with the command tool.`,
		"If you believe the work is already done, that is exactly the case this check exists for — RUN THE COMMAND to prove it. A summary, a claim, or a read of the files is not evidence and will not end the turn.",
		"If it fails, fix what it reports and run it again.",
	].join(" ");
}

/** The nudge while a `requiredTools` gate is unsatisfied — names the tools still un-called, for the same reason. */
export function requiredToolsEvidenceNudge(missingToolNames: readonly string[]): string {
	return [
		`This task requires tool(s) you have not called yet: ${missingToolNames.join(", ")}.`,
		"Call them now — the turn cannot end until they have run.",
	].join(" ");
}
