import { describe, expect, it } from "vitest";
import { auditPromptPrefixVolatility } from "../../../src/core/kv-prefix-audit";

describe("auditPromptPrefixVolatility (F12.7)", () => {
	it("passes a genuinely stable prefix", () => {
		const stable = "You are the !Klein worker. Follow the focus chain. Tools: read_files, write_files, run_commands.";
		expect(auditPromptPrefixVolatility(stable)).toEqual([]);
	});

	it("flags the classic culprits — a timestamp and a date in the system prompt — earliest first", () => {
		const prefix = "Current time: 14:32:05 on 2026-07-17. You are the worker agent.";
		const findings = auditPromptPrefixVolatility(prefix);
		expect(findings.length).toBeGreaterThanOrEqual(2);
		expect(findings[0]?.kind).toBe("timestamp");
		expect(findings[0]?.offset).toBeLessThan(findings.at(-1)?.offset ?? 0);
		// A leak this early means almost the whole prefix loses cache reuse.
		expect(findings[0]?.cacheSurvivalFraction).toBeLessThan(0.3);
	});

	it("flags counters, UUIDs, and hex ids that churn per run", () => {
		const findings = auditPromptPrefixVolatility(
			"Attempt #3. Session 3f2a9c4d-1b6e-4f0a-9c2d-8e7b6a5d4c3b, workspace hash a1b2c3d4e5f60718.",
		);
		expect(findings.map((finding) => finding.kind)).toEqual(expect.arrayContaining(["counter", "uuid", "hex_id"]));
	});

	it("range-checks epoch runs — a stable large constant is NOT a timestamp leak (review-found)", () => {
		// 104857600 (a byte budget) and 555123456789 (a phone-like run) are outside the epoch envelope.
		expect(auditPromptPrefixVolatility("Cap uploads at 104857600 bytes.")).toEqual([]);
		expect(auditPromptPrefixVolatility("Support line: 555123456789.")).toEqual([]);
		// A real epoch-seconds and epoch-ms value still flag.
		expect(auditPromptPrefixVolatility("Built at 1789000000.").map((f) => f.kind)).toContain("timestamp");
		expect(auditPromptPrefixVolatility("Built at 1789000000123.").map((f) => f.kind)).toContain("timestamp");
	});
});
