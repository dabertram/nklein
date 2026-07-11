/**
 * Minimal, dependency-free `.env` loader (the project has no dotenv). Loads KEY=VALUE pairs from a `.env` file into
 * `process.env` at startup so local power-user config (e.g. `NKLEIN_DEVICE_RAM_GB` for the §5.AB machine-aware loader)
 * can be preconfigured in a git-ignored file instead of exported every shell. The REAL environment ALWAYS WINS — a key
 * already present in `process.env` is never overwritten — so `.env` is a default layer, not an override. Best-effort:
 * a missing / unreadable file is a silent no-op. No variable expansion, no multiline values (keep it boring + safe).
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Parse `.env` file content into a KEY→value map. Skips blank lines and `#` comments, tolerates an optional `export `
 * prefix, and strips ONE layer of matching surrounding quotes. First occurrence of a key wins. Pure over the string.
 */
export function parseDotEnv(content: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) {
			continue;
		}
		const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
		const eq = body.indexOf("=");
		if (eq <= 0) {
			continue; // no key, or `=value` with an empty key
		}
		const key = body.slice(0, eq).trim();
		if (key.length === 0 || key in out) {
			continue;
		}
		let value = body.slice(eq + 1).trim();
		const quoted =
			value.length >= 2 &&
			((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'"));
		if (quoted) {
			value = value.slice(1, -1);
		}
		out[key] = value;
	}
	return out;
}

/** The default `.env` search path: the project-root `.env` first, then `~/.nklein/.env` (for the packaged app). */
export function defaultDotEnvPaths(): string[] {
	return [resolve(process.cwd(), ".env"), join(homedir(), ".nklein", ".env")];
}

/**
 * Load the given `.env` files into `process.env`, setting ONLY keys that are not already present (real env wins).
 * Earlier paths win over later ones for a duplicate key. A missing / unreadable file is skipped silently.
 */
export function loadDotEnv(paths: readonly string[] = defaultDotEnvPaths()): void {
	for (const path of paths) {
		let content: string;
		try {
			content = readFileSync(path, "utf8");
		} catch {
			continue; // no file here — silent no-op
		}
		for (const [key, value] of Object.entries(parseDotEnv(content))) {
			if (process.env[key] === undefined) {
				process.env[key] = value;
			}
		}
	}
}
