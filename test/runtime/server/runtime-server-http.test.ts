import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { getRemoteIp, readRequestBody } from "../../../src/server/runtime-server-http";

const asReq = (stream: PassThrough): IncomingMessage => stream as unknown as IncomingMessage;

describe("readRequestBody (§5.U extraction)", () => {
	it("reads the full UTF-8 body from the request stream", async () => {
		const stream = new PassThrough();
		const promise = readRequestBody(asReq(stream));
		stream.write("hello ");
		stream.write("world");
		stream.end();
		await expect(promise).resolves.toBe("hello world");
	});

	it("resolves empty for a body-less request", async () => {
		const stream = new PassThrough();
		const promise = readRequestBody(asReq(stream));
		stream.end();
		await expect(promise).resolves.toBe("");
	});

	it("rejects once the body exceeds the byte cap", async () => {
		const stream = new PassThrough();
		const promise = readRequestBody(asReq(stream), 8);
		stream.write("0123456789"); // 10 bytes > cap 8
		await expect(promise).rejects.toThrow(/too large/);
	});

	it("propagates a stream error", async () => {
		const stream = new PassThrough();
		const promise = readRequestBody(asReq(stream));
		stream.emit("error", new Error("socket reset"));
		await expect(promise).rejects.toThrow(/socket reset/);
	});
});

describe("getRemoteIp (§5.U extraction)", () => {
	it("returns the socket remote address when present", () => {
		expect(getRemoteIp({ socket: { remoteAddress: "10.0.0.4" } } as IncomingMessage)).toBe("10.0.0.4");
	});

	it("falls back to 'unknown' when there is no remote address", () => {
		expect(getRemoteIp({ socket: {} } as IncomingMessage)).toBe("unknown");
	});
});
