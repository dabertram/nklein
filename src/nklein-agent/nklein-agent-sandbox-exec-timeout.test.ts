import { describe, expect, it } from "vitest";
import { resolveSandboxExecTimeoutMs } from "./nklein-agent-sandbox";

// Live-found 2026-08-27 (`.real-runs/20260827-012026`): a worker's `npx -y tsx --test` first-run install exceeded
// the 30s default sandbox exec ceiling, so its acceptance never went green and the card stuck In Progress until the
// bed cap. User-code tools now get a generous ceiling; the fast structured tools keep the short one.

describe("resolveSandboxExecTimeoutMs", () => {
	it("gives the shell tool a generous ceiling (a slow npx install / test suite must not be killed at 30s)", () => {
		expect(resolveSandboxExecTimeoutMs("bash")).toBeGreaterThanOrEqual(120_000);
	});

	it("gives the test/capture tools the same generous ceiling", () => {
		expect(resolveSandboxExecTimeoutMs("propertyCheck")).toBeGreaterThanOrEqual(120_000);
		expect(resolveSandboxExecTimeoutMs("visualCapture")).toBeGreaterThanOrEqual(120_000);
	});

	it("keeps the fast structured tools at the short 30s ceiling so a genuine hang there fails fast", () => {
		expect(resolveSandboxExecTimeoutMs("readFile")).toBe(30_000);
		expect(resolveSandboxExecTimeoutMs("editor")).toBe(30_000);
		expect(resolveSandboxExecTimeoutMs("search")).toBe(30_000);
		expect(resolveSandboxExecTimeoutMs("applyPatch")).toBe(30_000);
	});

	it("the shell ceiling is strictly longer than the fast-tool ceiling", () => {
		expect(resolveSandboxExecTimeoutMs("bash")).toBeGreaterThan(resolveSandboxExecTimeoutMs("readFile"));
	});
});
