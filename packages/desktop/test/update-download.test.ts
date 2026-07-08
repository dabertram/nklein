import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	computeSha256Hex,
	downloadDesktopUpdateAsset,
	normalizeSha256,
	sanitizeUpdateAssetFileName,
	type DesktopUpdateDownloadFetch,
} from "../src/update-download.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(path.join(tmpdir(), "nklein-update-download-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function fetchBytes(bytes: Uint8Array, ok = true, status = ok ? 200 : 500): DesktopUpdateDownloadFetch {
	return async () => ({
		ok,
		status,
		async arrayBuffer() {
			const copy = new ArrayBuffer(bytes.byteLength);
			new Uint8Array(copy).set(bytes);
			return copy;
		},
	});
}

describe("desktop update download helpers", () => {
	it("normalizes sha256 strings and rejects malformed digests", () => {
		const digest = "a".repeat(64);
		expect(normalizeSha256(` SHA256:${digest.toUpperCase()} `)).toBe(digest);
		expect(normalizeSha256("abc")).toBeNull();
		expect(normalizeSha256(undefined)).toBeNull();
	});

	it("sanitizes asset filenames to prevent path traversal", () => {
		expect(sanitizeUpdateAssetFileName("../nKlein<>.dmg")).toBe("nKlein__.dmg");
		expect(sanitizeUpdateAssetFileName("")).toBe("nklein-update");
	});
});

describe("downloadDesktopUpdateAsset", () => {
	it("downloads and writes an asset only after its sha256 matches", async () => {
		const bytes = new TextEncoder().encode("signed installer bytes");
		const sha256 = computeSha256Hex(bytes);
		const destinationDirectory = await makeTempDir();

		const result = await downloadDesktopUpdateAsset({
			asset: {
				name: "nKlein-0.2.0-arm64.dmg",
				url: "https://downloads.invalid/nKlein-0.2.0-arm64.dmg",
				sha256,
			},
			destinationDirectory,
			fetch: fetchBytes(bytes),
		});

		expect(result.status).toBe("downloaded");
		if (result.status !== "downloaded") {
			throw new Error("expected downloaded");
		}
		expect(result.byteLength).toBe(bytes.byteLength);
		expect(await readFile(result.filePath, "utf8")).toBe("signed installer bytes");
	});

	it("refuses to download assets without a valid sha256", async () => {
		const result = await downloadDesktopUpdateAsset({
			asset: { name: "nKlein.dmg", url: "https://downloads.invalid/nKlein.dmg" },
			destinationDirectory: await makeTempDir(),
			fetch: fetchBytes(new Uint8Array()),
		});

		expect(result.status).toBe("missing_sha256");
	});

	it("does not write a file when the checksum mismatches", async () => {
		const destinationDirectory = await makeTempDir();
		const result = await downloadDesktopUpdateAsset({
			asset: {
				name: "nKlein-0.2.0-arm64.dmg",
				url: "https://downloads.invalid/nKlein-0.2.0-arm64.dmg",
				sha256: "b".repeat(64),
			},
			destinationDirectory,
			fetch: fetchBytes(new TextEncoder().encode("tampered")),
		});

		expect(result.status).toBe("checksum_mismatch");
		await expect(stat(path.join(destinationDirectory, "nKlein-0.2.0-arm64.dmg"))).rejects.toThrow();
	});

	it("reports failed HTTP downloads without writing", async () => {
		const result = await downloadDesktopUpdateAsset({
			asset: {
				name: "nKlein-0.2.0-arm64.dmg",
				url: "https://downloads.invalid/nKlein-0.2.0-arm64.dmg",
				sha256: "a".repeat(64),
			},
			destinationDirectory: await makeTempDir(),
			fetch: fetchBytes(new Uint8Array(), false, 404),
		});

		expect(result).toEqual({
			status: "download_failed",
			httpStatus: 404,
			message: "Could not download desktop update asset nKlein-0.2.0-arm64.dmg.",
		});
	});
});
