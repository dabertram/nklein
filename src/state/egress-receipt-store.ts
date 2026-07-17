import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { buildEgressReceipt, type EgressReceipt, type EgressReceiptInput } from "../core/egress-receipt";

/**
 * F12.99 effectful leg: the local, append-only, hash-chained egress-receipt log
 * (`~/.nklein/nklein/egress-receipts.jsonl`). Appends chain onto the last persisted receipt; reads skip unparseable
 * lines (a torn tail line must not brick auditing — the chain verification reports the break honestly instead).
 */

export interface EgressReceiptStoreOptions {
	readonly filePath?: string;
}

function resolvePath(options: EgressReceiptStoreOptions): string {
	return options.filePath ?? join(homedir(), ".nklein", "nklein", "egress-receipts.jsonl");
}

export async function readEgressReceipts(options: EgressReceiptStoreOptions = {}): Promise<EgressReceipt[]> {
	try {
		const raw = await readFile(resolvePath(options), "utf8");
		return raw
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.flatMap((line) => {
				try {
					return [JSON.parse(line) as EgressReceipt];
				} catch {
					return [];
				}
			});
	} catch {
		return [];
	}
}

/** Append one receipt, chaining onto the last persisted hash. Serialized per process via a simple promise queue. */
let appendQueue: Promise<unknown> = Promise.resolve();

export function appendEgressReceipt(
	input: Omit<EgressReceiptInput, "prevHash" | "at"> & { at?: number },
	options: EgressReceiptStoreOptions = {},
): Promise<EgressReceipt> {
	const run = async (): Promise<EgressReceipt> => {
		const path = resolvePath(options);
		const existing = await readEgressReceipts(options);
		const receipt = buildEgressReceipt({
			...input,
			at: input.at ?? Date.now(),
			prevHash: existing[existing.length - 1]?.hash ?? null,
		});
		await mkdir(dirname(path), { recursive: true });
		await appendFile(path, `${JSON.stringify(receipt)}\n`, "utf8");
		return receipt;
	};
	const next = appendQueue.then(run, run);
	appendQueue = next.catch(() => {});
	return next;
}
