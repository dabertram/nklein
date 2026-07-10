/**
 * The REFLECTION-LOOP capture seam (§13d, David's must-have). Run the simulator as a PASSTHROUGH RECORD PROXY in
 * front of the real LM Studio / Ollama endpoint: !Klein points its provider baseUrl at this proxy, works normally
 * against REAL models, and every request/response is saved as an aimock fixture on disk. A later `distill` step
 * folds those recordings into scenario tracks (keyed by the failure catalog), so the mock library grows with
 * everything real usage surfaces — no !Klein code change, no workflow disruption.
 *
 * aimock does the recording (its `record` config; NOTE proxyOnly=true would DISABLE saving); this is the thin,
 * !Klein-free factory + the on-disk shape the distiller reads.
 */

import { LLMock } from "@copilotkit/aimock";

export interface RecordProxyOptions {
	/** Where to bind (0 = ephemeral). */
	port?: number;
	/** The REAL upstream OpenAI-compatible base — e.g. LM Studio `http://127.0.0.1:1234` or an Ollama endpoint. */
	upstreamOpenAiUrl: string;
	/** Directory the captured fixtures are written to (one library per capture campaign). */
	fixturePath: string;
	/**
	 * IMPORTANT aimock semantics (dist-verified 1.35.1): `proxyOnly: true` means proxy WITHOUT SAVING fixtures
	 * — the opposite of a capture campaign. Capture (default false here) proxies every request upstream AND
	 * persists each interaction as a fixture file; answers always come from upstream either way.
	 */
	proxyOnly?: boolean;
	/** Keep the exact dated model id ("qwen2.5-coder-14b@q4") instead of a canonical alias. Default true (local ids matter). */
	recordFullModelVersion?: boolean;
}

export interface RecordProxyHandle {
	start(): Promise<void>;
	stop(): Promise<void>;
	port(): number;
	/** The base URL !Klein's provider config points at while capturing. */
	url(): string;
	mock: LLMock;
}

/**
 * Create a passthrough record proxy. Both LM Studio and Ollama expose the OpenAI-compatible `/v1` surface, so the
 * `openai` provider slot is the right capture channel for either.
 */
export function createRecordProxy(options: RecordProxyOptions): RecordProxyHandle {
	const mock = new LLMock({
		port: options.port ?? 0,
		record: {
			providers: { openai: options.upstreamOpenAiUrl },
			fixturePath: options.fixturePath,
			proxyOnly: options.proxyOnly ?? false,
			recordFullModelVersion: options.recordFullModelVersion ?? true,
		},
	});
	return {
		mock,
		async start() {
			await mock.start();
		},
		async stop() {
			await mock.stop();
		},
		port() {
			return mock.port;
		},
		url() {
			return `http://127.0.0.1:${mock.port}/v1`;
		},
	};
}
