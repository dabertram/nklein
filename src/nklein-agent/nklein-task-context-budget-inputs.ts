/**
 * Per-task inputs to the context-budget breakdown, extracted from InMemoryNKleinTaskSessionService.
 *
 * When a task session starts, the assembled system prompt and the estimated tool-schema token cost
 * are stashed here; a later turn's budget projection reads them back (alongside the live message
 * history) to estimate how much of the context window is already committed before the next prompt.
 *
 * {@link record} mirrors the two inline `.set()`s and the getters bake in the same defaults the
 * call sites used (`?? null` for the prompt, `?? 0` for the tokens).
 *
 * Unlike the pre-extraction maps — which were never swept and leaked one entry per task ever
 * started — {@link forget} is now wired into the terminal cleanup paths (the inputs are only read
 * during an active turn's budget projection, so dropping them on teardown is safe and plugs the
 * leak); {@link clear} drops everything on full disposal.
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

	/** Drops a finished task's stashed inputs (called from the terminal cleanup paths). */
	forget(taskId: string): void {
		this.systemPromptByTaskId.delete(taskId);
		this.toolSchemaTokensByTaskId.delete(taskId);
	}

	clear(): void {
		this.systemPromptByTaskId.clear();
		this.toolSchemaTokensByTaskId.clear();
	}
}
