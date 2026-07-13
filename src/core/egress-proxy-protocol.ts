/**
 * Egress-proxy protocol parsing (docs/dev/egress-proxy-design.md §5/§6 I1 — the pure head of the §5.L host-side
 * egress proxy). PURE: no sockets, no DNS, no clock — the I2 proxy server feeds it raw bytes and acts on the result.
 *
 * WHAT: extracts the requested TARGET (host + port) from the bytes a proxy client sends before any tunnel opens,
 * in the design's §5 host-extraction order: CONNECT authority (HTTPS — covers ~all agent traffic) → absolute-form
 * URL (plain HTTP) → `Host` header (origin-form fallback). Plus {@link parseTlsClientHelloSni}, the SNI peek for a
 * hypothetical later transparent mode (built per §6 I1, deliberately NOT wired in v1 — see the design's ECH note).
 *
 * WHY default-deny: a parse anomaly here fails toward "blocked", never "escaped" (§3 threat model — the proxy can
 * only OPEN holes; the `--internal` topology is the boundary). So every anomaly — malformed line, userinfo@ smuggle,
 * missing CONNECT port, oversized head, bare CR/LF, duplicate Host — returns a typed reject that the verdict layer
 * maps to the proxy-local `parse_error` deny (§5 step 1). Port POLICY (443/80 only, §7 Q3) is NOT enforced here:
 * that is `decideProxyVerdict`'s `disallowed_port` (egress-proxy-verdict.ts); this module only validates port
 * SYNTAX so the policy layer sees honest numbers.
 */

/** Hard cap on a request head (through the CRLFCRLF terminator) — §6 I1 "hard byte/line limits". */
export const EGRESS_PROXY_MAX_HEAD_BYTES = 8 * 1024;
/** Hard cap on any single head line. */
export const EGRESS_PROXY_MAX_LINE_BYTES = 2 * 1024;

/** Why a proxy request head/line was refused. Every code maps to the verdict layer's `parse_error` deny. */
export type EgressProxyParseRejectCode =
	/** No CRLFCRLF terminator yet AND under the byte cap — the I2 reader may keep accumulating; still a deny if acted on. */
	| "head_incomplete"
	| "head_too_large"
	| "line_too_long"
	| "malformed_request_line"
	| "unsupported_method"
	/** Absolute-form target with a non-`http:` scheme (https goes through CONNECT; everything else is refused). */
	| "unsupported_scheme"
	/** A `userinfo@` in any authority is a smuggling shape, never legitimate agent traffic. */
	| "userinfo_in_authority"
	/** CONNECT authority without a port (RFC 7231 §4.3.6 requires one; guessing would widen the tunnel). */
	| "missing_port"
	| "invalid_port"
	| "invalid_host"
	| "missing_host_header"
	| "duplicate_host_header"
	| "malformed_header";

/** A successfully extracted proxy target. */
export interface EgressProxyParsedTarget {
	ok: true;
	/** Which §5 extraction path produced the target. */
	kind: "connect" | "absolute_form" | "host_header";
	/**
	 * Normalized host: lowercased, one trailing FQDN-root dot stripped; bracketed IPv6 literals KEEP their brackets
	 * (`[::1]`) so `decideEgressPolicy` sees the literal shape it fail-closes on.
	 */
	host: string;
	port: number;
	method: string;
}

export interface EgressProxyParseReject {
	ok: false;
	code: EgressProxyParseRejectCode;
	/** Static, audit-safe explanation — never echoes uncontrolled request bytes. */
	detail: string;
}

export type EgressProxyHeadParseResult = EgressProxyParsedTarget | EgressProxyParseReject;

function reject(code: EgressProxyParseRejectCode, detail: string): EgressProxyParseReject {
	return { ok: false, code, detail };
}

/** C0 controls + DEL anywhere in a line (CR/LF are handled as separators before lines reach here). */
function hasControlChars(line: string): boolean {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control bytes is the point.
	return /[\u0000-\u001f\u007f]/.test(line);
}

/** Strict port syntax: decimal, no leading zeros, 1–65535. Returns null on any deviation. */
function parsePort(raw: string): number | null {
	if (!/^[1-9]\d{0,4}$/.test(raw)) {
		return null;
	}
	const port = Number(raw);
	return port >= 1 && port <= 65535 ? port : null;
}

/**
 * Normalize + validate a host token. Named hosts: lowercase, strip one FQDN-root dot, conservative DNS charset,
 * no empty labels, ≤253 chars. Bracketed IPv6: charset-checked, brackets kept (full literal validity is re-checked
 * by the verdict layer's URL parse). Returns null on any anomaly (default-deny).
 */
function normalizeHost(raw: string): string | null {
	const lowered = raw.toLowerCase();
	if (lowered.startsWith("[")) {
		return /^\[(?=[0-9a-f:.]*:)[0-9a-f:.]+\]$/.test(lowered) ? lowered : null;
	}
	const host = lowered.endsWith(".") ? lowered.slice(0, -1) : lowered;
	if (host === "" || host.length > 253) {
		return null;
	}
	if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(host)) {
		return null;
	}
	if (host.split(".").some((label) => label === "")) {
		return null;
	}
	return host;
}

/** Split `host[:port]` / `[v6][:port]` — null on structural anomalies (unbracketed multi-colon, junk after `]`). */
function splitAuthority(authority: string): { rawHost: string; rawPort: string | null } | null {
	if (authority.startsWith("[")) {
		const close = authority.indexOf("]");
		if (close === -1) {
			return null;
		}
		const rawHost = authority.slice(0, close + 1);
		const rest = authority.slice(close + 1);
		if (rest === "") {
			return { rawHost, rawPort: null };
		}
		return rest.startsWith(":") ? { rawHost, rawPort: rest.slice(1) } : null;
	}
	const colon = authority.indexOf(":");
	if (colon === -1) {
		return { rawHost: authority, rawPort: null };
	}
	if (authority.indexOf(":", colon + 1) !== -1) {
		return null; // unbracketed IPv6 / multi-colon authority is ambiguous — refuse
	}
	return { rawHost: authority.slice(0, colon), rawPort: authority.slice(colon + 1) };
}

/** Shared request-line shape gate: single spaces, exactly three non-empty parts, control-free, length-capped. */
function splitRequestLine(line: string): [string, string, string] | EgressProxyParseReject {
	if (line.length > EGRESS_PROXY_MAX_LINE_BYTES) {
		return reject("line_too_long", "request line exceeds the line byte cap");
	}
	if (hasControlChars(line)) {
		return reject("malformed_request_line", "control bytes in the request line");
	}
	const parts = line.split(" ");
	if (parts.length !== 3 || parts.some((part) => part === "")) {
		return reject("malformed_request_line", "expected exactly `METHOD target HTTP/1.x`");
	}
	return [parts[0], parts[1], parts[2]];
}

const HTTP_VERSION_RE = /^HTTP\/1\.[01]$/;

/**
 * Parse a `CONNECT host:port HTTP/1.x` request line into its target. Default-deny on ANY anomaly: non-CONNECT
 * method, missing/invalid port, `userinfo@`, unbracketed IPv6, bad host charset. The line excludes its CRLF.
 */
export function parseConnectRequestLine(line: string): EgressProxyHeadParseResult {
	const parts = splitRequestLine(line);
	if (!Array.isArray(parts)) {
		return parts;
	}
	const [method, authority, version] = parts;
	if (method !== "CONNECT") {
		return reject("unsupported_method", "not a CONNECT request line");
	}
	if (!HTTP_VERSION_RE.test(version)) {
		return reject("malformed_request_line", "unsupported HTTP version (HTTP/1.0 or HTTP/1.1 only)");
	}
	if (authority.includes("@")) {
		return reject("userinfo_in_authority", "userinfo in a CONNECT authority is refused");
	}
	const split = splitAuthority(authority);
	if (split === null) {
		return reject("invalid_host", "CONNECT authority is not a valid host:port");
	}
	if (split.rawPort === null) {
		return reject("missing_port", "CONNECT authority must state an explicit port");
	}
	const port = parsePort(split.rawPort);
	if (port === null) {
		return reject("invalid_port", "CONNECT port must be a plain decimal in 1–65535");
	}
	const host = normalizeHost(split.rawHost);
	if (host === null) {
		return reject("invalid_host", "CONNECT host failed normalization");
	}
	return { ok: true, kind: "connect", host, port, method: "CONNECT" };
}

/**
 * Parse an absolute-form plain-HTTP request line (`GET http://host[:port]/path HTTP/1.x`) into its target
 * (default port 80). Only the `http:` scheme is proxyable in absolute form — https rides CONNECT (§5), everything
 * else is refused. Default-deny on anomalies (userinfo, empty host, bad port).
 */
export function parseAbsoluteFormRequestLine(line: string): EgressProxyHeadParseResult {
	const parts = splitRequestLine(line);
	if (!Array.isArray(parts)) {
		return parts;
	}
	const [method, target, version] = parts;
	if (!/^[A-Z]+$/.test(method) || method === "CONNECT") {
		return reject("unsupported_method", "absolute-form method must be an uppercase non-CONNECT token");
	}
	if (!HTTP_VERSION_RE.test(version)) {
		return reject("malformed_request_line", "unsupported HTTP version (HTTP/1.0 or HTTP/1.1 only)");
	}
	const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(target);
	if (scheme === null) {
		return reject("malformed_request_line", "target is not an absolute-form URL");
	}
	if (scheme[1].toLowerCase() !== "http") {
		return reject("unsupported_scheme", "only http: is proxyable in absolute form (https uses CONNECT)");
	}
	const authority = target.slice(scheme[0].length).split(/[/?#]/, 1)[0];
	if (authority.includes("@")) {
		return reject("userinfo_in_authority", "userinfo in an absolute-form authority is refused");
	}
	let url: URL;
	try {
		url = new URL(target);
	} catch {
		return reject("malformed_request_line", "absolute-form URL failed to parse");
	}
	if (url.hostname === "") {
		return reject("invalid_host", "absolute-form URL has an empty host");
	}
	const port = url.port === "" ? 80 : parsePort(url.port);
	if (port === null) {
		return reject("invalid_port", "absolute-form port must be a plain decimal in 1–65535");
	}
	const host = normalizeHost(url.hostname);
	if (host === null) {
		return reject("invalid_host", "absolute-form host failed normalization");
	}
	return { ok: true, kind: "absolute_form", host, port, method };
}

/** `Host` header value → target (origin-form plain-HTTP fallback, default port 80). */
function parseHostHeaderTarget(value: string, method: string): EgressProxyHeadParseResult {
	if (value.includes("@")) {
		return reject("userinfo_in_authority", "userinfo in a Host header is refused");
	}
	const split = splitAuthority(value);
	if (split === null) {
		return reject("invalid_host", "Host header is not a valid host[:port]");
	}
	const port = split.rawPort === null ? 80 : parsePort(split.rawPort);
	if (port === null) {
		return reject("invalid_port", "Host header port must be a plain decimal in 1–65535");
	}
	const host = normalizeHost(split.rawHost);
	if (host === null) {
		return reject("invalid_host", "Host header host failed normalization");
	}
	return { ok: true, kind: "host_header", host, port, method };
}

/**
 * Parse a full proxy request HEAD (bytes through the CRLFCRLF terminator) into a target, applying the §5
 * host-extraction order: CONNECT authority → absolute-form URL → `Host` header (origin-form fallback).
 *
 * Contract for the I2 reader loop: feed the accumulated bytes; `head_incomplete` means "no terminator yet, still
 * under the cap" (keep reading), any other reject is final. Strict CRLF framing — a bare CR or LF anywhere is a
 * smuggling shape and denies. Header-shape checks (obs-fold, duplicate `Host`) run only on the origin-form path
 * where headers are load-bearing; for CONNECT/absolute-form the request line alone is authoritative.
 */
export function parseHttpConnectHead(head: Buffer | string): EgressProxyHeadParseResult {
	// latin1 is byte-preserving, so the length/charset gates below reason over the raw bytes.
	const text = typeof head === "string" ? head : head.toString("latin1");
	const terminator = text.indexOf("\r\n\r\n");
	if (terminator === -1) {
		return text.length >= EGRESS_PROXY_MAX_HEAD_BYTES
			? reject("head_too_large", "no head terminator within the byte cap")
			: reject("head_incomplete", "head not terminated by CRLFCRLF yet");
	}
	if (terminator + 4 > EGRESS_PROXY_MAX_HEAD_BYTES) {
		return reject("head_too_large", "request head exceeds the byte cap");
	}
	const lines = text.slice(0, terminator).split("\r\n");
	if (lines.some((line) => line.includes("\r") || line.includes("\n"))) {
		return reject("malformed_header", "bare CR or LF inside the head");
	}
	if (lines.some((line) => line.length > EGRESS_PROXY_MAX_LINE_BYTES)) {
		return reject("line_too_long", "a head line exceeds the line byte cap");
	}
	const requestLine = lines[0];
	if (requestLine === undefined || requestLine === "") {
		return reject("malformed_request_line", "empty request line");
	}
	if (requestLine.startsWith("CONNECT ")) {
		return parseConnectRequestLine(requestLine);
	}
	const parts = splitRequestLine(requestLine);
	if (!Array.isArray(parts)) {
		return parts;
	}
	const [method, target, version] = parts;
	if (target.includes("://")) {
		return parseAbsoluteFormRequestLine(requestLine);
	}
	// Origin-form fallback: validate the request line, then extract the (single) Host header.
	if (!/^[A-Z]+$/.test(method) || method === "CONNECT") {
		return reject("unsupported_method", "origin-form method must be an uppercase non-CONNECT token");
	}
	if (!HTTP_VERSION_RE.test(version)) {
		return reject("malformed_request_line", "unsupported HTTP version (HTTP/1.0 or HTTP/1.1 only)");
	}
	if (!target.startsWith("/")) {
		return reject("malformed_request_line", "origin-form target must start with `/`");
	}
	let hostValue: string | null = null;
	for (const line of lines.slice(1)) {
		if (hasControlChars(line)) {
			return reject("malformed_header", "control bytes in a header line");
		}
		if (line.startsWith(" ") || line.startsWith("\t")) {
			return reject("malformed_header", "obs-fold header continuations are refused");
		}
		const colon = line.indexOf(":");
		if (colon <= 0) {
			return reject("malformed_header", "header line without a name:value shape");
		}
		const name = line.slice(0, colon);
		if (/[ \t]/.test(name)) {
			return reject("malformed_header", "whitespace inside a header name is a smuggling shape");
		}
		if (name.toLowerCase() === "host") {
			if (hostValue !== null) {
				return reject("duplicate_host_header", "more than one Host header");
			}
			hostValue = line.slice(colon + 1).trim();
		}
	}
	if (hostValue === null) {
		return reject("missing_host_header", "origin-form request without a Host header");
	}
	return parseHostHeaderTarget(hostValue, method);
}

/**
 * Minimal TLS ClientHello SNI peek (§6 I1; R7 — read the ClientHello, never decrypt). Returns the first
 * `host_name` server_name entry (normalized like every other parsed host), or null when the bytes are not a
 * well-formed first-record ClientHello carrying one. Tolerates truncation ANYWHERE with null — never throws.
 *
 * Deliberate minimalism: only the FIRST TLS record is walked (a ClientHello fragmented across records → null),
 * and every declared length is clamped to the bytes actually present.
 */
export function parseTlsClientHelloSni(record: Uint8Array): string | null {
	// TLS record header: content type 0x16 (handshake), legacy version major 0x03, u16 length.
	if (record.length < 5 || record[0] !== 0x16 || record[1] !== 0x03) {
		return null;
	}
	const recordEnd = Math.min(5 + ((record[3] << 8) | record[4]), record.length);
	let off = 5;
	// Handshake header: type 0x01 (ClientHello), u24 length.
	if (off + 4 > recordEnd || record[off] !== 0x01) {
		return null;
	}
	const bodyEnd = Math.min(off + 4 + ((record[off + 1] << 16) | (record[off + 2] << 8) | record[off + 3]), recordEnd);
	off += 4;
	off += 2 + 32; // legacy_version + random
	if (off + 1 > bodyEnd) {
		return null;
	}
	off += 1 + record[off]; // session_id
	if (off + 2 > bodyEnd) {
		return null;
	}
	off += 2 + ((record[off] << 8) | record[off + 1]); // cipher_suites
	if (off + 1 > bodyEnd) {
		return null;
	}
	off += 1 + record[off]; // compression_methods
	if (off + 2 > bodyEnd) {
		return null;
	}
	const extensionsEnd = Math.min(off + 2 + ((record[off] << 8) | record[off + 1]), bodyEnd);
	off += 2;
	while (off + 4 <= extensionsEnd) {
		const extType = (record[off] << 8) | record[off + 1];
		const extLen = (record[off + 2] << 8) | record[off + 3];
		off += 4;
		if (off + extLen > extensionsEnd) {
			return null; // truncated extension body
		}
		if (extType === 0x0000) {
			return parseServerNameExtensionBody(record, off, off + extLen);
		}
		off += extLen;
	}
	return null;
}

/** server_name extension body: u16 list length, then `{ name_type u8, u16 length, bytes }` entries; host_name = 0. */
function parseServerNameExtensionBody(record: Uint8Array, start: number, end: number): string | null {
	if (start + 2 > end) {
		return null;
	}
	const listEnd = Math.min(start + 2 + ((record[start] << 8) | record[start + 1]), end);
	let off = start + 2;
	while (off + 3 <= listEnd) {
		const nameType = record[off];
		const nameLen = (record[off + 1] << 8) | record[off + 2];
		off += 3;
		if (off + nameLen > listEnd) {
			return null;
		}
		if (nameType === 0x00) {
			if (nameLen === 0) {
				return null;
			}
			let raw = "";
			for (let i = off; i < off + nameLen; i++) {
				raw += String.fromCharCode(record[i]);
			}
			// Same normalization as every parsed host; an IP-literal SNI flows through and the policy layer denies it.
			return normalizeHost(raw);
		}
		off += nameLen;
	}
	return null;
}

/** A parsed proxy identity claim from the request head (F2.5). Not yet validated — just the stated credentials. */
export interface EgressProxyIdentityClaim {
	taskId: string;
	token: string;
}

/**
 * F2.5 — extract the `Proxy-Authorization: Basic <base64(taskId:token)>` claim from a COMPLETE request head.
 * Attribution-only: malformed/absent auth returns null and never affects the target parse or the verdict. The
 * first colon splits taskId from token (task ids never contain colons; tokens may). Case-insensitive header
 * name and scheme per RFC 7235.
 */
export function parseProxyAuthorizationHeader(head: Buffer | string): EgressProxyIdentityClaim | null {
	const text = typeof head === "string" ? head : head.toString("latin1");
	const terminator = text.indexOf("\r\n\r\n");
	const headText = terminator === -1 ? text : text.slice(0, terminator);
	for (const line of headText.split("\r\n").slice(1)) {
		const colon = line.indexOf(":");
		if (colon <= 0) {
			continue;
		}
		if (line.slice(0, colon).trim().toLowerCase() !== "proxy-authorization") {
			continue;
		}
		const value = line.slice(colon + 1).trim();
		const match = /^basic\s+([a-z0-9+/=]+)$/i.exec(value);
		if (!match) {
			return null;
		}
		let decoded: string;
		try {
			decoded = Buffer.from(match[1], "base64").toString("latin1");
		} catch {
			return null;
		}
		const split = decoded.indexOf(":");
		if (split <= 0 || split === decoded.length - 1) {
			return null;
		}
		return { taskId: decoded.slice(0, split), token: decoded.slice(split + 1) };
	}
	return null;
}
