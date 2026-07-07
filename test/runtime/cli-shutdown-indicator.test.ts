import { describe, expect, it, vi } from "vitest";
import { createShutdownIndicator, isTerminalTeardownError } from "../../src/cli-shutdown-indicator";

describe("isTerminalTeardownError", () => {
	it("is true for an EIO-coded error or a setRawMode-EIO message", () => {
		expect(isTerminalTeardownError(Object.assign(new Error("io"), { code: "EIO" }))).toBe(true);
		expect(isTerminalTeardownError(new Error("setRawMode EIO (whatever follows)"))).toBe(true);
	});

	it("is false for other errors and non-errors", () => {
		expect(isTerminalTeardownError(Object.assign(new Error("pipe"), { code: "EPIPE" }))).toBe(false);
		expect(isTerminalTeardownError(new Error("some unrelated failure"))).toBe(false);
		expect(isTerminalTeardownError("EIO")).toBe(false);
		expect(isTerminalTeardownError(null)).toBe(false);
	});
});

// A minimal fake WriteStream: non-TTY so the indicator takes the plain-text path (no real spinner in tests).
function fakeStream(overrides: Partial<NodeJS.WriteStream> = {}): NodeJS.WriteStream {
	return { isTTY: false, write: vi.fn(() => true), ...overrides } as unknown as NodeJS.WriteStream;
}

describe("createShutdownIndicator (non-TTY plain-text path)", () => {
	it("writes 'Cleaning up...' on start and a result line on stop", () => {
		const stream = fakeStream();
		const indicator = createShutdownIndicator(stream);
		indicator.start();
		indicator.stop("done");
		const written = (stream.write as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).join("");
		expect(written).toContain("Cleaning up...");
		expect(written).toContain("Cleanup done.");
	});

	it("maps each result to its own suffix and is idempotent (stop without start is a no-op)", () => {
		const stream = fakeStream();
		const indicator = createShutdownIndicator(stream);
		indicator.stop("done"); // never started → no output
		expect((stream.write as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
		indicator.start();
		indicator.stop("interrupted");
		const written = (stream.write as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).join("");
		expect(written).toContain("Cleanup interrupted.");
	});

	it("swallows an EIO write failure (terminal teardown) but rethrows a real write error", () => {
		const eioStream = fakeStream({
			write: vi.fn(() => {
				throw Object.assign(new Error("write EIO"), { code: "EIO" });
			}) as unknown as NodeJS.WriteStream["write"],
		});
		expect(() => createShutdownIndicator(eioStream).start()).not.toThrow();

		const brokenStream = fakeStream({
			write: vi.fn(() => {
				throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
			}) as unknown as NodeJS.WriteStream["write"],
		});
		expect(() => createShutdownIndicator(brokenStream).start()).toThrow(/disk full/);
	});
});
