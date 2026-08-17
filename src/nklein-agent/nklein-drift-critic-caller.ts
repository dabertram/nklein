/**
 * F12.92 / P18.4b — the PRODUCTION drift-critic model caller.
 *
 * Found 2026-08-11 by measuring rather than assuming: `NKLEIN_DRIFT_CRITIC=1` was exported on a real drain and
 * the run recorded ZERO drift events — because the flag was read NOWHERE in src. The pure core
 * (core/drift-critic.ts), the extension seam (`driftCriticCaller?`), and the wire tests (mock caller) all
 * existed; no production code ever constructed a caller, and the session runtime hardwired `undefined` at that
 * position. The enabled_but_silent shape, in the very item whose history documents it twice.
 *
 * Same transport pattern as `createOpenAiCompatPhaseOnePickCaller` (the neighbouring argument): a plain
 * OpenAI-compat chat call against the session's own endpoint and model. The critic consults the SAME local
 * model the worker runs on — a second opinion from a fresh context, not a stronger model.
 */

import { buildSessionRequestRecord } from "../core/session-request-log";
import { appendSessionRequestRecord, isSessionRequestLogEnabled } from "../state/session-request-log-store";
import type { DriftCriticModelCaller } from "./nklein-context-focus-extension";

export function createOpenAiCompatDriftCriticCaller(config: {
	baseUrl: string;
	modelId: string;
	maxTokens?: number;
}): DriftCriticModelCaller {
	const base = config.baseUrl.replace(/\/$/, "");
	const url = base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
	return async (prompt: string): Promise<string | null> => {
		// §dsh#31 A2: this is one of the three raw-fetch strays outside the LocalLlmClient choke point — tap it
		// directly so the request log stays total over model-bound requests.
		if (isSessionRequestLogEnabled()) {
			void appendSessionRequestRecord(
				buildSessionRequestRecord({
					sessionId: `drift-critic:${config.modelId}`,
					source: "local_llm_client",
					purpose: "drift_critic",
					modelId: config.modelId,
					recordedAt: new Date().toISOString(),
					messages: [{ role: "user", content: prompt }],
				}),
			);
		}
		const response = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: config.modelId,
				temperature: 0,
				max_tokens: config.maxTokens ?? 512,
				messages: [{ role: "user", content: prompt }],
			}),
		});
		if (!response.ok) {
			// The extension treats a throwing critic as best-effort noise; null reads as on-track. Throw so the
			// failure is at least visible to its catch, rather than silently classifying the turn as healthy.
			throw new Error(`drift critic call failed (${response.status})`);
		}
		const json = (await response.json()) as {
			choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
		};
		const message = json.choices?.[0]?.message;
		// Reasoning models can burn the whole budget in reasoning_content and return empty content (live-found
		// with the §5.AB eval harness) — fall back so the verdict is parsed from what the model actually said.
		const text = message?.content?.trim() || message?.reasoning_content?.trim() || "";
		return text.length > 0 ? text : null;
	};
}
