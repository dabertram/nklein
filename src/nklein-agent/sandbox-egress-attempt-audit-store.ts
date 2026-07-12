import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import {
	type EgressProxyAuditRecord,
	egressProxyAuditRecordSchema,
	encodeEgressProxyAuditRecordLine,
} from "../core/egress-proxy-audit";
import { parseValidatedJsonl } from "../state/jsonl-store";

/**
 * Effectful STORE for the I1 `EgressProxyAuditRecord` (docs/dev/egress-proxy-design.md §5 audit record / §6 I1, R5).
 * Structurally mirrors `chat-egress-attempt-audit-store.ts`: one zod-validated JSON object per line, appended to a
 * JSONL file under the runtime home, read back through `parseValidatedJsonl`. The pure record shape + builder live in
 * `core/egress-proxy-audit.ts`; this module owns only the filesystem edge the I2a server's `auditSink` seam consumes.
 *
 * Durability is BEST-EFFORT (todo §1, like the ledger stores): an audit write must NEVER break egress handling, so a
 * validation or filesystem failure is swallowed rather than propagated onto the proxy's request path.
 */

export interface EgressProxyAuditStoreOptions {
	rootDir?: string;
}

/** Default under the runtime home, sibling of the chat store's `chat-audit` dir (§4 RW-mounted audit trail). */
const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "sandbox-egress-audit");

function resolveLogPath(rootDir?: string): string {
	return join(rootDir ?? DEFAULT_ROOT, "egress-attempts.jsonl");
}

/**
 * Append one attempt to the JSONL trail (R5: every attempt — allow AND deny AND confirm — is recorded). Validates at
 * the boundary with the I1 schema so a mis-shaped record never lands in the file (the read side skips it anyway), then
 * appends best-effort: any filesystem failure is swallowed so audit durability can never break egress handling.
 */
export async function appendEgressProxyAuditRecord(
	record: EgressProxyAuditRecord,
	options: EgressProxyAuditStoreOptions = {},
): Promise<void> {
	const validated = egressProxyAuditRecordSchema.safeParse(record);
	if (!validated.success) {
		// Boundary validation failed — drop rather than persist a line the reader would reject (never throw).
		return;
	}
	try {
		const root = options.rootDir ?? DEFAULT_ROOT;
		await mkdir(root, { recursive: true });
		await appendFile(resolveLogPath(options.rootDir), encodeEgressProxyAuditRecordLine(validated.data), "utf8");
	} catch {
		// Best-effort (todo §1): a failed audit write must never propagate into the proxy's egress path.
	}
}

export interface ReadEgressProxyAuditRecordsOptions extends EgressProxyAuditStoreOptions {
	/** Return only the most recent `limit` records — the chronological TAIL. */
	limit?: number;
}

/**
 * Read the trail in CHRONOLOGICAL (append) order, schema-validated line-by-line via `parseValidatedJsonl` (invalid or
 * unparseable lines are skipped, not fatal). A missing file ⇒ `[]`. With `limit`, returns the most recent `limit`
 * records — the tail — still in chronological order.
 */
export async function readEgressProxyAuditRecords(
	options: ReadEgressProxyAuditRecordsOptions = {},
): Promise<EgressProxyAuditRecord[]> {
	let raw: string;
	try {
		raw = await readFile(resolveLogPath(options.rootDir), "utf8");
	} catch {
		// Missing (or unreadable) file ⇒ no records yet.
		return [];
	}
	const all = parseValidatedJsonl(raw, egressProxyAuditRecordSchema, "sandbox-egress-attempt-audit-store");
	if (typeof options.limit !== "number") {
		return all;
	}
	const limit = Math.max(0, options.limit);
	// `slice(-0)` returns the whole array, so short-circuit an explicit zero limit.
	return limit === 0 ? [] : all.slice(-limit);
}

/**
 * The `(record) => void` audit sink the I2a egress-proxy server injects (`EgressProxyServerDeps.auditSink`). Fire-and-
 * forget: the seam is synchronous, and the underlying append is self-contained best-effort (never throws/rejects), so
 * the discarded promise can never surface an unhandled rejection on the proxy's hot path.
 */
export function createEgressProxyAuditSink(
	options: EgressProxyAuditStoreOptions = {},
): (record: EgressProxyAuditRecord) => void {
	return (record) => {
		void appendEgressProxyAuditRecord(record, options);
	};
}
