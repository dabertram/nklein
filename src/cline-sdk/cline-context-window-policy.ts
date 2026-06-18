export const CLINE_MIN_CONTEXT_WINDOW_TOKENS = 32_000;

export interface ClineContextWindowPolicyInput {
	providerId: string;
	modelId?: string | null;
	contextWindow?: number | null;
	label?: string | null;
}

export type ClineContextWindowPolicyResult =
	| {
			ok: true;
			contextWindow: number;
	  }
	| {
			ok: false;
			contextWindow: number | null;
			message: string;
	  };

export class ClineContextWindowPolicyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ClineContextWindowPolicyError";
	}
}

export function isClineContextWindowPolicyError(error: unknown): error is ClineContextWindowPolicyError {
	return error instanceof ClineContextWindowPolicyError;
}

export function normalizeClineContextWindow(value: number | null | undefined): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return null;
	}
	return Math.trunc(value);
}

export function formatClineContextWindowTokens(value: number): string {
	return value.toLocaleString();
}

function formatModelReference(input: ClineContextWindowPolicyInput): string {
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

export function evaluateClineContextWindowPolicy(input: ClineContextWindowPolicyInput): ClineContextWindowPolicyResult {
	const contextWindow = normalizeClineContextWindow(input.contextWindow);
	const minContextWindow = formatClineContextWindowTokens(CLINE_MIN_CONTEXT_WINDOW_TOKENS);
	const label = input.label?.trim() || "Selected Cline model";
	const modelReference = formatModelReference(input);
	if (contextWindow === null) {
		return {
			ok: false,
			contextWindow: null,
			message: `${label} ${modelReference} does not report a context window. !Klein requires at least ${minContextWindow} context tokens before this model can be activated.`,
		};
	}
	if (contextWindow < CLINE_MIN_CONTEXT_WINDOW_TOKENS) {
		return {
			ok: false,
			contextWindow,
			message: `${label} ${modelReference} reports ${formatClineContextWindowTokens(contextWindow)} context tokens. !Klein requires at least ${minContextWindow} before this model can be activated.`,
		};
	}
	return {
		ok: true,
		contextWindow,
	};
}

export function assertClineContextWindowPolicy(input: ClineContextWindowPolicyInput): number {
	const result = evaluateClineContextWindowPolicy(input);
	if (!result.ok) {
		throw new ClineContextWindowPolicyError(result.message);
	}
	return result.contextWindow;
}
