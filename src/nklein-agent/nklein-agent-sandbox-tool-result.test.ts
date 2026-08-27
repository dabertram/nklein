import { describe, expect, it } from "vitest";
import { formatSandboxToolFailure, parseToolRunnerResult } from "./nklein-agent-sandbox-tool-result";

// Live-found (.real-runs/20260827-052346): a worker ran `npm test` ~30 times without ever writing code, because a
// non-zero command exit was framed as a sandbox failure with "retry with a smaller request" — wrong advice for a
// command that RAN and returned non-zero (a failing test/build). The formatter now steers it to fix the code.

describe("formatSandboxToolFailure — command exit-code guidance", () => {
	it("steers the model to FIX the code (not retry) when a command exited non-zero", () => {
		const msg = formatSandboxToolFailure(
			"bash",
			"Command exited with code 1\n[stderr] test failed: expected 2 got 3",
		);
		expect(msg).toContain("NON-ZERO exit code");
		expect(msg).toContain("FIX the underlying code");
		expect(msg).not.toContain("retry with a smaller");
	});

	it("matches the common phrasings of a non-zero exit", () => {
		for (const detail of ["exited with code 2", "exited with a non-zero code", "process exit code 127"]) {
			expect(formatSandboxToolFailure("bash", detail)).toContain("FIX the underlying code");
		}
	});

	it("keeps the generic retry guidance for an unknown, non-exit-code failure", () => {
		const msg = formatSandboxToolFailure("bash", "permission denied writing to the mounted volume");
		expect(msg).toContain("retry with a smaller focused bash request");
		expect(msg).not.toContain("FIX the underlying code");
	});
});

describe("parseToolRunnerResult", () => {
	it("decodes the ok envelope", () => {
		expect(parseToolRunnerResult('{"ok":true,"result":"hello"}')).toEqual({ ok: true, result: "hello" });
	});

	it("decodes the error envelope", () => {
		expect(parseToolRunnerResult('{"ok":false,"error":"boom"}')).toEqual({ ok: false, error: "boom" });
	});

	it("degrades non-envelope output to a plain-text error", () => {
		const result = parseToolRunnerResult("not json at all");
		expect(result.ok).toBe(false);
	});
});
