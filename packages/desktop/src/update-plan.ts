export type DesktopUpdatePlatform = "darwin" | "linux" | "win32";
export type DesktopUpdateArch = "arm64" | "x64";
export type DesktopUpdateChannel = "stable" | "beta" | "nightly" | "dev";

/**
 * Pre-release channels (`dev`, `nightly`) ship UNSIGNED assets while !Klein is maturing — the default trust policy
 * drops the signature/notarization requirement for them but ALWAYS keeps sha256 (checksum integrity is the security
 * that matters for an unsigned build). Release channels (`stable`, `beta`) stay strict so signed releases are enforced
 * the moment signing credentials exist. An explicit `trustPolicy` on the input still overrides either way.
 */
export function channelAllowsUnsignedAssets(channel: DesktopUpdateChannel): boolean {
	return channel === "dev" || channel === "nightly";
}
export type DesktopReleaseAssetKind =
	| "mac_dmg"
	| "mac_zip"
	| "windows_nsis"
	| "windows_msi"
	| "linux_appimage"
	| "linux_deb"
	| "linux_rpm";

export interface DesktopReleaseAsset {
	name: string;
	url: string;
	kind?: DesktopReleaseAssetKind;
	platform?: DesktopUpdatePlatform;
	arch?: DesktopUpdateArch | "universal";
	sha256?: string;
	signature?: "signed" | "unsigned" | "unknown";
	notarized?: boolean;
}

export interface DesktopProjectMigrationSpec {
	required: boolean;
	backupRequired?: boolean;
	rollbackSupported?: boolean;
	fromVersion?: string;
	toVersion?: string;
	notes?: string[];
}

export interface DesktopReleaseManifest {
	version: string;
	channel?: DesktopUpdateChannel;
	projectMigration?: DesktopProjectMigrationSpec;
	assets: DesktopReleaseAsset[];
}

export interface DesktopUpdateTrustPolicy {
	requireSha256?: boolean;
	requireSignedAsset?: boolean;
	requireMacNotarization?: boolean;
}

export interface SelectDesktopUpdateInput {
	currentVersion: string;
	platform: DesktopUpdatePlatform;
	arch: DesktopUpdateArch;
	channel?: DesktopUpdateChannel;
	manifest: DesktopReleaseManifest;
	trustPolicy?: DesktopUpdateTrustPolicy;
}

export type DesktopUpdatePlan =
	| { status: "up_to_date"; currentVersion: string; latestVersion: string }
	| { status: "wrong_channel"; requestedChannel: DesktopUpdateChannel; releaseChannel: DesktopUpdateChannel }
	| { status: "no_compatible_asset"; latestVersion: string; platform: DesktopUpdatePlatform; arch: DesktopUpdateArch }
	| {
			status: "blocked_untrusted_asset";
			latestVersion: string;
			asset: DesktopReleaseAsset;
			reasons: string[];
	  }
	| {
			status: "update_available";
			currentVersion: string;
			latestVersion: string;
			asset: DesktopReleaseAsset;
			projectMigration: Required<DesktopProjectMigrationSpec>;
	  };

const ASSET_KIND_ORDER: Record<DesktopUpdatePlatform, DesktopReleaseAssetKind[]> = {
	darwin: ["mac_dmg", "mac_zip"],
	win32: ["windows_nsis", "windows_msi"],
	linux: ["linux_appimage", "linux_deb", "linux_rpm"],
};

function parseVersion(version: string): Array<number | string> {
	return version
		.replace(/\+.*/u, "")
		.split(/[.-]/u)
		.map((part) => {
			const parsed = Number.parseInt(part, 10);
			return Number.isFinite(parsed) && String(parsed) === part ? parsed : part;
		});
}

export function compareDesktopVersions(leftVersion: string, rightVersion: string): number {
	const left = parseVersion(leftVersion);
	const right = parseVersion(rightVersion);
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index++) {
		const leftPart = left[index] ?? 0;
		const rightPart = right[index] ?? 0;
		if (leftPart === rightPart) {
			continue;
		}
		if (typeof leftPart === "number" && typeof rightPart === "number") {
			return leftPart > rightPart ? 1 : -1;
		}
		if (typeof leftPart === "number") {
			return 1;
		}
		if (typeof rightPart === "number") {
			return -1;
		}
		return String(leftPart).localeCompare(String(rightPart));
	}
	return 0;
}

export function inferDesktopReleaseAssetKind(name: string): DesktopReleaseAssetKind | null {
	const normalized = name.toLowerCase();
	if (normalized.endsWith(".dmg")) {
		return "mac_dmg";
	}
	if (normalized.endsWith(".zip") && (normalized.includes("mac") || normalized.includes("darwin"))) {
		return "mac_zip";
	}
	if (normalized.endsWith(".exe")) {
		return "windows_nsis";
	}
	if (normalized.endsWith(".msi")) {
		return "windows_msi";
	}
	if (normalized.endsWith(".appimage")) {
		return "linux_appimage";
	}
	if (normalized.endsWith(".deb")) {
		return "linux_deb";
	}
	if (normalized.endsWith(".rpm")) {
		return "linux_rpm";
	}
	return null;
}

export function inferAssetArch(name: string): DesktopUpdateArch | "universal" | null {
	const normalized = name.toLowerCase();
	if (normalized.includes("universal")) {
		return "universal";
	}
	if (normalized.includes("arm64") || normalized.includes("aarch64")) {
		return "arm64";
	}
	if (normalized.includes("x64") || normalized.includes("x86_64") || normalized.includes("amd64")) {
		return "x64";
	}
	return null;
}

export function platformForKind(kind: DesktopReleaseAssetKind): DesktopUpdatePlatform {
	if (kind.startsWith("mac_")) {
		return "darwin";
	}
	if (kind.startsWith("windows_")) {
		return "win32";
	}
	return "linux";
}

function assetMatches(input: SelectDesktopUpdateInput, asset: DesktopReleaseAsset): boolean {
	const kind = asset.kind ?? inferDesktopReleaseAssetKind(asset.name);
	if (!kind) {
		return false;
	}
	const platform = asset.platform ?? platformForKind(kind);
	if (platform !== input.platform) {
		return false;
	}
	const arch = asset.arch ?? inferAssetArch(asset.name);
	return arch === "universal" || arch === input.arch;
}

function defaultTrustPolicy(
	platform: DesktopUpdatePlatform,
	channel: DesktopUpdateChannel,
): Required<DesktopUpdateTrustPolicy> {
	// Pre-release channels accept unsigned assets (checksum still required); release channels enforce signing.
	const signingRequired = !channelAllowsUnsignedAssets(channel) && (platform === "darwin" || platform === "win32");
	return {
		requireSha256: true,
		requireSignedAsset: signingRequired,
		requireMacNotarization: signingRequired && platform === "darwin",
	};
}

function validateAssetTrust(
	asset: DesktopReleaseAsset,
	platform: DesktopUpdatePlatform,
	channel: DesktopUpdateChannel,
	policy: DesktopUpdateTrustPolicy | undefined,
): string[] {
	const resolvedPolicy = { ...defaultTrustPolicy(platform, channel), ...policy };
	const reasons: string[] = [];
	if (resolvedPolicy.requireSha256 && !asset.sha256?.trim()) {
		reasons.push("missing_sha256");
	}
	if (resolvedPolicy.requireSignedAsset && asset.signature !== "signed") {
		reasons.push("missing_signature");
	}
	if (resolvedPolicy.requireMacNotarization && asset.notarized !== true) {
		reasons.push("missing_notarization");
	}
	return reasons;
}

function buildProjectMigrationPlan(manifest: DesktopReleaseManifest): Required<DesktopProjectMigrationSpec> {
	const migration = manifest.projectMigration;
	return {
		required: migration?.required === true,
		backupRequired: migration?.backupRequired !== false,
		rollbackSupported: migration?.rollbackSupported === true,
		fromVersion: migration?.fromVersion ?? "",
		toVersion: migration?.toVersion ?? manifest.version,
		notes: migration?.notes ?? [],
	};
}

export function selectDesktopUpdate(input: SelectDesktopUpdateInput): DesktopUpdatePlan {
	if (compareDesktopVersions(input.manifest.version, input.currentVersion) <= 0) {
		return {
			status: "up_to_date",
			currentVersion: input.currentVersion,
			latestVersion: input.manifest.version,
		};
	}

	const requestedChannel = input.channel ?? "stable";
	const releaseChannel = input.manifest.channel ?? "stable";
	if (requestedChannel !== releaseChannel) {
		return { status: "wrong_channel", requestedChannel, releaseChannel };
	}

	const candidates = input.manifest.assets
		.filter((asset) => assetMatches(input, asset))
		.sort((left, right) => {
			const leftKind = left.kind ?? inferDesktopReleaseAssetKind(left.name);
			const rightKind = right.kind ?? inferDesktopReleaseAssetKind(right.name);
			const order = ASSET_KIND_ORDER[input.platform];
			return order.indexOf(leftKind as DesktopReleaseAssetKind) - order.indexOf(rightKind as DesktopReleaseAssetKind);
		});

	const asset = candidates[0];
	if (!asset) {
		return {
			status: "no_compatible_asset",
			latestVersion: input.manifest.version,
			platform: input.platform,
			arch: input.arch,
		};
	}

	const trustReasons = validateAssetTrust(asset, input.platform, releaseChannel, input.trustPolicy);
	if (trustReasons.length > 0) {
		return {
			status: "blocked_untrusted_asset",
			latestVersion: input.manifest.version,
			asset,
			reasons: trustReasons,
		};
	}

	return {
		status: "update_available",
		currentVersion: input.currentVersion,
		latestVersion: input.manifest.version,
		asset,
		projectMigration: buildProjectMigrationPlan(input.manifest),
	};
}
