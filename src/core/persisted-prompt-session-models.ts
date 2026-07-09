export interface PersistedPromptSessionModelObservation {
	sessionId: string;
	modelId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
	const value = record[key];
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function extractPersistedPromptSessionModel(record: unknown): PersistedPromptSessionModelObservation | null {
	if (!isRecord(record)) {
		return null;
	}
	const sessionId = stringField(record, "session_id") ?? stringField(record, "sessionId");
	const modelId = stringField(record, "model") ?? stringField(record, "modelId");
	if (!sessionId || !modelId) {
		return null;
	}
	return { sessionId, modelId };
}

export function collectPersistedPromptSessionModelIds(records: readonly unknown[]): Set<string> {
	const modelIds = new Set<string>();
	for (const record of records) {
		const observation = extractPersistedPromptSessionModel(record);
		if (observation) {
			modelIds.add(observation.modelId);
		}
	}
	return modelIds;
}
