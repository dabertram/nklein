/**
 * LM Studio `/api/v0` + `/api/v1/models` shim — a {@link Mountable} for aimock. No existing mock speaks LM
 * Studio's native model-catalog surface (residency, quant, context length, per-request stats), yet !Klein's fleet
 * logic (residency watcher, admission waits, context planning, the loaded-vs-available fleet strip) reads it. This
 * mount lets a scenario declare a fleet of models with load states so those code paths run under the simulator.
 *
 * Deliberately data-driven + free of !Klein imports.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Mountable } from "@copilotkit/aimock";

export interface SimulatedModel {
	/** The served id (what LM Studio reports as `id`). */
	id: string;
	/** "loaded" ⇒ resident (appears in the fleet strip as idle/running); "not-loaded" ⇒ available. */
	state: "loaded" | "not-loaded";
	/** Max context length (`/api/v0/models` `max_context_length` / loaded_context_length). */
	maxContextLength?: number;
	quantization?: string;
	/** Coarse family tag for readability (not required by LM Studio). */
	family?: string;
}

export interface LmStudioShimOptions {
	models: SimulatedModel[];
}

function modelPayload(model: SimulatedModel): Record<string, unknown> {
	return {
		id: model.id,
		object: "model",
		type: "llm",
		publisher: model.family ?? "aimock",
		state: model.state,
		max_context_length: model.maxContextLength ?? 32768,
		loaded_context_length: model.state === "loaded" ? (model.maxContextLength ?? 32768) : undefined,
		quantization: model.quantization ?? "Q4_K_M",
	};
}

/** Build the `/api/v0/models` + `/api/v1/models` mount for a declared model fleet. */
export function createLmStudioShim(options: LmStudioShimOptions): Mountable {
	const listBody = JSON.stringify({ data: options.models.map(modelPayload) });
	const nativeBody = JSON.stringify({ models: options.models.map(modelPayload) });
	const sendJson = (res: ServerResponse, body: string): void => {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(body);
	};
	return {
		// NOTE: aimock's mount("/api", …) STRIPS the mount prefix, so `pathname` here is the sub-path
		// (`/v0/models`, `/v1/models`), NOT the full request path (verified against aimock 1.35.1).
		async handleRequest(_req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
			// `/api/v0/models` (enhanced, `{data:[]}`) and `/api/v1/models` (native, `{models:[]}`).
			if (pathname === "/v0/models" || pathname.startsWith("/v0/models/")) {
				sendJson(res, listBody);
				return true;
			}
			if (pathname === "/v1/models" || pathname.startsWith("/v1/models/")) {
				sendJson(res, nativeBody);
				return true;
			}
			return false;
		},
		health() {
			return { status: "ok", models: options.models.length };
		},
	};
}
