import { describe, expect, it } from "vitest";

import {
	channelAllowsUnsignedAssets,
	compareDesktopVersions,
	inferDesktopReleaseAssetKind,
	selectDesktopUpdate,
	type DesktopReleaseManifest,
} from "../src/update-plan.js";

function manifest(overrides: Partial<DesktopReleaseManifest> = {}): DesktopReleaseManifest {
	return {
		version: "0.2.0",
		channel: "stable",
		assets: [],
		...overrides,
	};
}

describe("compareDesktopVersions", () => {
	it("orders semver-ish stable and prerelease versions", () => {
		expect(compareDesktopVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
		expect(compareDesktopVersions("0.2.0", "0.2.0")).toBe(0);
		expect(compareDesktopVersions("0.2.0-beta.1", "0.2.0")).toBeLessThan(0);
	});
});

describe("inferDesktopReleaseAssetKind", () => {
	it("maps electron-builder style package names to asset kinds", () => {
		expect(inferDesktopReleaseAssetKind("nKlein-0.2.0-arm64.dmg")).toBe("mac_dmg");
		expect(inferDesktopReleaseAssetKind("nKlein Setup 0.2.0.exe")).toBe("windows_nsis");
		expect(inferDesktopReleaseAssetKind("nKlein-0.2.0-x64.AppImage")).toBe("linux_appimage");
	});
});

describe("selectDesktopUpdate", () => {
	it("returns up_to_date when the release is not newer", () => {
		expect(
			selectDesktopUpdate({
				currentVersion: "0.2.0",
				platform: "darwin",
				arch: "arm64",
				manifest: manifest({ version: "0.2.0" }),
			}),
		).toEqual({ status: "up_to_date", currentVersion: "0.2.0", latestVersion: "0.2.0" });
	});

	it("selects a notarized signed mac dmg and carries the project migration plan", () => {
		const plan = selectDesktopUpdate({
			currentVersion: "0.1.0",
			platform: "darwin",
			arch: "arm64",
			manifest: manifest({
				projectMigration: {
					required: true,
					backupRequired: true,
					rollbackSupported: true,
					fromVersion: "0.1.0",
					toVersion: "0.2.0",
					notes: ["workspace-index-v2"],
				},
				assets: [
					{
						name: "nKlein-0.2.0-x64.dmg",
						url: "https://example.invalid/nklein-x64.dmg",
						sha256: "x64sum",
						signature: "signed",
						notarized: true,
					},
					{
						name: "nKlein-0.2.0-arm64.dmg",
						url: "https://example.invalid/nklein-arm64.dmg",
						sha256: "arm64sum",
						signature: "signed",
						notarized: true,
					},
				],
			}),
		});

		expect(plan.status).toBe("update_available");
		if (plan.status !== "update_available") {
			throw new Error("expected update_available");
		}
		expect(plan.asset.name).toBe("nKlein-0.2.0-arm64.dmg");
		expect(plan.projectMigration).toEqual({
			required: true,
			backupRequired: true,
			rollbackSupported: true,
			fromVersion: "0.1.0",
			toVersion: "0.2.0",
			notes: ["workspace-index-v2"],
		});
	});

	it("blocks a mac update asset without notarization", () => {
		const plan = selectDesktopUpdate({
			currentVersion: "0.1.0",
			platform: "darwin",
			arch: "arm64",
			manifest: manifest({
				assets: [
					{
						name: "nKlein-0.2.0-arm64.dmg",
						url: "https://example.invalid/nklein-arm64.dmg",
						sha256: "sum",
						signature: "signed",
					},
				],
			}),
		});

		expect(plan.status).toBe("blocked_untrusted_asset");
		if (plan.status !== "blocked_untrusted_asset") {
			throw new Error("expected blocked_untrusted_asset");
		}
		expect(plan.reasons).toContain("missing_notarization");
	});

	it("blocks a windows update asset without a signature", () => {
		const plan = selectDesktopUpdate({
			currentVersion: "0.1.0",
			platform: "win32",
			arch: "x64",
			manifest: manifest({
				assets: [
					{
						name: "nKlein-Setup-0.2.0-x64.exe",
						url: "https://example.invalid/nklein.exe",
						sha256: "sum",
						signature: "unsigned",
					},
				],
			}),
		});

		expect(plan.status).toBe("blocked_untrusted_asset");
		if (plan.status !== "blocked_untrusted_asset") {
			throw new Error("expected blocked_untrusted_asset");
		}
		expect(plan.reasons).toContain("missing_signature");
	});

	it("accepts a checksummed linux AppImage without requiring platform signing by default", () => {
		const plan = selectDesktopUpdate({
			currentVersion: "0.1.0",
			platform: "linux",
			arch: "x64",
			manifest: manifest({
				assets: [
					{
						name: "nKlein-0.2.0-x64.AppImage",
						url: "https://example.invalid/nklein.AppImage",
						sha256: "sum",
						signature: "unknown",
					},
				],
			}),
		});

		expect(plan.status).toBe("update_available");
	});

	it("fails closed when no asset matches the current arch", () => {
		const plan = selectDesktopUpdate({
			currentVersion: "0.1.0",
			platform: "darwin",
			arch: "arm64",
			manifest: manifest({
				assets: [
					{
						name: "nKlein-0.2.0-x64.dmg",
						url: "https://example.invalid/nklein-x64.dmg",
						sha256: "sum",
						signature: "signed",
						notarized: true,
					},
				],
			}),
		});

		expect(plan).toEqual({
			status: "no_compatible_asset",
			latestVersion: "0.2.0",
			platform: "darwin",
			arch: "arm64",
		});
	});

	it("does not offer beta releases on the stable channel", () => {
		expect(
			selectDesktopUpdate({
				currentVersion: "0.1.0",
				platform: "darwin",
				arch: "arm64",
				channel: "stable",
				manifest: manifest({ channel: "beta" }),
			}),
		).toEqual({ status: "wrong_channel", requestedChannel: "stable", releaseChannel: "beta" });
	});

	it("F5.5: offers an UNSIGNED mac asset on the dev channel (checksum still required)", () => {
		const plan = selectDesktopUpdate({
			currentVersion: "0.1.0",
			platform: "darwin",
			arch: "arm64",
			channel: "dev",
			manifest: manifest({
				version: "0.2.0-dev.5",
				channel: "dev",
				assets: [
					{
						name: "nklein-0.2.0-dev.5-arm64.dmg",
						url: "https://example.com/nklein-dev.dmg",
						sha256: "a".repeat(64),
						signature: "unsigned",
						notarized: false,
					},
				],
			}),
		});
		// Unsigned + not notarized is fine on dev; the checksum is present so the asset is offered.
		expect(plan.status).toBe("update_available");
	});

	it("F5.5: still blocks a dev asset that is MISSING its sha256 checksum", () => {
		const plan = selectDesktopUpdate({
			currentVersion: "0.1.0",
			platform: "darwin",
			arch: "arm64",
			channel: "dev",
			manifest: manifest({
				version: "0.2.0-dev.5",
				channel: "dev",
				assets: [
					{ name: "nklein-0.2.0-dev.5-arm64.dmg", url: "https://example.com/x.dmg", signature: "unsigned" },
				],
			}),
		});
		expect(plan.status).toBe("blocked_untrusted_asset");
		if (plan.status !== "blocked_untrusted_asset") {
			throw new Error("expected blocked_untrusted_asset");
		}
		expect(plan.reasons).toEqual(["missing_sha256"]);
	});

	it("F5.5: an explicit trustPolicy can still demand signing on the dev channel", () => {
		const plan = selectDesktopUpdate({
			currentVersion: "0.1.0",
			platform: "darwin",
			arch: "arm64",
			channel: "dev",
			trustPolicy: { requireSignedAsset: true },
			manifest: manifest({
				version: "0.2.0-dev.5",
				channel: "dev",
				assets: [
					{
						name: "nklein-0.2.0-dev.5-arm64.dmg",
						url: "https://example.com/x.dmg",
						sha256: "a".repeat(64),
						signature: "unsigned",
					},
				],
			}),
		});
		expect(plan.status).toBe("blocked_untrusted_asset");
		if (plan.status !== "blocked_untrusted_asset") {
			throw new Error("expected blocked_untrusted_asset");
		}
		expect(plan.reasons).toContain("missing_signature");
	});
});

describe("channelAllowsUnsignedAssets", () => {
	it("relaxes signing only on pre-release channels", () => {
		expect(channelAllowsUnsignedAssets("dev")).toBe(true);
		expect(channelAllowsUnsignedAssets("nightly")).toBe(true);
		expect(channelAllowsUnsignedAssets("beta")).toBe(false);
		expect(channelAllowsUnsignedAssets("stable")).toBe(false);
	});
});
