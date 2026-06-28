/**
 * Prompt-variation substrate (todo §5.AA) — the PURE template core behind the `prompt_variant` retry rung and the
 * reason-then-act phase (a) prompt. Wiring (firing a variant at the model-call seam on a no-call/malformed outcome) is
 * the separate §5.AA retry-engine work.
 *
 * The §5.Z sweeps show a model that won't act on one phrasing often acts on another: an imperative command, an
 * explicit "respond with only a tool call", a worked example to mimic, or — for reasoning models that ruminate — an
 * explicit "reason first, then call". This re-frames the SAME instruction in those families without changing its intent,
 * so the ladder can try a different phrasing rather than give up. Pure + generic (no tool/SDK types beyond a name +
 * example args) so the chat loop and swarm runtime share one seam and it is trivially testable.
 */

/** The phrasing families the ladder can try, in escalation order (cheapest/most-direct first). */
export type PromptVariantFamily = "imperative" | "explicit_format" | "example_led" | "reason_then_act";

/** Default escalation order for the `prompt_variant` rung. `reason_then_act` is last (it pairs with constrained decode). */
export const PROMPT_VARIANT_LADDER: readonly PromptVariantFamily[] = [
	"imperative",
	"explicit_format",
	"example_led",
	"reason_then_act",
];

export interface PromptVariantInput {
	/** The core task instruction — preserved verbatim in every variant (only the FRAMING changes). */
	instruction: string;
	/** The tool the model should call; sharpens the imperative / explicit-format / example-led framings when known. */
	toolName?: string;
	/** A worked example arguments object for the example-led framing; omitted ⇒ an empty-args example. */
	exampleArguments?: Record<string, unknown>;
}

/**
 * Re-frame `instruction` in the given phrasing family. The instruction text is always preserved verbatim (a variant
 * changes HOW we ask, never WHAT we ask) so the task's meaning can't drift across retries.
 */
export function buildPromptVariant(family: PromptVariantFamily, input: PromptVariantInput): string {
	const instruction = input.instruction.trim();
	const tool = input.toolName?.trim();
	switch (family) {
		case "imperative":
			return tool ? `Do this now — call the ${tool} tool:\n${instruction}` : `Do this now:\n${instruction}`;
		case "explicit_format":
			return tool
				? `Respond with a single ${tool} tool call and nothing else — no explanation.\nTask: ${instruction}`
				: `Respond with a single tool call and nothing else — no explanation.\nTask: ${instruction}`;
		case "example_led": {
			const example = JSON.stringify({ tool: tool ?? "the_tool", arguments: input.exampleArguments ?? {} });
			return `Example of the exact tool-call format to produce:\n${example}\nNow produce the matching tool call for this task:\n${instruction}`;
		}
		case "reason_then_act":
			return (
				"First, think step by step about exactly which tool call accomplishes this task and what its arguments " +
				`should be. Then make that single tool call.\nTask: ${instruction}`
			);
	}
}
