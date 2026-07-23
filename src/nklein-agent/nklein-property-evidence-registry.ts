export interface PropertyCheckEvidence {
	readonly outcome: "pass" | "fail" | "unavailable";
	readonly reason: string;
	readonly invariantCount: number;
}

const evidenceByTaskId = new Map<string, PropertyCheckEvidence>();

export function storePropertyCheckEvidence(taskId: string, evidence: PropertyCheckEvidence): void {
	evidenceByTaskId.set(taskId, evidence);
}

export function getPropertyCheckEvidence(taskId: string): PropertyCheckEvidence | null {
	return evidenceByTaskId.get(taskId) ?? null;
}

export function forgetPropertyCheckEvidence(taskId: string): void {
	evidenceByTaskId.delete(taskId);
}
