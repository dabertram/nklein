import { describe, expect, it } from "vitest";
import {
	formatTaskTimeoutFailureMessage,
	formatTaskTimeoutLabel,
	formatTaskTimeoutMessage,
	formatTaskTimeoutReason,
} from "../../../src/nklein-agent/nklein-task-timeout-diagnostics";

describe("formatTaskTimeoutLabel", () => {
	it("maps each timeout kind to its label", () => {
		expect(formatTaskTimeoutLabel("stream")).toBe("stream inactivity");
		expect(formatTaskTimeoutLabel("tool")).toBe("tool execution");
		expect(formatTaskTimeoutLabel("conversation")).toBe("conversation");
	});
});

describe("formatTaskTimeoutReason / formatTaskTimeoutMessage", () => {
	it("rounds the timeout to whole seconds", () => {
		expect(formatTaskTimeoutReason("stream inactivity", 30_000)).toBe("stream inactivity timeout after 30s");
		expect(formatTaskTimeoutReason("tool execution", 29_500)).toBe("tool execution timeout after 30s");
		expect(formatTaskTimeoutMessage("conversation", 45_000)).toBe("!Klein conversation timeout after 45 seconds");
	});
});

describe("formatTaskTimeoutFailureMessage", () => {
	it("includes the last-tool clause only when a tool is present", () => {
		expect(
			formatTaskTimeoutFailureMessage("stream inactivity", 30_000, {
				lastActivity: "reading file",
				lastTool: "read_file",
				changesCaptured: true,
				restartSafe: false,
			}),
		).toBe(
			"!Klein stream inactivity timeout after 30 seconds (last activity: reading file, last tool: read_file; workspace changes captured: yes; resume safe: no)",
		);
	});

	it("omits the tool clause and falls back to 'unknown' activity when absent", () => {
		expect(
			formatTaskTimeoutFailureMessage("conversation", 60_000, {
				lastActivity: null,
				lastTool: null,
				changesCaptured: false,
				restartSafe: true,
			}),
		).toBe(
			"!Klein conversation timeout after 60 seconds (last activity: unknown; workspace changes captured: no; resume safe: yes)",
		);
	});
});
