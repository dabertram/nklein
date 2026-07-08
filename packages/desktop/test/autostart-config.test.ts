import { describe, expect, it, vi } from "vitest";
import {
	type AutostartEffects,
	type AutostartPlan,
	applyAutostartPlan,
	buildXdgAutostartEntry,
	resolveAutostartPlan,
} from "../src/autostart-config.js";

describe("buildXdgAutostartEntry", () => {
	it("produces a valid freedesktop autostart entry", () => {
		const entry = buildXdgAutostartEntry("!Klein", "/opt/nklein/nklein --daemon");
		expect(entry).toContain("[Desktop Entry]");
		expect(entry).toContain("Type=Application");
		expect(entry).toContain("Name=!Klein");
		expect(entry).toContain("Exec=/opt/nklein/nklein --daemon");
		expect(entry).toContain("X-GNOME-Autostart-enabled=true");
		expect(entry.endsWith("\n")).toBe(true);
	});
});

describe("resolveAutostartPlan", () => {
	it("macOS → a login-item plan carrying openAtLogin", () => {
		expect(resolveAutostartPlan({ platform: "darwin", enabled: true, appName: "!Klein", execPath: "/x" })).toEqual({
			kind: "login-item",
			openAtLogin: true,
		});
		expect(resolveAutostartPlan({ platform: "win32", enabled: false, appName: "!Klein", execPath: "/x" })).toEqual({
			kind: "login-item",
			openAtLogin: false,
		});
	});

	it("Linux ENABLE → an xdg-autostart plan with the file path + contents", () => {
		const plan = resolveAutostartPlan({
			platform: "linux",
			enabled: true,
			appName: "!Klein",
			execPath: "/opt/nklein/nklein",
			homeDir: "/home/dave",
		});
		expect(plan.kind).toBe("xdg-autostart");
		if (plan.kind === "xdg-autostart") {
			expect(plan.path).toBe("/home/dave/.config/autostart/klein.desktop");
			expect(plan.content).toContain("Exec=/opt/nklein/nklein");
		}
	});

	it("Linux DISABLE → an xdg-autostart plan with null content (remove the file)", () => {
		const plan = resolveAutostartPlan({
			platform: "linux",
			enabled: false,
			appName: "!Klein",
			execPath: "/x",
			homeDir: "/home/dave/",
		});
		expect(plan).toEqual({ kind: "xdg-autostart", path: "/home/dave/.config/autostart/klein.desktop", content: null });
	});

	it("slugifies a messy app name into a safe .desktop filename", () => {
		const plan = resolveAutostartPlan({ platform: "linux", enabled: true, appName: "My App!!", execPath: "/x", homeDir: "/h" });
		expect(plan.kind === "xdg-autostart" && plan.path).toBe("/h/.config/autostart/my-app.desktop");
	});
});

describe("applyAutostartPlan", () => {
	function fakeEffects(): AutostartEffects & {
		calls: { login: Array<{ openAtLogin: boolean }>; writes: Array<[string, string]>; removes: string[] };
	} {
		const calls = { login: [] as Array<{ openAtLogin: boolean }>, writes: [] as Array<[string, string]>, removes: [] as string[] };
		return {
			calls,
			setLoginItemSettings: (s) => calls.login.push(s),
			writeAutostartFile: async (p, c) => {
				calls.writes.push([p, c]);
			},
			removeAutostartFile: async (p) => {
				calls.removes.push(p);
			},
		};
	}

	it("login-item plan → calls setLoginItemSettings, no fs", async () => {
		const fx = fakeEffects();
		await applyAutostartPlan({ kind: "login-item", openAtLogin: true }, fx);
		expect(fx.calls.login).toEqual([{ openAtLogin: true }]);
		expect(fx.calls.writes).toEqual([]);
	});

	it("xdg plan with content → writes the file", async () => {
		const fx = fakeEffects();
		const plan: AutostartPlan = { kind: "xdg-autostart", path: "/h/.config/autostart/k.desktop", content: "X" };
		await applyAutostartPlan(plan, fx);
		expect(fx.calls.writes).toEqual([["/h/.config/autostart/k.desktop", "X"]]);
		expect(fx.calls.removes).toEqual([]);
	});

	it("xdg plan with null content → removes the file", async () => {
		const fx = fakeEffects();
		await applyAutostartPlan({ kind: "xdg-autostart", path: "/h/.config/autostart/k.desktop", content: null }, fx);
		expect(fx.calls.removes).toEqual(["/h/.config/autostart/k.desktop"]);
		expect(fx.calls.writes).toEqual([]);
	});

	it("end-to-end: resolve → apply for a macOS enable", async () => {
		const fx = fakeEffects();
		const setSpy = vi.spyOn(fx, "setLoginItemSettings");
		await applyAutostartPlan(
			resolveAutostartPlan({ platform: "darwin", enabled: true, appName: "!Klein", execPath: "/x" }),
			fx,
		);
		expect(setSpy).toHaveBeenCalledWith({ openAtLogin: true });
	});
});
