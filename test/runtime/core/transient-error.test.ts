import { describe, expect, it } from "vitest";
import { isTransientNetworkError } from "../../../src/core/transient-error";

describe("isTransientNetworkError", () => {
	it("flags the undici timeouts a live scout actually hit", () => {
		expect(isTransientNetworkError("Agent error: Body Timeout Error")).toBe(true);
		expect(isTransientNetworkError(new Error("fetch failed"))).toBe(true);
		expect(isTransientNetworkError(new Error("HeadersTimeoutError: Headers Timeout Error"))).toBe(true);
	});

	it("reads the undici code off error.cause", () => {
		const err = new Error("fetch failed");
		(err as { cause?: unknown }).cause = new Error("UND_ERR_BODY_TIMEOUT");
		expect(isTransientNetworkError(err)).toBe(true);
	});

	it("flags connection blips and transient server states", () => {
		expect(isTransientNetworkError("read ECONNRESET")).toBe(true);
		expect(isTransientNetworkError("socket hang up")).toBe(true);
		expect(isTransientNetworkError(new Error("503 Service Unavailable"))).toBe(true);
		expect(isTransientNetworkError({ message: "The server is overloaded" })).toBe(true);
	});

	it("does NOT flag a genuine, non-transient failure", () => {
		expect(isTransientNetworkError("Type validation failed: invalid tool arguments")).toBe(false);
		expect(isTransientNetworkError(new Error("model declined to call a tool"))).toBe(false);
		expect(isTransientNetworkError(null)).toBe(false);
		expect(isTransientNetworkError(undefined)).toBe(false);
		expect(isTransientNetworkError(42)).toBe(false);
	});
});
