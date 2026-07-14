/**
 * F5.7 — release channel-manifest GENERATOR (the write side complementing {@link parseDesktopReleaseManifest}). A
 * release process runs this over its built asset files to emit the `desktop-update.json` the updater feed consumes:
 * per-asset sha256 (integrity), inferred kind/platform/arch (so a client can match its OS/arch), the channel, and the
 * project-migration spec. Pure + deterministic — the caller supplies the already-computed sha256 (via
 * {@link computeSha256Hex} over the asset bytes), so no filesystem/crypto side effects live here.
 *
 * Credential-free by design (mirrors F5.5's unsigned-OK dev channel): `signature` defaults to `"unsigned"` and
 * `notarized` to false, so a dev/nightly release manifest is produced WITHOUT signing credentials. When signing is
 * later integrated, the caller passes `signature: "signed"` / `notarized: true` and the same generator emits a
 * release-channel manifest — no code change, just richer inputs. The output round-trips through
 * {@link parseDesktopReleaseManifest} by construction (see the integrity tests).
 */

import { normalizeSha256 } from "./update-download.js";
import {
	type DesktopProjectMigrationSpec,
	type DesktopReleaseAsset,
	type DesktopReleaseManifest,
	type DesktopUpdateChannel,
	inferAssetArch,
	inferDesktopReleaseAssetKind,
	platformForKind,
} from "./update-plan.js";

export interface ReleaseAssetInput {
	/** The asset file name (drives kind/platform/arch inference) — e.g. `nKlein-0.3.0-arm64.dmg`. */
	readonly name: string;
	/** The download URL the client fetches. */
	readonly url: string;
	/** SHA-256 hex of the asset bytes (with or without a `sha256:` prefix); required for integrity. */
	readonly sha256: string;
	/** Defaults to `"unsigned"` (dev/nightly); pass `"signed"` once signing is integrated. */
	readonly signature?: "signed" | "unsigned";
	/** macOS notarization; defaults to false. */
	readonly notarized?: boolean;
}

export interface BuildReleaseManifestInput {
	readonly version: string;
	readonly channel: DesktopUpdateChannel;
	readonly assets: readonly ReleaseAssetInput[];
	readonly projectMigration?: DesktopProjectMigrationSpec;
}

export type BuildReleaseManifestResult =
	| { readonly ok: true; readonly manifest: DesktopReleaseManifest }
	| { readonly ok: false; readonly errors: readonly string[] };

function buildAsset(input: ReleaseAssetInput): { asset: DesktopReleaseAsset | null; error: string | null } {
	const name = input.name.trim();
	if (!name) {
		return { asset: null, error: "asset has an empty name" };
	}
	const kind = inferDesktopReleaseAssetKind(name);
	if (!kind) {
		return { asset: null, error: `asset "${name}" has an unrecognized kind (extension)` };
	}
	const sha256 = normalizeSha256(input.sha256);
	if (!sha256) {
		return { asset: null, error: `asset "${name}" is missing a valid sha256 checksum` };
	}
	const arch = inferAssetArch(name) ?? "universal";
	return {
		error: null,
		asset: {
			name,
			url: input.url.trim(),
			kind,
			platform: platformForKind(kind),
			arch,
			sha256,
			signature: input.signature ?? "unsigned",
			notarized: input.notarized ?? false,
		},
	};
}

export function buildDesktopReleaseManifest(input: BuildReleaseManifestInput): BuildReleaseManifestResult {
	const errors: string[] = [];
	const version = input.version.trim();
	if (!version) {
		errors.push("manifest version is empty");
	}
	if (input.assets.length === 0) {
		errors.push("manifest has no assets");
	}
	const assets: DesktopReleaseAsset[] = [];
	for (const assetInput of input.assets) {
		const { asset, error } = buildAsset(assetInput);
		if (error) {
			errors.push(error);
		} else if (asset) {
			assets.push(asset);
		}
	}
	if (errors.length > 0) {
		return { ok: false, errors };
	}
	const manifest: DesktopReleaseManifest = {
		version,
		channel: input.channel,
		assets,
		...(input.projectMigration ? { projectMigration: input.projectMigration } : {}),
	};
	return { ok: true, manifest };
}
