/**
 * `lookup` receipt + content store — the durable side of the fact-check audit trail.
 *
 * Layout under the runtime's diagnostic root (`~/.nklein` in production; a temp dir in tests):
 *   lookup/receipts/<workspace-hash>.jsonl   one receipt per line (append-only; `lookup-receipt.ts` owns the shape)
 *   lookup/cache/<cacheKey>.json             `{ url, finalUrl, contentType, status, sha256, at }`
 *   lookup/cache/<cacheKey>.body             the exact bytes that came back
 *
 * A cache hit serves the stored body (nothing leaves the machine) and still appends a receipt marked `served:
 * "cache"`. The append is atomic per line (a single `appendFile` of one JSON line); the cache write goes through a
 * temp file + rename so a crash never leaves a half body that a later hit would trust.
 */

import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type LookupReceipt, lookupCacheKey, lookupReceiptSchema } from "../core/lookup-receipt";

export interface LookupCacheEntry {
	url: string;
	finalUrl: string;
	contentType: string | null;
	status: number | null;
	sha256: string;
	at: number;
}

export interface LookupReceiptStore {
	appendReceipt(workspaceHash: string, receipt: LookupReceipt): Promise<void>;
	readReceipts(workspaceHash: string): Promise<LookupReceipt[]>;
	readCached(kind: LookupReceipt["kind"], url: string): Promise<{ entry: LookupCacheEntry; body: Uint8Array } | null>;
	writeCached(kind: LookupReceipt["kind"], url: string, entry: LookupCacheEntry, body: Uint8Array): Promise<void>;
	readonly rootDir: string;
}

export function createLookupReceiptStore(rootDir: string): LookupReceiptStore {
	const receiptsDir = join(rootDir, "lookup", "receipts");
	const cacheDir = join(rootDir, "lookup", "cache");

	async function appendReceipt(workspaceHash: string, receipt: LookupReceipt): Promise<void> {
		await mkdir(receiptsDir, { recursive: true });
		await appendFile(join(receiptsDir, `${workspaceHash}.jsonl`), `${JSON.stringify(receipt)}\n`, "utf8");
	}

	async function readReceipts(workspaceHash: string): Promise<LookupReceipt[]> {
		let text: string;
		try {
			text = await readFile(join(receiptsDir, `${workspaceHash}.jsonl`), "utf8");
		} catch {
			return [];
		}
		const receipts: LookupReceipt[] = [];
		for (const line of text.split("\n")) {
			if (!line.trim()) {
				continue;
			}
			try {
				const parsed = lookupReceiptSchema.safeParse(JSON.parse(line));
				if (parsed.success) {
					receipts.push(parsed.data);
				}
			} catch {
				// A torn line is skipped, never trusted — the receipts before and after it remain readable.
			}
		}
		return receipts;
	}

	async function readCached(kind: LookupReceipt["kind"], url: string) {
		const key = lookupCacheKey(kind, url);
		try {
			const [entryText, body] = await Promise.all([
				readFile(join(cacheDir, `${key}.json`), "utf8"),
				readFile(join(cacheDir, `${key}.body`)),
			]);
			const entry = JSON.parse(entryText) as LookupCacheEntry;
			if (typeof entry?.sha256 !== "string" || typeof entry?.url !== "string") {
				return null;
			}
			return { entry, body: new Uint8Array(body) };
		} catch {
			return null;
		}
	}

	async function writeCached(kind: LookupReceipt["kind"], url: string, entry: LookupCacheEntry, body: Uint8Array) {
		await mkdir(cacheDir, { recursive: true });
		const key = lookupCacheKey(kind, url);
		const bodyPath = join(cacheDir, `${key}.body`);
		const entryPath = join(cacheDir, `${key}.json`);
		const stamp = `${process.pid}-${Date.now().toString(36)}`;
		await writeFile(`${bodyPath}.${stamp}.tmp`, body);
		await rename(`${bodyPath}.${stamp}.tmp`, bodyPath);
		await writeFile(`${entryPath}.${stamp}.tmp`, JSON.stringify(entry), "utf8");
		await rename(`${entryPath}.${stamp}.tmp`, entryPath);
	}

	return { appendReceipt, readReceipts, readCached, writeCached, rootDir };
}
