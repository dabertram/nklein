import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DesktopReleaseAsset } from "./update-plan.js";

interface DownloadResponseLike {
	ok: boolean;
	status: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}

export type DesktopUpdateDownloadFetch = (
	url: string,
	init?: { signal?: AbortSignal },
) => Promise<DownloadResponseLike>;

export type DesktopUpdateDownloadResult =
	| { status: "downloaded"; filePath: string; sha256: string; byteLength: number }
	| { status: "missing_sha256"; message: string }
	| { status: "invalid_sha256"; sha256: string; message: string }
	| { status: "download_failed"; httpStatus: number | null; message: string }
	| { status: "checksum_mismatch"; expectedSha256: string; actualSha256: string }
	| { status: "write_failed"; message: string };

export interface DownloadDesktopUpdateAssetOptions {
	asset: DesktopReleaseAsset;
	destinationDirectory: string;
	fetch: DesktopUpdateDownloadFetch;
	signal?: AbortSignal;
}

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

export function normalizeSha256(value: string | undefined): string | null {
	const normalized = value?.trim().toLowerCase().replace(/^sha256:/u, "").trim();
	if (!normalized) {
		return null;
	}
	return SHA256_HEX_PATTERN.test(normalized) ? normalized : null;
}

export function computeSha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export function sanitizeUpdateAssetFileName(name: string): string {
	const baseName = path.basename(name.trim()).replace(/[^a-zA-Z0-9._ -]/gu, "_");
	return baseName || "nklein-update";
}

export async function downloadDesktopUpdateAsset(
	options: DownloadDesktopUpdateAssetOptions,
): Promise<DesktopUpdateDownloadResult> {
	if (!options.asset.sha256?.trim()) {
		return {
			status: "missing_sha256",
			message: "Desktop update asset is missing a sha256 checksum.",
		};
	}
	const expectedSha256 = normalizeSha256(options.asset.sha256);
	if (!expectedSha256) {
		return {
			status: "invalid_sha256",
			sha256: options.asset.sha256,
			message: "Desktop update asset checksum is not a valid SHA-256 hex digest.",
		};
	}

	const response = await options.fetch(options.asset.url, { signal: options.signal }).catch(() => null);
	if (!response?.ok) {
		return {
			status: "download_failed",
			httpStatus: response?.status ?? null,
			message: `Could not download desktop update asset ${options.asset.name}.`,
		};
	}

	const bytes = new Uint8Array(await response.arrayBuffer());
	const actualSha256 = computeSha256Hex(bytes);
	if (actualSha256 !== expectedSha256) {
		return {
			status: "checksum_mismatch",
			expectedSha256,
			actualSha256,
		};
	}

	const filePath = path.join(options.destinationDirectory, sanitizeUpdateAssetFileName(options.asset.name));
	try {
		await mkdir(options.destinationDirectory, { recursive: true });
		await writeFile(filePath, bytes);
	} catch (error) {
		return {
			status: "write_failed",
			message: error instanceof Error ? error.message : String(error),
		};
	}

	return {
		status: "downloaded",
		filePath,
		sha256: actualSha256,
		byteLength: bytes.byteLength,
	};
}
