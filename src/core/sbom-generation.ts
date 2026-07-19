/**
 * F12.102 (SBOM half) — build a Software Bill of Materials for the app itself, PURE core.
 *
 * The supply chain INTO !Klein is part of its trust boundary: the same argument that makes S7 pin skills and
 * F12.100 inventory model licenses applies to the code we ship. This turns an npm lockfile into a component
 * inventory (name, version, integrity digest, license) plus a CycloneDX-shaped document a user can verify before
 * install.
 *
 * Honesty stance, matching F12.100: a component with no published license reads `unknown` and is COUNTED as
 * unknown in the summary — never silently folded into "permissive" — and dev-only dependencies are marked so a
 * reader can tell what actually ships from what merely builds it.
 */

export interface SbomComponent {
	readonly name: string;
	readonly version: string;
	/** Subresource-integrity digest from the lockfile (`sha512-…`), or null when absent (e.g. workspace links). */
	readonly integrity: string | null;
	/** Published license id, or null ⇒ reported as `unknown`. */
	readonly license: string | null;
	/** True when the package is a devDependency — it builds the app but does not ship inside it. */
	readonly dev: boolean;
}

export interface Sbom {
	readonly components: readonly SbomComponent[];
	readonly runtimeCount: number;
	readonly devCount: number;
	/** Components whose license the lockfile does not publish — the honest gap counter. */
	readonly unknownLicenseCount: number;
	/** Components with no integrity digest — cannot be verified byte-for-byte. */
	readonly unverifiableCount: number;
}

interface LockfilePackageEntry {
	readonly version?: unknown;
	readonly license?: unknown;
	readonly integrity?: unknown;
	readonly dev?: unknown;
	readonly link?: unknown;
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Build the SBOM from a parsed npm lockfile (v2/v3 `packages` map). The root entry ("") is skipped — it is the
 * app, not a component of itself. Unparseable input yields an empty SBOM rather than a partial guess.
 */
export function buildSbomFromLockfile(lockfile: unknown): Sbom {
	const packages =
		lockfile && typeof lockfile === "object" && "packages" in lockfile
			? ((lockfile as { packages?: unknown }).packages as Record<string, LockfilePackageEntry> | undefined)
			: undefined;
	if (!packages || typeof packages !== "object") {
		return { components: [], runtimeCount: 0, devCount: 0, unknownLicenseCount: 0, unverifiableCount: 0 };
	}
	const components: SbomComponent[] = [];
	for (const [path, entry] of Object.entries(packages)) {
		// "" is the root project; workspace links are not third-party components.
		if (path === "" || entry?.link === true) {
			continue;
		}
		const marker = "node_modules/";
		const index = path.lastIndexOf(marker);
		const name = index === -1 ? path : path.slice(index + marker.length);
		const version = asString(entry?.version);
		if (!name || !version) {
			continue;
		}
		components.push({
			name,
			version,
			integrity: asString(entry?.integrity),
			license: asString(entry?.license),
			dev: entry?.dev === true,
		});
	}
	components.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
	return {
		components,
		runtimeCount: components.filter((component) => !component.dev).length,
		devCount: components.filter((component) => component.dev).length,
		unknownLicenseCount: components.filter((component) => component.license === null).length,
		unverifiableCount: components.filter((component) => component.integrity === null).length,
	};
}

/** CycloneDX-shaped document (the widely-consumed interchange form). */
export function renderCycloneDxJson(sbom: Sbom, appName: string, appVersion: string): string {
	return `${JSON.stringify(
		{
			bomFormat: "CycloneDX",
			specVersion: "1.5",
			version: 1,
			metadata: { component: { type: "application", name: appName, version: appVersion } },
			components: sbom.components.map((component) => ({
				type: "library",
				name: component.name,
				version: component.version,
				scope: component.dev ? "excluded" : "required",
				...(component.license ? { licenses: [{ license: { id: component.license } }] } : {}),
				...(component.integrity ? { hashes: [{ alg: "SHA-512", content: component.integrity }] } : {}),
			})),
		},
		null,
		2,
	)}\n`;
}

/** Operator-facing summary that states the gaps instead of burying them. */
export function renderSbomSummary(sbom: Sbom): string {
	return [
		`SBOM: ${sbom.components.length} component(s) — ${sbom.runtimeCount} runtime, ${sbom.devCount} dev-only.`,
		`Licenses: ${sbom.components.length - sbom.unknownLicenseCount} published, ${sbom.unknownLicenseCount} UNKNOWN.`,
		`Integrity: ${sbom.components.length - sbom.unverifiableCount} with a digest, ${sbom.unverifiableCount} WITHOUT (not byte-verifiable).`,
		"Unknown ≠ permissive, and a missing digest is a real verification gap — both are reported, never assumed away.",
	].join("\n");
}
