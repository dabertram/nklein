/**
 * `lookup` receipts — PURE. Every search and every page fetch the fact-check tool performs leaves a receipt: the URL,
 * the sha256 of the bytes that came back, their size, the card and step that asked, and when. David: "cached locally
 * so re-runs are reproducible and David can audit exactly what left the machine". The store (`lookup-receipt-store.ts`)
 * owns the JSONL + content cache I/O; this module owns the shapes, the hash and the cache key so they are testable
 * without a filesystem.
 *
 * A cached lookup (same cache key, body served from disk) ALSO gets a receipt, marked `served: "cache"` — the audit
 * question is "what did the model see", and a cache hit is something the model saw.
 */

import { createHash } from "node:crypto";
import { z } from "zod";

export const lookupReceiptSchema = z.object({
	id: z.string().min(1),
	kind: z.enum(["search", "fetch"]),
	/** The exact URL requested (for a search, the engine URL with the query). */
	url: z.string().min(1),
	/** The final URL after redirects (fetch), or the same as `url`. */
	finalUrl: z.string().min(1),
	/** For a search: the query. For a fetch: null. */
	query: z.string().nullable(),
	sha256: z.string().length(64),
	bytes: z.number().int().nonnegative(),
	contentType: z.string().nullable(),
	cardId: z.string().min(1),
	stepId: z.string().nullable(),
	served: z.enum(["network", "cache"]),
	/** HTTP status for a network response; null on cache. */
	status: z.number().int().nullable(),
	at: z.number(),
});
export type LookupReceipt = z.infer<typeof lookupReceiptSchema>;

export function sha256Hex(bytes: Uint8Array | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** The cache key is the request identity (kind + normalized URL) — the same lookup on a re-run hits the same entry. */
export function lookupCacheKey(kind: LookupReceipt["kind"], url: string): string {
	return sha256Hex(`${kind}\u0000${normalizeLookupUrl(url)}`);
}

/** Lowercase host, drop the fragment, keep query order (a search query IS the identity). */
export function normalizeLookupUrl(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.hash = "";
		parsed.hostname = parsed.hostname.toLowerCase();
		return parsed.toString();
	} catch {
		return url.trim();
	}
}

export interface BuildLookupReceiptInput {
	kind: LookupReceipt["kind"];
	url: string;
	finalUrl?: string | null;
	query?: string | null;
	body: Uint8Array | string;
	contentType?: string | null;
	cardId: string;
	stepId?: string | null;
	served: LookupReceipt["served"];
	status?: number | null;
	at: number;
	/** Injected id source so the receipt is deterministic in tests. */
	id?: string;
}

export function buildLookupReceipt(input: BuildLookupReceiptInput): LookupReceipt {
	const sha256 = sha256Hex(input.body);
	const bytes = typeof input.body === "string" ? Buffer.byteLength(input.body, "utf8") : input.body.byteLength;
	return {
		id: input.id ?? `lookup-${input.at.toString(36)}-${sha256.slice(0, 12)}`,
		kind: input.kind,
		url: input.url,
		finalUrl: input.finalUrl?.trim() || input.url,
		query: input.query ?? null,
		sha256,
		bytes,
		contentType: input.contentType ?? null,
		cardId: input.cardId,
		stepId: input.stepId ?? null,
		served: input.served,
		status: input.status ?? null,
		at: input.at,
	};
}

/** The set of URLs a card's receipts vouch for — what `complete_step` accepts as `citations` on a verify step. */
export function receiptUrlSet(receipts: readonly LookupReceipt[], cardId: string): Set<string> {
	const urls = new Set<string>();
	for (const receipt of receipts) {
		if (receipt.cardId !== cardId) {
			continue;
		}
		urls.add(normalizeLookupUrl(receipt.url));
		urls.add(normalizeLookupUrl(receipt.finalUrl));
	}
	return urls;
}
