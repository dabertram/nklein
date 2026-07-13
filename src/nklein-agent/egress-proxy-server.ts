import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import type { Duplex } from "node:stream";

import type { AgentRulesetRole, SandboxNetworkPolicy } from "../core/agent-rulesets";
import { DEFAULT_EGRESS_CONFIRM_TIMEOUT_MS, type EgressConfirmQueue } from "../core/egress-confirm-queue";
import {
	buildEgressProxyAuditRecord,
	type EgressProxyAuditRecord,
	type EgressProxyAuditTransport,
	egressProxyTransportForParsedKind,
} from "../core/egress-proxy-audit";
import {
	EGRESS_PROXY_MAX_HEAD_BYTES,
	type EgressProxyHeadParseResult,
	parseHttpConnectHead,
	parseProxyAuthorizationHeader,
} from "../core/egress-proxy-protocol";
import {
	decideProxyVerdict,
	type EgressProxyReasonCode,
	type EgressProxyRoleSnapshot,
	type EgressProxyVerdict,
} from "../core/egress-proxy-verdict";

/**
 * Egress-proxy SERVER (docs/dev/egress-proxy-design.md §5 enforcement flow / §6 I2 — the effectful head atop the pure
 * I1 cores). This is the DEPENDENCY-INJECTED, unit-testable core: EVERY effectful edge — the accept/listen seam, DNS
 * resolution, the upstream dial, the audit sink, the per-role policy source, the clock, the id generator, and the
 * timers — is INJECTED, so the whole §5 state machine runs against fakes with no real sockets. I2b wires the real edges
 * (net.Server bind on the container's internal interface, dns.lookup, net.connect, the JSONL audit store, and the
 * runtime→role-snapshot source); see the I2b hand-off note at the end of this file.
 *
 * Security contract (§3 threat model, R2): the proxy can only OPEN holes — the `--internal` Docker topology is the
 * boundary — so this server FAILS CLOSED on every anomaly (parse reject, resolve/dial failure, timeout, unexpected
 * throw): deny + exactly one audit record + close. It NEVER opens an upstream socket before a final address-checked
 * allow, and dials ONLY a vetted address from the verdict — never re-resolving the name (no TOCTOU, §5 step 4).
 *
 * v1 scope (§5, §7 Q3): CONNECT tunnelling only. A well-formed non-CONNECT request (absolute-form / origin-form plain
 * HTTP) is refused — plain-HTTP forward-proxying is deliberately not enabled in v1 (the design diagram details only the
 * CONNECT 200 + opaque splice path, and R7 keeps the tunnel un-inspected).
 */

/** Exactly the design's §5 step-4 success line — sent only AFTER the upstream dial establishes. */
const CONNECT_ESTABLISHED_RESPONSE = "HTTP/1.1 200 Connection Established\r\n\r\n";

const DEFAULT_HEAD_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

const EMPTY = Buffer.alloc(0);

/** A cancellable one-shot timer — the injected-clock seam so timeouts are deterministic in tests. */
export interface EgressProxyTimerHandle {
	cancel(): void;
}
export type EgressProxyScheduler = (delayMs: number, onFire: () => void) => EgressProxyTimerHandle;

/**
 * The accept/listen seam. Prod wraps `node:net`; tests bypass it entirely and drive
 * {@link EgressProxyServer.handleConnection} with a fake duplex socket.
 */
export interface EgressProxyNetServer {
	listen(port: number, host: string | undefined, onListening: () => void): void;
	close(onClosed: () => void): void;
}
export type EgressProxyNetServerFactory = (onConnection: (socket: Duplex) => void) => EgressProxyNetServer;

/**
 * Which listener a connection arrived on. The proxy runs one listener per role (§4 "one listener port per role"), so the
 * listener knows the role even before the role's policy snapshot resolves — that role is the audit identity when the
 * snapshot is missing (fail-closed to policy `none`).
 */
export interface EgressProxyConnectionContext {
	listenerPort: number;
	role: AgentRulesetRole;
}

export interface EgressProxyServerDeps {
	/** Per-role policy snapshot for a listener, resolved host-side; `null` ⇒ unknown role ⇒ deny `no_egress_policy` (R2). */
	resolveRoleSnapshot: (context: EgressProxyConnectionContext) => EgressProxyRoleSnapshot | null;
	/** DNS seam (prod: dns.lookup all-addresses). §5 step 3 — resolved host-side, then re-vetted (anti-rebind). */
	resolveHost: (hostname: string) => Promise<readonly string[]>;
	/** Upstream dial seam (prod: net.connect). Called ONLY with a vetted address from the verdict, after a final allow. */
	dial: (host: string, port: number) => Promise<Duplex>;
	/** One audit record per attempt (R5). Prod appends the JSONL store; tests collect. */
	auditSink: (record: EgressProxyAuditRecord) => void;
	now?: () => number;
	generateId?: () => string;
	scheduler?: EgressProxyScheduler;
	netServerFactory?: EgressProxyNetServerFactory;
	/** The (port, role) listeners `start()` binds. Empty ⇒ `start()` is a no-op (tests drive `handleConnection`). */
	listeners?: readonly EgressProxyConnectionContext[];
	bindHost?: string;
	maxHeadBytes?: number;
	headTimeoutMs?: number;
	connectTimeoutMs?: number;
	idleTimeoutMs?: number;
	/**
	 * F2.3 (I5): the host↔proxy approval channel. Present ⇒ a `confirm` verdict PARKS on the queue and waits
	 * (bounded by `confirmTimeoutMs`) for an approve/deny bound to attempt+target+role; timeout/deny/expiry all
	 * refuse (fail-closed). Absent ⇒ v1 behavior: confirm is refused immediately.
	 */
	confirmQueue?: EgressConfirmQueue;
	confirmTimeoutMs?: number;
	/**
	 * F2.5: validate a claimed (taskId, token) proxy identity. Present => a valid claim attributes the attempt's
	 * audit record to that task; absent/invalid claims audit unattributed. Attribution-only - never gates.
	 */
	validateTaskIdentity?: (taskId: string, token: string) => boolean;
}

export interface EgressProxyServer {
	start(): Promise<void>;
	stop(): Promise<void>;
	handleConnection(clientSocket: Duplex, context: EgressProxyConnectionContext): Promise<void>;
}

/** The head bytes read from the client, plus any bytes the client pipelined AFTER the CONNECT terminator. */
interface HeadReadResult {
	parsed: EgressProxyHeadParseResult;
	leftover: Buffer;
	/** The raw bytes read for the head (F2.5: parsed separately for the Proxy-Authorization identity claim). */
	rawHead: Buffer;
}

const defaultScheduler: EgressProxyScheduler = (delayMs, onFire) => {
	const handle = setTimeout(onFire, delayMs);
	// Don't let a pending proxy timer keep the host process alive.
	const unrefable = handle as { unref?: () => void };
	if (typeof unrefable.unref === "function") {
		unrefable.unref();
	}
	return {
		cancel: () => {
			clearTimeout(handle);
		},
	};
};

const defaultNetServerFactory: EgressProxyNetServerFactory = (onConnection) => {
	const server = createServer((socket) => {
		onConnection(socket);
	});
	return {
		listen: (port, host, onListening) => {
			server.listen(port, host, onListening);
		},
		close: (onClosed) => {
			server.close(() => {
				onClosed();
			});
		},
	};
};

function safeWrite(socket: Duplex, data: string | Buffer): void {
	try {
		if (!socket.destroyed && socket.writable) {
			socket.write(data);
		}
	} catch {
		// Writing to a socket that died underneath us is not fatal — fail closed; the caller destroys it next.
	}
}

function safeDestroy(socket: Duplex): void {
	try {
		if (!socket.destroyed) {
			socket.destroy();
		}
	} catch {
		// Already torn down — nothing to do.
	}
}

function httpResponse(statusLine: string, body: string): string {
	const length = Buffer.byteLength(body, "utf8");
	return (
		`HTTP/1.1 ${statusLine}\r\n` +
		"Content-Type: text/plain; charset=utf-8\r\n" +
		`Content-Length: ${length}\r\n` +
		"Connection: close\r\n\r\n" +
		body
	);
}

/** Build a proxy-local deny verdict (the server's own refusals — the pure verdict layer owns policy denials). */
function denyVerdict(
	reasonCode: EgressProxyReasonCode,
	reason: string,
	host: string | null,
	port: number | null,
): EgressProxyVerdict {
	return {
		decision: "deny",
		reasonCode,
		reason,
		host,
		port,
		requiresResolvedAddressCheck: false,
		vettedAddresses: null,
	};
}

export function createEgressProxyServer(deps: EgressProxyServerDeps): EgressProxyServer {
	const now = deps.now ?? Date.now;
	const generateId = deps.generateId ?? randomUUID;
	const scheduler = deps.scheduler ?? defaultScheduler;
	const netServerFactory = deps.netServerFactory ?? defaultNetServerFactory;
	const listeners = deps.listeners ?? [];
	const bindHost = deps.bindHost;
	const maxHeadBytes = deps.maxHeadBytes ?? EGRESS_PROXY_MAX_HEAD_BYTES;
	const headTimeoutMs = deps.headTimeoutMs ?? DEFAULT_HEAD_TIMEOUT_MS;
	const connectTimeoutMs = deps.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
	const idleTimeoutMs = deps.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

	const confirmTimeoutMs = deps.confirmTimeoutMs ?? DEFAULT_EGRESS_CONFIRM_TIMEOUT_MS;

	/**
	 * F2.3 (I5): park a confirm-tier attempt on the queue and wait (bounded) for a bound approve/deny.
	 * Resolves true ONLY on a clean approval; deny/expiry/timeout all resolve false (fail-closed).
	 */
	function awaitConfirmDecision(request: { host: string; port: number; role: string }): Promise<boolean> {
		const queue = deps.confirmQueue;
		if (!queue) {
			return Promise.resolve(false);
		}
		const attemptId = generateId();
		queue.enqueue({ attemptId, host: request.host, port: request.port, role: request.role }, now(), confirmTimeoutMs);
		return new Promise<boolean>((resolve) => {
			let settled = false;
			const settle = (approved: boolean): void => {
				if (settled) {
					return;
				}
				settled = true;
				timer.cancel();
				unsubscribe();
				queue.take(attemptId, now()); // consume (one-shot) so the decision can never replay
				resolve(approved);
			};
			const unsubscribe = queue.subscribe(attemptId, (status) => {
				settle(status === "approved");
			});
			const timer = scheduler(confirmTimeoutMs, () => {
				queue.sweep(now()); // expire the entry (audited by the caller's refuse) — fail closed
				settle(false);
			});
		});
	}

	const servers = new Map<number, EgressProxyNetServer>();
	const activeClients = new Set<Duplex>();

	/** Race a promise against an injected-clock deadline (fail closed on timeout). */
	function withDeadline<T>(promise: Promise<T>, delayMs: number): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const timer = scheduler(delayMs, () => {
				reject(new Error("egress-proxy: deadline exceeded"));
			});
			promise.then(
				(value) => {
					timer.cancel();
					resolve(value);
				},
				(error: unknown) => {
					timer.cancel();
					reject(error instanceof Error ? error : new Error("egress-proxy: operation failed"));
				},
			);
		});
	}

	/** §5 step 3: resolve host-side. Timeout / failure / empty ⇒ `[]` ⇒ the verdict layer maps it to `resolve_failure`. */
	async function resolveWithDeadline(hostname: string): Promise<readonly string[]> {
		try {
			return await withDeadline(Promise.resolve(deps.resolveHost(hostname)), connectTimeoutMs);
		} catch {
			return [];
		}
	}

	/** Dial a vetted address. On timeout destroy any socket that arrives late, so a refused attempt never leaks an fd. */
	async function dialWithDeadline(host: string, port: number): Promise<Duplex> {
		const dialPromise = Promise.resolve(deps.dial(host, port));
		try {
			return await withDeadline(dialPromise, connectTimeoutMs);
		} catch (error) {
			dialPromise.then(
				(socket) => {
					safeDestroy(socket);
				},
				() => {
					// Dial rejected as well — nothing to clean up.
				},
			);
			throw error;
		}
	}

	/**
	 * §5 step 1: accumulate the request head across chunks and parse it. Resolves once the parse is TERMINAL (a target or
	 * a final reject) — `head_incomplete` keeps reading until the byte cap. Timeout / early EOF / socket error all resolve
	 * to a reject (fail closed) rather than hanging.
	 */
	function readHead(client: Duplex): Promise<HeadReadResult> {
		return new Promise<HeadReadResult>((resolve) => {
			const chunks: Buffer[] = [];
			let total = 0;
			let done = false;

			const settle = (parsed: EgressProxyHeadParseResult, leftover: Buffer, rawHead: Buffer = EMPTY): void => {
				if (done) {
					return;
				}
				done = true;
				timer.cancel();
				client.removeListener("data", onData);
				client.removeListener("end", onEnd);
				client.removeListener("error", onError);
				client.removeListener("close", onEnd);
				resolve({ parsed, leftover, rawHead });
			};

			const onData = (chunk: Buffer): void => {
				chunks.push(chunk);
				total += chunk.length;
				const buffer = Buffer.concat(chunks);
				const parsed = parseHttpConnectHead(buffer);
				if (!parsed.ok && parsed.code === "head_incomplete") {
					if (total >= maxHeadBytes) {
						// Over the cap with no terminator — refuse rather than accumulate unboundedly (§6 I1 byte limits).
						settle(
							{ ok: false, code: "head_too_large", detail: "no head terminator within the byte cap" },
							EMPTY,
						);
					}
					return;
				}
				// Terminal parse. Stop consuming as head; carry any pipelined tunnel bytes as leftover.
				client.pause();
				let leftover = EMPTY;
				let rawHead = buffer;
				if (parsed.ok) {
					const term = buffer.indexOf("\r\n\r\n");
					if (term !== -1) {
						leftover = buffer.subarray(term + 4);
						rawHead = buffer.subarray(0, term + 4);
					}
				}
				settle(parsed, leftover, rawHead);
			};

			const onEnd = (): void => {
				// Client closed before a full head — parse what arrived (a partial head is `head_incomplete` ⇒ deny).
				settle(parseHttpConnectHead(Buffer.concat(chunks)), EMPTY);
			};

			const onError = (): void => {
				settle({ ok: false, code: "head_incomplete", detail: "the connection errored before a full head" }, EMPTY);
			};

			const timer = scheduler(headTimeoutMs, () => {
				settle({ ok: false, code: "head_incomplete", detail: "the request head timed out" }, EMPTY);
			});

			client.on("data", onData);
			client.once("end", onEnd);
			client.once("error", onError);
			client.once("close", onEnd);
		});
	}

	function handleConnection(client: Duplex, context: EgressProxyConnectionContext): Promise<void> {
		activeClients.add(client);
		const startedAt = now();
		const snapshot = deps.resolveRoleSnapshot(context) ?? undefined;

		let audited = false;
		let attributedTaskId: string | null = null; // F2.5 identity attribution
		let settled = false;
		let idleTimer: EgressProxyTimerHandle | undefined;
		let upstream: Duplex | undefined;
		let bytesToUpstream = 0;
		let bytesToClient = 0;

		return new Promise<void>((resolveDone) => {
			const finish = (): void => {
				if (settled) {
					return;
				}
				settled = true;
				idleTimer?.cancel();
				activeClients.delete(client);
				safeDestroy(client);
				if (upstream !== undefined) {
					safeDestroy(upstream);
				}
				resolveDone();
			};

			const emitAudit = (
				verdict: EgressProxyVerdict,
				transport: EgressProxyAuditTransport,
				resolvedIps: readonly string[] | null,
				executed: boolean,
			): void => {
				if (audited) {
					return;
				}
				audited = true;
				const role = snapshot?.role ?? context.role;
				const policy: SandboxNetworkPolicy = snapshot?.networkPolicy ?? "none";
				const target =
					verdict.host !== null && verdict.port !== null ? `${verdict.host}:${verdict.port}` : "unparsed";
				deps.auditSink(
					buildEgressProxyAuditRecord({
						id: generateId(),
						recordedAt: now(),
						role,
						policy,
						listenerPort: context.listenerPort,
						transport,
						target,
						verdict,
						resolvedIps,
						taskId: attributedTaskId,
						executed,
						bytesIn: bytesToClient,
						bytesOut: bytesToUpstream,
						durationMs: Math.max(0, now() - startedAt),
					}),
				);
			};

			/** §5 step 2/3 refusal: a 403 (or 502) body, the single audit record, and close. */
			const refuse = (
				verdict: EgressProxyVerdict,
				transport: EgressProxyAuditTransport,
				resolvedIps: readonly string[] | null,
			): void => {
				safeWrite(client, httpResponse("403 Forbidden", `${verdict.reason}\n`));
				emitAudit(verdict, transport, resolvedIps, false);
				finish();
			};

			/** §5 step 4: 200, then opaque bidirectional splice to the dialed vetted address (no interception, R7). */
			const startTunnel = (
				established: Duplex,
				verdict: EgressProxyVerdict,
				transport: EgressProxyAuditTransport,
				resolvedIps: readonly string[] | null,
				leftover: Buffer,
			): void => {
				safeWrite(client, CONNECT_ESTABLISHED_RESPONSE);
				if (leftover.length > 0) {
					bytesToUpstream += leftover.length;
					safeWrite(established, leftover);
				}

				const resetIdle = (): void => {
					idleTimer?.cancel();
					idleTimer = scheduler(idleTimeoutMs, () => {
						emitAudit(verdict, transport, resolvedIps, true);
						finish();
					});
				};

				let openSides = 2;
				const onSideClosed = (): void => {
					openSides -= 1;
					if (openSides <= 0) {
						emitAudit(verdict, transport, resolvedIps, true);
						finish();
					}
				};
				const onSideError = (): void => {
					safeDestroy(client);
					safeDestroy(established);
				};

				client.on("data", (chunk: Buffer) => {
					bytesToUpstream += chunk.length;
					resetIdle();
				});
				established.on("data", (chunk: Buffer) => {
					bytesToClient += chunk.length;
					resetIdle();
				});
				client.once("error", onSideError);
				established.once("error", onSideError);
				client.once("close", onSideClosed);
				established.once("close", onSideClosed);

				client.pipe(established);
				established.pipe(client);
				resetIdle();
				client.resume();
			};

			void (async (): Promise<void> => {
				try {
					const head = await readHead(client);
					const parsed = head.parsed;
					// F2.5: attribution-only identity — a VALID claimed (taskId, token) attributes this attempt's audit.
					const identityClaim = parseProxyAuthorizationHeader(head.rawHead);
					if (identityClaim && deps.validateTaskIdentity?.(identityClaim.taskId, identityClaim.token)) {
						attributedTaskId = identityClaim.taskId;
					}
					const transport: EgressProxyAuditTransport = parsed.ok
						? egressProxyTransportForParsedKind(parsed.kind)
						: "connect";

					// §5 step 2: decide WITHOUT addresses (no socket may open yet).
					const verdict1 = decideProxyVerdict(parsed, snapshot);
					if (verdict1.decision === "deny") {
						refuse(verdict1, transport, null);
						return;
					}
					if (verdict1.decision === "confirm" && !deps.confirmQueue) {
						// §5 step 2 (v1): without the I5 approval channel, confirm is refused (audited decision "confirm").
						refuse(verdict1, transport, null);
						return;
					}
					// F2.3: with the confirm queue present, a provisional confirm falls through — the FINAL
					// (address-checked) verdict below is the one that parks on the approval channel.
					// decision === "allow": provisional (requiresResolvedAddressCheck) — parsed is necessarily ok here.
					if (!parsed.ok) {
						refuse(denyVerdict("parse_error", "Unparseable request head.", null, null), transport, null);
						return;
					}
					if (parsed.kind !== "connect") {
						// v1 scope: CONNECT tunnelling only (§5). Refuse well-formed plain-HTTP forward-proxy requests.
						refuse(
							denyVerdict(
								"parse_error",
								"The v1 egress proxy tunnels CONNECT requests only; plain-HTTP forward-proxying is not enabled.",
								parsed.host,
								parsed.port,
							),
							transport,
							null,
						);
						return;
					}

					// §5 step 3: resolve host-side, then RE-decide WITH the addresses (anti-rebind).
					const resolved = await resolveWithDeadline(parsed.host);
					const resolvedIps = resolved.length > 0 ? resolved : null;
					const verdict2 = decideProxyVerdict(parsed, snapshot, resolved);
					if (verdict2.decision === "deny") {
						refuse(verdict2, transport, resolvedIps);
						return;
					}
					if (verdict2.decision === "confirm") {
						const approved = deps.confirmQueue
							? await awaitConfirmDecision({ host: parsed.host, port: parsed.port, role: context.role })
							: false;
						if (!approved) {
							refuse(verdict2, transport, resolvedIps);
							return;
						}
						// Approved: proceed exactly like an allow — the verdict's vetted addresses still bind the dial.
					}

					// Final allow. §5 step 4: dial ONE vetted address from the verdict — never re-resolve (no TOCTOU).
					const vetted = verdict2.vettedAddresses?.[0];
					if (vetted === undefined) {
						refuse(
							denyVerdict("resolve_failure", "No vetted address to connect to.", parsed.host, parsed.port),
							transport,
							resolvedIps,
						);
						return;
					}

					let established: Duplex;
					try {
						established = await dialWithDeadline(vetted, parsed.port);
					} catch {
						// Egress WAS permitted by policy; the tunnel simply failed to establish (executed stays false).
						safeWrite(
							client,
							httpResponse("502 Bad Gateway", "The egress proxy could not reach the upstream host.\n"),
						);
						emitAudit(
							{ ...verdict2, reason: `${verdict2.reason} The upstream connection could not be established.` },
							transport,
							resolvedIps,
							false,
						);
						finish();
						return;
					}

					if (settled) {
						// Torn down while dialing — destroy the late upstream, don't leak.
						safeDestroy(established);
						return;
					}
					upstream = established;
					startTunnel(established, verdict2, transport, resolvedIps, head.leftover);
				} catch {
					// Fail closed on any unexpected error — one audit record, then close.
					if (!audited) {
						safeWrite(client, httpResponse("403 Forbidden", "The egress proxy refused the request.\n"));
						emitAudit(
							denyVerdict("parse_error", "The connection failed before a verdict could be reached.", null, null),
							"connect",
							null,
							false,
						);
					}
					finish();
				}
			})();
		});
	}

	async function start(): Promise<void> {
		for (const listener of listeners) {
			if (servers.has(listener.listenerPort)) {
				continue;
			}
			const server = netServerFactory((socket) => {
				void handleConnection(socket, listener);
			});
			servers.set(listener.listenerPort, server);
			await new Promise<void>((resolve) => {
				server.listen(listener.listenerPort, bindHost, resolve);
			});
		}
	}

	async function stop(): Promise<void> {
		const closing = [...servers.values()].map(
			(server) =>
				new Promise<void>((resolve) => {
					server.close(resolve);
				}),
		);
		servers.clear();
		await Promise.all(closing);
		for (const client of activeClients) {
			safeDestroy(client);
		}
		activeClients.clear();
	}

	return { start, stop, handleConnection };
}

/*
 * I2b hand-off — what this DI core deliberately leaves unwired (all injected here as seams):
 *   - `netServerFactory` + `listeners`: the real `node:net` bind on the proxy container's internal interface, one
 *     listener per role (§4 ports 3128/3129/3130). `start()` already binds via the factory; I2b supplies the ports.
 *   - `resolveHost`: `dns.lookup(host, { all: true })` on the host, returning every A/AAAA address (§5 step 3).
 *   - `dial`: `net.connect(vettedIp, port)` returning the connected socket (called only post-allow, on a vetted IP).
 *   - `resolveRoleSnapshot`: the runtime→role→tier `{ networkPolicy, allowlist, requirePerActionApproval }` source.
 *   - `auditSink`: append to the RW-mounted JSONL store (`~/.nklein/sandbox-audit/`, mirror chat-egress store; §6 I1
 *     named `src/nklein-agent/sandbox-egress-attempt-audit-store.ts`, not yet built).
 *   - the DNS stub (`node:dgram` NXDOMAIN + audit) and the Docker `--internal` topology are separate I2b pieces.
 */
