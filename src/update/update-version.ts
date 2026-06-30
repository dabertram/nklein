/**
 * Pure semver parsing + comparison for the auto-updater, extracted from update.ts. SemVer-ish: a
 * dotted numeric core, an optional `-prerelease` (dot-separated numeric/alphanumeric identifiers),
 * and a `+build` suffix that is ignored. No I/O, so behavior-preserving and unit-testable.
 */

interface ParsedVersion {
	core: number[];
	prerelease: Array<number | string> | null;
}

/** True for a `-nightly.` prerelease build. */
export function isNightlyVersion(version: string): boolean {
	return version.includes("-nightly.");
}

/** The npm dist-tag a given current version installs from: `"nightly"` for nightly builds, else `"latest"`. */
export function getNpmTag(currentVersion: string): string {
	return isNightlyVersion(currentVersion) ? "nightly" : "latest";
}

/** Parse a version into its numeric core and optional prerelease identifiers (the `+build` suffix is dropped). */
function parseVersion(version: string): ParsedVersion {
	const versionWithoutBuild = version.split("+", 1)[0] ?? "";
	const [corePart, prereleasePart] = versionWithoutBuild.split("-", 2);
	const core = corePart
		.split(".")
		.filter((part) => part.length > 0)
		.map((part) => Number.parseInt(part, 10));
	const prerelease = prereleasePart
		? prereleasePart
				.split(".")
				.filter((part) => part.length > 0)
				.map((part) => (/^\d+$/u.test(part) ? Number.parseInt(part, 10) : part))
		: null;
	return {
		core,
		prerelease,
	};
}

/**
 * Compare prerelease identifier lists per SemVer: no prerelease outranks a prerelease (so `1.0.0` >
 * `1.0.0-rc`); numeric identifiers compare numerically and rank below alphanumeric ones; a shorter
 * prefix list ranks lower. Returns -1, 0, or 1.
 */
function comparePrereleaseParts(left: Array<number | string> | null, right: Array<number | string> | null): number {
	if (!left && !right) {
		return 0;
	}
	if (!left) {
		return 1;
	}
	if (!right) {
		return -1;
	}

	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		const leftPart = left[index];
		const rightPart = right[index];
		if (leftPart === undefined && rightPart === undefined) {
			return 0;
		}
		if (leftPart === undefined) {
			return -1;
		}
		if (rightPart === undefined) {
			return 1;
		}
		if (leftPart === rightPart) {
			continue;
		}
		if (typeof leftPart === "number" && typeof rightPart === "number") {
			return leftPart > rightPart ? 1 : -1;
		}
		if (typeof leftPart === "number") {
			return -1;
		}
		if (typeof rightPart === "number") {
			return 1;
		}
		return leftPart.localeCompare(rightPart);
	}
	return 0;
}

/** Compare two versions, returning 1 if `leftVersion` is newer, -1 if older, 0 if equal (core then prerelease). */
export function compareVersions(leftVersion: string, rightVersion: string): number {
	const left = parseVersion(leftVersion);
	const right = parseVersion(rightVersion);
	const length = Math.max(left.core.length, right.core.length);
	for (let index = 0; index < length; index += 1) {
		const leftPart = left.core[index] ?? 0;
		const rightPart = right.core[index] ?? 0;
		if (leftPart > rightPart) {
			return 1;
		}
		if (leftPart < rightPart) {
			return -1;
		}
	}
	return comparePrereleaseParts(left.prerelease, right.prerelease);
}
