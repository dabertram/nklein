import { describe, expect, it } from "vitest";
import type { NKleinTaskSessionEntry } from "../../../src/nklein-agent/nklein-session-state";
import {
	buildSessionIdPrefix,
	canReturnToRunning,
	isNKleinUserAttentionTool,
	latestAssistantMessageMatches,
} from "../../../src/nklein-agent/nklein-session-state";

const entry = (messages: Array<{ role: string; content: string }>): NKleinTaskSessionEntry =>
	({ messages }) as unknown as NKleinTaskSessionEntry;

describe("isNKleinUserAttentionTool (§5.V coverage)", () => {
	it("recognizes the user-attention tools case-insensitively (trimmed)", () => {
		expect(isNKleinUserAttentionTool("ask_followup_question")).toBe(true);
		expect(isNKleinUserAttentionTool("  Plan_Mode_Respond  ")).toBe(true);
	});

	it("is false for other tools, blank, or null", () => {
		expect(isNKleinUserAttentionTool("write_file")).toBe(false);
		expect(isNKleinUserAttentionTool("")).toBe(false);
		expect(isNKleinUserAttentionTool(null)).toBe(false);
	});
});

describe("canReturnToRunning (§5.V coverage)", () => {
	it("allows a return to running only for recoverable review reasons", () => {
		for (const reason of ["attention", "hook", "error"] as const) {
			expect(canReturnToRunning(reason)).toBe(true);
		}
		expect(canReturnToRunning("interrupted")).toBe(false);
		expect(canReturnToRunning("exit")).toBe(false);
		expect(canReturnToRunning(null)).toBe(false);
	});
});

describe("buildSessionIdPrefix (§5.V coverage)", () => {
	it("normalizes the task id into a trailing-dash prefix", () => {
		expect(buildSessionIdPrefix("task-1")).toBe("task-1-");
		expect(buildSessionIdPrefix("   ")).toBe("session-"); // empty after normalize → 'session'
		expect(buildSessionIdPrefix("anything").endsWith("-")).toBe(true);
	});
});

describe("latestAssistantMessageMatches (§5.V coverage)", () => {
	it("compares the latest assistant message's content (trimmed) to the given content", () => {
		const e = entry([
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "  hello there  " },
			{ role: "user", content: "later" },
		]);
		expect(latestAssistantMessageMatches(e, "hello there")).toBe(true);
		expect(latestAssistantMessageMatches(e, "different")).toBe(false);
	});

	it("is false when there is no assistant message", () => {
		expect(latestAssistantMessageMatches(entry([{ role: "user", content: "hi" }]), "hi")).toBe(false);
	});
});
