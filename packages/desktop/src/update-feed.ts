import {
	selectDesktopUpdate,
	type DesktopProjectMigrationSpec,
	type DesktopReleaseAsset,
	type DesktopReleaseAssetKind,
	type DesktopReleaseManifest,
	type DesktopUpdateArch,
	type DesktopUpdateChannel,
	type DesktopUpdatePlan,
	type DesktopUpdatePlatform,
	type DesktopUpdateTrustPolicy,
} from "./update-plan.js";

interface FetchResponseLike {
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
}

export type DesktopUpdateFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponseLike>;

export interface GitHubDesktopReleaseSource {
	owner: string;
	repo: string;
	channel?: DesktopUpdateChannel;
	tag?: string;
	manifestAssetNames?: string[];
}

export interface CheckDesktopUpdateFromGitHubOptions extends GitHubDesktopReleaseSource {
	currentVersion: string;
	platform: DesktopUpdatePlatform;
	arch: DesktopUpdateArch;
	fetch: DesktopUpdateFetch;
	trustPolicy?: DesktopUpdateTrustPolicy;
	signal?: AbortSignal;
}

export type DesktopUpdateFeedFailureReason =
	| "release_fetch_failed"
	| "release_not_found"
	| "manifest_asset_missing"
	| "manifest_fetch_failed"
	| "manifest_invalid";

export type DesktopUpdateFeedResult =
	| {
			status: "feed_unavailable";
			reason: DesktopUpdateFeedFailureReason;
			message: string;
	  }
	| DesktopUpdatePlan;

interface GitHubReleaseAssetResponse {
	name?: unknown;
	browser_download_url?: unknown;
}

interface GitHubReleaseResponse {
	tag_name?: unknown;
	draft?: unknown;
	prerelease?: unknown;
	assets?: unknown;
}

const DEFAULT_MANIFEST_ASSET_NAMES = ["nklein-desktop-release.json", "desktop-update.json"];

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolValue(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function normalizeVersionTag(tagName: string): string {
	return tagName.trim().replace(/^v/u, "");
}

function channelForRelease(release: GitHubReleaseResponse): DesktopUpdateChannel {
	const tag = stringValue(release.tag_name)?.toLowerCase() ?? "";
	if (tag.includes("nightly")) {
		return "nightly";
	}
	return release.prerelease === true ? "beta" : "stable";
}

export function buildGitHubReleaseApiUrl(input: GitHubDesktopReleaseSource): string {
	const base = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;
	if (input.tag?.trim()) {
		return `${base}/releases/tags/${encodeURIComponent(input.tag.trim())}`;
	}
	if ((input.channel ?? "stable") === "stable") {
		return `${base}/releases/latest`;
	}
	return `${base}/releases?per_page=20`;
}

function parseRelease(value: unknown): GitHubReleaseResponse | null {
	if (!isRecord(value)) {
		return null;
	}
	return {
		tag_name: value.tag_name,
		draft: value.draft,
		prerelease: value.prerelease,
		assets: value.assets,
	};
}

function selectRelease(payload: unknown, channel: DesktopUpdateChannel): GitHubReleaseResponse | null {
	if (Array.isArray(payload)) {
		for (const entry of payload) {
			const release = parseRelease(entry);
			if (!release || release.draft === true) {
				continue;
			}
			if (channelForRelease(release) === channel) {
				return release;
			}
		}
		return null;
	}
	const release = parseRelease(payload);
	if (!release || release.draft === true) {
		return null;
	}
	return release;
}

function findManifestAsset(
	release: GitHubReleaseResponse,
	names: readonly string[],
): { name: string; url: string } | null {
	const normalizedNames = new Set(names.map((name) => name.toLowerCase()));
	for (const rawAsset of arrayValue(release.assets)) {
		if (!isRecord(rawAsset)) {
			continue;
		}
		const asset = rawAsset as GitHubReleaseAssetResponse;
		const name = stringValue(asset.name);
		const url = stringValue(asset.browser_download_url);
		if (name && url && normalizedNames.has(name.toLowerCase())) {
			return { name, url };
		}
	}
	return null;
}

function parseAsset(value: unknown): DesktopReleaseAsset | null {
	if (!isRecord(value)) {
		return null;
	}
	const name = stringValue(value.name);
	const url = stringValue(value.url);
	if (!name || !url) {
		return null;
	}
	return {
		name,
		url,
		kind: (stringValue(value.kind) as DesktopReleaseAssetKind | null) ?? undefined,
		platform: (stringValue(value.platform) as DesktopUpdatePlatform | null) ?? undefined,
		arch: (stringValue(value.arch) as DesktopUpdateArch | "universal" | null) ?? undefined,
		sha256: stringValue(value.sha256) ?? undefined,
		signature: (stringValue(value.signature) as DesktopReleaseAsset["signature"] | null) ?? undefined,
		notarized: boolValue(value.notarized),
	};
}

function parseMigration(value: unknown): DesktopProjectMigrationSpec | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	return {
		required: value.required === true,
		backupRequired: boolValue(value.backupRequired),
		rollbackSupported: boolValue(value.rollbackSupported),
		fromVersion: stringValue(value.fromVersion) ?? undefined,
		toVersion: stringValue(value.toVersion) ?? undefined,
		notes: arrayValue(value.notes).map(stringValue).filter((note): note is string => note !== null),
	};
}

export function parseDesktopReleaseManifest(value: unknown): DesktopReleaseManifest | null {
	if (!isRecord(value)) {
		return null;
	}
	const version = stringValue(value.version);
	if (!version) {
		return null;
	}
	const assets = arrayValue(value.assets).map(parseAsset).filter((asset): asset is DesktopReleaseAsset => asset !== null);
	if (assets.length === 0) {
		return null;
	}
	return {
		version,
		channel: stringValue(value.channel) as DesktopUpdateChannel | undefined,
		projectMigration: parseMigration(value.projectMigration),
		assets,
	};
}

export async function fetchDesktopReleaseManifestFromGitHub(
	options: GitHubDesktopReleaseSource & { fetch: DesktopUpdateFetch; signal?: AbortSignal },
): Promise<
	| { status: "ok"; manifest: DesktopReleaseManifest }
	| { status: "error"; reason: DesktopUpdateFeedFailureReason; message: string }
> {
	const channel = options.channel ?? "stable";
	const releaseResponse = await options.fetch(buildGitHubReleaseApiUrl(options), { signal: options.signal }).catch(() => null);
	if (!releaseResponse?.ok) {
		return {
			status: "error",
			reason: "release_fetch_failed",
			message: `Could not fetch GitHub release metadata (${releaseResponse?.status ?? "network_error"}).`,
		};
	}
	const releasePayload = await releaseResponse.json().catch(() => null);
	const release = selectRelease(releasePayload, channel);
	if (!release) {
		return { status: "error", reason: "release_not_found", message: `No ${channel} desktop release found.` };
	}
	const manifestAsset = findManifestAsset(release, options.manifestAssetNames ?? DEFAULT_MANIFEST_ASSET_NAMES);
	if (!manifestAsset) {
		return {
			status: "error",
			reason: "manifest_asset_missing",
			message: "Desktop release manifest asset is missing.",
		};
	}
	const manifestResponse = await options.fetch(manifestAsset.url, { signal: options.signal }).catch(() => null);
	if (!manifestResponse?.ok) {
		return {
			status: "error",
			reason: "manifest_fetch_failed",
			message: `Could not fetch desktop release manifest ${manifestAsset.name}.`,
		};
	}
	const manifestPayload = await manifestResponse.json().catch(() => null);
	const manifest = parseDesktopReleaseManifest(manifestPayload);
	if (!manifest) {
		return {
			status: "error",
			reason: "manifest_invalid",
			message: `Desktop release manifest ${manifestAsset.name} is invalid.`,
		};
	}
	return { status: "ok", manifest };
}

export async function checkDesktopUpdateFromGitHub(
	options: CheckDesktopUpdateFromGitHubOptions,
): Promise<DesktopUpdateFeedResult> {
	const feed = await fetchDesktopReleaseManifestFromGitHub(options);
	if (feed.status === "error") {
		return {
			status: "feed_unavailable",
			reason: feed.reason,
			message: feed.message,
		};
	}
	return selectDesktopUpdate({
		currentVersion: options.currentVersion,
		platform: options.platform,
		arch: options.arch,
		channel: options.channel,
		manifest: feed.manifest,
		trustPolicy: options.trustPolicy,
	});
}
