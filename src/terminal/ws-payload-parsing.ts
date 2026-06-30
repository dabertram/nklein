// Pure decoding of inbound terminal-WebSocket frames (extracted from ws-server.ts, §5.U). The `ws` library
// hands a message as a string, a Buffer, an ArrayBuffer, or a fragmented Buffer[]; these helpers normalize
// that to a single Buffer (for raw terminal input) or to a validated client control message (for JSON frames),
// returning null on any parse/validation failure so the bridge can ignore malformed frames.
import type { RawData } from "ws";
import { parseTerminalWsClientMessage } from "../core/api-validation";

/** Normalize any `ws` RawData frame (string / Buffer / ArrayBuffer / fragmented Buffer[]) to a single Buffer. */
export function rawDataToBuffer(message: RawData): Buffer {
	if (typeof message === "string") {
		return Buffer.from(message, "utf8");
	}
	if (Buffer.isBuffer(message)) {
		return message;
	}
	if (Array.isArray(message)) {
		return Buffer.concat(message.map((part) => rawDataToBuffer(part)));
	}
	return Buffer.from(message);
}

/** Parse a RawData frame as a JSON terminal control message, or null if it isn't valid JSON / fails validation. */
export function parseWebSocketPayload(message: RawData) {
	try {
		const text = typeof message === "string" ? message : message.toString("utf8");
		const parsed = JSON.parse(text) as unknown;
		return parseTerminalWsClientMessage(parsed);
	} catch {
		return null;
	}
}
