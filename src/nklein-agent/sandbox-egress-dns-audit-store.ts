import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { type EgressProxyDnsAuditRecord, egressProxyDnsAuditRecordSchema } from "../core/egress-proxy-dns-audit";
import { parseValidatedJsonl } from "../state/jsonl-store";

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "sandbox-egress-audit");
const LOG_FILE = "egress-dns-queries.jsonl";

export interface EgressProxyDnsAuditStoreOptions {
	rootDir?: string;
}

export async function appendEgressProxyDnsAuditRecord(
	record: EgressProxyDnsAuditRecord,
	options: EgressProxyDnsAuditStoreOptions = {},
): Promise<void> {
	const validated = egressProxyDnsAuditRecordSchema.safeParse(record);
	if (!validated.success) return;
	try {
		const root = options.rootDir ?? DEFAULT_ROOT;
		await mkdir(root, { recursive: true });
		await appendFile(join(root, LOG_FILE), `${JSON.stringify(validated.data)}\n`, "utf8");
	} catch {
		// Auditing is best-effort; NXDOMAIN remains the fail-closed enforcement result.
	}
}

export async function readEgressProxyDnsAuditRecords(
	options: EgressProxyDnsAuditStoreOptions = {},
): Promise<EgressProxyDnsAuditRecord[]> {
	try {
		const raw = await readFile(join(options.rootDir ?? DEFAULT_ROOT, LOG_FILE), "utf8");
		return parseValidatedJsonl(raw, egressProxyDnsAuditRecordSchema, "sandbox-egress-dns-audit-store");
	} catch {
		return [];
	}
}

export function createEgressProxyDnsAuditSink(
	options: EgressProxyDnsAuditStoreOptions = {},
): (record: EgressProxyDnsAuditRecord) => void {
	return (record) => void appendEgressProxyDnsAuditRecord(record, options);
}
