import { lookup as dnsLookup } from "node:dns/promises";
import { connect as netConnect } from "node:net";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { AGENT_RULESET_ROLES, type AgentCapabilityRulesetConfig, type AgentRulesetRole } from "../core/agent-rulesets";
import type { EgressProxyAuditRecord } from "../core/egress-proxy-audit";
import { createEgressProxyDnsStub, type EgressProxyDnsSocketFactory } from "./egress-proxy-dns-stub";
import { parseEgressAllowlist, resolveEgressProxyRoleSnapshot } from "./egress-proxy-role-snapshot";
import {
	createEgressProxyServer,
	type EgressProxyConnectionContext,
	type EgressProxyNetServerFactory,
	type EgressProxyScheduler,
} from "./egress-proxy-server";
import { createEgressProxyAuditSink } from "./sandbox-egress-attempt-audit-store";

/**
 * The RUNNABLE egress-proxy process (docs/dev/egress-proxy-design.md §4 topology, §5 flow) — the thin effectful shell
 * that instantiates the dependency-injected I2a `createEgressProxyServer` with REAL seams (one `node:net` listener per
 * role on the §4 ports, `dns.lookup` for host resolution, `net.connect` for the upstream dial, the JSONL audit sink,
 * the pure per-role snapshot resolver) and starts the `node:dgram` DNS stub. It runs INSIDE the dual-homed proxy
 * container; the host lifecycle (network + container) is `egress-proxy-lifecycle.ts`.
 *
 * Every effectful edge is injectable so the WIRING is unit-testable with fakes (assert three listeners bound to the
 * role ports, the role resolver + audit sink wired) without opening a socket. The per-role allowlist SOURCE is an
 * injected seam here (default empty ⇒ default-deny); the real config surface is I3 (§6) — this module invents none.
 */

/** §4: one listener port per role — squid-conventional base 3128, one per fixed role in `AGENT_RULESET_ROLES` order. */
export const EGRESS_PROXY_ROLE_PORTS: Record<AgentRulesetRole, number> = {
	architect: 3128,
	worker: 3129,
	reviewer: 3130,
};

/** The default UDP port the DNS stub binds inside the container (standard DNS). */
export const EGRESS_PROXY_DNS_STUB_PORT = 53;

/**
 * §6 I3: the env var the host manager uses to hand the resolved global host allowlist to the in-container runtime
 * (comma-separated hosts, applied to EVERY role in v1). Set by `startEgressProxyContainer`, read by `runEgressProxyMain`.
 */
export const EGRESS_PROXY_ALLOWLIST_ENV = "NKLEIN_EGRESS_PROXY_ALLOWLIST";

export interface EgressProxyRuntimeDeps {
	/** Resolved capability ruleset (role → tier → networkPolicy). Absent ⇒ built-in default tier. */
	capabilityConfig?: AgentCapabilityRulesetConfig;
	/** Injected per-role allowlist source — the I3 config seam. Unset for a role ⇒ empty (default-deny, fail-closed). */
	allowlistForRole?: (role: AgentRulesetRole) => readonly string[];
	/** Injected per-role per-action-approval source (I3+/I5). */
	requirePerActionApprovalForRole?: (role: AgentRulesetRole) => boolean;
	/** Root dir for the audit JSONL (RW mount). Default: the store's `~/.nklein/sandbox-audit`. */
	auditRootDir?: string;
	/** Host resolution seam. Default: `dns.lookup(host, { all: true })` → the resolved addresses. */
	resolveHost?: (hostname: string) => Promise<readonly string[]>;
	/** Upstream dial seam. Default: `net.connect`, resolved once the socket connects. */
	dial?: (host: string, port: number) => Promise<Duplex>;
	/** Audit sink seam. Default: the JSONL append store. */
	auditSink?: (record: EgressProxyAuditRecord) => void;
	/**
	 * Best-effort observability for each DNS-stub query name (§4 injection signal). NOT the typed JSONL sink: a DNS
	 * query has no role/policy attribution (one shared UDP listener), and the I1 audit record requires both — routing
	 * role-less DNS names into that trail is deferred to the config/schema increment. Default: dropped.
	 */
	onDnsQuery?: (queryName: string) => void;
	/** `node:net` accept/listen seam passthrough (default from the server). Injected as a fake in unit tests. */
	netServerFactory?: EgressProxyNetServerFactory;
	/** `node:dgram` socket seam for the DNS stub. Injected as a fake in unit tests. */
	dnsSocketFactory?: EgressProxyDnsSocketFactory;
	/** DNS stub bind port (default 53). */
	dnsStubPort?: number;
	/** Clock / id / timer passthroughs for the server (optional). */
	now?: () => number;
	generateId?: () => string;
	scheduler?: EgressProxyScheduler;
}

export interface EgressProxyRuntime {
	start(): Promise<void>;
	stop(): Promise<void>;
	/** The (port, role) listeners the server binds — exposed for wiring assertions in unit tests. */
	readonly listeners: readonly EgressProxyConnectionContext[];
}

/** Default host resolver — `dns.lookup(all)` mapped to bare addresses (the verdict layer does the private-IP recheck). */
function defaultResolveHost(hostname: string): Promise<readonly string[]> {
	return dnsLookup(hostname, { all: true }).then((results) => results.map((entry) => entry.address));
}

/** Default upstream dial — `net.connect`, resolving on `connect`, rejecting on the first error (fail-closed dial). */
function defaultDial(host: string, port: number): Promise<Duplex> {
	return new Promise<Duplex>((resolve, reject) => {
		const socket = netConnect(port, host);
		const onError = (error: Error): void => {
			socket.removeListener("connect", onConnect);
			reject(error);
		};
		const onConnect = (): void => {
			socket.removeListener("error", onError);
			resolve(socket);
		};
		socket.once("error", onError);
		socket.once("connect", onConnect);
	});
}

/** The fixed (port, role) listener set the server binds — one per role, in `AGENT_RULESET_ROLES` order. */
export function buildEgressProxyListeners(): EgressProxyConnectionContext[] {
	return AGENT_RULESET_ROLES.map((role) => ({ role, listenerPort: EGRESS_PROXY_ROLE_PORTS[role] }));
}

/**
 * Assemble the runtime: the per-role proxy server + the DNS stub, both over injected (default-real) seams. The role
 * snapshot for a listener is resolved by that listener's `role` (the audit identity is fixed by port, §4), composing
 * the pure `resolveEgressProxyRoleSnapshot` with the injected allowlist source — an unknown role yields `null`, which
 * the server maps to a `no_egress_policy` deny (R2, fail-closed).
 */
export function createEgressProxyRuntime(deps: EgressProxyRuntimeDeps = {}): EgressProxyRuntime {
	const listeners = buildEgressProxyListeners();
	const auditSink = deps.auditSink ?? createEgressProxyAuditSink({ rootDir: deps.auditRootDir });

	const server = createEgressProxyServer({
		resolveRoleSnapshot: (context) =>
			resolveEgressProxyRoleSnapshot(context.role, {
				capabilityConfig: deps.capabilityConfig,
				allowlistForRole: deps.allowlistForRole,
				requirePerActionApprovalForRole: deps.requirePerActionApprovalForRole,
			}),
		resolveHost: deps.resolveHost ?? defaultResolveHost,
		dial: deps.dial ?? defaultDial,
		auditSink,
		now: deps.now,
		generateId: deps.generateId,
		scheduler: deps.scheduler,
		netServerFactory: deps.netServerFactory,
		listeners,
	});

	// The DNS stub answers NXDOMAIN to every query (§4 exfil-channel closure, risk Q1); query names surface on the
	// best-effort `onDnsQuery` observability seam (role-less, so not the typed JSONL trail — see the deps doc).
	const dnsStub = createEgressProxyDnsStub({
		socketFactory: deps.dnsSocketFactory,
		onQuery: deps.onDnsQuery ? (queryName) => deps.onDnsQuery?.(queryName) : undefined,
	});
	const dnsStubPort = deps.dnsStubPort ?? EGRESS_PROXY_DNS_STUB_PORT;

	return {
		listeners,
		async start(): Promise<void> {
			await server.start();
			await dnsStub.start(dnsStubPort);
		},
		async stop(): Promise<void> {
			await dnsStub.stop();
			await server.stop();
		},
	};
}

/** Build the production runtime from process env + defaults and start it (the bundle entry calls this). */
export async function runEgressProxyMain(): Promise<EgressProxyRuntime> {
	// §6 I3: the host manager hands the resolved global allowlist in via NKLEIN_EGRESS_PROXY_ALLOWLIST (set by
	// egress-proxy-lifecycle → startEgressProxyContainer from the persisted `sandboxEgressAllowlist` config).
	// `parseEgressAllowlist` is the canonical parser; v1 binds ONE global allowlist to EVERY role (per-role lists later).
	// Absent ⇒ empty ⇒ default-deny (fail-closed, R2).
	const allowlist = parseEgressAllowlist(process.env[EGRESS_PROXY_ALLOWLIST_ENV]);
	const runtime = createEgressProxyRuntime({
		auditRootDir: process.env.NKLEIN_EGRESS_PROXY_AUDIT_DIR?.trim() || undefined,
		allowlistForRole: allowlist.length > 0 ? () => allowlist : undefined,
	});
	await runtime.start();
	return runtime;
}

// ESM main-module guard: run only when this file is the process entry (a bundled `node egress-proxy-entrypoint.js`),
// never on import (tests import the named factory). Failure exits non-zero so the container is unhealthy ⇒ fail-closed.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	runEgressProxyMain().catch(() => {
		process.exitCode = 1;
	});
}
