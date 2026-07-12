import type { Buffer } from "node:buffer";
import { Buffer as NodeBuffer } from "node:buffer";
import { createSocket } from "node:dgram";

/**
 * The egress-proxy DNS stub (docs/dev/egress-proxy-design.md §4 "DNS: containers get a stub, not a resolver", risk Q1).
 *
 * Docker's embedded resolver (127.0.0.11) forwards external lookups UPSTREAM even on `--internal` networks — a live
 * DNS-exfiltration channel (data encodes in query names). This ~UDP server closes that leak by answering **NXDOMAIN to
 * EVERY query** (the sandbox reaches hosts only via explicit CONNECT to the proxy, which resolves host-side — §5). Each
 * query name is handed to the audit sink: a free injection-detection signal.
 *
 * Fail-closed (R2): the response is authoritatively "does not exist"; a container can therefore resolve NOTHING through
 * this path. The socket seam is injected so the wire logic (`buildNxdomainResponse`) is unit-testable with no I/O.
 */

/** RCODE 3 = NXDOMAIN (RFC 1035 §4.1.1). The one answer this stub ever gives. */
const DNS_RCODE_NXDOMAIN = 3;
const DNS_HEADER_BYTES = 12;
/** QR=1 (response) in the high flags byte. */
const DNS_FLAG_QR_RESPONSE = 0x80;
/** RD (recursion desired) bit in the high flags byte — echoed back from the query, cosmetic only. */
const DNS_FLAG_RD = 0x01;

/** The injected UDP socket — the only effectful edge. Prod wraps `node:dgram`; tests drive `handleQuery` directly. */
export interface EgressProxyDnsSocket {
	on(event: "message", listener: (msg: Buffer, rinfo: { address: string; port: number }) => void): void;
	on(event: "error", listener: (error: Error) => void): void;
	on(event: "listening", listener: () => void): void;
	bind(port: number, address: string | undefined, onBound: () => void): void;
	send(msg: Buffer, port: number, address: string, onSent?: (error: Error | null) => void): void;
	close(onClosed?: () => void): void;
}

export type EgressProxyDnsSocketFactory = () => EgressProxyDnsSocket;

export interface EgressProxyDnsStubDeps {
	/** UDP socket factory. Default: `node:dgram` udp4. Injected as a fake in unit tests. */
	socketFactory?: EgressProxyDnsSocketFactory;
	/** Audits every query name seen (design §4 "auditing each query name"). Best-effort; must never throw into the datapath. */
	onQuery?: (queryName: string, rinfo: { address: string; port: number }) => void;
	/** Bind address; default `undefined` ⇒ all interfaces (the proxy binds the internal-network interface in prod). */
	bindAddress?: string;
}

export interface EgressProxyDnsStub {
	start(port: number): Promise<void>;
	stop(): Promise<void>;
	/** Pure: parse a query, return the NXDOMAIN response for it. Exposed for unit tests and reuse by `start`. */
	handleQuery(query: Buffer): Buffer;
}

/** The parsed shape of a DNS query the stub cares about (id + the dotted question name). */
interface ParsedDnsQuery {
	name: string;
	questionEnd: number;
}

/**
 * Walk the QNAME labels from the header end (offset 12). Returns the dotted name and the offset just past the question
 * (QNAME + QTYPE + QCLASS). Defensive against malformed/truncated packets: any bounds violation throws, and the caller
 * (`handleQuery`) still returns a header-only NXDOMAIN — a parse anomaly fails toward "does not exist", never a leak.
 */
function parseQuestion(query: Buffer): ParsedDnsQuery {
	const labels: string[] = [];
	let offset = DNS_HEADER_BYTES;
	while (offset < query.length) {
		const len = query.readUInt8(offset);
		offset += 1;
		if (len === 0) {
			break; // Root terminator — end of QNAME.
		}
		if ((len & 0xc0) !== 0) {
			// Compression pointers are illegal in a question QNAME; treat as anomaly.
			throw new Error("egress-dns-stub: unexpected label pointer in question");
		}
		if (offset + len > query.length) {
			throw new Error("egress-dns-stub: truncated label");
		}
		labels.push(query.subarray(offset, offset + len).toString("ascii"));
		offset += len;
	}
	// Skip QTYPE (2) + QCLASS (2) to mark the end of the question section we echo.
	const questionEnd = offset + 4;
	return { name: labels.join("."), questionEnd };
}

/**
 * Build the NXDOMAIN response for a query buffer (pure). Echoes the query id and the question section (QDCOUNT=1), sets
 * QR=1 and RCODE=3, and zeroes all record counts. On any parse anomaly, returns a valid header-only NXDOMAIN echoing
 * just the id — still authoritative "does not exist" (fail-closed).
 */
export function buildNxdomainResponse(query: Buffer): Buffer {
	if (query.length < DNS_HEADER_BYTES) {
		// Too short to even hold an id; reply with a zeroed NXDOMAIN header (best-effort, still fail-closed).
		const header = NodeBuffer.alloc(DNS_HEADER_BYTES);
		header.writeUInt8(DNS_FLAG_QR_RESPONSE, 2);
		header.writeUInt8(DNS_RCODE_NXDOMAIN, 3);
		return header;
	}
	let questionEnd = DNS_HEADER_BYTES;
	try {
		questionEnd = Math.min(parseQuestion(query).questionEnd, query.length);
	} catch {
		// Malformed question ⇒ echo the id only, no question section (QDCOUNT stays 0). Fail-closed NXDOMAIN.
		questionEnd = DNS_HEADER_BYTES;
	}
	const echoesQuestion = questionEnd > DNS_HEADER_BYTES;
	const response = NodeBuffer.alloc(questionEnd);
	// Copy id (bytes 0-1) verbatim so the client matches the response to its query.
	query.copy(response, 0, 0, 2);
	// Flags: QR=1, echo the RD bit (byte 2 low bit), RCODE=NXDOMAIN. Everything else (AA/TC/RA/Z) zeroed.
	const rd = query.readUInt8(2) & DNS_FLAG_RD;
	response.writeUInt8(DNS_FLAG_QR_RESPONSE | rd, 2);
	response.writeUInt8(DNS_RCODE_NXDOMAIN, 3);
	// QDCOUNT=1 iff we echoed a question; ANCOUNT/NSCOUNT/ARCOUNT all 0 (offsets 6/8/10 already zero from alloc).
	response.writeUInt16BE(echoesQuestion ? 1 : 0, 4);
	if (echoesQuestion) {
		query.copy(response, DNS_HEADER_BYTES, DNS_HEADER_BYTES, questionEnd);
	}
	return response;
}

function defaultSocketFactory(): EgressProxyDnsSocket {
	// The real udp4 socket is only constructed in prod (`start`); tests inject `socketFactory`, so this never binds there.
	return createSocket("udp4") as unknown as EgressProxyDnsSocket;
}

/**
 * Create the DNS stub. `start(port)` binds the socket and answers NXDOMAIN to every datagram; `handleQuery` exposes the
 * pure wire logic for tests. The audit callback is best-effort — a throwing sink is swallowed so it can never break the
 * datapath (an unauditable query still gets its authoritative NXDOMAIN).
 */
export function createEgressProxyDnsStub(deps: EgressProxyDnsStubDeps = {}): EgressProxyDnsStub {
	const socketFactory = deps.socketFactory ?? defaultSocketFactory;
	let socket: EgressProxyDnsSocket | null = null;

	const handleQuery = (query: Buffer): Buffer => buildNxdomainResponse(query);

	return {
		handleQuery,
		start(port: number): Promise<void> {
			return new Promise<void>((resolve, reject) => {
				const sock = socketFactory();
				socket = sock;
				sock.on("error", (error) => {
					reject(error);
				});
				sock.on("message", (msg, rinfo) => {
					if (deps.onQuery) {
						try {
							let name = "";
							if (msg.length >= DNS_HEADER_BYTES) {
								try {
									name = parseQuestion(msg).name;
								} catch {
									name = "";
								}
							}
							deps.onQuery(name, rinfo);
						} catch {
							// Best-effort audit (R5): an audit failure must never affect the reply.
						}
					}
					const response = handleQuery(msg);
					sock.send(response, rinfo.port, rinfo.address);
				});
				sock.bind(port, deps.bindAddress, () => {
					resolve();
				});
			});
		},
		stop(): Promise<void> {
			return new Promise<void>((resolve) => {
				if (!socket) {
					resolve();
					return;
				}
				socket.close(() => {
					socket = null;
					resolve();
				});
			});
		},
	};
}
