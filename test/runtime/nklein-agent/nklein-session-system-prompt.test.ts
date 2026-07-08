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

	it("includes the prior-attempt retry note as task context before the session-env suffix", () => {
		const text = buildSessionSystemPrompt({
			...base,
			attemptRetryNote: "Already attempted this task (do NOT repeat these).",
		}).text;

		expect(text).toContain("Already attempted this task");
		expect(text.indexOf("Already attempted this task")).toBeGreaterThan(text.indexOf("HOME"));
		expect(text.indexOf("Already attempted this task")).toBeLessThan(text.indexOf("ENV"));
	});

	it("a non-static base is task-volatility (custom prompts embed per-task content, not byte-stable)", () => {
		const staticText = buildSessionSystemPrompt(base).text;
		const customText = buildSessionSystemPrompt({ ...base, baseIsStaticShell: false }).text;
		// The base is head-pinned in both, so the rendered text matches here; the volatility flag drives caching, not order.
		expect(customText.startsWith("BASE")).toBe(true);
		expect(staticText).toBe(customText);
	});
});

/**
 * §5.U byte-stability invariants that GATE the two-call-site prompt-assembly dedup (startTaskSession vs
 * startRuntimeTaskSessionFromLaunchConfig). The restart path OMITS `planningPrompt` + `skillFragments`; the primary
 * path passes them. A single shared input-builder can only serve both if an ABSENT optional field assembles
 * byte-identically to `null` / `""` / `[]` — which it does, because the assembler resolves each via `?? ""` / `?? []`.
 * These tests pin that so a future edit (e.g. swapping `?? ""` for an `if present` branch) can't silently shift the
 * §5.AQ cache-critical bytes and break the dedup without a red test.
 */
describe("buildSessionSystemPrompt — absent ≡ null ≡ empty (the dedup byte-invariant)", () => {
	const common: SessionSystemPromptInput = {
		basePrompt: "BASE",
		baseIsStaticShell: true,
		efficiencyRules: "RULES",
		temporalBlock: "TODAY",
		homeAgentAppend: "HOME",
		sessionEnv: "ENV",
	};

	it("planningPrompt: absent ≡ null ≡ empty-string", () => {
		const absent = buildSessionSystemPrompt(common).text;
		expect(buildSessionSystemPrompt({ ...common, planningPrompt: null }).text).toBe(absent);
		expect(buildSessionSystemPrompt({ ...common, planningPrompt: "" }).text).toBe(absent);
	});

	it("skillFragments: absent ≡ empty array", () => {
		const absent = buildSessionSystemPrompt(common).text;
		expect(buildSessionSystemPrompt({ ...common, skillFragments: [] }).text).toBe(absent);
	});

	it("homeAgentAppend / attemptRetryNote / sessionEnv: absent ≡ null", () => {
		const bare: SessionSystemPromptInput = {
			basePrompt: "BASE",
			baseIsStaticShell: true,
			efficiencyRules: "RULES",
			temporalBlock: "TODAY",
		};
		expect(
			buildSessionSystemPrompt({ ...bare, homeAgentAppend: null, attemptRetryNote: null, sessionEnv: null }).text,
		).toBe(buildSessionSystemPrompt(bare).text);
	});

	it("the two call-site shapes converge: restart-shape ≡ primary-shape with its extras nulled", () => {
		// restart omits planningPrompt + skillFragments; primary passes them. Same shared fields + null/[] extras ⇒
		// byte-identical, so one shared builder serves both paths without moving a single §5.AQ prefix byte.
		const restartShape = buildSessionSystemPrompt(common).text;
		const primaryShapeExtrasNulled = buildSessionSystemPrompt({
			...common,
			planningPrompt: null,
			skillFragments: [],
		}).text;
		expect(primaryShapeExtrasNulled).toBe(restartShape);
	});
});
