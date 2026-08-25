import {
	createLmStudioModelAcquisitionClient,
	type LmStudioModelAcquisitionClient,
	type ModelAcquisitionConsent,
	type ModelArtifactFormat,
} from "../core/lmstudio-model-acquisition";
import { buildModelAcquisitionPreview } from "../core/model-acquisition-preview";
import { parseModelAttributes } from "../core/model-attributes";
import { resolveBudget } from "./dev-model-fit-command";

/**
 * P25.3 phase 3 — SETUP-MODE model acquisition with per-model consent (P25.2a).
 *
 * This command is the ONLY product surface that downloads a model, and it lives in the CLI's setup entry
 * point — outside the autonomous runtime's import closure (pinned by `model-acquisition-boundary.test.ts`),
 * so "an autonomous session downloaded a model" stays unreachable rather than merely unusual.
 *
 * TWO-STEP BY DESIGN: without `--approve` the command previews the pick — key, declared format (safety
 * verdict), declared size and publisher, and the phase-1 FIT verdict against this host's budget — and prints
 * the exact re-run command. Only the explicit re-run with `--approve` touches the network. The consent fields
 * are what the OPERATOR WAS SHOWN (LM Studio catalogue / model card / frontier radar recommendation) —
 * declared here, recorded and enforced by the fenced acquisition client (format hard-gated, publisher
 * allow-listed when given, size recorded).
 */

export interface SetupAcquireOptions {
	format?: string;
	sizeGb?: string;
	publisher?: string;
	allowPublisher?: string[];
	params?: string;
	quant?: string;
	context?: string;
	budgetGb?: string;
	baseUrl?: string;
	approve?: boolean;
	json?: boolean;
}

const BYTES_PER_GIB = 1024 ** 3;
const MODEL_FORMATS: readonly ModelArtifactFormat[] = ["safetensors", "gguf", "mlx", "pickle", "unknown"];

function parseFormat(value: string | undefined): ModelArtifactFormat | null {
	if (!value) return null;
	const normalized = value.trim().toLowerCase();
	return (MODEL_FORMATS as readonly string[]).includes(normalized) ? (normalized as ModelArtifactFormat) : null;
}

/** Build the shared structured preview from CLI options (the web view builds the SAME structure server-side). */
function buildPreviewFromOptions(modelKey: string, format: ModelArtifactFormat | null, options: SetupAcquireOptions) {
	const declaredParams = Number(options.params);
	const paramB =
		Number.isFinite(declaredParams) && declaredParams > 0
			? declaredParams
			: (parseModelAttributes(modelKey).paramB ?? null);
	const quant = Number(options.quant);
	const context = Number(options.context);
	const sizeGb = Number(options.sizeGb);
	const budget = resolveBudget(options);
	return buildModelAcquisitionPreview({
		modelKey,
		format,
		sizeBytes: Number.isFinite(sizeGb) && sizeGb > 0 ? Math.round(sizeGb * BYTES_PER_GIB) : null,
		publisher: options.publisher?.trim() || null,
		allowedPublishers: (options.allowPublisher ?? []).map((entry) => entry.trim()).filter(Boolean),
		paramB,
		weightBitsPerParam: Number.isFinite(quant) && quant > 0 ? quant : 4,
		contextTokens: Number.isFinite(context) && context > 0 ? context : 32_768,
		budgetBytes: budget.bytes,
		budgetSource: budget.source,
	});
}

export async function runSetupAcquireCommand(
	modelKey: string,
	options: SetupAcquireOptions,
	deps: {
		write?: (text: string) => void;
		createClient?: (input: {
			baseUrl: string;
			consent: ModelAcquisitionConsent;
			allowedPublishers?: readonly string[];
		}) => LmStudioModelAcquisitionClient;
	} = {},
): Promise<number> {
	const write = deps.write ?? console.log;
	const format = parseFormat(options.format);
	if (options.format && format === null) {
		write(`Unknown --format "${options.format}". Declare what the catalogue shows: ${MODEL_FORMATS.join(", ")}.`);
		return 64;
	}
	const sizeGb = Number(options.sizeGb);
	const approvedBytes = Number.isFinite(sizeGb) && sizeGb > 0 ? Math.round(sizeGb * BYTES_PER_GIB) : null;
	const publisher = options.publisher?.trim() || undefined;
	const allowedPublishers = (options.allowPublisher ?? []).map((entry) => entry.trim()).filter(Boolean);
	const structuredPreview = buildPreviewFromOptions(modelKey, format, options);
	const preview = [
		`Model acquisition (setup-mode, per-model consent — P25.2a):`,
		`  model:     ${structuredPreview.modelKey}`,
		`  format:    ${structuredPreview.format.label}`,
		`  size:      ${structuredPreview.sizeLabel}`,
		`  publisher: ${structuredPreview.publisherLabel}`,
		`  fit: ${structuredPreview.fit.label}`,
	].join("\n");
	write(preview);

	if (!options.approve) {
		const approveArgs = [
			`nklein setup acquire ${modelKey}`,
			format ? `--format ${format}` : "--format <safetensors|gguf|mlx>",
			approvedBytes !== null ? `--size-gb ${sizeGb}` : "",
			publisher ? `--publisher "${publisher}"` : "",
			"--approve",
		]
			.filter(Boolean)
			.join(" ");
		write(`\nNo download performed. To download exactly this model, re-run:\n  ${approveArgs}`);
		return 0;
	}

	if (format === null) {
		write(`\nRefusing to download: --format is required with --approve (the format rule is a hard gate).`);
		return 65;
	}
	const consent: ModelAcquisitionConsent = {
		modelKey,
		approvedBytes,
		artifactFormat: format,
		...(publisher ? { publisher } : {}),
	};
	const client = (deps.createClient ?? createLmStudioModelAcquisitionClient)({
		baseUrl: options.baseUrl ?? process.env.NKLEIN_LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234",
		consent,
		...(allowedPublishers.length > 0 ? { allowedPublishers } : {}),
	});
	write(`\nDownloading ${modelKey} (this can take a long time for large models)…`);
	const result = await client.downloadModel({ model: modelKey });
	if (result.ok) {
		write(`✓ downloaded ${modelKey}. Refresh the roster (lms ls / the models view) to see it.`);
		return 0;
	}
	write(`✗ refused/failed: [${result.error.type}] ${result.error.message}`);
	return 1;
}
