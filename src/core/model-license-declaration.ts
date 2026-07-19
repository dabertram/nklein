/**
 * F12.100 (data half) — the OPERATOR-DECLARED model license map. PURE core.
 *
 * The local gateway publishes no license field, so every model in the AI-BOM currently reads `unknown`. The
 * temptation is to ship a hardcoded table of "well-known" model licenses. **That would be fabricated compliance
 * data, which is worse than an honest "unverified"**: licenses change between releases, quantized re-uploads
 * frequently carry different terms than the upstream weights, and a table that is right 90% of the time produces
 * a BOM that is confidently wrong 10% of the time — with no way for a reader to tell which rows are which.
 *
 * So the mechanism is: the OPERATOR declares licenses, and the BOM records that they were operator-declared.
 *
 * ── PROVENANCE IS A SEPARATE AXIS FROM THE LICENSE ITSELF ──
 * This deliberately mirrors the evidence/authority separation the Dschinn spec was corrected to use (P23.2): an
 * operator declaring "this model is apache-2.0" is an ACT OF AUTHORITY, not an act of verification. It records
 * who takes responsibility for the claim; it does not make the claim true. So a declared license never reads as
 * `verified`, and the BOM shows the provenance next to every row:
 *
 *  - `gateway`      — the serving runtime published it (today: never; no gateway exposes this).
 *  - `operator`     — a human declared it in config. Trusted as a statement of responsibility, NOT as proof.
 *  - `unknown`      — nobody said. Warns, and must never read as "fine".
 *
 * The gate's existing honesty stance is preserved end to end: UNKNOWN never passes silently.
 */

import type { ModelLicenseFacts } from "./model-license-gate";

export type LicenseProvenance = "gateway" | "operator" | "unknown";

export interface DeclaredLicense {
	readonly license: string;
	readonly provenance: LicenseProvenance;
	/** Optional free-text note from the operator (e.g. "confirmed against the model card 2026-07-20"). */
	readonly note?: string | null;
}

export interface ModelLicenseFactsWithProvenance extends ModelLicenseFacts {
	readonly provenance: LicenseProvenance;
	readonly note?: string | null;
}

/**
 * Parse an operator license declaration string.
 *
 * Format: `modelKeyOrPrefix=license[;note]`, comma-separated. A trailing `*` makes the key a PREFIX match, which
 * is what makes this usable at all — a fleet carries many quantized variants of one model
 * (`qwen3-14b-q4_k_m`, `qwen3-14b-mlx@8bit`, …) and declaring each individually invites drift.
 *
 * Total and forgiving: a malformed entry is SKIPPED rather than throwing, because a typo in a config string must
 * not take down a runtime — but a skipped entry simply leaves that model `unknown`, which warns. Silence is never
 * upgraded to permission.
 *
 * @example parseLicenseDeclarations("qwen3-*=apache-2.0, llama-3.1-*=llama3.1;700M MAU ceiling applies")
 */
export function parseLicenseDeclarations(raw: string | null | undefined): Map<string, DeclaredLicense> {
	const map = new Map<string, DeclaredLicense>();
	if (typeof raw !== "string" || raw.trim().length === 0) {
		return map;
	}
	for (const entry of raw.split(",")) {
		const trimmed = entry.trim();
		if (trimmed.length === 0) {
			continue;
		}
		const equals = trimmed.indexOf("=");
		if (equals <= 0) {
			continue;
		}
		const key = trimmed.slice(0, equals).trim().toLowerCase();
		const rest = trimmed.slice(equals + 1).trim();
		if (key.length === 0 || rest.length === 0) {
			continue;
		}
		const semi = rest.indexOf(";");
		const license = (semi >= 0 ? rest.slice(0, semi) : rest).trim();
		const note = semi >= 0 ? rest.slice(semi + 1).trim() : "";
		if (license.length === 0) {
			continue;
		}
		map.set(key, { license, provenance: "operator", ...(note.length > 0 ? { note } : {}) });
	}
	return map;
}

/** Resolve one model against the declaration map. Exact match wins over prefix; longest prefix wins over shorter. */
export function resolveDeclaredLicense(
	modelKey: string,
	declarations: ReadonlyMap<string, DeclaredLicense>,
): DeclaredLicense | null {
	const key = modelKey.trim().toLowerCase();
	const exact = declarations.get(key);
	if (exact) {
		return exact;
	}
	let best: { pattern: string; value: DeclaredLicense } | null = null;
	for (const [pattern, value] of declarations) {
		if (!pattern.endsWith("*")) {
			continue;
		}
		const prefix = pattern.slice(0, -1);
		if (prefix.length > 0 && key.startsWith(prefix) && (best === null || prefix.length > best.pattern.length - 1)) {
			best = { pattern, value };
		}
	}
	return best?.value ?? null;
}

/**
 * Attach licenses + provenance to the fleet's models. A model with no declaration keeps `license: null` and
 * `provenance: "unknown"` — the AI-BOM already renders that as `unknown` and warns, which is the correct and
 * deliberate outcome. **This function never guesses a license from a model name.**
 */
export function applyLicenseDeclarations(
	models: readonly { modelKey: string; version?: string | null; hash?: string | null }[],
	declarations: ReadonlyMap<string, DeclaredLicense>,
): ModelLicenseFactsWithProvenance[] {
	return models.map((model) => {
		const declared = resolveDeclaredLicense(model.modelKey, declarations);
		return {
			modelKey: model.modelKey,
			license: declared?.license ?? null,
			...(model.version !== undefined ? { version: model.version } : {}),
			...(model.hash !== undefined ? { hash: model.hash } : {}),
			provenance: declared ? declared.provenance : "unknown",
			...(declared?.note ? { note: declared.note } : {}),
		};
	});
}

/**
 * Render the provenance disclaimer that MUST accompany any BOM containing operator-declared rows. Without it a
 * reader cannot distinguish "someone checked this" from "the runtime verified this" — and the whole point of
 * separating the axes is that nobody should have to guess which they are looking at.
 */
export function renderProvenanceNote(models: readonly ModelLicenseFactsWithProvenance[]): string {
	const operator = models.filter((model) => model.provenance === "operator").length;
	const unknown = models.filter((model) => model.provenance === "unknown").length;
	const parts: string[] = [];
	if (operator > 0) {
		parts.push(
			`${operator} license(s) are OPERATOR-DECLARED: a human recorded them in configuration. That is a statement of responsibility, NOT a verification — !Klein did not check them against any model card or registry.`,
		);
	}
	if (unknown > 0) {
		parts.push(
			`${unknown} model(s) have NO declared license and are reported as unknown. Unknown is not permission: treat these as unresolved until someone declares them.`,
		);
	}
	if (parts.length === 0) {
		parts.push("No models to report.");
	}
	return parts.join(" ");
}
