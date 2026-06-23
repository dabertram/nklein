function normalizeDisplayPath(path: string): string {
	return path.replaceAll("\\", "/");
}

function detectHomePrefix(path: string): string | null {
	const normalized = normalizeDisplayPath(path);
	const unixMatch = normalized.match(/^\/(?:Users|home)\/[^/]+/);
	if (unixMatch?.[0]) {
		return unixMatch[0];
	}
	const windowsMatch = normalized.match(/^[A-Za-z]:\/Users\/[^/]+/);
	if (windowsMatch?.[0]) {
		return windowsMatch[0];
	}
	return null;
}

// OS temp-dir prefixes: macOS per-user `/private/var/folders/<x>/<y>/T/` (and its `/var/folders/...` form) and
// `/tmp/`. Dev-test projects and sandbox mounts live here, and the prefix is pure noise the user dislikes seeing —
// collapse it to a short `$TMPDIR/` marker so the readable tail (the project folder) is what shows.
const TEMP_DIR_PREFIXES = [
	/^\/private\/var\/folders\/[^/]+\/[^/]+\/T\//,
	/^\/var\/folders\/[^/]+\/[^/]+\/T\//,
	/^\/tmp\//,
];

function collapseTempPrefix(path: string): string | null {
	for (const prefix of TEMP_DIR_PREFIXES) {
		if (prefix.test(path)) {
			return path.replace(prefix, "$TMPDIR/");
		}
	}
	return null;
}

export function formatPathForDisplay(path: string): string {
	const normalized = normalizeDisplayPath(path);
	const homePrefix = detectHomePrefix(normalized);
	if (homePrefix) {
		if (normalized === homePrefix) {
			return "~";
		}
		if (normalized.startsWith(`${homePrefix}/`)) {
			return `~/${normalized.slice(homePrefix.length + 1)}`;
		}
		return normalized;
	}
	return collapseTempPrefix(normalized) ?? normalized;
}
