/**
 * §5.AB endpoint-iteration — the effectful HTTP clients for the `anthropic_messages` + `native_v1_chat` endpoint kinds,
 * built on the pure wire-shape cores ({@link buildAnthropicMessagesRequest}/{@link parseAnthropicMessagesResponse},
 * {@link buildNativeChatRequest}/{@link parseNativeChatResponse}). Each client: LOCAL-ONLY guards the URL (prime
 * directive #1 — a non-local endpoint is refused, never reached), POSTs the built request via an INJECTED `fetch`
 * (default global; injected in tests → no live server needed), retries transient network blips, and returns the parsed
 * result. So the client is fully unit-testable now; a live run only confirms which shape a given local server emits.
 *
 * This is for a LOCAL server exposing an Anthropic-Messages- or native-chat-compatible surface — NOT any managed cloud
 * provider (the local-only guard confines that literal to boundary files).
 */

import { isLocalBaseUrl } from "../nklein-agent/nklein-local-only-policy.js";
import {
	type AnthropicMessagesRequestInput,
	buildAnthropicMessagesRequest,
	type ParsedAnthropicMessagesResponse,
	parseAnthropicMessagesResponse,
} from "./local-messages-api-shape.js";
import {
	buildNativeChatRequest,
	type NativeChatRequestInput,
	type ParsedNativeChatResponse,
	parseNativeChatResponse,
} from "./local-native-chat-shape.js";
import { withTransientRetry } from "./transient-error.js";

/** Raised when the endpoint is non-local (refused) or the server returns a non-2xx status. */
export class LocalEndpointError extends Error {
	readonly status: number | null;
	constructor(message: string, status: number | null = null) {
		super(message);
		this.name = "LocalEndpointError";
		this.status = status;
	}
}

/** POST a JSON body to a LOCAL endpoint URL and return the parsed JSON, with a bounded transient retry. */
async function postLocalJson(url: string, body: unknown, fetchImpl: typeof fetch): Promise<unknown> {
	if (!isLocalBaseUrl(url)) {
		throw new LocalEndpointError(`Refusing to reach non-local endpoint: ${url} (local-only, prime directive #1).`);
	}
	const attempt = async (): Promise<unknown> => {
		const response = await fetchImpl(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!response.ok) {
			throw new LocalEndpointError(`Endpoint ${url} returned HTTP ${response.status}.`, response.status);
		}
		return response.json();
	};
	return withTransientRetry(attempt, { maxRetries: 2 });
}

export interface LocalAnthropicMessagesCallInput extends AnthropicMessagesRequestInput {
	/** The full `/v1/messages` endpoint URL (must be local). */
	url: string;
	/** Injected for testing; defaults to global fetch. */
	fetchImpl?: typeof fetch;
}

/** Call a local Anthropic-Messages-compatible endpoint and return the parsed text + tool calls + stop reason. */
export async function callLocalAnthropicMessages(
	input: LocalAnthropicMessagesCallInput,
): Promise<ParsedAnthropicMessagesResponse> {
	const { url, fetchImpl, ...requestInput } = input;
	const body = buildAnthropicMessagesRequest(requestInput);
	const json = await postLocalJson(url, body, fetchImpl ?? fetch);
	return parseAnthropicMessagesResponse(json);
}

export interface LocalNativeChatCallInput extends NativeChatRequestInput {
	/** The full native `/api/v1/chat` endpoint URL (must be local). */
	url: string;
	/** Injected for testing; defaults to global fetch. */
	fetchImpl?: typeof fetch;
}

/** Call a local native `/api/v1/chat` endpoint and return the parsed text + reasoning + structured tool calls. */
export async function callLocalNativeChat(input: LocalNativeChatCallInput): Promise<ParsedNativeChatResponse> {
	const { url, fetchImpl, ...requestInput } = input;
	const body = buildNativeChatRequest(requestInput);
	const json = await postLocalJson(url, body, fetchImpl ?? fetch);
	return parseNativeChatResponse(json);
}
