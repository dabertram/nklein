import { describe, expect, it } from "vitest";
import {
	buildTrayMenuTemplate,
	buildTrayTooltip,
	summarizeTrayActivity,
	summarizeTrayUpdateStatus,
	type TrayState,
} from "../src/tray-menu.js";

const running: TrayState = { paused: false, activitySummary: "3 cards running" };
const pausedIdle: TrayState = { paused: true, activitySummary: "Idle" };

describe("buildTrayMenuTemplate", () => {
	it("leads with a disabled activity readout, then Open / Pause / Quit", () => {
		const items = buildTrayMenuTemplate(running);
		expect(items[0]).toEqual({ type: "normal", label: "3 cards running", enabled: false });
		const commands = items.filter((i) => i.command).map((i) => i.command);
		expect(commands).toEqual(["open", "toggle-pause", "quit"]);
	});

	it("shows 'Pause work' when running and 'Resume work' when paused", () => {
		const pauseItem = (s: TrayState) => buildTrayMenuTemplate(s).find((i) => i.command === "toggle-pause");
		expect(pauseItem(running)?.label).toBe("Pause work");
		expect(pauseItem(pausedIdle)?.label).toBe("Resume work");
	});

	it("includes separators between the groups", () => {
		expect(buildTrayMenuTemplate(running).filter((i) => i.type === "separator")).toHaveLength(2);
	});

	it("command items are enabled, the activity readout is not", () => {
		for (const item of buildTrayMenuTemplate(running)) {
			if (item.command) expect(item.enabled).toBe(true);
			if (item.label === "3 cards running") expect(item.enabled).toBe(false);
		}
	});

	it("adds clickable update rows only when the update needs user action", () => {
		const available = buildTrayMenuTemplate({
			...running,
			updateStatus: { kind: "available", latestVersion: "0.2.0" },
		});
		expect(available[1]).toEqual({
			type: "normal",
			label: "Update available: 0.2.0",
			command: "show-update",
			enabled: true,
		});

		const downloading = buildTrayMenuTemplate({
			...running,
			updateStatus: { kind: "downloading", latestVersion: "0.2.0" },
		});
		expect(downloading[1]).toEqual({
			type: "normal",
			label: "Downloading update: 0.2.0",
			command: undefined,
			enabled: false,
		});
	});
});

describe("buildTrayTooltip", () => {
	it("appends (paused) only when paused", () => {
		expect(buildTrayTooltip(running)).toBe("!Klein — 3 cards running");
		expect(buildTrayTooltip(pausedIdle)).toBe("!Klein — Idle (paused)");
	});
});

describe("summarizeTrayActivity", () => {
	it("0 / negative / NaN → Idle; 1 → singular; N → plural", () => {
		expect(summarizeTrayActivity(0)).toBe("Idle");
		expect(summarizeTrayActivity(-2)).toBe("Idle");
		expect(summarizeTrayActivity(Number.NaN)).toBe("Idle");
		expect(summarizeTrayActivity(1)).toBe("1 card running");
		expect(summarizeTrayActivity(5)).toBe("5 cards running");
		expect(summarizeTrayActivity(3.9)).toBe("3 cards running"); // truncated
	});
});

describe("summarizeTrayUpdateStatus", () => {
	it("renders compact updater state labels", () => {
		expect(summarizeTrayUpdateStatus(undefined)).toBeNull();
		expect(summarizeTrayUpdateStatus({ kind: "idle" })).toBeNull();
		expect(summarizeTrayUpdateStatus({ kind: "checking" })).toBe("Checking for updates...");
		expect(summarizeTrayUpdateStatus({ kind: "ready_to_install", latestVersion: "0.2.0" })).toBe(
			"Install update: 0.2.0",
		);
		expect(summarizeTrayUpdateStatus({ kind: "error", message: "network" })).toBe("Update failed: network");
	});
});
