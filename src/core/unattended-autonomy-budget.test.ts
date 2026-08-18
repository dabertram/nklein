import { describe, expect, it } from "vitest";
import {
	createWorkspaceAttendedRegistry,
	DEFAULT_UNATTENDED_AUTONOMY_BUDGET_HOURS,
	resolveUnattendedAutonomyBudgetMs,
} from "./unattended-autonomy-budget";

const HOUR = 3_600_000;

describe("resolveUnattendedAutonomyBudgetMs", () => {
	it("defaults generously and honors the knob", () => {
		expect(resolveUnattendedAutonomyBudgetMs({})).toBe(DEFAULT_UNATTENDED_AUTONOMY_BUDGET_HOURS * HOUR);
		expect(resolveUnattendedAutonomyBudgetMs({ NKLEIN_UNATTENDED_AUTONOMY_HOURS: "2" })).toBe(2 * HOUR);
		expect(resolveUnattendedAutonomyBudgetMs({ NKLEIN_UNATTENDED_AUTONOMY_HOURS: "0.5" })).toBe(HOUR / 2);
	});

	it("0/off disables the gate; junk falls back to the default rather than to disabled", () => {
		expect(resolveUnattendedAutonomyBudgetMs({ NKLEIN_UNATTENDED_AUTONOMY_HOURS: "0" })).toBeNull();
		expect(resolveUnattendedAutonomyBudgetMs({ NKLEIN_UNATTENDED_AUTONOMY_HOURS: "off" })).toBeNull();
		// A typo must not silently remove the bound — that would be the quiet failure this feature exists to kill.
		expect(resolveUnattendedAutonomyBudgetMs({ NKLEIN_UNATTENDED_AUTONOMY_HOURS: "banana" })).toBe(
			DEFAULT_UNATTENDED_AUTONOMY_BUDGET_HOURS * HOUR,
		);
		expect(resolveUnattendedAutonomyBudgetMs({ NKLEIN_UNATTENDED_AUTONOMY_HOURS: "-3" })).toBe(
			DEFAULT_UNATTENDED_AUTONOMY_BUDGET_HOURS * HOUR,
		);
	});
});

describe("createWorkspaceAttendedRegistry", () => {
	it("seeds the first sighting as attended (boot counts), then expires past the budget", () => {
		let clock = 1_000_000;
		const registry = createWorkspaceAttendedRegistry({ budgetMs: 2 * HOUR, now: () => clock });
		expect(registry.decide("ws")).toEqual({ allow: true, unattendedMs: 0 });
		clock += HOUR;
		expect(registry.decide("ws")).toEqual({ allow: true, unattendedMs: HOUR });
		clock += 2 * HOUR;
		expect(registry.decide("ws")).toEqual({ allow: false, unattendedMs: 3 * HOUR, budgetMs: 2 * HOUR });
	});

	it("an attended touch resets the clock — the resume gesture re-opens autonomy", () => {
		let clock = 0;
		const registry = createWorkspaceAttendedRegistry({ budgetMs: HOUR, now: () => clock });
		registry.decide("ws");
		clock += 3 * HOUR;
		expect(registry.decide("ws").allow).toBe(false);
		registry.touch("ws");
		expect(registry.decide("ws")).toEqual({ allow: true, unattendedMs: 0 });
	});

	it("a disabled budget always allows, while still tracking touches", () => {
		let clock = 0;
		const registry = createWorkspaceAttendedRegistry({ budgetMs: null, now: () => clock });
		registry.decide("ws");
		clock += 100 * HOUR;
		expect(registry.decide("ws")).toEqual({ allow: true, unattendedMs: 100 * HOUR });
	});

	it("workspaces are independent", () => {
		let clock = 0;
		const registry = createWorkspaceAttendedRegistry({ budgetMs: HOUR, now: () => clock });
		registry.decide("a");
		clock += 2 * HOUR;
		registry.touch("b");
		expect(registry.decide("a").allow).toBe(false);
		expect(registry.decide("b").allow).toBe(true);
	});
});
