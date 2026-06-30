import { resolve } from "node:path";

/**
 * Pure path-segment analysis for auto-update install detection, extracted from update.ts. Given an
 * entrypoint path, these locate the install directory implied by a known segment sequence/pattern
 * (e.g. an npx cache or a `node_modules/<pkg>` layout). No I/O beyond `path.resolve`, so they are
 * behavior-preserving and unit-testable.
 */

/** Normalize Windows separators to POSIX `/` (no case change). */
function toPosixPath(path: string): string {
	return path.replaceAll("\\", "/");
}

/** Normalize Windows separators to POSIX `/` AND lowercase, for case-insensitive path comparison. */
export function toPosixLowerPath(path: string): string {
	return path.replaceAll("\\", "/").toLowerCase();
}

/**
 * Case-insensitive containment: is `targetPath` the same as, or nested under, `containerPath`? Both are resolved
 * first; the trailing-slash check on the prefix avoids the sibling-prefix bug (`/foo` is NOT inside `/foobar`).
 */
export function isPathInside(targetPath: string, containerPath: string): boolean {
	const normalizedTarget = toPosixLowerPath(resolve(targetPath));
	const normalizedContainer = toPosixLowerPath(resolve(containerPath));
	if (normalizedTarget === normalizedContainer) {
		return true;
	}
	return normalizedTarget.startsWith(`${normalizedContainer}/`);
}

/** Resolve a path and split it into segments (and lowercased segments), recording whether it was absolute. */
function splitResolvedPath(path: string): {
	hasLeadingSlash: boolean;
	segments: string[];
	normalizedSegments: string[];
} {
	const resolvedPath = toPosixPath(resolve(path));
	const hasLeadingSlash = resolvedPath.startsWith("/");
	const segments = resolvedPath.split("/").filter((_segment, index) => !(hasLeadingSlash && index === 0));
	return {
		hasLeadingSlash,
		segments,
		normalizedSegments: segments.map((segment) => segment.toLowerCase()),
	};
}

/** Rebuild a directory path from the first `endIndex` segments, re-adding a leading slash if the path was absolute. */
function buildDirectoryFromSegments(segments: string[], hasLeadingSlash: boolean, endIndex: number): string | null {
	if (endIndex <= 0 || segments.length < endIndex) {
		return null;
	}
	const directory = segments.slice(0, endIndex).join("/");
	if (directory.length === 0) {
		return null;
	}
	return hasLeadingSlash ? `/${directory}` : directory;
}

/** Index of the first occurrence of `sequence` as a contiguous run within `segments`, or -1. */
function findSegmentSequence(segments: string[], sequence: string[]): number {
	if (sequence.length === 0 || segments.length < sequence.length) {
		return -1;
	}

	for (let index = 0; index <= segments.length - sequence.length; index += 1) {
		let matches = true;
		for (let offset = 0; offset < sequence.length; offset += 1) {
			if (segments[index + offset] !== sequence[offset]) {
				matches = false;
				break;
			}
		}
		if (matches) {
			return index;
		}
	}

	return -1;
}

/**
 * Find the install directory ending `trailingSegmentCount` segments after the first matching segment
 * sequence (the trailing segments must be present and not `.`/`..`/`node_modules`/empty). Returns the
 * original-cased directory, or null when no sequence matches cleanly.
 */
export function extractDirectoryForSegmentSequence(
	entrypointPath: string,
	sequences: string[][],
	trailingSegmentCount: number,
): string | null {
	const { hasLeadingSlash, segments, normalizedSegments } = splitResolvedPath(entrypointPath);

	for (const sequence of sequences) {
		const sequenceIndex = findSegmentSequence(normalizedSegments, sequence);
		if (sequenceIndex < 0) {
			continue;
		}
		const endIndex = sequenceIndex + sequence.length + trailingSegmentCount;
		const requiredSegments = normalizedSegments.slice(sequenceIndex + sequence.length, endIndex);
		if (
			requiredSegments.length !== trailingSegmentCount ||
			requiredSegments.some(
				(segment) => segment.length === 0 || segment === "." || segment === ".." || segment === "node_modules",
			)
		) {
			continue;
		}
		const directory = buildDirectoryFromSegments(segments, hasLeadingSlash, endIndex);
		if (directory) {
			return directory;
		}
	}

	return null;
}

/** The directory up to and including the first segment matching `pattern`, or null when none matches. */
export function extractDirectoryForSegmentPattern(entrypointPath: string, pattern: RegExp): string | null {
	const { hasLeadingSlash, segments, normalizedSegments } = splitResolvedPath(entrypointPath);
	const matchingIndex = normalizedSegments.findIndex((segment) => pattern.test(segment));
	return buildDirectoryFromSegments(segments, hasLeadingSlash, matchingIndex + 1);
}
