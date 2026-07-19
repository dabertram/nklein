/**
 * F3.5 "interrupt safely" — an {@link AgentModel} decorator that samples the IN-FLIGHT text stream with the
 * runaway-generation detector and aborts a degenerate turn instead of letting it burn the whole token budget.
 *
 * Placement: UNDER the transient-abort recovery wrapper (`recovery(runawayInterrupt(base))`), which buffers this
 * decorator's events — so an interrupt surfaces there as `thrownError` (a typed {@link RunawayGenerationInterruptError},
 * deliberately NOT retryable-transient: re-running the identical request would just run away again). The turn then
 * fails typed into the session-level §5.AA attempt ladder, whose prompt-variant/budget rungs own the re-frame.
 *
 * Safety rules mirror the recovery wrapper's: a turn that has emitted ANY tool-call delta is never interrupted
 * (aborting could orphan a side effect), and the abort is delivered through a DERIVED AbortSignal chained to the
 * caller's — the provider sees a normal cancellation, and a caller-initiated abort is never re-attributed to the
 * detector. OFF unless constructed (the runtime gates construction on NKLEIN_RUNAWAY_ABORT); with clean text the
 * pass-through is byte-identical.
 */
import type { AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { detectRunawayGeneration, type RunawayVerdict } from "../core/runaway-generation-detector";

/** Re-run the detector only every this-many newly streamed chars — sampling, not per-delta scanning. */
const DEFAULT_SAMPLE_INTERVAL_CHARS = 2_000;

export class RunawayGenerationInterruptError extends Error {
	readonly verdict: RunawayVerdict;
	constructor(verdict: RunawayVerdict) {
		super(`Runaway generation interrupted mid-stream: ${verdict.detail ?? verdict.reason ?? "degenerate output"}`);
		this.name = "RunawayGenerationInterruptError";
		this.verdict = verdict;
	}
}

export interface RunawayInterruptModelOptions {
	/** Detector override for tests; defaults to `detectRunawayGeneration`. */
	detect?: (text: string) => RunawayVerdict;
	/** Chars of new text between detector samples. */
	sampleIntervalChars?: number;
	/** Observability hook fired once per interrupt (telemetry/self-observation); must not throw. */
	onInterrupt?: (verdict: RunawayVerdict) => void;
}

/** Wrap `base` so a mid-stream runaway generation aborts the provider call and fails the turn typed. */
export function createRunawayInterruptModel(base: AgentModel, options: RunawayInterruptModelOptions = {}): AgentModel {
	const detect = options.detect ?? ((text: string) => detectRunawayGeneration(text));
	const sampleInterval = Math.max(1, options.sampleIntervalChars ?? DEFAULT_SAMPLE_INTERVAL_CHARS);
	return {
		stream(request: AgentModelRequest): AsyncIterable<AgentModelEvent> {
			return streamWithInterrupt(base, request, detect, sampleInterval, options.onInterrupt);
		},
	};
}

async function* streamWithInterrupt(
	base: AgentModel,
	request: AgentModelRequest,
	detect: (text: string) => RunawayVerdict,
	sampleInterval: number,
	onInterrupt: ((verdict: RunawayVerdict) => void) | undefined,
): AsyncGenerator<AgentModelEvent> {
	const controller = new AbortController();
	const outerSignal = request.signal;
	const forwardAbort = () => controller.abort(outerSignal?.reason);
	if (outerSignal?.aborted) {
		forwardAbort();
	} else {
		outerSignal?.addEventListener("abort", forwardAbort, { once: true });
	}
	let streamedText = "";
	let charsSinceSample = 0;
	let hadToolCall = false;
	try {
		const iterable = await base.stream({ ...request, signal: controller.signal });
		for await (const event of iterable) {
			if (event.type === "tool-call-delta") {
				hadToolCall = true;
			} else if (event.type === "text-delta" && event.text.length > 0) {
				streamedText += event.text;
				charsSinceSample += event.text.length;
			}
			yield event;
			if (!hadToolCall && charsSinceSample >= sampleInterval) {
				charsSinceSample = 0;
				const verdict = detect(streamedText);
				if (verdict.runaway) {
					controller.abort(new RunawayGenerationInterruptError(verdict));
					try {
						onInterrupt?.(verdict);
					} catch {
						// Observability must never mask the interrupt itself.
					}
					throw new RunawayGenerationInterruptError(verdict);
				}
			}
		}
	} finally {
		outerSignal?.removeEventListener("abort", forwardAbort);
	}
}
