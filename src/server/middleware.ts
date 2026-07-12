import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import {
	getKanbanRuntimeAdvertisedHost,
	getKanbanRuntimeHost,
	getKanbanRuntimePort,
	isKanbanRemoteHost,
	isKanbanRuntimeHttps,
} from "../core/runtime-endpoint";

export type CorsDecision =
	| { kind: "allow"; origin: string | null }
	| { kind: "preflight"; origin: string }
	| { kind: "reject"; origin: string };

export interface CorsGateInput {
	method: string | undefined;
	originHeader: string | undefined;
	/**
	 * Every origin the app is legitimately served from. One entry on a loopback bind; on a
	 * remote (LAN-serving) bind the app is reachable via loopback (the desktop shell), the
	 * bound host, AND the advertised public host — a browser sends whichever it loaded.
	 */
	allowedOrigins: ReadonlySet<string>;
}

const isDev = process.env.NODE_ENV === "development";

export function evaluateCors(input: CorsGateInput): CorsDecision {
	const origin = input.originHeader || null;
	const isPreflight = input.method === "OPTIONS";

	if (origin === null) {
		return { kind: "allow", origin: null };
	}

	const isDevServer = isDev && (origin === "http://localhost:4173" || origin === "http://127.0.0.1:4173");

	if (!input.allowedOrigins.has(origin) && !isDevServer) {
		return { kind: "reject", origin };
	}

	if (isPreflight) {
		return { kind: "preflight", origin };
	}

	return { kind: "allow", origin };
}

export interface HostGateInput {
	hostHeader: string | undefined;
	allowedHosts: ReadonlySet<string>;
}

export type HostDecision = { kind: "allow" } | { kind: "reject"; host: string | null };

export function evaluateHost(input: HostGateInput): HostDecision {
	if (!input.hostHeader) {
		return { kind: "reject", host: null };
	}

	if (!input.allowedHosts.has(input.hostHeader.toLowerCase())) {
		return { kind: "reject", host: input.hostHeader };
	}

	return { kind: "allow" };
}

export function getAllowedHostHeaders(): ReadonlySet<string> {
	const port = getKanbanRuntimePort();
	const boundHost = getKanbanRuntimeHost().toLowerCase();
	const advertisedHost = getKanbanRuntimeAdvertisedHost().toLowerCase();
	const allowed = new Set<string>();
	const addHostPort = (host: string) => {
		const normalized = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
		allowed.add(`${normalized}:${port}`);
	};

	if (isKanbanRemoteHost()) {
		addHostPort(boundHost);
		addHostPort(advertisedHost);
		// Same-machine access stays first-class on a remote bind: the desktop shell loads the
		// UI via 127.0.0.1 even while the runtime listens on a wildcard, and a host-machine
		// browser uses localhost. This does not weaken the DNS-rebinding defence — a rebinding
		// attack needs the attacker's *domain* in this set, and loopback literals never are.
		addHostPort("localhost");
		addHostPort("127.0.0.1");
		addHostPort("::1");
		return allowed;
	}

	addHostPort("localhost");
	addHostPort("127.0.0.1");
	if (isDev) {
		// Vite's default dev server host:port
		allowed.add("localhost:4173");
		allowed.add("127.0.0.1:4173");
	}
	return allowed;
}

/**
 * Every origin the served app may legitimately run under — the CORS mirror of
 * {@link getAllowedHostHeaders} (scheme × allowed hosts). On a loopback bind this is the
 * classic single-origin set; on a remote bind it additionally covers the bound host, the
 * advertised public host, and loopback (the desktop shell / host-machine browser).
 */
export function getAllowedRuntimeOrigins(): ReadonlySet<string> {
	const scheme = isKanbanRuntimeHttps() ? "https" : "http";
	const origins = new Set<string>();
	for (const host of getAllowedHostHeaders()) {
		origins.add(`${scheme}://${host}`);
	}
	return origins;
}

const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].join(", ");
const ALLOWED_HEADERS = ["Authorization", "Content-Type", "X-Nklein-Workspace-Id", "X-Kanban-Workspace-Id"].join(", ");
const PREFLIGHT_MAX_AGE_SECONDS = "600";

function applyAllowedOriginHeaders(res: ServerResponse, origin: string): void {
	res.setHeader("Access-Control-Allow-Origin", origin);
	res.setHeader("Vary", "Origin");
	res.setHeader("Access-Control-Allow-Credentials", "true");
}

function rejectRequest(res: ServerResponse, message: string): { end: boolean } {
	res.writeHead(403, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	res.end(JSON.stringify({ error: message }));
	return { end: true };
}

function rejectSocket(socket: Duplex): { end: boolean } {
	socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
	socket.destroy();
	return { end: true };
}

export function handleHttpRequest(req: IncomingMessage, res: ServerResponse): { end: boolean } {
	const hostDecision = evaluateHost({
		hostHeader: req.headers.host,
		allowedHosts: getAllowedHostHeaders(),
	});
	if (hostDecision.kind === "reject") {
		return rejectRequest(res, "Host not allowed.");
	}

	const corsDecision = evaluateCors({
		method: req.method,
		originHeader: req.headers.origin,
		allowedOrigins: getAllowedRuntimeOrigins(),
	});

	switch (corsDecision.kind) {
		case "allow": {
			if (corsDecision.origin !== null) {
				applyAllowedOriginHeaders(res, corsDecision.origin);
			}
			return { end: false };
		}
		case "preflight": {
			applyAllowedOriginHeaders(res, corsDecision.origin);
			res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
			res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
			res.setHeader("Access-Control-Max-Age", PREFLIGHT_MAX_AGE_SECONDS);
			res.writeHead(204);
			res.end();
			return { end: true };
		}
		case "reject": {
			return rejectRequest(res, "Origin not allowed.");
		}
	}
}

export function handleSocketUpgrade(request: IncomingMessage, socket: Duplex): { end: boolean } {
	const hostDecision = evaluateHost({
		hostHeader: request.headers.host,
		allowedHosts: getAllowedHostHeaders(),
	});
	if (hostDecision.kind === "reject") {
		return rejectSocket(socket);
	}

	const corsDecision = evaluateCors({
		method: request.method,
		originHeader: request.headers.origin,
		allowedOrigins: getAllowedRuntimeOrigins(),
	});
	if (corsDecision.kind === "reject") {
		return rejectSocket(socket);
	}

	return { end: false };
}
