/**
 * The simulator server — aimock wrapped with a compiled {@link ScenarioScript}. !Klein (or any agentic tool)
 * points its OpenAI-compatible provider baseUrl at `url()` and every LLM call is answered by the script: perfect
 * runs, scripted failures, chaos — at memory speed, no models loaded.
 */

import { LLMock } from "@copilotkit/aimock";
import { createLmStudioShim, type SimulatedModel } from "./aimock/lmstudio-shim.js";
import { compileScenarioScript, type CompileOptions } from "./aimock/track-compiler.js";
import type { ScenarioScript } from "./scenario/track-types.js";

export interface SimulatorServerOptions extends CompileOptions {
	/** 0 = ephemeral (read the bound port from `port()`). */
	port?: number;
	/**
	 * Declared model fleet for the LM Studio `/api/v0` + `/api/v1/models` shim — lets !Klein's fleet/residency/
	 * admission code run under the simulator. Omit to serve only the chat surface.
	 */
	models?: SimulatedModel[];
}

export interface SimulatorServer {
	start(): Promise<void>;
	stop(): Promise<void>;
	/** The bound port (valid after start). */
	port(): number;
	/** OpenAI-compatible base URL (…/v1) !Klein's provider config points at. */
	url(): string;
	/** The underlying mock — escape hatch for advanced fixtures/record mode. */
	mock: LLMock;
}

export function createSimulatorServer(script: ScenarioScript, options: SimulatorServerOptions = {}): SimulatorServer {
	const mock = new LLMock({ port: options.port ?? 0 });
	mock.addFixtures(compileScenarioScript(script, options));
	if (options.models && options.models.length > 0) {
		mock.mount("/api", createLmStudioShim({ models: options.models }));
	}
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
