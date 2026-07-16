/**
 * Parse `lms ls` (the DOWNLOADED-model catalog) into per-model {device, size} rows — the local half of the fleet
 * catalog the F3.35 capability-ceiling enrichment needs (which machine a not-loaded candidate lives on, and how big it
 * is, to check fit). Distinct from {@link parseLmsPs} (in lms-ps-json.ts), which lists only the RESIDENT models.
 *
 * `lms ls` prints a fixed-column table: NAME [PARAMS] ARCH SIZE DEVICE, columns separated by ≥2 spaces (PARAMS is blank
 * for some models, so column COUNT varies — we key off the tail: DEVICE is last, SIZE second-to-last). A trailing
 * "(N variants)" on the name is stripped. The EMBEDDING section (and everything after it) is skipped — those are infra,
 * not chat candidates. Pure + deterministic over the captured stdout.
 */

/** One downloaded model from the `lms ls` catalog. */
export interface LmsCatalogModel {
	/** The model key/identifier as `lms` prints it (its first column). */
	readonly modelKey: string;
	/** The machine the model lives on. `"Local"` is aliased to `localDeviceName` (default `"local"`). */
	readonly device: string;
	/** On-disk size in GB (MB/TB normalized). */
	readonly sizeGB: number;
}

const SIZE_UNIT_TO_GB: Readonly<Record<string, number>> = { TB: 1024, GB: 1, MB: 1 / 1024, KB: 1 / 1024 / 1024 };

/** Parse a `"96.53 GB"` / `"351.38 MB"` / `"1.39 TB"` size token to GB, or null when unparseable. */
export function parseLmsSizeToGB(token: string): number | null {
	const m = /^([\d.]+)\s*(TB|GB|MB|KB)$/i.exec(token.trim());
	if (!m) {
		return null;
	}
	const value = Number(m[1]);
	const unit = SIZE_UNIT_TO_GB[m[2].toUpperCase()];
	if (!Number.isFinite(value) || unit === undefined) {
		return null;
	}
	return value * unit;
}

/**
 * Parse the `lms ls` stdout into the downloaded-model catalog. Skips the header, the "You have N models" summary line,
 * blank lines, and the entire EMBEDDING section. `localDeviceName` aliases the `"Local"` device label to the real local
 * machine name so it matches the fleet RAM-map keys (the same trap `applyLocalDeviceAlias` guards for routing).
 */
export function parseLmsLsCatalog(stdout: string, options: { localDeviceName?: string } = {}): LmsCatalogModel[] {
	const localName = options.localDeviceName?.trim() || "local";
	const models: LmsCatalogModel[] = [];
	let inEmbeddingSection = false;
	for (const rawLine of stdout.split("\n")) {
		const line = rawLine.replace(/\s+$/, "");
		if (!line.trim()) {
			continue;
		}
		if (/^EMBEDDING\b/.test(line)) {
			inEmbeddingSection = true;
			continue;
		}
		if (inEmbeddingSection) {
			continue;
		}
		if (/^LLM\b/.test(line) || /^You have\b/.test(line)) {
			continue;
		}
		const fields = line.split(/\s{2,}/).filter((f) => f.length > 0);
		if (fields.length < 3) {
			continue; // need at least name, size, device
		}
		const device = fields[fields.length - 1].trim();
		const sizeGB = parseLmsSizeToGB(fields[fields.length - 2]);
		if (sizeGB === null) {
			continue; // not a data row (e.g. a stray header) — the size column must parse
		}
		const modelKey = fields[0].replace(/\s*\(\d+\s+variants?\)\s*$/i, "").trim();
		if (!modelKey) {
			continue;
		}
		models.push({ modelKey, device: /^local$/i.test(device) ? localName : device, sizeGB });
	}
	return models;
}
