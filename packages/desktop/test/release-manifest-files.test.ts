import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { writeDesktopReleaseMetadata } from "../src/release-manifest-files.js";
import { verifyDesktopReleaseManifestSignature } from "../src/update-manifest-signature.js";

async function fixtureDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "nklein-release-metadata-"));
	await Promise.all([
		writeFile(join(directory, "nKlein-1.2.3-arm64.dmg"), "mac"),
		writeFile(join(directory, "nKlein-1.2.3-windows-x64-setup.exe"), "win"),
		writeFile(join(directory, "nKlein-1.2.3-linux-x64.AppImage"), "linux"),
		writeFile(join(directory, "latest.yml"), "ignored"),
	]);
	return directory;
}

describe("desktop release metadata files", () => {
	it("writes deterministic checksums and a signed cross-platform stable manifest", async () => {
		const directory = await fixtureDirectory();
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		const result = await writeDesktopReleaseMetadata({
			assetDirectory: directory,
			baseUrl: "https://github.com/dabertram/nklein/releases/download/v1.2.3/",
			version: "1.2.3",
			channel: "stable",
			keyId: "release-2026",
			privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
			trustedKeys: {
				"release-2026": publicKey.export({ type: "spki", format: "pem" }).toString(),
			},
			signedPlatforms: ["darwin", "win32"],
			notarizedPlatforms: ["darwin"],
		});

		expect(result.manifest.assets).toHaveLength(3);
		expect(verifyDesktopReleaseManifestSignature(result.manifest, {
			"release-2026": publicKey.export({ type: "spki", format: "pem" }).toString(),
		})).toEqual({ ok: true });
		const checksums = await readFile(result.checksumsPath, "utf8");
		expect(checksums).toContain("nKlein-1.2.3-linux-x64.AppImage");
		expect(checksums).not.toContain("latest.yml");
		expect(await readFile(result.manifestPath, "utf8")).toContain('"algorithm": "ed25519"');
	});

	it("refuses protected output when platform trust proofs or the manifest key are absent", async () => {
		const directory = await fixtureDirectory();
		await expect(
			writeDesktopReleaseMetadata({
				assetDirectory: directory,
				baseUrl: "https://example.invalid",
				version: "1.2.3",
				channel: "stable",
			}),
		).rejects.toThrow(/macOS asset .* not proven signed and notarized/u);

		await expect(
			writeDesktopReleaseMetadata({
				assetDirectory: directory,
				baseUrl: "https://example.invalid",
				version: "1.2.3",
				channel: "stable",
				signedPlatforms: ["darwin", "win32"],
				notarizedPlatforms: ["darwin"],
			}),
		).rejects.toThrow(/requires an Ed25519 key id and private key/u);

		const { privateKey } = generateKeyPairSync("ed25519");
		await expect(
			writeDesktopReleaseMetadata({
				assetDirectory: directory,
				baseUrl: "https://example.invalid",
				version: "1.2.3",
				channel: "stable",
				keyId: "not-embedded",
				privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
				signedPlatforms: ["darwin", "win32"],
				notarizedPlatforms: ["darwin"],
			}),
		).rejects.toThrow(/not trusted by the packaged keyring \(unknown_key\)/u);
	});

	it("permits explicitly unsigned dev metadata while retaining SHA-256", async () => {
		const directory = await fixtureDirectory();
		const result = await writeDesktopReleaseMetadata({
			assetDirectory: directory,
			baseUrl: "https://example.invalid",
			version: "1.2.3-dev.1",
			channel: "dev",
		});
		expect(result.manifest.releaseSignature).toBeUndefined();
		expect(result.manifest.assets.every((asset) => asset.sha256?.length === 64)).toBe(true);
	});
});
