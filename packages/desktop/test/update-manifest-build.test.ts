import { describe, expect, it } from "vitest";

import { computeSha256Hex } from "../src/update-download.js";
import { parseDesktopReleaseManifest } from "../src/update-feed.js";
import { buildDesktopReleaseManifest } from "../src/update-manifest-build.js";
import { selectDesktopUpdate } from "../src/update-plan.js";

/** F5.7 — the channel-manifest generator + its integrity round-trip. */

const sha = (text: string): string => computeSha256Hex(new TextEncoder().encode(text));

describe("buildDesktopReleaseManifest", () => {
	it("builds a dev-channel manifest with per-asset integrity, inferred kind/platform/arch, unsigned by default", () => {
		const result = buildDesktopReleaseManifest({
			version: "0.3.0-dev.7",
			channel: "dev",
			assets: [
				{ name: "nKlein-0.3.0-dev.7-arm64.dmg", url: "https://dl.invalid/mac.dmg", sha256: sha("mac-bytes") },
				{ name: "nKlein-0.3.0-dev.7-x64.AppImage", url: "https://dl.invalid/linux.AppImage", sha256: sha("linux-bytes") },
			],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.manifest.channel).toBe("dev");
		const mac = result.manifest.assets.find((a) => a.kind === "mac_dmg");
		expect(mac).toMatchObject({ platform: "darwin", arch: "arm64", signature: "unsigned", notarized: false });
		expect(mac?.sha256).toBe(sha("mac-bytes"));
		const linux = result.manifest.assets.find((a) => a.kind === "linux_appimage");
		expect(linux).toMatchObject({ platform: "linux", arch: "x64" });
	});

	it("INTEGRITY round-trip: a generated manifest parses back losslessly and drives a real update selection", () => {
		const built = buildDesktopReleaseManifest({
			version: "0.3.0-dev.7",
			channel: "dev",
			assets: [{ name: "nKlein-0.3.0-dev.7-arm64.dmg", url: "https://dl.invalid/mac.dmg", sha256: sha("bytes") }],
		});
		if (!built.ok) throw new Error("expected ok");
		// Serialize → parse (what the feed does after downloading desktop-update.json).
		const reparsed = parseDesktopReleaseManifest(JSON.parse(JSON.stringify(built.manifest)));
		expect(reparsed).toEqual(built.manifest);
		// And the parsed manifest selects an update for a matching client (unsigned OK on dev).
		const plan = selectDesktopUpdate({
			currentVersion: "0.2.0",
			platform: "darwin",
			arch: "arm64",
			channel: "dev",
			manifest: reparsed!,
		});
		expect(plan.status).toBe("update_available");
	});

	it("carries signed/notarized through when signing is later integrated (no code change)", () => {
		const result = buildDesktopReleaseManifest({
			version: "1.0.0",
			channel: "stable",
			assets: [
				{ name: "nKlein-1.0.0-arm64.dmg", url: "https://dl.invalid/mac.dmg", sha256: sha("b"), signature: "signed", notarized: true },
			],
		});
		if (!result.ok) throw new Error("expected ok");
		expect(result.manifest.assets[0]).toMatchObject({ signature: "signed", notarized: true });
	});

	it("fails closed on an unrecognized asset, a missing checksum, or no assets", () => {
		expect(
			buildDesktopReleaseManifest({ version: "1.0.0", channel: "dev", assets: [{ name: "notes.txt", url: "u", sha256: sha("x") }] }),
		).toMatchObject({ ok: false });
		expect(
			buildDesktopReleaseManifest({ version: "1.0.0", channel: "dev", assets: [{ name: "a.dmg", url: "u", sha256: "not-a-hash" }] }),
		).toMatchObject({ ok: false });
		expect(buildDesktopReleaseManifest({ version: "1.0.0", channel: "dev", assets: [] })).toMatchObject({ ok: false });
	});
});
