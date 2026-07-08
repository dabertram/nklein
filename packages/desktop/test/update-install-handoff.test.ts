import { describe, expect, it, vi } from "vitest";

import {
	planDesktopInstallerHandoff,
	runDesktopInstallerHandoff,
	type DesktopInstallerHandoffPlan,
} from "../src/update-install-handoff.js";

describe("planDesktopInstallerHandoff", () => {
	it("opens macOS dmg packages with the system opener", () => {
		expect(
			planDesktopInstallerHandoff({
				platform: "darwin",
				filePath: "/tmp/nKlein-0.2.0-arm64.dmg",
				asset: {
					name: "nKlein-0.2.0-arm64.dmg",
					url: "https://downloads.invalid/nKlein.dmg",
				},
			}),
		).toEqual({
			status: "ready",
			command: "open",
			args: ["/tmp/nKlein-0.2.0-arm64.dmg"],
			requiresAppQuit: true,
			userActionRequired: true,
			requiresExecutableBit: false,
			notes: ["Open the package and follow the macOS installer prompt."],
		});
	});

	it("runs Windows NSIS installers directly and MSI installers through msiexec", () => {
		expect(
			planDesktopInstallerHandoff({
				platform: "win32",
				filePath: "C:\\Temp\\nKlein-Setup.exe",
				asset: { name: "nKlein-Setup-0.2.0-x64.exe", url: "https://downloads.invalid/nKlein.exe" },
			}),
		).toMatchObject({
			status: "ready",
			command: "C:\\Temp\\nKlein-Setup.exe",
			args: [],
		});

		expect(
			planDesktopInstallerHandoff({
				platform: "win32",
				filePath: "C:\\Temp\\nKlein.msi",
				asset: { name: "nKlein-0.2.0-x64.msi", url: "https://downloads.invalid/nKlein.msi" },
			}),
		).toMatchObject({
			status: "ready",
			command: "msiexec.exe",
			args: ["/i", "C:\\Temp\\nKlein.msi"],
		});
	});

	it("opens Linux packages with xdg-open and marks AppImage executable-bit requirement", () => {
		expect(
			planDesktopInstallerHandoff({
				platform: "linux",
				filePath: "/tmp/nKlein.AppImage",
				asset: { name: "nKlein-0.2.0-x64.AppImage", url: "https://downloads.invalid/nKlein.AppImage" },
			}),
		).toMatchObject({
			status: "ready",
			command: "xdg-open",
			args: ["/tmp/nKlein.AppImage"],
			requiresExecutableBit: true,
		});

		expect(
			planDesktopInstallerHandoff({
				platform: "linux",
				filePath: "/tmp/nklein.deb",
				asset: { name: "nklein_0.2.0_amd64.deb", url: "https://downloads.invalid/nklein.deb" },
			}),
		).toMatchObject({
			status: "ready",
			requiresExecutableBit: false,
		});
	});

	it("fails closed for unsupported package/platform combinations", () => {
		expect(
			planDesktopInstallerHandoff({
				platform: "darwin",
				filePath: "/tmp/nklein.AppImage",
				asset: { name: "nKlein-0.2.0-x64.AppImage", url: "https://downloads.invalid/nklein.AppImage" },
			}),
		).toEqual({ status: "unsupported", reason: "Unsupported macOS update asset kind: linux_appimage" });
	});
});

describe("runDesktopInstallerHandoff", () => {
	it("launches ready handoff plans through the injected runner", () => {
		const spawnDetached = vi.fn();
		const plan: DesktopInstallerHandoffPlan = {
			status: "ready",
			command: "open",
			args: ["/tmp/nKlein.dmg"],
			requiresAppQuit: true,
			userActionRequired: true,
			requiresExecutableBit: false,
			notes: [],
		};

		expect(runDesktopInstallerHandoff(plan, { spawnDetached })).toEqual({
			status: "launched",
			command: "open",
			args: ["/tmp/nKlein.dmg"],
		});
		expect(spawnDetached).toHaveBeenCalledWith("open", ["/tmp/nKlein.dmg"]);
	});

	it("reports launch failures without throwing", () => {
		const plan: DesktopInstallerHandoffPlan = {
			status: "ready",
			command: "open",
			args: ["/tmp/nKlein.dmg"],
			requiresAppQuit: true,
			userActionRequired: true,
			requiresExecutableBit: false,
			notes: [],
		};

		expect(
			runDesktopInstallerHandoff(plan, {
				spawnDetached: () => {
					throw new Error("blocked");
				},
			}),
		).toEqual({ status: "launch_failed", message: "blocked" });
	});
});
