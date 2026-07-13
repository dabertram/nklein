import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EgressProxyAuditRecord } from "../../../src/core/egress-proxy-audit";
import {
	appendEgressProxyAuditRecord,
	createEgressProxyAuditSink,
	readEgressProxyAuditRecords,
} from "../../../src/nklein-agent/sandbox-egress-attempt-audit-store";

/**
 * Persistence coverage for the I2b egress-attempt audit STORE (docs/dev/egress-proxy-design.md §6 I1, R5). Mirrors
 * `test/runtime/chat/chat-egress-attempt-audit-store.test.ts`: a per-test tmp `rootDir`, append→read round-trip, and
 * the best-effort / schema-skip / limit-tail edges. The store is validated against a real I1 record shape.
 */

function makeRecord(over: Partial<EgressProxyAuditRecord> = {}): EgressProxyAuditRecord {
	return {
		schemaVersion: 1,
		id: "id-1",
		role: "worker",
		policy: "allowlist",
		listenerPort: 3129,
		transport: "connect",
		taskId: null,
		target: "example.com:443",
		host: "example.com",
		port: 443,
		decision: "allow",
		reasonCode: null,
		reason: "The host is on the egress allowlist.",
		resolvedIps: ["93.184.216.34"],
		executed: true,
		bytesIn: 0,
		bytesOut: 0,
		durationMs: 1,
		recordedAt: 10,
		...over,
	};
}

const LOG_FILE = "egress-attempts.jsonl";

/** The sink is fire-and-forget (returns void); poll the trail until the async append has settled. */
async function waitForRecords(rootDir: string, count: number): Promise<EgressProxyAuditRecord[]> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const records = await readEgressProxyAuditRecords({ rootDir });
		if (records.length >= count) {
			return records;
		}
		await new Promise((resolve) => setImmediate(resolve));
	}
	return readEgressProxyAuditRecords({ rootDir });
}

describe("sandbox-egress-attempt-audit-store", () => {
	let rootDir: string;
	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-sandbox-egress-audit-"));
	});
	afterEach(async () => {
		await rm(rootDir, { force: true, recursive: true });
	});

	it("appends then reads back records in chronological (append) order", async () => {
		await appendEgressProxyAuditRecord(makeRecord({ id: "a", recordedAt: 10 }), { rootDir });
		await appendEgressProxyAuditRecord(
			makeRecord({ id: "b", recordedAt: 20, decision: "deny", reasonCode: "not_on_allowlist", executed: false }),
			{ rootDir },
		);
		await appendEgressProxyAuditRecord(makeRecord({ id: "c", recordedAt: 30 }), { rootDir });

		const records = await readEgressProxyAuditRecords({ rootDir });
		expect(records.map((r) => r.id)).toEqual(["a", "b", "c"]);
		expect(records[1]).toMatchObject({ decision: "deny", reasonCode: "not_on_allowlist", executed: false });
	});

	it("returns [] when the log file does not exist yet", async () => {
		expect(await readEgressProxyAuditRecords({ rootDir })).toEqual([]);
	});

	it("with a limit, returns the most recent records (the chronological tail)", async () => {
		for (const recordedAt of [10, 20, 30]) {
			await appendEgressProxyAuditRecord(makeRecord({ id: `r-${recordedAt}`, recordedAt }), { rootDir });
		}
		expect((await readEgressProxyAuditRecords({ rootDir, limit: 1 })).map((r) => r.recordedAt)).toEqual([30]);
		expect((await readEgressProxyAuditRecords({ rootDir, limit: 2 })).map((r) => r.recordedAt)).toEqual([20, 30]);
		expect(await readEgressProxyAuditRecords({ rootDir, limit: 0 })).toEqual([]);
		expect((await readEgressProxyAuditRecords({ rootDir, limit: 99 })).map((r) => r.recordedAt)).toEqual([
			10, 20, 30,
		]);
	});

	it("is best-effort: a filesystem write failure never throws (audit must not break egress handling)", async () => {
		// Point the root under a path component that is a FILE → mkdir -p fails with ENOTDIR.
		const filePath = join(rootDir, "not-a-dir");
		await writeFile(filePath, "x", "utf8");
		const unwritableRoot = join(filePath, "nested");

		await expect(appendEgressProxyAuditRecord(makeRecord(), { rootDir: unwritableRoot })).resolves.toBeUndefined();
		// Nothing persisted, and reading the bad root is likewise swallowed to [].
		expect(await readEgressProxyAuditRecords({ rootDir: unwritableRoot })).toEqual([]);
	});

	it("skips schema-invalid and unparseable lines on read, keeping the valid ones", async () => {
		await mkdir(rootDir, { recursive: true });
		const valid = makeRecord({ id: "valid", recordedAt: 10 });
		const lines = [
			JSON.stringify(valid),
			"{ not json", // unparseable → skipped
			JSON.stringify({ schemaVersion: 1, id: "bad" }), // parseable but schema-invalid → skipped
			"", // blank → skipped
		];
		await writeFile(join(rootDir, LOG_FILE), `${lines.join("\n")}\n`, "utf8");

		const records = await readEgressProxyAuditRecords({ rootDir });
		expect(records.map((r) => r.id)).toEqual(["valid"]);
	});

	it("validates at the boundary: a mis-shaped record is dropped on append, not persisted", async () => {
		const bogus = { schemaVersion: 1, id: "bogus" } as unknown as EgressProxyAuditRecord;
		await expect(appendEgressProxyAuditRecord(bogus, { rootDir })).resolves.toBeUndefined();
		expect(await readEgressProxyAuditRecords({ rootDir })).toEqual([]);
	});

	it("createEgressProxyAuditSink returns a (record) => void that appends fire-and-forget", async () => {
		const sink = createEgressProxyAuditSink({ rootDir });
		expect(typeof sink).toBe("function");
		// The seam is synchronous void (matches EgressProxyServerDeps.auditSink); the write happens in the background.
		expect(sink(makeRecord({ id: "sunk", recordedAt: 42 }))).toBeUndefined();

		const records = await waitForRecords(rootDir, 1);
		expect(records.map((r) => r.id)).toEqual(["sunk"]);
	});
});
