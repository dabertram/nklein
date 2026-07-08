import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAutostartEffects, setAutostartEnabled } from "../src/autostart-effects.js";

describe("createAutostartEffects (real fs + injected login-item)", () => {
	let home: string;
	beforeEach(async () => {
		home = await mkdtemp(join(tmpdir(), "nklein-autostart-"));
	});
	afterEach(async () => {
		await rm(home, { recursive: true, force: true });
	});

	it("forwards login-item settings to the injected app (macOS/Windows path)", () => {
		const calls: Array<{ openAtLogin: boolean }> = [];
		const effects = createAutostartEffects({ setLoginItemSettings: (s) => calls.push(s) });
		effects.setLoginItemSettings({ openAtLogin: true });
		expect(calls).toEqual([{ openAtLogin: true }]);
	});

	it("writes the XDG .desktop file, creating parent dirs (Linux enable)", async () => {
		const effects = createAutostartEffects({ setLoginItemSettings: () => {} });
		const path = join(home, ".config", "autostart", "klein.desktop");
		await effects.writeAutostartFile(path, "[Desktop Entry]\nName=!Klein\n");
		expect(existsSync(path)).toBe(true);
		expect(await readFile(path, "utf8")).toContain("Name=!Klein");
	});

	it("removes the .desktop file, and a missing file is not an error (Linux disable)", async () => {
		const effects = createAutostartEffects({ setLoginItemSettings: () => {} });
		const path = join(home, "k.desktop");
		await writeFile(path, "x", "utf8");
		await effects.removeAutostartFile(path);
		expect(existsSync(path)).toBe(false);
		await expect(effects.removeAutostartFile(path)).resolves.toBeUndefined(); // idempotent
	});
});

describe("setAutostartEnabled (resolve → apply, end-to-end)", () => {
	it("macOS enable → the injected app receives openAtLogin:true", async () => {
		const calls: Array<{ openAtLogin: boolean }> = [];
		await setAutostartEnabled(
			{ setLoginItemSettings: (s) => calls.push(s) },
			{ platform: "darwin", enabled: true, appName: "!Klein", execPath: "/Applications/!Klein.app" },
		);
		expect(calls).toEqual([{ openAtLogin: true }]);
	});

	it("Linux enable then disable → writes then removes the .desktop file", async () => {
		const home = await mkdtemp(join(tmpdir(), "nklein-autostart-e2e-"));
		try {
			const app = { setLoginItemSettings: () => {} };
			const base = { platform: "linux" as const, appName: "!Klein", execPath: "/opt/nklein/nklein", homeDir: home };
			await setAutostartEnabled(app, { ...base, enabled: true });
			const path = join(home, ".config", "autostart", "klein.desktop");
			expect(existsSync(path)).toBe(true);
			await setAutostartEnabled(app, { ...base, enabled: false });
			expect(existsSync(path)).toBe(false);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});
});
