import { describe, expect, it } from "vitest";
import {
	appendTemporalContext,
	decideTemporalContextInjection,
	type TemporalContextInjectionInput,
} from "../../../src/core/temporal-context-injection";

const NOW = new Date("2026-07-01T12:00:00Z");
const base = (over: Partial<TemporalContextInjectionInput> = {}): TemporalContextInjectionInput => ({
	now: NOW,
	...over,
});

describe("decideTemporalContextInjection", () => {
	it("is OFF by default — no `enabled` ⇒ never injects (zero prompt cost)", () => {
		const d = decideTemporalContextInjection(base({ text: "what is the latest version today" }));
		expect(d.inject).toBe(false);
		expect(d.block).toBe("");
		expect(d.reason).toMatch(/off by default/i);
	});

	it("enabled:false also never injects", () => {
		expect(decideTemporalContextInjection(base({ enabled: false, text: "latest news" })).inject).toBe(false);
	});

	it("enabled + a temporally-relevant task ⇒ injects, placement is always append_end", () => {
		const d = decideTemporalContextInjection(base({ enabled: true, text: "what is the latest release" }));
		expect(d.inject).toBe(true);
		expect(d.placement).toBe("append_end");
		expect(d.block).toContain("<current_date>");
		expect(d.reason).toMatch(/relevant/i);
	});

	it("enabled but a plain (non-temporal) task ⇒ skipped to avoid prompt bloat", () => {
		const d = decideTemporalContextInjection(base({ enabled: true, text: "refactor the parser into modules" }));
		expect(d.inject).toBe(false);
		expect(d.reason).toMatch(/bloat/i);
	});

	it("enabled + a temporally-relevant ROLE injects even without a text cue", () => {
		const d = decideTemporalContextInjection(base({ enabled: true, role: "researcher", text: "gather facts" }));
		expect(d.inject).toBe(true);
	});

	it("force bypasses the relevance gate — but STILL requires enabled", () => {
		expect(decideTemporalContextInjection(base({ enabled: true, force: true, text: "plain task" })).inject).toBe(
			true,
		);
		expect(decideTemporalContextInjection(base({ force: true, text: "plain task" })).inject).toBe(false); // not enabled
	});

	it("granularity:'datetime' produces the wall-clock block", () => {
		const d = decideTemporalContextInjection(base({ enabled: true, force: true, granularity: "datetime" }));
		expect(d.block).toContain("<current_datetime>");
	});
});

describe("appendTemporalContext", () => {
	it("appends the block at the END (blank-line separated) when injecting", () => {
		const d = decideTemporalContextInjection(base({ enabled: true, text: "latest release" }));
		const out = appendTemporalContext("SYSTEM PROMPT BODY", d);
		expect(out.startsWith("SYSTEM PROMPT BODY")).toBe(true); // prefix byte-stable
		expect(out).toBe(`SYSTEM PROMPT BODY\n\n${d.block}`);
	});

	it("returns the base prompt UNCHANGED (byte-identical) when not injecting", () => {
		const off = decideTemporalContextInjection(base({ text: "latest release" })); // off by default
		expect(appendTemporalContext("BODY", off)).toBe("BODY");
		const irrelevant = decideTemporalContextInjection(base({ enabled: true, text: "rename a variable" }));
		expect(appendTemporalContext("BODY", irrelevant)).toBe("BODY");
	});

	it("returns the block alone when the base prompt is empty", () => {
		const d = decideTemporalContextInjection(base({ enabled: true, force: true }));
		expect(appendTemporalContext("", d)).toBe(d.block);
	});
});
