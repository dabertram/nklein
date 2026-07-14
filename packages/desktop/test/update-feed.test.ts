import { describe, expect, it } from "vitest";

import {
	buildGitHubReleaseApiUrl,
	checkDesktopUpdateFromGitHub,
	fetchDesktopReleaseManifestFromGitHub,
	parseDesktopReleaseManifest,
	type DesktopUpdateFetch,
} from "../src/update-feed.js";

function response(payload: unknown, ok = true, status = ok ? 200 : 500): Awaited<ReturnType<DesktopUpdateFetch>> {
	return {
		ok,
		status,
		async json() {
			return payload;
		},
	};
}

function fetchSequence(payloads: Array<Awaited<ReturnType<DesktopUpdateFetch>>>): {
	fetch: DesktopUpdateFetch;
	urls: string[];
} {
	const urls: string[] = [];
	return {
		urls,
		fetch: async (url) => {
			urls.push(url);
			const next = payloads.shift();
			if (!next) {
				throw new Error(`unexpected fetch: ${url}`);
			}
			return next;
		},
	};
}

describe("buildGitHubReleaseApiUrl", () => {
	it("builds latest, tagged, and channel-list GitHub release URLs", () => {
		expect(buildGitHubReleaseApiUrl({ owner: "dabertram", repo: "nklein" })).toBe(
			"https://api.github.com/repos/dabertram/nklein/releases/latest",
		);
		expect(buildGitHubReleaseApiUrl({ owner: "dabertram", repo: "nklein", tag: "v0.2.0" })).toBe(
			"https://api.github.com/repos/dabertram/nklein/releases/tags/v0.2.0",
		);
		expect(buildGitHubReleaseApiUrl({ owner: "dabertram", repo: "nklein", channel: "beta" })).toBe(
			"https://api.github.com/repos/dabertram/nklein/releases?per_page=20",
		);
	});
});

describe("parseDesktopReleaseManifest", () => {
	it("parses a minimal valid release manifest", () => {
		expect(
			parseDesktopReleaseManifest({
				version: "0.2.0",
				channel: "stable",
				projectMigration: { required: true, notes: ["workspace-index-v2"] },
				assets: [
					{
						name: "nKlein-0.2.0-arm64.dmg",
						url: "https://example.invalid/nKlein-0.2.0-arm64.dmg",
						sha256: "sum",
						signature: "signed",
						notarized: true,
					},
				],
			}),
		).toEqual({
			version: "0.2.0",
			channel: "stable",
			projectMigration: {
				required: true,
				backupRequired: undefined,
				rollbackSupported: undefined,
				fromVersion: undefined,
				toVersion: undefined,
				notes: ["workspace-index-v2"],
			},
			assets: [
				{
					name: "nKlein-0.2.0-arm64.dmg",
					url: "https://example.invalid/nKlein-0.2.0-arm64.dmg",
					kind: undefined,
					platform: undefined,
					arch: undefined,
					sha256: "sum",
					signature: "signed",
					notarized: true,
				},
			],
		});
	});

	it("rejects manifests without version or usable assets", () => {
		expect(parseDesktopReleaseManifest({ version: "0.2.0", assets: [] })).toBeNull();
		expect(parseDesktopReleaseManifest({ assets: [{ name: "asset", url: "https://example.invalid" }] })).toBeNull();
	});
});

describe("fetchDesktopReleaseManifestFromGitHub", () => {
	it("fetches the release manifest asset from the latest stable GitHub release", async () => {
		const { fetch, urls } = fetchSequence([
			response({
				tag_name: "v0.2.0",
				prerelease: false,
				assets: [
					{
						name: "nklein-desktop-release.json",
						browser_download_url: "https://downloads.invalid/nklein-desktop-release.json",
					},
				],
			}),
			response({
				version: "0.2.0",
				assets: [
					{
						name: "nKlein-0.2.0-arm64.dmg",
						url: "https://downloads.invalid/nKlein-0.2.0-arm64.dmg",
						sha256: "sum",
						signature: "signed",
						notarized: true,
					},
				],
			}),
		]);

		const result = await fetchDesktopReleaseManifestFromGitHub({ owner: "dabertram", repo: "nklein", fetch });

		expect(result.status).toBe("ok");
		if (result.status !== "ok") {
			throw new Error("expected ok");
		}
		expect(result.manifest.version).toBe("0.2.0");
		expect(urls).toEqual([
			"https://api.github.com/repos/dabertram/nklein/releases/latest",
			"https://downloads.invalid/nklein-desktop-release.json",
		]);
	});

	it("selects the first matching beta release from the release list", async () => {
		const { fetch } = fetchSequence([
			response([
				{ tag_name: "v0.3.0-nightly.1", prerelease: true, assets: [] },
				{
					tag_name: "v0.2.0-beta.1",
					prerelease: true,
					assets: [{ name: "desktop-update.json", browser_download_url: "https://downloads.invalid/beta.json" }],
				},
			]),
			response({
				version: "0.2.0-beta.1",
				channel: "beta",
				assets: [
					{
						name: "nKlein-0.2.0-beta.1-x64.AppImage",
						url: "https://downloads.invalid/nklein.AppImage",
						sha256: "sum",
					},
				],
			}),
		]);

		const result = await fetchDesktopReleaseManifestFromGitHub({
			owner: "dabertram",
			repo: "nklein",
			channel: "beta",
			fetch,
		});

		expect(result.status).toBe("ok");
		if (result.status !== "ok") {
			throw new Error("expected ok");
		}
		expect(result.manifest.channel).toBe("beta");
	});

	it("F5.5: selects a dev-tagged prerelease on the dev channel", async () => {
		const { fetch } = fetchSequence([
			response([
				{ tag_name: "v0.2.0-beta.1", prerelease: true, assets: [] },
				{
					tag_name: "v0.3.0-dev.7",
					prerelease: true,
					assets: [{ name: "desktop-update.json", browser_download_url: "https://downloads.invalid/dev.json" }],
				},
			]),
			response({
				version: "0.3.0-dev.7",
				channel: "dev",
				assets: [
					{
						name: "nKlein-0.3.0-dev.7-arm64.dmg",
						url: "https://downloads.invalid/nklein-dev.dmg",
						sha256: "sum",
						signature: "unsigned",
					},
				],
			}),
		]);

		const result = await fetchDesktopReleaseManifestFromGitHub({ owner: "dabertram", repo: "nklein", channel: "dev", fetch });

		expect(result.status).toBe("ok");
		if (result.status !== "ok") {
			throw new Error("expected ok");
		}
		expect(result.manifest.channel).toBe("dev");
	});

	it("returns a typed error when the release has no desktop manifest asset", async () => {
		const { fetch } = fetchSequence([
			response({
				tag_name: "v0.2.0",
				prerelease: false,
				assets: [{ name: "nKlein-0.2.0-arm64.dmg", browser_download_url: "https://downloads.invalid/app.dmg" }],
			}),
		]);

		await expect(fetchDesktopReleaseManifestFromGitHub({ owner: "dabertram", repo: "nklein", fetch })).resolves.toEqual({
			status: "error",
			reason: "manifest_asset_missing",
			message: "Desktop release manifest asset is missing.",
		});
	});
});

describe("checkDesktopUpdateFromGitHub", () => {
	it("combines feed fetch with signed-asset planning", async () => {
		const { fetch } = fetchSequence([
			response({
				tag_name: "v0.2.0",
				prerelease: false,
				assets: [
					{
						name: "nklein-desktop-release.json",
						browser_download_url: "https://downloads.invalid/nklein-desktop-release.json",
					},
				],
			}),
			response({
				version: "0.2.0",
				channel: "stable",
				assets: [
					{
						name: "nKlein-0.2.0-arm64.dmg",
						url: "https://downloads.invalid/nKlein-0.2.0-arm64.dmg",
						sha256: "sum",
						signature: "signed",
						notarized: true,
					},
				],
			}),
		]);

		const plan = await checkDesktopUpdateFromGitHub({
			owner: "dabertram",
			repo: "nklein",
			currentVersion: "0.1.0",
			platform: "darwin",
			arch: "arm64",
			fetch,
		});

		expect(plan.status).toBe("update_available");
		if (plan.status !== "update_available") {
			throw new Error("expected update_available");
		}
		expect(plan.latestVersion).toBe("0.2.0");
		expect(plan.asset.name).toBe("nKlein-0.2.0-arm64.dmg");
	});
});
