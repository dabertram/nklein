import { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import type { EgressProxyAuditRecord } from "../../../src/core/egress-proxy-audit";
import type { EgressProxyRoleSnapshot } from "../../../src/core/egress-proxy-verdict";
import {
	createEgressProxyServer,
	type EgressProxyConnectionContext,
	type EgressProxyNetServerFactory,
	type EgressProxyScheduler,
	type EgressProxyServerDeps,
} from "../../../src/nklein-agent/egress-proxy-server";

/**
 * §5 enforcement-flow coverage for the DI egress-proxy server (docs/dev/egress-proxy-design.md §6 I2a). Every effectful
 * edge is faked: a duplex `FakeSocket` for client + upstream, a fake DNS resolver, a fake dialer, a manual scheduler.
 */

/** A duplex whose writes are captured and whose readable side the test drives via `feed`/`eof`. */
class FakeSocket extends Duplex {
	public readonly writes: Buffer[] = [];

	_read(): void {
		// Test pushes bytes explicitly via feed(); nothing to pull.
	}

	_write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
		this.writes.push(Buffer.from(chunk));
		callback();
	}

	written(): string {
		return Buffer.concat(this.writes).toString("latin1");
	}

	feed(data: string | Buffer): void {
		this.push(Buffer.from(data));
	}

	eof(): void {
		this.push(null);
	}
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
async function flush(times = 5): Promise<void> {
	for (let i = 0; i < times; i += 1) {
		await tick();
	}
}

const WORKER_CTX: EgressProxyConnectionContext = { listenerPort: 3129, role: "worker" };

function makeSnapshot(over: Partial<EgressProxyRoleSnapshot> = {}): EgressProxyRoleSnapshot {
	return { role: "worker", networkPolicy: "allowlist", allowlist: ["example.com"], ...over };
}

function createManualScheduler(): { scheduler: EgressProxyScheduler; fireAll: () => void } {
	const timers = new Set<{ fire: () => void }>();
	const scheduler: EgressProxyScheduler = (_delayMs, onFire) => {
		const entry = { fire: onFire };
		timers.add(entry);
		return {
			cancel: () => {
				timers.delete(entry);
			},
		};
	};
	return {
		scheduler,
		fireAll: () => {
			for (const entry of [...timers]) {
				timers.delete(entry);
				entry.fire();
			}
		},
	};
}

interface HarnessOptions {
	snapshot?: EgressProxyRoleSnapshot | null;
	resolveHost?: (hostname: string) => Promise<readonly string[]>;
	dial?: (host: string, port: number) => Promise<Duplex>;
	depsOverride?: Partial<EgressProxyServerDeps>;
}

interface Harness {
	deps: EgressProxyServerDeps;
	audits: EgressProxyAuditRecord[];
	resolveCalls: string[];
	dialCalls: Array<{ host: string; port: number }>;
	upstream: FakeSocket;
	fireAll: () => void;
}

function buildHarness(options: HarnessOptions = {}): Harness {
	const audits: EgressProxyAuditRecord[] = [];
	const resolveCalls: string[] = [];
	const dialCalls: Array<{ host: string; port: number }> = [];
	const upstream = new FakeSocket();
	const { scheduler, fireAll } = createManualScheduler();
	const snapshot = options.snapshot === undefined ? makeSnapshot() : options.snapshot;
	let idCounter = 0;

	const deps: EgressProxyServerDeps = {
		resolveRoleSnapshot: () => snapshot,
		resolveHost: async (hostname) => {
			resolveCalls.push(hostname);
			return options.resolveHost ? options.resolveHost(hostname) : ["93.184.216.34"];
		},
		dial: async (host, port) => {
			dialCalls.push({ host, port });
			return options.dial ? options.dial(host, port) : upstream;
		},
		auditSink: (record) => {
			audits.push(record);
		},
		now: () => 1000,
		generateId: () => {
			idCounter += 1;
			return `id-${idCounter}`;
		},
		scheduler,
		...options.depsOverride,
	};

	return { deps, audits, resolveCalls, dialCalls, upstream, fireAll };
}

describe("createEgressProxyServer — §5 enforcement flow", () => {
	it("allow → 200 Connection Established, then bytes splice both ways to the vetted IP", async () => {
		const h = buildHarness();
		const server = createEgressProxyServer(h.deps);
		const client = new FakeSocket();

		const done = server.handleConnection(client, WORKER_CTX);
		await flush();
		client.feed("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com\r\n\r\n");
		await flush();

		expect(client.written()).toContain("HTTP/1.1 200 Connection Established");
		// §5 step 4: dialed the vetted RESOLVED address (never the name), on the requested port.
		expect(h.dialCalls).toEqual([{ host: "93.184.216.34", port: 443 }]);

		client.feed("client->server payload");
		await flush();
		h.upstream.feed("server->client reply");
		await flush();

		expect(h.upstream.written()).toContain("client->server payload");
		expect(client.written()).toContain("server->client reply");

		client.eof();
		h.upstream.eof();
		await done;

		expect(h.audits).toHaveLength(1);
		const record = h.audits[0];
		expect(record.decision).toBe("allow");
		expect(record.executed).toBe(true);
		expect(record.host).toBe("example.com");
		expect(record.port).toBe(443);
		expect(record.transport).toBe("connect");
		expect(record.role).toBe("worker");
		expect(record.policy).toBe("allowlist");
		expect(record.listenerPort).toBe(3129);
		expect(record.resolvedIps).toEqual(["93.184.216.34"]);
		expect(record.bytesOut).toBe("client->server payload".length);
		expect(record.bytesIn).toBe("server->client reply".length);
	});

	it("performs the two-phase resolve: resolve the name, then dial the vetted resolved IP", async () => {
		const h = buildHarness({ resolveHost: async () => ["93.184.216.34"] });
		const server = createEgressProxyServer(h.deps);
		const client = new FakeSocket();

		const done = server.handleConnection(client, WORKER_CTX);
		await flush();
		client.feed("CONNECT example.com:443 HTTP/1.1\r\n\r\n");
		await flush();

		expect(h.resolveCalls).toEqual(["example.com"]);
		expect(h.dialCalls).toEqual([{ host: "93.184.216.34", port: 443 }]);

		client.eof();
		h.upstream.eof();
		await done;
	});

	it("deny on empty allowlist → 403 + audit, and NO resolve, NO dial (pre-resolution deny)", async () => {
		const h = buildHarness({ snapshot: makeSnapshot({ allowlist: [] }) });
		const server = createEgressProxyServer(h.deps);
		const client = new FakeSocket();

		const done = server.handleConnection(client, WORKER_CTX);
		await flush();
		client.feed("CONNECT blocked.example.net:443 HTTP/1.1\r\n\r\n");
		await done;

		expect(client.written()).toContain("HTTP/1.1 403 Forbidden");
		expect(h.resolveCalls).toEqual([]);
		expect(h.dialCalls).toEqual([]);
		expect(h.audits).toHaveLength(1);
		expect(h.audits[0].decision).toBe("deny");
		expect(h.audits[0].reasonCode).toBe("not_on_allowlist");
		expect(h.audits[0].host).toBe("blocked.example.net");
		expect(h.audits[0].executed).toBe(false);
	});

	it("deny on a disallowed host (not on a non-empty allowlist) → 403 + audit, NO dial", async () => {
		const h = buildHarness({ snapshot: makeSnapshot({ allowlist: ["allowed.example.com"] }) });
		const server = createEgressProxyServer(h.deps);
		const client = new FakeSocket();

		const done = server.handleConnection(client, WORKER_CTX);
		await flush();
		client.feed("CONNECT other.example.org:443 HTTP/1.1\r\n\r\n");
		await done;

		expect(h.dialCalls).toEqual([]);
		expect(h.audits).toHaveLength(1);
		expect(h.audits[0].decision).toBe("deny");
		expect(h.audits[0].reasonCode).toBe("not_on_allowlist");
	});

	it("malformed head → deny parse_error, NO dial", async () => {
		const h = buildHarness();
		const server = createEgressProxyServer(h.deps);
		const client = new FakeSocket();

		const done = server.handleConnection(client, WORKER_CTX);
		await flush();
		client.feed("NOT-A-VALID-REQUEST-LINE\r\n\r\n");
		await done;

		expect(client.written()).toContain("403 Forbidden");
		expect(h.dialCalls).toEqual([]);
		expect(h.audits).toHaveLength(1);
		expect(h.audits[0].decision).toBe("deny");
		expect(h.audits[0].reasonCode).toBe("parse_error");
	});

	it("private-IP resolution → deny resolved_private_ip; resolve IS called, dial is NOT (anti-rebind)", async () => {
		const h = buildHarness({ resolveHost: async () => ["10.0.0.5"] });
		const server = createEgressProxyServer(h.deps);
		const client = new FakeSocket();

		const done = server.handleConnection(client, WORKER_CTX);
		await flush();
		client.feed("CONNECT example.com:443 HTTP/1.1\r\n\r\n");
		await done;

		expect(h.resolveCalls).toEqual(["example.com"]);
		expect(h.dialCalls).toEqual([]);
		expect(client.written()).toContain("403 Forbidden");
		expect(h.audits).toHaveLength(1);
		expect(h.audits[0].decision).toBe("deny");
		expect(h.audits[0].reasonCode).toBe("resolved_private_ip");
		expect(h.audits[0].resolvedIps).toEqual(["10.0.0.5"]);
	});

	it("a mixed public+private resolution is condemned as a whole (fail-closed), NO dial", async () => {
		const h = buildHarness({ resolveHost: async () => ["93.184.216.34", "192.168.1.9"] });
		const server = createEgressProxyServer(h.deps);
		const client = new FakeSocket();

		const done = server.handleConnection(client, WORKER_CTX);
		await flush();
		client.feed("CONNECT example.com:443 HTTP/1.1\r\n\r\n");
		await done;

		expect(h.dialCalls).toEqual([]);
		expect(h.audits[0].decision).toBe("deny");
		expect(h.audits[0].reasonCode).toBe("resolved_private_ip");
	});

	it("resolution failure → deny resolve_failure, NO dial", async () => {
		const h = buildHarness({
			resolveHost: async () => {
				throw new Error("ENOTFOUND");
			},
		});
		const server = createEgressProxyServer(h.deps);
		const client = new FakeSocket();

		const done = server.handleConnection(client, WORKER_CTX);
		await flush();
		client.feed("CONNECT example.com:443 HTTP/1.1\r\n\r\n");
		await done;

		expect(h.dialCalls).toEqual([]);
		expect(h.audits).toHaveLength(1);
		expect(h.audits[0].decision).toBe("deny");
		expect(h.audits[0].reasonCode).toBe("resolve_failure");
	});

	it("head split across multiple chunks still parses and connects", async () => {
		const h = buildHarness();
		const server = createEgressProxyServer(h.deps);
		const client = new FakeSocket();

		const done = server.handleConnection(client, WORKER_CTX);
		await flush();
		client.feed("CONNECT exa");
		await flush();
		expect(h.dialCalls).toEqual([]); // head_incomplete — keep reading, no action yet

		client.feed("mple.com:443 HTTP/1.1\r\n\r\n");
		await flush();
		expect(client.written()).toContain("200 Connection Established");
		expect(h.dialCalls).toEqual([{ host: "93.184.216.34", port: 443 }]);

		client.eof();
		h.upstream.eof();
		await done;
	});

	it("oversized head (no terminator within the byte cap) → deny, NO dial", async () => {
		const h = buildHarness();
		const server = createEgressProxyServer(h.deps);
		const client = new FakeSocket();

		const done = server.handleConnection(client, WORKER_CTX);
		await flush();
		client.feed(`CONNECT ${"a".repeat(9000)}`); // > 8 KiB, no CRLFCRLF
		await done;

		expect(h.dialCalls).toEqual([]);
		expect(h.audits).toHaveLength(1);
		expect(h.audits[0].decision).toBe("deny");
		expect(h.audits[0].reasonCode).toBe("parse_error");
	});

	it("upstream dial failure → 502 + audit (permitted but executed:false), tunnel not established", async () => {
		const h = buildHarness({
			dial: async () => {
				throw new Error("ECONNREFUSED");
			},
		});
		const server = createEgressProxyServer(h.deps);
		const client = new FakeSocket();

		const done = server.handleConnection(client, WORKER_CTX);
		await flush();
		client.feed("CONNECT example.com:443 HTTP/1.1\r\n\r\n");
		await done;

		expect(h.dialCalls).toEqual([{ host: "93.184.216.34", port: 443 }]);
		expect(client.written()).toContain("502 Bad Gateway");
		expect(client.written()).not.toContain("200 Connection Established");
		expect(h.audits).toHaveLength(1);
		expect(h.audits[0].decision).toBe("allow");
		expect(h.audits[0].executed).toBe(false);
		expect(h.audits[0].reason).toContain("upstream connection could not be established");
	});

	it("missing role snapshot → deny no_egress_policy, audited as the listener role at policy none, NO dial", async () => {
		const h = buildHarness({ snapshot: null });
		const server = createEgressProxyServer(h.deps);
		const client = new FakeSocket();

		const done = server.handleConnection(client, WORKER_CTX);
		await flush();
		client.feed("CONNECT example.com:443 HTTP/1.1\r\n\r\n");
		await done;

		expect(h.dialCalls).toEqual([]);
		expect(client.written()).toContain("403 Forbidden");
		expect(h.audits).toHaveLength(1);
		expect(h.audits[0].decision).toBe("deny");
		expect(h.audits[0].reasonCode).toBe("no_egress_policy");
		expect(h.audits[0].role).toBe("worker");
		expect(h.audits[0].policy).toBe("none");
	});

	it("confirm (requirePerActionApproval) → v1 refuses with 403, audited decision:confirm, NO dial/resolve", async () => {
		const h = buildHarness({ snapshot: makeSnapshot({ requirePerActionApproval: true }) });
		const server = createEgressProxyServer(h.deps);
		const client = new FakeSocket();

		const done = server.handleConnection(client, WORKER_CTX);
		await flush();
		client.feed("CONNECT example.com:443 HTTP/1.1\r\n\r\n");
		await done;

		expect(h.resolveCalls).toEqual([]);
		expect(h.dialCalls).toEqual([]);
		expect(client.written()).toContain("403 Forbidden");
		expect(h.audits).toHaveLength(1);
		expect(h.audits[0].decision).toBe("confirm");
	});

	it("disallowed port → deny disallowed_port, NO dial", async () => {
		const h = buildHarness();
		const server = createEgressProxyServer(h.deps);
		const client = new FakeSocket();

		const done = server.handleConnection(client, WORKER_CTX);
		await flush();
		client.feed("CONNECT example.com:22 HTTP/1.1\r\n\r\n");
		await done;

		expect(h.dialCalls).toEqual([]);
		expect(h.audits).toHaveLength(1);
		expect(h.audits[0].decision).toBe("deny");
		expect(h.audits[0].reasonCode).toBe("disallowed_port");
	});

	it("well-formed non-CONNECT (plain HTTP) request → v1 refuses (CONNECT only), NO resolve/dial", async () => {
		const h = buildHarness({ snapshot: makeSnapshot({ allowlist: ["example.com"] }) });
		const server = createEgressProxyServer(h.deps);
		const client = new FakeSocket();

		const done = server.handleConnection(client, WORKER_CTX);
		await flush();
		client.feed("GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n");
		await done;

		expect(h.resolveCalls).toEqual([]);
		expect(h.dialCalls).toEqual([]);
		expect(client.written()).toContain("403 Forbidden");
		expect(h.audits).toHaveLength(1);
		expect(h.audits[0].decision).toBe("deny");
		expect(h.audits[0].reasonCode).toBe("parse_error");
		expect(h.audits[0].transport).toBe("http");
	});

	it("head read timeout → fail closed (deny), NO dial", async () => {
		const h = buildHarness();
		const server = createEgressProxyServer(h.deps);
		const client = new FakeSocket();

		const done = server.handleConnection(client, WORKER_CTX);
		await flush();
		client.feed("CONNECT exam"); // partial head that never completes
		await flush();
		h.fireAll(); // fire the injected head-read timer
		await done;

		expect(h.dialCalls).toEqual([]);
		expect(h.audits).toHaveLength(1);
		expect(h.audits[0].decision).toBe("deny");
		expect(h.audits[0].reasonCode).toBe("parse_error");
	});

	it("exactly one audit record per attempt, even across full tunnel teardown", async () => {
		const h = buildHarness();
		const server = createEgressProxyServer(h.deps);
		const client = new FakeSocket();

		const done = server.handleConnection(client, WORKER_CTX);
		await flush();
		client.feed("CONNECT example.com:443 HTTP/1.1\r\n\r\n");
		await flush();
		client.feed("payload");
		await flush();
		// tear down via error on one side AND normal eof on the other — must still audit exactly once
		h.upstream.emit("error", new Error("upstream reset"));
		client.eof();
		await done;

		expect(h.audits).toHaveLength(1);
	});

	it("start() binds one listener per role and routes accepted sockets through the verdict flow", async () => {
		let captured: ((socket: Duplex) => void) | undefined;
		const listens: number[] = [];
		const factory: EgressProxyNetServerFactory = (onConnection) => {
			captured = onConnection;
			return {
				listen: (port, _host, onListening) => {
					listens.push(port);
					onListening();
				},
				close: (onClosed) => {
					onClosed();
				},
			};
		};
		const h = buildHarness({ snapshot: makeSnapshot({ allowlist: [] }) });
		const server = createEgressProxyServer({
			...h.deps,
			netServerFactory: factory,
			listeners: [{ listenerPort: 3129, role: "worker" }],
		});

		await server.start();
		expect(listens).toEqual([3129]);
		expect(captured).toBeDefined();

		const client = new FakeSocket();
		captured?.(client);
		await flush();
		client.feed("CONNECT blocked.example.com:443 HTTP/1.1\r\n\r\n");
		await flush();

		expect(h.audits).toHaveLength(1);
		expect(h.audits[0].decision).toBe("deny");
		expect(h.audits[0].listenerPort).toBe(3129);

		await server.stop();
		expect(client.destroyed).toBe(true);
	});
});
