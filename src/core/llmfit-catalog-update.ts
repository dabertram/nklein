import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { type CatalogUpdateAction, type CatalogUpdateMode, decideCatalogUpdate } from "./catalog-update-decision";

/**
 * User-triggered llmfit catalog update check (§5.AB).
 *
 * Upstream moved the Hugging Face catalog from `data/hf_models.json` to
 * `llmfit-core/data/hf_models.json`; use GitHub's Contents API as the default
 * because it exposes the blob SHA, then fetch `download_url` only to count rows.
 * Callers must keep this behind an explicit user action or opt-in schedule.
 */
export const DEFAULT_LLMFIT_CATALOG_METADATA_URL =
	"https://api.github.com/repos/AlexsJones/llmfit/contents/llmfit-core/data/hf_models.json?ref=main";

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export interface RemoteLlmfitCatalogMetadata {
	sourceUrl: string;
	downloadUrl: string;
	revision: string;
	modelCount: number;
	sizeBytes: number | null;
	fetchedAt: number;
}

export interface RemoteLlmfitCatalogSnapshot extends RemoteLlmfitCatalogMetadata {
	models: unknown[];
}

export interface LlmfitCatalogUpdateCheck {
	mode: CatalogUpdateMode;
	action: CatalogUpdateAction["action"];
	reason: string;
	sourceUrl: string;
	downloadUrl: string | null;
	localRevision: string | null;
	remoteRevision: string | null;
	remoteModelCount: number | null;
	remoteSizeBytes: number | null;
	checkedAt: number;
	error?: string;
}

export interface LlmfitCatalogPullResult extends LlmfitCatalogUpdateCheck {
	cachePath: string | null;
	written: boolean;
}

export interface FetchLlmfitCatalogMetadataInput {
	sourceUrl?: string;
	fetchImpl?: typeof fetch;
	now?: () => number;
	timeoutMs?: number;
}

export interface CheckLlmfitCatalogUpdateInput extends FetchLlmfitCatalogMetadataInput {
	mode?: CatalogUpdateMode;
	homePath?: string;
	localCatalogPath?: string;
	localRevision?: string | null;
}

interface FetchTextResult {
	text: string;
	etag: string | null;
	sizeBytes: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function num(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeRevision(value: string | null): string | null {
	const trimmed = value?.trim();
	if (!trimmed) {
		return null;
	}
	const withoutWeakPrefix = trimmed.startsWith("W/") ? trimmed.slice(2).trim() : trimmed;
	const unquoted =
		withoutWeakPrefix.startsWith('"') && withoutWeakPrefix.endsWith('"')
			? withoutWeakPrefix.slice(1, -1)
			: withoutWeakPrefix;
	return unquoted.trim() || null;
}

function contentHash(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function parseJson(text: string, label: string): unknown {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(`${label} is not valid JSON: ${(error as Error).message}`);
	}
}

function modelRowsFromCatalogJson(raw: unknown): unknown[] {
	const record = asRecord(raw);
	if (Array.isArray(raw)) {
		return raw;
	}
	if (Array.isArray(record?.models)) {
		return record.models;
	}
	if (Array.isArray(record?.data)) {
		return record.data;
	}
	if (Array.isArray(record?.rows)) {
		return record.rows;
	}
	throw new Error("llmfit catalog JSON did not contain a model array.");
}

async function fetchText(
	url: string,
	fetchImpl: typeof fetch,
	timeoutMs: number,
	accept: string,
): Promise<FetchTextResult> {
	const response = await fetchImpl(url, {
		headers: { accept, "user-agent": "nklein-llmfit-catalog-check" },
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText || ""}`.trim());
	}
	const text = await response.text();
	return {
		text,
		etag: normalizeRevision(response.headers.get("etag")),
		sizeBytes: Buffer.byteLength(text, "utf8"),
	};
}

function localRevisionFromCache(raw: unknown): string | null {
	const record = asRecord(raw);
	const metadata = asRecord(record?.metadata);
	return (
		normalizeRevision(str(record?.revision)) ??
		normalizeRevision(str(metadata?.revision)) ??
		normalizeRevision(str(record?.sha)) ??
		null
	);
}

export function defaultLlmfitCatalogCachePath(homePath: string): string {
	return join(resolveNkleinRuntimeHomePath(homePath), "llmfit-catalog-cache.json");
}

export async function loadLocalLlmfitCatalogRevision(path: string): Promise<string | null> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}
	return localRevisionFromCache(parseJson(text, `local llmfit catalog cache ${path}`));
}

export async function fetchRemoteLlmfitCatalogMetadata(
	input: FetchLlmfitCatalogMetadataInput = {},
): Promise<RemoteLlmfitCatalogMetadata> {
	const snapshot = await fetchRemoteLlmfitCatalogSnapshot(input);
	const { models: _models, ...metadata } = snapshot;
	return metadata;
}

export async function fetchRemoteLlmfitCatalogSnapshot(
	input: FetchLlmfitCatalogMetadataInput = {},
): Promise<RemoteLlmfitCatalogSnapshot> {
	const sourceUrl = input.sourceUrl?.trim() || DEFAULT_LLMFIT_CATALOG_METADATA_URL;
	const fetchImpl = input.fetchImpl ?? fetch;
	const timeoutMs = input.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
	const fetchedAt = input.now?.() ?? Date.now();
	const metadataResponse = await fetchText(
		sourceUrl,
		fetchImpl,
		timeoutMs,
		"application/vnd.github+json, application/json, text/plain",
	);
	const metadataJson = parseJson(metadataResponse.text, `llmfit catalog metadata ${sourceUrl}`);
	const metadataRecord = asRecord(metadataJson);
	const downloadUrl = str(metadataRecord?.download_url) ?? sourceUrl;
	const githubRevision = normalizeRevision(str(metadataRecord?.sha));
	const declaredSizeBytes = num(metadataRecord?.size);

	if (downloadUrl !== sourceUrl && githubRevision) {
		const catalogResponse = await fetchText(downloadUrl, fetchImpl, timeoutMs, "application/json, text/plain");
		const rows = modelRowsFromCatalogJson(parseJson(catalogResponse.text, `llmfit catalog ${downloadUrl}`));
		return {
			sourceUrl,
			downloadUrl,
			revision: githubRevision,
			models: rows,
			modelCount: rows.length,
			sizeBytes: declaredSizeBytes ?? catalogResponse.sizeBytes,
			fetchedAt,
		};
	}

	const rows = modelRowsFromCatalogJson(metadataJson);
	return {
		sourceUrl,
		downloadUrl,
		revision: githubRevision ?? metadataResponse.etag ?? contentHash(metadataResponse.text),
		models: rows,
		modelCount: rows.length,
		sizeBytes: declaredSizeBytes ?? metadataResponse.sizeBytes,
		fetchedAt,
	};
}

export async function writeLlmfitCatalogCache(
	path: string,
	snapshot: RemoteLlmfitCatalogSnapshot,
): Promise<LlmfitCatalogPullResult> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(
		path,
		`${JSON.stringify(
			{
				version: 1,
				metadata: {
					sourceUrl: snapshot.sourceUrl,
					downloadUrl: snapshot.downloadUrl,
					revision: snapshot.revision,
					fetchedAt: snapshot.fetchedAt,
					modelCount: snapshot.modelCount,
					sizeBytes: snapshot.sizeBytes,
				},
				models: snapshot.models,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	return {
		mode: "notify",
		action: "up_to_date",
		reason: `Local llmfit catalog cache updated to ${snapshot.revision}.`,
		sourceUrl: snapshot.sourceUrl,
		downloadUrl: snapshot.downloadUrl,
		localRevision: snapshot.revision,
		remoteRevision: snapshot.revision,
		remoteModelCount: snapshot.modelCount,
		remoteSizeBytes: snapshot.sizeBytes,
		checkedAt: snapshot.fetchedAt,
		cachePath: path,
		written: true,
	};
}

export async function checkLlmfitCatalogUpdate(
	input: CheckLlmfitCatalogUpdateInput = {},
): Promise<LlmfitCatalogUpdateCheck> {
	const mode = input.mode ?? "notify";
	const sourceUrl = input.sourceUrl?.trim() || DEFAULT_LLMFIT_CATALOG_METADATA_URL;
	const checkedAt = input.now?.() ?? Date.now();
	const localRevision =
		input.localRevision !== undefined
			? input.localRevision
			: input.localCatalogPath || input.homePath
				? await loadLocalLlmfitCatalogRevision(
						input.localCatalogPath ?? defaultLlmfitCatalogCachePath(input.homePath ?? ""),
					).catch(() => null)
				: null;

	if (mode === "off") {
		const decision = decideCatalogUpdate({ mode, localRevision, remoteRevision: null });
		return {
			mode,
			action: decision.action,
			reason: decision.reason,
			sourceUrl,
			downloadUrl: null,
			localRevision,
			remoteRevision: null,
			remoteModelCount: null,
			remoteSizeBytes: null,
			checkedAt,
		};
	}

	try {
		const remote = await fetchRemoteLlmfitCatalogMetadata({
			sourceUrl,
			fetchImpl: input.fetchImpl,
			now: () => checkedAt,
			timeoutMs: input.timeoutMs,
		});
		const decision = decideCatalogUpdate({ mode, localRevision, remoteRevision: remote.revision });
		return {
			mode,
			action: decision.action,
			reason: decision.reason,
			sourceUrl: remote.sourceUrl,
			downloadUrl: remote.downloadUrl,
			localRevision,
			remoteRevision: remote.revision,
			remoteModelCount: remote.modelCount,
			remoteSizeBytes: remote.sizeBytes,
			checkedAt,
		};
	} catch (error) {
		const decision = decideCatalogUpdate({ mode, localRevision, remoteRevision: null });
		return {
			mode,
			action: decision.action,
			reason: decision.reason,
			sourceUrl,
			downloadUrl: null,
			localRevision,
			remoteRevision: null,
			remoteModelCount: null,
			remoteSizeBytes: null,
			checkedAt,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function pullLlmfitCatalogCache(
	input: CheckLlmfitCatalogUpdateInput = {},
): Promise<LlmfitCatalogPullResult> {
	const mode = input.mode ?? "notify";
	const sourceUrl = input.sourceUrl?.trim() || DEFAULT_LLMFIT_CATALOG_METADATA_URL;
	const checkedAt = input.now?.() ?? Date.now();
	const cachePath = input.localCatalogPath ?? (input.homePath ? defaultLlmfitCatalogCachePath(input.homePath) : null);

	if (mode === "off") {
		const decision = decideCatalogUpdate({ mode, localRevision: null, remoteRevision: null });
		return {
			mode,
			action: decision.action,
			reason: decision.reason,
			sourceUrl,
			downloadUrl: null,
			localRevision: null,
			remoteRevision: null,
			remoteModelCount: null,
			remoteSizeBytes: null,
			checkedAt,
			cachePath,
			written: false,
		};
	}
	if (!cachePath) {
		return {
			mode,
			action: "noop",
			reason: "No local llmfit catalog cache path is available.",
			sourceUrl,
			downloadUrl: null,
			localRevision: null,
			remoteRevision: null,
			remoteModelCount: null,
			remoteSizeBytes: null,
			checkedAt,
			cachePath: null,
			written: false,
			error: "No local llmfit catalog cache path is available.",
		};
	}

	try {
		const snapshot = await fetchRemoteLlmfitCatalogSnapshot({
			sourceUrl,
			fetchImpl: input.fetchImpl,
			now: () => checkedAt,
			timeoutMs: input.timeoutMs,
		});
		return { ...(await writeLlmfitCatalogCache(cachePath, snapshot)), mode };
	} catch (error) {
		return {
			mode,
			action: "noop",
			reason: "No remote catalog revision available (fetch skipped or failed).",
			sourceUrl,
			downloadUrl: null,
			localRevision: null,
			remoteRevision: null,
			remoteModelCount: null,
			remoteSizeBytes: null,
			checkedAt,
			cachePath,
			written: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
