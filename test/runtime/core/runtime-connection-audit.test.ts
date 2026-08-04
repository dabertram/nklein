import { describe, expect, it } from "vitest";
import {
	buildConnectionAuditVerdict,
	isLoopbackRemoteHost,
	parseLsofEstablishedLine,
} from "../../../src/core/runtime-connection-audit";

/**
 * N15 local-only assertion core. The fixtures are real `lsof -nP -iTCP -sTCP:ESTABLISHED` row shapes
 * (macOS column layout), because the parser's whole job is surviving that format — a parse that silently
 * returns null on real rows would make every audit pass vacuously (silence-is-not-success is asserted
 * separately via observedConnections).
 */
const HEADER = "COMMAND     PID  USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME";
const LOOPBACK_ROW =
	"node      48856 david   28u  IPv4 0x1234567890abcdef      0t0  TCP 127.0.0.1:52344->127.0.0.1:1234 (ESTABLISHED)";
const LAN_ROW =
	"node      48856 david   31u  IPv4 0x1234567890abcd00      0t0  TCP 192.168.1.20:52999->192.168.1.50:1234 (ESTABLISHED)";
const PUBLIC_ROW =
	"curl      50123 david    5u  IPv4 0xdeadbeefdeadbeef      0t0  TCP 192.168.1.20:53001->140.82.121.4:443 (ESTABLISHED)";
const V6_ROW =
	"node      48856 david   40u  IPv6 0xabcdefabcdefabcd      0t0  TCP [::1]:53010->[::1]:11234 (ESTABLISHED)";

describe("parseLsofEstablishedLine", () => {
	it("parses IPv4, bracketed IPv6, and skips the header and malformed rows", () => {
		expect(parseLsofEstablishedLine(LOOPBACK_ROW)).toEqual({
			command: "node",
			pid: 48856,
			remoteHost: "127.0.0.1",
			remotePort: 1234,
		});
		expect(parseLsofEstablishedLine(V6_ROW)).toEqual({
			command: "node",
			pid: 48856,
			remoteHost: "::1",
			remotePort: 11234,
		});
		expect(parseLsofEstablishedLine(HEADER)).toBeNull();
		expect(parseLsofEstablishedLine("")).toBeNull();
		expect(parseLsofEstablishedLine("node 123 david 5u IPv4 0x0 0t0 TCP *:8080 (LISTEN)")).toBeNull();
	});
});

describe("isLoopbackRemoteHost", () => {
	it("accepts every loopback spelling and rejects everything else", () => {
		for (const host of ["127.0.0.1", "127.5.5.5", "localhost", "LOCALHOST", "::1", "::ffff:127.0.0.1"]) {
			expect(isLoopbackRemoteHost(host), host).toBe(true);
		}
		for (const host of ["192.168.1.50", "10.0.0.1", "140.82.121.4", "fe80::1", "example.com", "128.0.0.1"]) {
			expect(isLoopbackRemoteHost(host), host).toBe(false);
		}
	});
});

describe("buildConnectionAuditVerdict", () => {
	const parse = (rows: string[]) =>
		rows.map(parseLsofEstablishedLine).filter((row): row is NonNullable<typeof row> => row !== null);

	it("passes an all-loopback run and records how much it actually saw", () => {
		const verdict = buildConnectionAuditVerdict(parse([LOOPBACK_ROW, V6_ROW]));
		expect(verdict.ok).toBe(true);
		expect(verdict.violations).toEqual([]);
		expect(verdict.observedConnections).toBe(2);
	});

	it("FAILS on LAN and public destinations alike — private ranges are NOT implicitly trusted", () => {
		const verdict = buildConnectionAuditVerdict(parse([LOOPBACK_ROW, LAN_ROW, PUBLIC_ROW]));
		expect(verdict.ok).toBe(false);
		expect(verdict.violations.map((violation) => violation.remoteHost).sort()).toEqual([
			"140.82.121.4",
			"192.168.1.50",
		]);
	});

	it("an explicit allowlist admits a fleet host; repeat sightings dedupe into one counted violation", () => {
		const allowlisted = buildConnectionAuditVerdict(parse([LAN_ROW, LAN_ROW]), {
			allowedRemoteHosts: ["192.168.1.50"],
		});
		expect(allowlisted.ok).toBe(true);
		const counted = buildConnectionAuditVerdict(parse([PUBLIC_ROW, PUBLIC_ROW, PUBLIC_ROW]));
		expect(counted.violations).toHaveLength(1);
		expect(counted.violations[0].observations).toBe(3);
	});

	it("zero observations is NOT a pass signal by itself — the count is exposed for the sampler-broken check", () => {
		const verdict = buildConnectionAuditVerdict([]);
		expect(verdict.ok).toBe(true);
		expect(verdict.observedConnections).toBe(0);
	});
});
