/**
 * P0.POOLLOSS — the per-model CRASH SIGNATURE: the last error a model's wire returned, kept in memory so a pool
 * loss can be reported WITH its cause ("500 … then gone") instead of as a bare absence. Fed by the session wire
 * tap (F2.30(e) captures every response, error included; bounded mode is the default). One entry per model id —
 * the newest error wins; an endpoint is not part of the key because the tap's scope does not carry one.
 *
 * Best-effort by design: a model that vanished without ever answering an error has no signature, and the notice
 * says so rather than inventing one.
 */

export interface ModelWireError {
	readonly modelId: string;
	readonly message: string;
	readonly atMs: number;
	readonly sessionId: string | null;
}

const MAX_MESSAGE_CHARS = 300;
const lastErrorByModelId = new Map<string, ModelWireError>();

export function recordModelWireError(input: {
	modelId: string;
	message: string;
	atMs?: number;
	sessionId?: string | null;
}): ModelWireError | null {
	const modelId = input.modelId.trim();
	const message = input.message.trim();
	if (!modelId || !message) {
		return null;
	}
	const entry: ModelWireError = {
		modelId,
		message: message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS)}…` : message,
		atMs: input.atMs ?? Date.now(),
		sessionId: input.sessionId ?? null,
	};
	lastErrorByModelId.set(modelId, entry);
	return entry;
}

export function getLastModelWireError(modelId: string): ModelWireError | undefined {
	return lastErrorByModelId.get(modelId.trim());
}

export function resetModelWireErrorLedgerForTests(): void {
	lastErrorByModelId.clear();
}
