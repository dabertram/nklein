import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
	INGRESS_REQUEST_BODY_MAX_BYTES,
	RequestBodyTooLargeError,
	readRequestBody,
} from "../../../src/server/runtime-server-http";

/**
 * The ingress-vs-control-surface body cap (live-found 2026-08-05): a 77 KiB task spec posted to /a2a/v1 was
 * rejected as "Invalid request body" — the 4 KiB control-surface default applied to an ingress whose payload
 * IS the task description, reported as if the JSON were malformed.
 */
function fakeRequest(chunks: string[]): IncomingMessage {
	const emitter = new EventEmitter() as IncomingMessage;
	queueMicrotask(() => {
		for (const chunk of chunks) {
			emitter.emit("data", Buffer.from(chunk, "utf8"));
		}
		emitter.emit("end");
	});
	return emitter;
}

describe("readRequestBody", () => {
	it("keeps the small 4 KiB default for the control surface", async () => {
		await expect(readRequestBody(fakeRequest(["x".repeat(5_000)]))).rejects.toBeInstanceOf(RequestBodyTooLargeError);
	});

	it("accepts a realistic task description at the INGRESS cap (the 77 KiB spec that failed live)", async () => {
		const spec = "s".repeat(77_000);
		await expect(readRequestBody(fakeRequest([spec]), INGRESS_REQUEST_BODY_MAX_BYTES)).resolves.toHaveLength(77_000);
	});

	it("too-large is its OWN error type, so a caller can say which failure it was", async () => {
		const error = await readRequestBody(fakeRequest(["y".repeat(2_000)]), 1_000).catch((caught) => caught);
		expect(error).toBeInstanceOf(RequestBodyTooLargeError);
		expect((error as RequestBodyTooLargeError).maxBytes).toBe(1_000);
	});

	it("the ingress cap is bounded — an ingress is not an upload endpoint", () => {
		expect(INGRESS_REQUEST_BODY_MAX_BYTES).toBe(1024 * 1024);
	});
});
