/**
 * P25.3 phase 3 — MODEL ACQUISITION, quarantined from the autonomous runtime.
 *
 * ── DAVID'S DECISION (2026-07-31) THIS IMPLEMENTS ──
 * *"Downloading new models shall never be part of standard !Klein workflows, except for initial or re-triggered
 * setup"*, with the user explicitly acknowledging each model. So acquisition is a SETUP-TIME activity, and the
 * backlog's instruction was unambiguous about how to build it: **the structural boundary FIRST** — the download
 * capability must live where the autonomous runtime cannot call it, *"so 'an autonomous session downloaded a
 * model' is unreachable rather than merely unusual"*.
 *
 * ── WHAT WAS ACTUALLY WRONG BEFORE ──
 * `downloadModel` was a method on `LmStudioRestModelClient` — the same object `start-task-session.ts` constructs
 * during a normal task run. Nothing called it, so nothing was broken; but "no caller today" is a fact about the
 * present, not a property of the design, and it is exactly the kind of fact a later refactor changes without
 * noticing. Moving the capability into its own module makes the absence checkable:
 * `test/runtime/model-acquisition-boundary.test.ts` walks the runtime's import closure and proves this file is
 * not in it.
 *
 * ── WHY CONSENT IS BOUND TO THE CLIENT, NOT PASSED TO THE CALL ──
 * One client instance carries one approved model. A consent *argument* on `downloadModel` would be a value the
 * caller supplies alongside the model key — so the same code that chooses the model also asserts the approval,
 * and the two can drift silently. Binding it at construction means the approval and the request are produced at
 * different moments by different code, and a mismatch is detectable. That is the same reasoning that put
 * P21.13b's secrets behind references rather than behind a redaction filter: make the bad state unrepresentable
 * where you can, and detectable where you cannot.
 *
 * **This module is NOT a security boundary against a hostile caller** — anything that can import it can construct
 * its own consent. It is a boundary against *drift*: an accidental call from the autonomous runtime, or a download
 * of something other than what the operator was shown. Those are the failure modes that actually occur here.
 */

import {
	createLmStudioRestPoster,
	type LmStudioRestFetch,
	type LmStudioRestResult,
} from "./lmstudio-rest-model-client";

/**
 * P25.2b — the artefact-format hard rule. Pickle-based weights (.bin/.pt/.pth/.ckpt/.pkl) execute arbitrary
 * code on load; real malicious models recur on Hugging Face, and the main open-source scanner carried three
 * CVSS-9.3 bypass CVEs (CVE-2025-10155/6/7) — so "we scan them" is not an answer, and CONSENT DOES NOT MAKE A
 * PICKLE FILE SAFE. safetensors (and the formats built on it: MLX) and GGUF execute no logic on load.
 * Auto-download is therefore restricted to safe-by-design formats; anything pickle-class or UNDECLARED is
 * refused regardless of consent — removing the arbitrary-code-execution class instead of trying to detect it.
 */
export type ModelArtifactFormat = "safetensors" | "gguf" | "mlx" | "pickle" | "unknown";

/** The formats whose LOAD executes no logic — the only ones auto-download may fetch. */
export function isAutoDownloadSafeFormat(format: ModelArtifactFormat): boolean {
	return format === "safetensors" || format === "gguf" || format === "mlx";
}

/** What the operator was shown and approved, for exactly one model. */
export interface ModelAcquisitionConsent {
	/** The model key the operator approved. A request for any other key is refused. */
	readonly modelKey: string;
	/**
	 * The size the operator was shown, if known.
	 *
	 * Recorded rather than enforced: LM Studio reports the catalogue size, and refusing a download because the
	 * real artefact is a few MB off the listed figure would fail the operator's genuine intent over a rounding
	 * difference. It exists so a wildly different size is visible in the record afterwards.
	 */
	readonly approvedBytes: number | null;
	/**
	 * The artefact format the operator was SHOWN (from the catalogue entry) — enforced, unlike the size,
	 * because the format rule is a hard gate: the download key alone does not reveal the format, so the
	 * declaration must travel with the consent, and an undeclared format is refused fail-closed.
	 */
	readonly artifactFormat: ModelArtifactFormat;
}

export interface LmStudioModelAcquisitionClient {
	/**
	 * Download the ONE model this client was constructed to acquire.
	 *
	 * Long-running for real models — tens of gigabytes — so callers must treat it as such. Never throws; a refusal
	 * and a network failure are both ordinary results.
	 */
	downloadModel(input: { model: string }): Promise<LmStudioRestResult<{ model: string }>>;
	/** The consent this client is bound to, so a caller can render what it is about to do. */
	readonly consent: ModelAcquisitionConsent;
}

export const CONSENT_MISMATCH = "consent_mismatch";
export const UNSAFE_FORMAT_REFUSED = "unsafe_format_refused";

export function createLmStudioModelAcquisitionClient(options: {
	baseUrl: string;
	consent: ModelAcquisitionConsent;
	fetch?: LmStudioRestFetch;
}): LmStudioModelAcquisitionClient {
	const origin = options.baseUrl.replace(/\/+$/u, "").replace(/\/v1$/u, "");
	const post = createLmStudioRestPoster({
		origin,
		doFetch: options.fetch ?? (fetch as unknown as LmStudioRestFetch),
	});
	const consent = options.consent;
	return {
		consent,
		async downloadModel(input) {
			if (input.model !== consent.modelKey) {
				return {
					ok: false,
					error: {
						type: CONSENT_MISMATCH,
						message: `Refusing to download ${input.model}: this client was authorised for ${consent.modelKey}. Acquisition is per-model and setup-time; construct a new client after the operator approves this one.`,
					},
				};
			}
			// P25.2b hard rule: the format gate binds AFTER identity but BEFORE any network call, and consent
			// cannot override it — a pickle file executes arbitrary code on load no matter who approved it.
			if (!isAutoDownloadSafeFormat(consent.artifactFormat)) {
				return {
					ok: false,
					error: {
						type: UNSAFE_FORMAT_REFUSED,
						message: `Refusing to download ${input.model}: artefact format "${consent.artifactFormat}" is not safe-by-design (safetensors/GGUF/MLX only). Pickle-class weights execute arbitrary code on load — consent does not make them safe. Obtain and load such weights manually if you accept that risk.`,
					},
				};
			}
			return post("/api/v1/models/download", { model: input.model }, () => ({ model: input.model }));
		},
	};
}
