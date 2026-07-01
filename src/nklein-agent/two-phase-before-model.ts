/**
 * §5.O two-phase tool narrowing for the SDK `beforeModel` seam. Given the tools a turn would offer + the current step
 * text + an injected phase-1 model caller, run the two-phase pick and return the tools NARROWED to the pick (so the
 * `beforeModel` hook can return `{ tools }` and the model sees exactly one tool that turn). Pure over the injected caller,
 * so the whole narrowing decision is unit-testable with a fake; the session runtime supplies a real completion caller.
 *
 * Conservative by construction: with fewer than 2 tools there's nothing to narrow (returned unchanged, no model call);
 * and a `none`/`plan_needed`/truncated pick leaves the full set unchanged (only a confident single pick narrows).
 */

import { kanbanTaskToolCardByName } from "../core/task-tool-cards";
import type { ToolCard } from "../core/tool-card";
import { narrowToolsToPick, type PhaseOneRawResponse } from "../core/two-phase-tool-pick";
import { runTwoPhaseToolPick, type TwoPhasePickModelCaller } from "./two-phase-tool-runner";

/** The latest user-authored step text from a message list (what the pick is "for"); "" when there is none. */
export function latestStepText(messages: readonly { role?: string; content?: unknown }[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role !== "user") {
			continue;
		}
		const text =
			typeof message.content === "string"
				? message.content
				: Array.isArray(message.content)
					? message.content
							.map((part) =>
								part && typeof part === "object" && "text" in part
									? String((part as { text?: unknown }).text ?? "")
									: "",
							)
							.join(" ")
					: "";
		if (text.trim()) {
			return text.trim();
		}
	}
	return "";
}

/**
 * An OpenAI-compat phase-1 pick caller (fetch) for the beforeModel two-phase wire — I/O, so the session runtime supplies
 * it and the pure {@link narrowToolsForStep} stays fake-testable. Normalizes the base URL to the `/v1/chat/completions`
 * route and uses a reasoning-sized budget (a small reasoning model needs room before the pick).
 */
export function createOpenAiCompatPhaseOnePickCaller(config: {
	baseUrl: string;
	modelId: string;
	maxTokens?: number;
}): TwoPhasePickModelCaller {
	const base = config.baseUrl.replace(/\/$/, "");
	const url = base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
	return async ({ menu, task }): Promise<PhaseOneRawResponse> => {
		const response = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: config.modelId,
				temperature: 0,
				max_tokens: config.maxTokens ?? 1024,
				messages: [
					{ role: "system", content: menu },
					{ role: "user", content: `Step: ${task}\nYour single-line answer:` },
				],
			}),
		});
		if (!response.ok) {
			throw new Error(`phase-1 pick failed (${response.status})`);
		}
		const json = (await response.json()) as {
			choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
		};
		const choice = json.choices?.[0];
		return { content: choice?.message?.content ?? "", finishReason: choice?.finish_reason ?? null };
	};
}

/** A card per offered tool: its authored kanban card, or a terse name-only fallback for a tool we haven't carded. */
function cardsForTools(tools: readonly { name: string }[]): ToolCard[] {
	return tools.map(
		(tool) =>
			kanbanTaskToolCardByName(tool.name) ?? { name: tool.name, purpose: tool.name, useWhen: `Use ${tool.name}.` },
	);
}

/**
 * Narrow a turn's offered tools to the two-phase pick for `step`. Returns the narrowed list (or the original when there's
 * nothing to narrow / no confident single pick). Only `name` is read from each tool, so it couples to no SDK tool type.
 */
export async function narrowToolsForStep<T extends { name: string }>(input: {
	tools: readonly T[];
	step: string;
	callModel: TwoPhasePickModelCaller;
}): Promise<readonly T[]> {
	if (input.tools.length < 2) {
		return input.tools; // nothing to narrow — skip the phase-1 call entirely
	}
	const cards = cardsForTools(input.tools);
	const { decision } = await runTwoPhaseToolPick({ task: input.step, callModel: input.callModel, cards });
	return narrowToolsToPick(input.tools, decision);
}
