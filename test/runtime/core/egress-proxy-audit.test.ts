import { describe, expect, it } from "vitest";
import {
	buildEgressProxyAuditRecord,
	EGRESS_PROXY_AUDIT_REASON_CODES,
	type EgressProxyAuditRecord,
	egressProxyAuditRecordSchema,
	egressProxyTransportForParsedKind,
	encodeEgressProxyAuditRecordLine,
} from "../../../src/core/egress-proxy-audit";
import { parseConnectRequestLine } from "../../../src/core/egress-proxy-protocol";
import {
	decideProxyVerdict,
	type EgressProxyRoleSnapshot,
	type EgressProxyVerdict,
} from "../../../src/core/egress-proxy-verdict";

const SNAPSHOT: EgressProxyRoleSnapshot = { role: "worker", networkPolicy: "allowlist", allowlist: ["example.com"] };

const connect = (authority: string) => parseConnectRequestLine(`CONNECT ${authority} HTTP/1.1`);

/** Fixed injected identity/clock — the builder is pure (no uuid, no Date.now). */
const BASE = {
	id: "attempt-0001",
	recordedAt: 1_784_323_200_000,
	role: "worker" as const,
	policy: "allowlist" as const,
	listenerPort: 3129,
	transport: "connect" as const,
	durationMs: 2,
};

describe("buildEgressProxyAuditRecord", () => {
	it("builds the full §5 record for a finalized allow (executed tunnel with byte counts)", () => {
		const verdict = decideProxyVerdict(connect("api.example.com:443"), SNAPSHOT, ["93.184.216.34"]);
		const record = buildEgressProxyAuditRecord({
			...BASE,
			target: "api.example.com:443",
			verdict,
			resolvedIps: ["93.184.216.34"],
			executed: true,
			bytesIn: 4096,
			bytesOut: 512,
		});
		expect(record).toEqual({
			schemaVersion: 1,
			id: "attempt-0001",
			role: "worker",
			policy: "allowlist",
			listenerPort: 3129,
			transport: "connect",
			target: "api.example.com:443",
			host: "api.example.com",
			port: 443,
			decision: "allow",
			reasonCode: null,
			reason: "The host is on the egress allowlist.",
			resolvedIps: ["93.184.216.34"],
			executed: true,
			taskId: null,
			bytesIn: 4096,
			bytesOut: 512,
			durationMs: 2,
			recordedAt: 1_784_323_200_000,
		});
		expect(egressProxyAuditRecordSchema.parse(record)).toEqual(record);
	});

	it("defaults executed/bytes/resolvedIps for a deny (mirrors the §5 example record)", () => {
		const verdict = decideProxyVerdict(connect("evil.com:443"), SNAPSHOT);
		const record = buildEgressProxyAuditRecord({ ...BASE, target: "evil.com:443", verdict });
		expect(record.decision).toBe("deny");
		expect(record.reasonCode).toBe("not_on_allowlist");
		expect(record.host).toBe("evil.com");
		expect(record.port).toBe(443);
		expect(record.resolvedIps).toBeNull();
		expect(record.executed).toBe(false);
		expect(record.bytesIn).toBe(0);
		expect(record.bytesOut).toBe(0);
		expect(egressProxyAuditRecordSchema.parse(record)).toEqual(record);
	});

	it("records a parse_error deny with null host/port but the raw attempted target", () => {
		const verdict = decideProxyVerdict(connect("example.com"), SNAPSHOT); // missing port
		const record = buildEgressProxyAuditRecord({ ...BASE, target: "example.com", verdict });
		expect(record.reasonCode).toBe("parse_error");
		expect(record.host).toBeNull();
		expect(record.port).toBeNull();
		expect(record.target).toBe("example.com");
		expect(egressProxyAuditRecordSchema.parse(record)).toEqual(record);
	});

	it("records a confirm (v1 audits it even though the proxy answers 403 until I5)", () => {
		const verdict = decideProxyVerdict(connect("api.example.com:443"), {
			...SNAPSHOT,
			requirePerActionApproval: true,
		});
		const record = buildEgressProxyAuditRecord({ ...BASE, target: "api.example.com:443", verdict });
		expect(record.decision).toBe("confirm");
		expect(record.reasonCode).toBeNull();
		expect(record.executed).toBe(false);
		expect(egressProxyAuditRecordSchema.parse(record)).toEqual(record);
	});
});

describe("egressProxyAuditRecordSchema (zod-validated JSONL entries, mirroring the chat audit store)", () => {
	const valid = (): EgressProxyAuditRecord =>
		buildEgressProxyAuditRecord({
			...BASE,
			target: "api.example.com:443",
			verdict: decideProxyVerdict(connect("api.example.com:443"), SNAPSHOT),
		});

	it("accepts every declared reason code (pure + proxy-local — layering drift breaks here)", () => {
		for (const reasonCode of EGRESS_PROXY_AUDIT_REASON_CODES) {
			const candidate = { ...valid(), decision: "deny", reasonCode };
			expect(() => egressProxyAuditRecordSchema.parse(candidate), reasonCode).not.toThrow();
		}
	});

	it("rejects wrong schemaVersion / decision / transport / role / reasonCode values", () => {
		const base = valid();
		for (const mutation of [
			{ schemaVersion: 2 },
			{ decision: "maybe" },
			{ transport: "udp" },
			{ role: "manager" },
			{ reasonCode: "bogus_code" },
			{ resolvedIps: "93.184.216.34" },
		]) {
			expect(() => egressProxyAuditRecordSchema.parse({ ...base, ...mutation }), JSON.stringify(mutation)).toThrow();
		}
	});

	it("rejects a record missing a required field", () => {
		const { recordedAt: _dropped, ...rest } = valid();
		expect(() => egressProxyAuditRecordSchema.parse(rest)).toThrow();
	});
});

describe("encodeEgressProxyAuditRecordLine", () => {
	it("emits exactly one newline-terminated JSON line that round-trips through the schema", () => {
		const record = buildEgressProxyAuditRecord({
			...BASE,
			target: "api.example.com:443",
			verdict: decideProxyVerdict(connect("api.example.com:443"), SNAPSHOT, ["93.184.216.34"]),
			resolvedIps: ["93.184.216.34"],
		});
		const line = encodeEgressProxyAuditRecordLine(record);
		expect(line.endsWith("\n")).toBe(true);
		expect(line.slice(0, -1)).not.toContain("\n");
		expect(egressProxyAuditRecordSchema.parse(JSON.parse(line))).toEqual(record);
	});

	it("keeps one record per line even when a reason contains raw newlines (JSON escaping)", () => {
		const verdict: EgressProxyVerdict = {
			decision: "deny",
			reasonCode: "parse_error",
			reason: "line one\nline two",
			host: null,
			port: null,
			requiresResolvedAddressCheck: false,
			vettedAddresses: null,
		};
		const line = encodeEgressProxyAuditRecordLine(buildEgressProxyAuditRecord({ ...BASE, target: "x", verdict }));
		expect(line.slice(0, -1)).not.toContain("\n");
	});
});

describe("egressProxyTransportForParsedKind", () => {
	it("maps CONNECT to the connect transport and both plain-HTTP paths to http", () => {
		expect(egressProxyTransportForParsedKind("connect")).toBe("connect");
		expect(egressProxyTransportForParsedKind("absolute_form")).toBe("http");
		expect(egressProxyTransportForParsedKind("host_header")).toBe("http");
	});
});
