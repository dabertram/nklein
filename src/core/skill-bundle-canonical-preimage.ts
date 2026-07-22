/**
 * Canonical byte pre-image for community-skill TOFU pins.
 *
 * Every file path, permission mode, and exact byte contributes. Fields are length-prefixed, files are sorted by
 * code-point path order, and a domain/version header prevents this digest from being confused with another format.
 * The function is pure and intentionally returns bytes; the effectful import service owns SHA-256.
 */

export interface CanonicalSkillBundleFile {
	readonly path: string;
	readonly mode: number;
	readonly content: Uint8Array;
}

const DOMAIN = new TextEncoder().encode("nklein.community-skill.bundle\0v1\0");

function uint32(value: number): Uint8Array {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value, false);
	return bytes;
}

function uint64(value: number): Uint8Array {
	const bytes = new Uint8Array(8);
	new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
	return bytes;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
	const size = parts.reduce((total, part) => total + part.byteLength, 0);
	const result = new Uint8Array(size);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.byteLength;
	}
	return result;
}

function assertCanonicalPath(path: string): void {
	if (
		path.length === 0 ||
		path.startsWith("/") ||
		path.includes("\\") ||
		path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
	) {
		throw new Error(`Non-canonical skill bundle path: ${JSON.stringify(path)}`);
	}
}

export function buildCanonicalSkillBundlePreimage(files: readonly CanonicalSkillBundleFile[]): Uint8Array {
	const ordered = [...files].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
	const seen = new Set<string>();
	const parts: Uint8Array[] = [DOMAIN, uint32(ordered.length)];
	const encoder = new TextEncoder();
	for (const file of ordered) {
		assertCanonicalPath(file.path);
		if (seen.has(file.path)) {
			throw new Error(`Duplicate skill bundle path: ${JSON.stringify(file.path)}`);
		}
		seen.add(file.path);
		if (!Number.isSafeInteger(file.mode) || file.mode < 0) {
			throw new Error(`Invalid skill bundle mode for ${JSON.stringify(file.path)}`);
		}
		const pathBytes = encoder.encode(file.path);
		parts.push(uint32(pathBytes.byteLength), pathBytes, uint32(file.mode & 0o7777), uint64(file.content.byteLength));
		parts.push(file.content);
	}
	return concatenate(parts);
}
