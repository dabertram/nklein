import { describe, expect, it } from "vitest";
import {
	buildSessionSystemPrompt,
	type SessionSystemPromptInput,
} from "../../../src/nklein-agent/nklein-session-system-prompt";

const base: SessionSystemPromptInput = {
	basePrompt: "BASE",
	baseIsStaticShell: true,
	efficiencyRules: "RULES",
	temporalBlock: "TODAY",
	planningPrompt: "PLAN",
	homeAgentAppend: "HOME",
	sessionEnv: "ENV",
};

describe("buildSessionSystemPrompt (§5.AQ / §5.U extraction)", () => {
	it("is deterministic — the same input assembles byte-identical text", () => {
		expect(buildSessionSystemPrompt(base).text).toBe(buildSessionSystemPrompt(base).text);
	});

	it("head-pins the base first and puts session-env LAST (the byte-stable suffix)", () => {
		const text = buildSessionSystemPrompt(base).text;
		expect(text.startsWith("BASE")).toBe(true);
		// session-env is the last task-tier fragment ⇒ the true suffix, so identical-card restarts share every byte up to it.
		expect(text.endsWith("ENV")).toBe(true);
	});

	it("orders fragments by churn: static base → config → daily → task", () => {
		const text = buildSessionSystemPrompt(base).text;
		expect(text).toBe("BASE\n\nRULES\n\nTODAY\n\nPLAN\n\nHOME\n\nENV");
	});

	it("dedups a skill fragment that reuses a FIXED key (never doubles efficiency-rules)", () => {
		const text = buildSessionSystemPrompt({
			...base,
			skillFragments: [{ key: "efficiency-rules", volatility: "config", text: "DUP-RULES" }],
		}).text;
		expect(text).not.toContain("DUP-RULES");
		expect(text).toContain("RULES");
	});

	it("includes a genuinely-new skill fragment in its volatility bucket", () => {
		const text = buildSessionSystemPrompt({
			...base,
			skillFragments: [{ key: "repo-map", volatility: "config", text: "REPO-MAP" }],
		}).text;
		expect(text).toContain("REPO-MAP");
		// config-volatility ⇒ lands after the base but before the daily/task fragments, regardless of append position.
		expect(text.indexOf("REPO-MAP")).toBeLessThan(text.indexOf("TODAY"));
	});

	it("a non-static base is task-volatility (custom prompts embed per-task content, not byte-stable)", () => {
		const staticText = buildSessionSystemPrompt(base).text;
		const customText = buildSessionSystemPrompt({ ...base, baseIsStaticShell: false }).text;
		// The base is head-pinned in both, so the rendered text matches here; the volatility flag drives caching, not order.
		expect(customText.startsWith("BASE")).toBe(true);
		expect(staticText).toBe(customText);
	});
});
