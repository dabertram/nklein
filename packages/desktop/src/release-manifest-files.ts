import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { computeSha256Hex } from "./update-download.js";
import { buildDesktopReleaseManifest, type ReleaseAssetInput } from "./update-manifest-build.js";
import {
	signDesktopReleaseManifest,
	type TrustedDesktopReleaseKeys,
	verifyDesktopReleaseManifestSignature,
} from "./update-manifest-signature.js";
import {
	inferDesktopReleaseAssetKind,
	platformForKind,
	type DesktopReleaseManifest,
	type DesktopUpdateChannel,
	type DesktopUpdatePlatform,
} from "./update-plan.js";

export interface WriteDesktopReleaseMetadataInput {
	assetDirectory: string;
	baseUrl: string;
	version: string;
	channel: DesktopUpdateChannel;
	keyId?: string;
	privateKeyPem?: string;
	trustedKeys?: TrustedDesktopReleaseKeys;
	signedPlatforms?: readonly DesktopUpdatePlatform[];
	notarizedPlatforms?: readonly DesktopUpdatePlatform[];
}

export interface WriteDesktopReleaseMetadataResult {
	manifest: DesktopReleaseManifest;
	manifestPath: string;
	checksumsPath: string;
}

function protectedChannel(channel: DesktopUpdateChannel): boolean {
	return channel === "stable" || channel === "beta";
}

function assetUrl(baseUrl: string, name: string): string {
	return `${baseUrl.replace(/\/+$/u, "")}/${encodeURIComponent(name)}`;
}

export async function collectDesktopReleaseAssetInputs(input: {
	assetDirectory: string;
	baseUrl: string;
	signedPlatforms?: readonly DesktopUpdatePlatform[];
	notarizedPlatforms?: readonly DesktopUpdatePlatform[];
}): Promise<ReleaseAssetInput[]> {
	const signedPlatforms = new Set(input.signedPlatforms ?? []);
	const notarizedPlatforms = new Set(input.notarizedPlatforms ?? []);
	const entries = await readdir(input.assetDirectory, { withFileTypes: true });
	const assets: ReleaseAssetInput[] = [];
	for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
		if (!entry.isFile()) continue;
		const kind = inferDesktopReleaseAssetKind(entry.name);
		if (!kind) continue;
		const platform = platformForKind(kind);
		const bytes = await readFile(join(input.assetDirectory, entry.name));
		assets.push({
			name: entry.name,
			url: assetUrl(input.baseUrl, entry.name),
			sha256: computeSha256Hex(bytes),
			signature: signedPlatforms.has(platform) ? "signed" : "unsigned",
			notarized: notarizedPlatforms.has(platform),
		});
	}
	return assets;
}

function assertProtectedAssetPolicy(manifest: DesktopReleaseManifest): void {
	if (!protectedChannel(manifest.channel ?? "stable")) return;
	for (const asset of manifest.assets) {
		if (asset.platform === "darwin" && (asset.signature !== "signed" || asset.notarized !== true)) {
			throw new Error(`Protected macOS asset ${asset.name} was not proven signed and notarized.`);
		}
		if (asset.platform === "win32" && asset.signature !== "signed") {
			throw new Error(`Protected Windows asset ${asset.name} was not proven Authenticode-signed.`);
		}
	}
}

export async function writeDesktopReleaseMetadata(
	input: WriteDesktopReleaseMetadataInput,
): Promise<WriteDesktopReleaseMetadataResult> {
	const assets = await collectDesktopReleaseAssetInputs(input);
	const built = buildDesktopReleaseManifest({ version: input.version, channel: input.channel, assets });
	if (!built.ok) {
		throw new Error(`Desktop release manifest is invalid: ${built.errors.join("; ")}`);
	}
	assertProtectedAssetPolicy(built.manifest);
	let manifest = built.manifest;
	if (protectedChannel(input.channel)) {
		if (!input.keyId?.trim() || !input.privateKeyPem?.trim()) {
			throw new Error("Stable/beta desktop release metadata requires an Ed25519 key id and private key.");
		}
		manifest = signDesktopReleaseManifest(manifest, { keyId: input.keyId, privateKeyPem: input.privateKeyPem });
		const verification = verifyDesktopReleaseManifestSignature(manifest, input.trustedKeys ?? {});
		if (!verification.ok) {
			throw new Error(
				`Generated release manifest is not trusted by the packaged keyring (${verification.reason}). ` +
					"Embed the public key before using its private half.",
			);
		}
	} else if (input.keyId?.trim() && input.privateKeyPem?.trim()) {
		manifest = signDesktopReleaseManifest(manifest, { keyId: input.keyId, privateKeyPem: input.privateKeyPem });
	}
	const manifestPath = join(input.assetDirectory, "nklein-desktop-release.json");
	const checksumsPath = join(input.assetDirectory, "SHA256SUMS");
	const checksums = manifest.assets
		.map((asset) => `${asset.sha256}  ${basename(asset.name)}`)
		.sort()
		.join("\n");
	await Promise.all([
		writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
		writeFile(checksumsPath, `${checksums}\n`, "utf8"),
	]);
	return { manifest, manifestPath, checksumsPath };
}
