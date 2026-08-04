import { RUNTIME_NKLEIN_MIN_CONTEXT_WINDOW_TOKENS } from "../core/api-contract";

export const NKLEIN_MIN_CONTEXT_WINDOW_TOKENS = RUNTIME_NKLEIN_MIN_CONTEXT_WINDOW_TOKENS;

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

/** The stable signature shared by both refusal messages ({@link evaluateNKleinContextWindowPolicy}). */
const CONTEXT_WINDOW_POLICY_MESSAGE_SIGNATURE = "before this model can be activated";

/**
 * Whether a start-failure MESSAGE (a plain string — e.g. a `startResult.error`) is a context-window-floor refusal.
 * A message-level check is needed because the failure crosses process/serialization boundaries as a string, where
 * {@link isNKleinContextWindowPolicyError}'s `instanceof` no longer applies. Lets a caller turn an opaque
 * "unknown_code" auto-start failure into an operator-actionable "reload the model at ≥Nk context" signal.
 */
export function isContextWindowPolicyMessage(message: string | null | undefined): boolean {
	return typeof message === "string" && message.includes(CONTEXT_WINDOW_POLICY_MESSAGE_SIGNATURE);
}

/**
 * The operator-actionable remedy appended when a card can't start because its model is below the floor.
 * Runtime-NEUTRAL by design (P17.1 breakpoint (a), 2026-08-04): the old string said `lms load …`
 * unconditionally — advice aimed at a runtime the refused provider may not be (the mlx-serve probe read it
 * while no lms existed anywhere). The floor message itself already names `provider:model`; this names one
 * lever per runtime class plus the always-available per-model override.
 */
export function contextFloorRemedyHint(): string {
	const floor = formatNKleinContextWindowTokens(NKLEIN_MIN_CONTEXT_WINDOW_TOKENS);
	return `Give the model at least ${floor} context tokens at its runtime (LM Studio: \`lms load <model> --context-length 32768\`; other local runtimes: raise the serve context, or set a per-model context-window override in Settings → Models), then it will auto-start.`;
}
