import { isAutoDownloadSafeFormat, type ModelArtifactFormat } from "./model-artifact-format.js";
import { estimateModelResidency, fitModelResidency, type ResidencyFitVerdict } from "./model-residency-sizing.js";

/**
 * P25.3 phase-3 — the SHARED, PURE acquisition PREVIEW builder. Both the `nklein setup acquire` CLI and the
 * setup web view render this one structure so they can never disagree about a model's format safety, size, or
 * fit. It is the read-only half of acquisition (no network, no download client — the fenced capability stays out
 * of this module's imports, so a runtime-reachable server preview procedure does not breach the acquisition
 * boundary). The DOWNLOAD itself is not here; it remains the consent-gated CLI handoff.
 */

const BYTES_PER_GIB = 1024 ** 3;

export interface ModelAcquisitionPreviewInput {
	readonly modelKey: string;
	/** Format AS SHOWN by the catalogue, already parsed; null when undeclared. */
	readonly format: ModelArtifactFormat | null;
	/** Download size in bytes as shown; null when undeclared (recorded, not enforced). */
	readonly sizeBytes: number | null;
	readonly publisher: string | null;
	readonly allowedPublishers: readonly string[];
	/** Parameter count in billions (declared or parsed from the key); null ⇒ no fit verdict. */
	readonly paramB: number | null;
	readonly weightBitsPerParam: number;
	readonly contextTokens: number;
	/** Host memory budget the fit is judged against, and where it came from (for honest display). */
	readonly budgetBytes: number;
	readonly budgetSource: string;
}

export interface ModelAcquisitionPreview {
	readonly modelKey: string;
	readonly format: {
		readonly value: ModelArtifactFormat | null;
		/** true = a weights-only format the download gate accepts; false/undeclared = refused at download time. */
		readonly safe: boolean;
		readonly label: string;
	};
	readonly sizeBytes: number | null;
	readonly sizeLabel: string;
	readonly publisher: string | null;
	readonly publisherLabel: string;
	readonly fit:
		| {
				readonly known: true;
				readonly verdict: ResidencyFitVerdict;
				readonly needBytes: number;
				readonly budgetBytes: number;
				readonly basis: string;
				readonly label: string;
		  }
		| { readonly known: false; readonly label: string };
}

/** Build the structured preview. PURE — no I/O; the caller resolves the host budget and passes it in. */
export function buildModelAcquisitionPreview(input: ModelAcquisitionPreviewInput): ModelAcquisitionPreview {
	const format = input.format;
	const safe = format !== null && isAutoDownloadSafeFormat(format);
	const formatLabel =
		format === null
			? "UNDECLARED — the download is refused fail-closed until the catalogue format is declared"
			: safe
				? `${format} (allow-listed weight format)`
				: `${format} — REFUSED at download time: not a weights-only format`;

	const sizeLabel =
		input.sizeBytes === null
			? "undeclared (recorded, not enforced)"
			: `${(input.sizeBytes / BYTES_PER_GIB).toFixed(1)} GiB as shown`;

	const publisherLabel =
		(input.publisher ?? "undeclared") +
		(input.allowedPublishers.length > 0 ? ` (allow-list: ${input.allowedPublishers.join(", ")})` : "");

	let fit: ModelAcquisitionPreview["fit"];
	if (input.paramB === null || input.paramB <= 0) {
		fit = {
			known: false,
			label: "unknown — the key does not state a parameter count; declare params for a fit verdict",
		};
	} else {
		const estimate = estimateModelResidency({
			paramB: input.paramB,
			weightBitsPerParam: input.weightBitsPerParam,
			contextTokens: input.contextTokens,
		});
		const verdict = fitModelResidency(estimate, input.budgetBytes);
		fit = {
			known: true,
			verdict: verdict.verdict,
			needBytes: estimate.totalBytes,
			budgetBytes: input.budgetBytes,
			basis: estimate.basis,
			label: `${verdict.verdict} — needs ~${(estimate.totalBytes / BYTES_PER_GIB).toFixed(1)} GiB (weights+KV+overhead, ${estimate.basis}) against ${(input.budgetBytes / BYTES_PER_GIB).toFixed(0)} GiB (${input.budgetSource})`,
		};
	}

	return {
		modelKey: input.modelKey,
		format: { value: format, safe, label: formatLabel },
		sizeBytes: input.sizeBytes,
		sizeLabel,
		publisher: input.publisher,
		publisherLabel,
		fit,
	};
}
