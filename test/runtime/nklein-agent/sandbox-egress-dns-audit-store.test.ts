import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildEgressProxyDnsAuditRecord } from "../../../src/core/egress-proxy-dns-audit";
import {
	appendEgressProxyDnsAuditRecord,
	readEgressProxyDnsAuditRecords,
} from "../../../src/nklein-agent/sandbox-egress-dns-audit-store";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("sandbox egress DNS audit", () => {
	it("persists a denied query without inventing task attribution", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "nklein-egress-dns-audit-"));
		roots.push(rootDir);
		const record = buildEgressProxyDnsAuditRecord({
			id: "dns-1",
			queryName: "payload.example",
			sourceAddress: "172.30.0.4",
			sourcePort: 53123,
			recordedAt: 1000,
		});
		await appendEgressProxyDnsAuditRecord(record, { rootDir });
		expect(await readEgressProxyDnsAuditRecords({ rootDir })).toEqual([
			{
				...record,
				decision: "deny",
				reasonCode: "dns_blocked",
				taskId: null,
				attribution: "shared_network_namespace",
			},
		]);
	});
});
