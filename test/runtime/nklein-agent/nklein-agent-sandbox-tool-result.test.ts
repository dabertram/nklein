import { describe, expect, it } from "vitest";
import {
	formatSandboxToolFailure,
	parseToolRunnerResult,
} from "../../../src/nklein-agent/nklein-agent-sandbox-tool-result";

describe("parseToolRunnerResult", () => {
	it("decodes a success envelope, preserving the result payload", () => {
		expect(parseToolRunnerResult('{"ok":true,"result":{"x":1}}')).toEqual({ ok: true, result: { x: 1 } });
	});

	it("decodes a failure envelope with the provided error string", () => {
		expect(parseToolRunnerResult('{"ok":false,"error":"boom"}')).toEqual({ ok: false, error: "boom" });
	});

	it("falls back to a generic error when ok is false but no error string is given", () => {
		expect(parseToolRunnerResult('{"ok":false}')).toEqual({ ok: false, error: "Tool runner failed." });
	});

	it("treats valid JSON without an `ok` field as a plain-text error of the raw output", () => {
		expect(parseToolRunnerResult('{"foo":1}')).toEqual({ ok: false, error: '{"foo":1}' });
	});

	it("treats non-JSON output as a trimmed plain-text error", () => {
		expect(parseToolRunnerResult("  not json  ")).toEqual({ ok: false, error: "not json" });
	});

	it("reports invalid JSON when the output is empty", () => {
		expect(parseToolRunnerResult("   ")).toEqual({ ok: false, error: "Tool runner returned invalid JSON." });
	});
});

describe("formatSandboxToolFailure", () => {
	it("includes the tool name, the detail block, and the next-step hint", () => {
		expect(formatSandboxToolFailure("run_command", "exit 1")).toBe(
			"Sandbox tool run_command failed.\nexit 1\nNext step: inspect the command, file path, permissions, and sandbox output above; then retry with a smaller focused run_command request.",
		);
	});

	it("normalizes a blank tool name to 'unknown' and omits an empty detail block", () => {
		const message = formatSandboxToolFailure("  ", "  ");
		expect(message).toBe(
			"Sandbox tool unknown failed.\nNext step: inspect the command, file path, permissions, and sandbox output above; then retry with a smaller focused unknown request.",
		);
	});
});
