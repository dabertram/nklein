import type { IncomingMessage } from "node:http";

/**
 * §5.U — small, closure-state-free HTTP request helpers lifted out of the `createRuntimeServer` closure in
 * `runtime-server`: read a request body with a hard byte cap, and resolve the remote IP. They depend only on their
 * `req` argument (no server state), so they are independently testable.
 */

/** Read the full request body as UTF-8, rejecting once more than `maxBytes` have arrived (default 4 KiB). */
/**
 * The body cap for EXTERNAL-INGRESS endpoints (A2A SendMessage, external-trigger intake) — the ones whose
 * payload IS a task description.
 *
 * The 4 KiB default below is right for the control surface (small JSON commands) and WRONG for ingress: a real
 * agent-to-agent task is a spec, an issue body, a bug report. Live-found 2026-08-05 — a 77 KiB project spec
 * posted to `/a2a/v1` was rejected with "Invalid request body", which reads as malformed JSON and sent the
 * caller looking in the wrong place entirely. The soak harness never caught it because its prompts are ~100
 * bytes; nothing about a small-prompt test says anything about a realistic one.
 */
export const INGRESS_REQUEST_BODY_MAX_BYTES = 1024 * 1024;

/** Thrown when the body exceeded the cap — distinct from a parse failure, so callers can say WHICH happened. */
export class RequestBodyTooLargeError extends Error {
	constructor(readonly maxBytes: number) {
		// Keeps the pre-existing "too large" wording its callers/tests match on — the NEW information here is the
		// error TYPE and the cap, not a rewording.
		super(`Request body too large (limit ${maxBytes} bytes).`);
		this.name = "RequestBodyTooLargeError";
	}
}

export function readRequestBody(req: IncomingMessage, maxBytes = 4096): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > maxBytes) {
				reject(new RequestBodyTooLargeError(maxBytes));
				return;
			}
			body += chunk.toString("utf8");
		});
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}

/** The remote IP of a request, or `"unknown"` when the socket has none. */
export function getRemoteIp(req: IncomingMessage): string {
	return req.socket.remoteAddress ?? "unknown";
}
