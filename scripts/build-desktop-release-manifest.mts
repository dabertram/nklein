import { writeDesktopReleaseMetadata } from "../packages/desktop/src/release-manifest-files.js";
import { TRUSTED_DESKTOP_RELEASE_KEYS } from "../packages/desktop/src/release-trust.js";
import type { DesktopUpdateChannel, DesktopUpdatePlatform } from "../packages/desktop/src/update-plan.js";

function option(name: string, required = true): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
	if (required && !value) throw new Error(`Missing --${name}.`);
	return value;
}

function platforms(name: string): DesktopUpdatePlatform[] {
	const value = option(name, false);
	if (!value) return [];
	return value.split(",").map((entry) => {
		const platform = entry.trim();
		if (platform !== "darwin" && platform !== "win32" && platform !== "linux") {
			throw new Error(`Invalid platform "${platform}" in --${name}.`);
		}
		return platform;
	});
}

function privateKeyFromEnvironment(): string | undefined {
	const raw = process.env.NKLEIN_RELEASE_MANIFEST_PRIVATE_KEY?.trim();
	if (!raw) return undefined;
	return raw.includes("BEGIN PRIVATE KEY") ? raw : Buffer.from(raw, "base64").toString("utf8");
}

const channel = option("channel") as DesktopUpdateChannel;
if (!(["stable", "beta", "nightly", "dev"] as string[]).includes(channel)) {
	throw new Error(`Invalid --channel "${channel}".`);
}

const result = await writeDesktopReleaseMetadata({
	assetDirectory: option("asset-dir")!,
	baseUrl: option("base-url")!,
	version: option("version")!,
	channel,
	keyId: process.env.NKLEIN_RELEASE_MANIFEST_KEY_ID?.trim(),
	privateKeyPem: privateKeyFromEnvironment(),
	trustedKeys: TRUSTED_DESKTOP_RELEASE_KEYS,
	signedPlatforms: platforms("signed-platforms"),
	notarizedPlatforms: platforms("notarized-platforms"),
});

console.log(`Wrote ${result.manifestPath}`);
console.log(`Wrote ${result.checksumsPath}`);
console.log(`Release assets: ${result.manifest.assets.length}; manifest signed: ${Boolean(result.manifest.releaseSignature)}`);
