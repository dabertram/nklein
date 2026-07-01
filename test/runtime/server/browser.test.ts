import type open from "open";
import { describe, expect, it, vi } from "vitest";
import { openInBrowser } from "../../../src/server/browser";

// A stand-in for the `open` package: records calls, resolves or rejects as configured.
function fakeOpen(outcome: "resolve" | "reject") {
	return vi.fn((_url: string, _options?: unknown) =>
		outcome === "resolve" ? Promise.resolve(undefined) : Promise.reject(new Error("no browser")),
	) as unknown as typeof open;
}

describe("openInBrowser", () => {
	it("uses the xdg-open app option on Linux when xdg-open is on PATH", () => {
		const openUrl = fakeOpen("resolve");
		openInBrowser("http://localhost:3000", { openUrl, platform: "linux", isBinaryAvailable: () => true });
		expect(openUrl).toHaveBeenCalledWith("http://localhost:3000", { app: { name: "xdg-open" } });
	});

	it("passes no app option on Linux when xdg-open is absent", () => {
		const openUrl = fakeOpen("resolve");
		openInBrowser("http://localhost:3000", { openUrl, platform: "linux", isBinaryAvailable: () => false });
		expect(openUrl).toHaveBeenCalledWith("http://localhost:3000", undefined);
	});

	it("passes no app option on non-Linux platforms (even if a binary named xdg-open exists)", () => {
		const openUrl = fakeOpen("resolve");
		openInBrowser("http://localhost:3000", { openUrl, platform: "darwin", isBinaryAvailable: () => true });
		expect(openUrl).toHaveBeenCalledWith("http://localhost:3000", undefined);
	});

	it("warns with the manual URL when the browser fails to open", async () => {
		const openUrl = fakeOpen("reject");
		const warn = vi.fn();
		openInBrowser("http://localhost:3000/board", { openUrl, warn, platform: "darwin" });
		await new Promise((resolve) => setTimeout(resolve, 0)); // let the async .catch settle
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("http://localhost:3000/board"));
	});
});
