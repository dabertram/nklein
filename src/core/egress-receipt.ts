/**
 * Egress receipts (F12.99) — PURE hash-chained receipt building + verification.
 *
 * "We don't exfiltrate" should be an auditable record, not a promise: every outbound request appends a receipt
 * (timestamp, destination, request hash, category, taint labels) to a LOCAL log the user can inspect. Receipts are
 * HASH-CHAINED — each embeds the previous receipt's hash, so truncating or editing the middle of the log breaks the
 * chain verifiably. Chaining gives tamper-EVIDENCE without key management; per-receipt signatures (identity) can
 * layer on later. Pure: the caller supplies the clock and the previous hash; the store owns I/O.
 */

import { createHash } from "node:crypto";

export interface EgressReceiptInput {
	/** Where the request went (URL or host). */
	readonly destination: string;
	readonly method: string;
	/** Hash or digest-able summary of WHAT was sent (for a GET: the full URL; for a POST: the body hash). */
	readonly requestSummary: string;
	/** Egress class from the trust-center inventory (e.g. "web_research", "model_download"). */
	readonly category: string;
	/** Taint labels active on the requesting session (empty when untainted). */
	readonly taintLabels: readonly string[];
	/** Previous receipt's hash, or null for the chain genesis. */
	readonly prevHash: string | null;
	/** Epoch ms (injected — keeps this pure). */
	readonly at: number;
}

export interface EgressReceipt extends EgressReceiptInput {
	/** sha256 over the canonical serialization of every field above (including prevHash) — the chain link. */
	readonly hash: string;
}

function canonical(input: EgressReceiptInput): string {
	return JSON.stringify([
		input.at,
		input.category,
		input.destination,
		input.method,
		input.requestSummary,
		[...input.taintLabels].sort(),
		input.prevHash,
	]);
}

/** Build one chained receipt. */
export function buildEgressReceipt(input: EgressReceiptInput): EgressReceipt {
	return { ...input, hash: createHash("sha256").update(canonical(input)).digest("hex") };
}

export interface ChainVerification {
	readonly valid: boolean;
	/** Index of the first broken receipt (bad hash or broken prev link); null when valid. */
	readonly brokenAt: number | null;
	readonly reason: string;
}

/** Verify a receipt log: every hash must recompute AND every prevHash must equal the prior receipt's hash. */
export function verifyEgressReceiptChain(receipts: readonly EgressReceipt[]): ChainVerification {
	for (let i = 0; i < receipts.length; i++) {
		const receipt = receipts[i];
		if (!receipt) {
			return { valid: false, brokenAt: i, reason: `receipt ${i} is missing.` };
		}
		const expectedPrev = i === 0 ? receipt.prevHash : (receipts[i - 1]?.hash ?? null);
		if (i > 0 && receipt.prevHash !== expectedPrev) {
			return { valid: false, brokenAt: i, reason: `receipt ${i} does not link to receipt ${i - 1} (chain break).` };
		}
		const recomputed = createHash("sha256").update(canonical(receipt)).digest("hex");
		if (recomputed !== receipt.hash) {
			return { valid: false, brokenAt: i, reason: `receipt ${i} hash mismatch (content was altered).` };
		}
	}
	return { valid: true, brokenAt: null, reason: `${receipts.length} receipt(s), chain intact.` };
}
