/**
 * Per-task inputs to the context-budget breakdown, extracted from InMemoryNKleinTaskSessionService.
 *
 * When a task session starts, the assembled system prompt and the estimated tool-schema token cost
 * are stashed here; a later turn's budget projection reads them back (alongside the live message
 * history) to estimate how much of the context window is already committed before the next prompt.
 *
 * Behavior-preserving extraction: {@link record} mirrors the two inline `.set()`s and the getters
 * bake in the same defaults the call sites used (`?? null` for the prompt, `?? 0` for the tokens).
 *
 * Note: like the pre-extraction maps, these entries are NOT swept on task teardown — set on start,
 * read during the run. That is a (small, bounded-by-task-count) leak preserved here for parity; a
 * `forget(taskId)` wired into the terminal cleanup paths would fix it as a separate change.
 */
export class TaskContextBudgetInputs {
	private readonly systemPromptByTaskId = new Map<string, string>();
	private readonly toolSchemaTokensByTaskId = new Map<string, number>();

	/** Stashes the assembled system prompt and tool-schema token estimate for a starting task. */
	record(taskId: string, systemPrompt: string, toolSchemaTokens: number): void {
		this.systemPromptByTaskId.set(taskId, systemPrompt);
		this.toolSchemaTokensByTaskId.set(taskId, toolSchemaTokens);
	}

	/** The stashed system prompt, or null if the task never recorded one. */
	getSystemPrompt(taskId: string): string | null {
		return this.systemPromptByTaskId.get(taskId) ?? null;
	}

	/** The stashed tool-schema token estimate, or 0 if the task never recorded one. */
	getToolSchemaTokens(taskId: string): number {
		return this.toolSchemaTokensByTaskId.get(taskId) ?? 0;
	}
}
