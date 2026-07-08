/**
 * §5.AB endpoint-iteration — the retry-loop ORCHESTRATOR that ties the try-order decider, the per-endpoint clients, and
 * the per-model persistence together: try each endpoint kind in the strategy order until one produces a USABLE result
 * (e.g. an actual tool call when one was needed), and report the winning kind so the caller can record it into the
 * §5.AB ModelBehaviorProfile (`winningEndpointKind` → `endpointKindCounts` → the next call's `preferredKind`).
 *
 * Pure orchestration over an INJECTED `attempt(kind) → usable?` callback (in real use it dispatches to
 * `callLocalAnthropicMessages` / `callLocalNativeChat` for the resolved URL of that kind) — so the loop is fully
 * unit-testable without a live server. Defensive: an endpoint whose attempt THROWS (dead server, refused) is recorded
 * as not-usable and the ladder moves on rather than aborting — a broken protocol shouldn't sink the others.
 */

import {
	type EndpointStrategyOrderInput,
	type LocalModelEndpointKind,
	orderEndpointStrategies,
} from "./local-model-endpoint-strategy.js";

export interface EndpointAttemptOutcome {
	kind: LocalModelEndpointKind;
	/** Did this endpoint produce a usable result? */
	usable: boolean;
	/** When the attempt threw (dead/refused endpoint), the error message — recorded, not propagated. */
	error?: string;
}

export interface EndpointIterationResult {
	/** The first kind that produced a usable result, or null when every eligible kind was exhausted without one. */
	winningKind: LocalModelEndpointKind | null;
	/** Every kind attempted, in order, with its usable verdict (for the ledger + the calibration read). */
	attempts: EndpointAttemptOutcome[];
}

export interface EndpointIterationInput extends EndpointStrategyOrderInput {
	/**
	 * Attempt a call over the given endpoint kind; resolve `true` when the result is USABLE (short-circuits the ladder).
	 * May throw — a thrown attempt is recorded as not-usable and the ladder continues to the next kind.
	 */
	attempt: (kind: LocalModelEndpointKind) => Promise<boolean>;
}

/**
 * Iterate the endpoint kinds in the strategy order (learned winner first — see {@link orderEndpointStrategies}), trying
 * each until one is usable. Returns the winning kind + every attempt's verdict. Stops at the first usable kind (the
 * cheapest success); returns `winningKind: null` when none succeed. Pure over the injected `attempt`.
 */
export async function iterateEndpointStrategies(input: EndpointIterationInput): Promise<EndpointIterationResult> {
	const order = orderEndpointStrategies(input);
	const attempts: EndpointAttemptOutcome[] = [];
	for (const kind of order) {
		try {
			const usable = await input.attempt(kind);
			attempts.push({ kind, usable });
			if (usable) {
				return { winningKind: kind, attempts };
			}
		} catch (error) {
			attempts.push({ kind, usable: false, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return { winningKind: null, attempts };
}
