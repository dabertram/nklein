import { describe, expect, it } from "vitest";
import type { RawData } from "ws";
import { parseWebSocketPayload, rawDataToBuffer } from "../../../src/terminal/ws-payload-parsing";

describe("rawDataToBuffer", () => {
	it("encodes a string frame as utf8", () => {
		// ws can deliver a text frame as a string even though RawData's type omits it.
		expect(rawDataToBuffer("hi" as unknown as RawData).toString("utf8")).toBe("hi");
	});

	it("returns a Buffer frame unchanged (no copy)", () => {
		const buf = Buffer.from("abc");
		expect(rawDataToBuffer(buf)).toBe(buf);
	});

	it("concatenates a fragmented Buffer[] frame", () => {
		expect(rawDataToBuffer([Buffer.from("ab"), Buffer.from("cd")]).toString("utf8")).toBe("abcd");
	});

	it("copies an ArrayBuffer frame into a Buffer", () => {
		const arrayBuffer = new Uint8Array([104, 105]).buffer; // "hi"
		expect(rawDataToBuffer(arrayBuffer).toString("utf8")).toBe("hi");
	});
});

describe("parseWebSocketPayload", () => {
	it("parses a valid terminal control message", () => {
		expect(parseWebSocketPayload(Buffer.from(JSON.stringify({ type: "restore_complete" })))).toEqual({
			type: "restore_complete",
		});
		expect(parseWebSocketPayload(Buffer.from(JSON.stringify({ type: "output_ack", bytes: 42 })))).toEqual({
			type: "output_ack",
			bytes: 42,
		});
	});

	it("returns null for non-JSON input", () => {
		expect(parseWebSocketPayload(Buffer.from("not json"))).toBeNull();
	});

	it("returns null for JSON that does not match the client-message schema", () => {
		expect(parseWebSocketPayload(Buffer.from(JSON.stringify({ type: "bogus" })))).toBeNull();
		expect(parseWebSocketPayload(Buffer.from(JSON.stringify({ type: "output_ack", bytes: -1 })))).toBeNull();
	});
});
