export const NKLEIN_MIN_CONTEXT_WINDOW_TOKENS = 32_000;

export interface NKleinContextWindowPolicyInput {
	providerId: string;
	modelId?: string | null;
	contextWindow?: number | null;
	label?: string | null;
}

export type NKleinContextWindowPolicyResult =
	| {
			ok: true;
			contextWindow: number;
	  }
	| {
			ok: false;
			contextWindow: number | null;
			message: string;
	  };

export class NKleinContextWindowPolicyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NKleinContextWindowPolicyError";
	}
}

export function isNKleinContextWindowPolicyError(error: unknown): error is NKleinContextWindowPolicyError {
	return error instanceof NKleinContextWindowPolicyError;
}

export function normalizeNKleinContextWindow(value: number | null | undefined): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return null;
	}
	return Math.trunc(value);
}

export function formatNKleinContextWindowTokens(value: number): string {
	return value.toLocaleString();
}

function formatModelReference(input: NKleinContextWindowPolicyInput): string {
	const providerId = input.providerId.trim();
	const modelId = input.modelId?.trim();
	if (!providerId && !modelId) {
		return "selected model";
	}
	if (!modelId) {
		return providerId;
	}
	if (!providerId) {
		return modelId;
	}
	return `${providerId}:${modelId}`;
}

export function evaluateNKleinContextWindowPolicy(
	input: NKleinContextWindowPolicyInput,
): NKleinContextWindowPolicyResult {
	const contextWindow = normalizeNKleinContextWindow(input.contextWindow);
	const minContextWindow = formatNKleinContextWindowTokens(NKLEIN_MIN_CONTEXT_WINDOW_TOKENS);
	const label = input.label?.trim() || "Selected !Klein model";
	const modelReference = formatModelReference(input);
	if (contextWindow === null) {
		return {
			ok: false,
			contextWindow: null,
			message: `${label} ${modelReference} does not report a context window. !Klein requires at least ${minContextWindow} context tokens before this model can be activated.`,
		};
	}
	if (contextWindow < NKLEIN_MIN_CONTEXT_WINDOW_TOKENS) {
		return {
			ok: false,
			contextWindow,
			message: `${label} ${modelReference} reports ${formatNKleinContextWindowTokens(contextWindow)} context tokens. !Klein requires at least ${minContextWindow} before this model can be activated.`,
		};
	}
	return {
		ok: true,
		contextWindow,
	};
}

export function assertNKleinContextWindowPolicy(input: NKleinContextWindowPolicyInput): number {
	const result = evaluateNKleinContextWindowPolicy(input);
	if (!result.ok) {
		throw new NKleinContextWindowPolicyError(result.message);
	}
	return result.contextWindow;
}
