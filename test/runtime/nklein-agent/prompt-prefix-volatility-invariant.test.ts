import { describe, expect, it } from "vitest";
import { auditPromptPrefixVolatility } from "../../../src/core/kv-prefix-audit";
import { buildNKleinStartPromptParts } from "../../../src/nklein-agent/nklein-task-prompt-builders";

/**
 * F12.7 CI invariant: the LIVE prompt builders' cache-stable output must stay volatility-free. A timestamp, UUID, or
 * counter leaking into these system prompts silently kills KV-cache reuse for every session (up to 10× throughput
 * loss at long contexts) — this test makes that regression loud. Deliberately-volatile fragments (the daily temporal
 * block, session-env cwd/date trailer) are bucketed AFTER the stable prefix by §5.AQ assembly and are not audited.
 */
describe("prompt-prefix volatility invariant (F12.7)", () => {
	it("keeps the planning system prompt cache-stable", () => {
		const parts = buildNKleinStartPromptParts("Implement the rate limiter.", true);
		const findings = auditPromptPrefixVolatility(parts.systemPrompt ?? "");
		expect(findings).toEqual([]);
	});

	it("keeps the refinement system prompt cache-stable", () => {
		const parts = buildNKleinStartPromptParts("Refine the summary card.", false, true);
		const findings = auditPromptPrefixVolatility(parts.systemPrompt ?? "");
		expect(findings).toEqual([]);
	});

	it("keeps the framework-preamble path cache-stable (workspace-stable lines only)", () => {
		const parts = buildNKleinStartPromptParts("Implement the widget.", true, false, null, [
			"This workspace uses React 19 with the app router.",
			"Styling: Tailwind utility classes, dark theme first.",
		]);
		expect(auditPromptPrefixVolatility(parts.systemPrompt ?? "")).toEqual([]);
	});
});
