import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
	buildNxdomainResponse,
	createEgressProxyDnsStub,
	type EgressProxyDnsSocket,
} from "../../../src/nklein-agent/egress-proxy-dns-stub";

/** Build a minimal DNS query datagram for `name` (QTYPE=A, QCLASS=IN) with the given transaction id and RD set. */
function buildQuery(id: number, name: string): Buffer {
	const header = Buffer.alloc(12);
	header.writeUInt16BE(id, 0);
	header.writeUInt16BE(0x0100, 2); // RD set
	header.writeUInt16BE(1, 4); // QDCOUNT=1
	const labels = name.split(".");
	const qnameParts: Buffer[] = [];
	for (const label of labels) {
		const len = Buffer.alloc(1);
		len.writeUInt8(label.length, 0);
		qnameParts.push(len, Buffer.from(label, "ascii"));
	}
	qnameParts.push(Buffer.from([0])); // root terminator
	const qname = Buffer.concat(qnameParts);
	const trailer = Buffer.alloc(4);
	trailer.writeUInt16BE(1, 0); // QTYPE=A
	trailer.writeUInt16BE(1, 2); // QCLASS=IN
	return Buffer.concat([header, qname, trailer]);
}

describe("buildNxdomainResponse", () => {
	it("echoes the query id and answers NXDOMAIN (RCODE=3, QR=1) for every query", () => {
		const query = buildQuery(0xbeef, "api.example.com");
		const response = buildNxdomainResponse(query);
		expect(response.readUInt16BE(0)).toBe(0xbeef); // id echoed
		expect(response.readUInt8(2) & 0x80).toBe(0x80); // QR = response
		expect(response.readUInt8(3) & 0x0f).toBe(3); // RCODE = NXDOMAIN
		expect(response.readUInt16BE(6)).toBe(0); // ANCOUNT = 0 (no answer — nothing exists)
	});

	it("echoes the question section verbatim (QDCOUNT=1)", () => {
		const query = buildQuery(0x1234, "exfil.evil.test");
		const response = buildNxdomainResponse(query);
		expect(response.readUInt16BE(4)).toBe(1); // QDCOUNT=1
		// The question bytes (offset 12..end) are copied verbatim.
		expect(response.subarray(12)).toEqual(query.subarray(12));
	});

	it("fails closed on a truncated/malformed packet — header-only NXDOMAIN, no question echoed", () => {
		const malformed = Buffer.from([0xab, 0xcd, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09]);
		const response = buildNxdomainResponse(malformed);
		expect(response.readUInt16BE(0)).toBe(0xabcd); // id still echoed
		expect(response.readUInt8(3) & 0x0f).toBe(3); // still NXDOMAIN
		expect(response.readUInt16BE(4)).toBe(0); // QDCOUNT=0 (question not echoed)
	});

	it("replies with a zeroed NXDOMAIN header when the packet is too short to hold an id", () => {
		const tiny = Buffer.from([0x00]);
		const response = buildNxdomainResponse(tiny);
		expect(response.length).toBe(12);
		expect(response.readUInt8(2) & 0x80).toBe(0x80);
		expect(response.readUInt8(3) & 0x0f).toBe(3);
	});
});

/** A fake dgram socket that lets the test drive the message handler and capture sent datagrams. */
function createFakeSocket(): {
	socket: EgressProxyDnsSocket;
	emitMessage: (msg: Buffer, rinfo: { address: string; port: number }) => void;
	bound: { port: number | null };
	sent: { msg: Buffer; port: number; address: string }[];
} {
	let messageListener: ((msg: Buffer, rinfo: { address: string; port: number }) => void) | null = null;
	const bound: { port: number | null } = { port: null };
	const sent: { msg: Buffer; port: number; address: string }[] = [];
	const socket: EgressProxyDnsSocket = {
		on(event, listener) {
			if (event === "message") {
				messageListener = listener as typeof messageListener;
			}
		},
		bind(port, _address, onBound) {
			bound.port = port;
			onBound();
		},
		send(msg, port, address) {
			sent.push({ msg, port, address });
		},
		close(onClosed) {
			onClosed?.();
		},
	};
	return {
		socket,
		emitMessage: (msg, rinfo) => messageListener?.(msg, rinfo),
		bound,
		sent,
	};
}

describe("createEgressProxyDnsStub", () => {
	it("binds the injected socket and answers NXDOMAIN, auditing the query name", async () => {
		const fake = createFakeSocket();
		const seen: string[] = [];
		const stub = createEgressProxyDnsStub({
			socketFactory: () => fake.socket,
			onQuery: (name) => seen.push(name),
		});
		await stub.start(53);
		expect(fake.bound.port).toBe(53);

		fake.emitMessage(buildQuery(0x0001, "leak.example.com"), { address: "10.0.0.9", port: 40000 });
		expect(seen).toEqual(["leak.example.com"]); // query name audited (injection signal)
		expect(fake.sent).toHaveLength(1);
		expect(fake.sent[0].msg.readUInt8(3) & 0x0f).toBe(3); // NXDOMAIN reply sent back
		expect(fake.sent[0].address).toBe("10.0.0.9");
	});

	it("a throwing audit sink never breaks the NXDOMAIN reply (best-effort audit)", async () => {
		const fake = createFakeSocket();
		const stub = createEgressProxyDnsStub({
			socketFactory: () => fake.socket,
			onQuery: () => {
				throw new Error("audit down");
			},
		});
		await stub.start(53);
		fake.emitMessage(buildQuery(0x0002, "x.test"), { address: "10.0.0.9", port: 40001 });
		expect(fake.sent).toHaveLength(1);
		expect(fake.sent[0].msg.readUInt8(3) & 0x0f).toBe(3);
	});
});
