import { describe, expect, it } from "vitest";
import { decideFocusChainNudge } from "../../../src/core/focus-chain-nudge";

describe("decideFocusChainNudge", () => {
	it("nudges a multi-step, tools-offered task with no chain", () => {
		const d = decideFocusChainNudge({ hasFocusChain: false, toolsOffered: 5 });
		expect(d.nudge).toBe(true);
		expect(d.reason).toMatch(/draft one/i);
	});

	it("stays quiet when a chain already exists", () => {
		expect(decideFocusChainNudge({ hasFocusChain: true, toolsOffered: 5 }).nudge).toBe(false);
	});

	it("stays quiet for a trivial task (checklist is overhead)", () => {
		expect(decideFocusChainNudge({ hasFocusChain: false, toolsOffered: 5, trivial: true }).nudge).toBe(false);
	});

	it("stays quiet for a no-tool (pure answer) turn", () => {
		expect(decideFocusChainNudge({ hasFocusChain: false, toolsOffered: 0 }).nudge).toBe(false);
	});
});
