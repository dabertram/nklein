import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RgbaImage } from "../core/visual-verification-gate";

/**
 * Golden-baseline store for the F12.87 visual-verification gate. Persists raw RGBA screenshots (the comparator's
 * native format — no PNG codec dependency) plus a small JSON sidecar with the dimensions, keyed by a caller-chosen
 * baseline key (workspace + route, slug-safe). First render of a route stores the golden; later renders read it for
 * `comparePixels`. Best-effort I/O in the caller's hands: read returns null when absent/corrupt (⇒ the gate's
 * `baseline_created` path), write creates directories as needed.
 */

export interface VisualBaselineStoreOptions {
	/** Override the store root (tests). Defaults to `~/.nklein/nklein/visual-baselines`. */
	readonly rootDir?: string;
}

function resolveRoot(options: VisualBaselineStoreOptions): string {
	return options.rootDir ?? join(homedir(), ".nklein", "nklein", "visual-baselines");
}

/** Slug a baseline key onto the filesystem (route paths carry slashes/params). */
function slugKey(key: string): string {
	return key.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

export async function readVisualBaseline(
	key: string,
	options: VisualBaselineStoreOptions = {},
): Promise<RgbaImage | null> {
	const base = join(resolveRoot(options), slugKey(key));
	try {
		const [meta, data] = await Promise.all([readFile(`${base}.json`, "utf8"), readFile(`${base}.rgba`)]);
		const parsed = JSON.parse(meta) as { width?: number; height?: number };
		const width = parsed.width ?? 0;
		const height = parsed.height ?? 0;
		if (width <= 0 || height <= 0 || data.length !== width * height * 4) {
			return null; // corrupt/mismatched baseline — treat as absent so the gate re-creates it
		}
		return { width, height, data: new Uint8Array(data) };
	} catch {
		return null;
	}
}

export async function writeVisualBaseline(
	key: string,
	image: RgbaImage,
	options: VisualBaselineStoreOptions = {},
): Promise<void> {
	const root = resolveRoot(options);
	await mkdir(root, { recursive: true });
	const base = join(root, slugKey(key));
	await writeFile(`${base}.json`, JSON.stringify({ width: image.width, height: image.height, updatedAt: Date.now() }));
	await writeFile(`${base}.rgba`, Buffer.from(image.data));
}
