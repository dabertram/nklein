/**
 * §dsh#31 slice A2 — the SDK-side SESSION REQUEST LOG tap: an {@link AgentModel} decorator that records the
 * request it is handed, verbatim, then passes through untouched.
 *
 * Placement is the whole point: it wraps `base` — the INNERMOST model, before any other decorator — inside the
 * runtime's `modelWrapper`, so what it sees is the FINAL request after every `beforeModel` hook, messageBuilder,
 * and outer decorator (context_shrink, retry notes, prompt variants) has run. That makes its record the wire
 * truth for the whole SDK session family, which the slice-A divergence audit compares against the durable
 * `.messages.json` snapshot. Recording is observe-first gated (NKLEIN_SESSION_REQUEST_LOG=1) and best-effort:
 * it must never delay or break a turn.
 */

import type { AgentModel, AgentModelRequest } from "@cline/shared";
import { buildSessionRequestRecord, type SessionRequestWireMessage } from "../core/session-request-log";
import { appendSessionRequestRecord, isSessionRequestLogEnabled } from "../state/session-request-log-store";
import { agentMessageToEndpointText } from "./local-alternate-endpoint-model";

export interface SessionRequestLogScope {
	sessionId: string;
	modelId: string;
	purpose: string;
}

/** Flatten the SDK request to wire rows with the SAME flattener the local endpoint path uses. */
function toWireMessages(request: AgentModelRequest): SessionRequestWireMessage[] {
	return request.messages.map((message) => ({
		role: message.role,
		content: agentMessageToEndpointText(message),
	}));
}

function recordBestEffort(request: AgentModelRequest, scope: SessionRequestLogScope): void {
	try {
		if (!isSessionRequestLogEnabled()) {
			return;
		}
		const record = buildSessionRequestRecord({
			sessionId: scope.sessionId,
			source: "sdk_model_wrapper",
			purpose: scope.purpose,
			modelId: scope.modelId,
			recordedAt: new Date().toISOString(),
			...(request.systemPrompt !== undefined ? { systemPrompt: request.systemPrompt } : {}),
			messages: toWireMessages(request),
			toolNames: request.tools.map((tool) => tool.name),
		});
		void appendSessionRequestRecord(record);
	} catch {
		// The tap is observational; a failure to record must never fail the turn.
	}
}

/** Wrap `base` so every request that reaches the provider is appended to the session request log. */
export function createSessionRequestLogModel(base: AgentModel, scope: SessionRequestLogScope): AgentModel {
	return {
		// Return type mirrors AgentModel.stream verbatim (it may be a promise of an iterable) — pass through as-is.
		stream(request: AgentModelRequest) {
			recordBestEffort(request, scope);
			return base.stream(request);
		},
	};
}
