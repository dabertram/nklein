import type { IncomingMessage } from "node:http";

/**
 * §5.U — small, closure-state-free HTTP request helpers lifted out of the `createRuntimeServer` closure in
 * `runtime-server`: read a request body with a hard byte cap, and resolve the remote IP. They depend only on their
 * `req` argument (no server state), so they are independently testable.
 */

/** Read the full request body as UTF-8, rejecting once more than `maxBytes` have arrived (default 4 KiB). */
export function readRequestBody(req: IncomingMessage, maxBytes = 4096): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > maxBytes) {
				reject(new Error("Request body too large"));
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
