import { randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { connect as netConnect } from "node:net";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { AGENT_RULESET_ROLES, type AgentCapabilityRulesetConfig, type AgentRulesetRole } from "../core/agent-rulesets";
import { createEgressConfirmQueue, type EgressConfirmQueue } from "../core/egress-confirm-queue";
import type { EgressProxyAuditRecord } from "../core/egress-proxy-audit";
import { buildEgressProxyDnsAuditRecord, type EgressProxyDnsAuditRecord } from "../core/egress-proxy-dns-audit";
import { createEgressTaskIdentityRegistry } from "../core/egress-task-identity";
import { isTruthyEnv } from "../core/env-flag";
import { createEgressConfirmControlServer, type EgressConfirmControlServer } from "./egress-confirm-control-server";
import { createEgressProxyDnsStub, type EgressProxyDnsSocketFactory } from "./egress-proxy-dns-stub";
import {
	allowlistForRoleFromScoped,
	parseRoleScopedEgressAllowlist,
	resolveEgressProxyRoleSnapshot,
} from "./egress-proxy-role-snapshot";
import {
	createEgressProxyServer,
	type EgressProxyConnectionContext,
	type EgressProxyNetServerFactory,
	type EgressProxyScheduler,
} from "./egress-proxy-server";
import { createEgressProxyAuditSink } from "./sandbox-egress-attempt-audit-store";
import { createEgressProxyDnsAuditSink } from "./sandbox-egress-dns-audit-store";

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
/** Opt-in comma-separated roles whose otherwise-allowed egress requires a one-shot confirmation. */
export const EGRESS_CONFIRM_ROLES_ENV = "NKLEIN_EGRESS_CONFIRM_ROLES";
/** Host-generated bearer token protecting the container control listener from self-approval by agent sandboxes. */
export const EGRESS_CONFIRM_CONTROL_TOKEN_ENV = "NKLEIN_EGRESS_CONFIRM_CONTROL_TOKEN";
/** Production manager flag: require a valid issued task credential on every proxy request. */
export const EGRESS_REQUIRE_TASK_IDENTITY_ENV = "NKLEIN_EGRESS_REQUIRE_TASK_IDENTITY";
/** Container-side control listener; Docker publishes it to a random HOST-loopback port. */
export const EGRESS_CONFIRM_CONTROL_PORT = 3131;
/**
 * The proxy is the implementation of the `allowlist` network tier. The shared sandbox pool currently resolves one
 * global network policy, so every proxy listener must start from that tier; defaulting this process to the product's
 * general `fully_open` tier would bypass every configured host list.
 */
export const EGRESS_PROXY_CAPABILITY_CONFIG: AgentCapabilityRulesetConfig = Object.freeze({ globalPreset: "medium" });

export interface EgressProxyRuntimeDeps {
	/** Resolved capability ruleset (role → tier → networkPolicy). Absent ⇒ built-in default tier. */
	capabilityConfig?: AgentCapabilityRulesetConfig;
	/** Injected per-role allowlist source — the I3 config seam. Unset for a role ⇒ empty (default-deny, fail-closed). */
	allowlistForRole?: (role: AgentRulesetRole) => readonly string[];
	/** Injected per-role per-action-approval source (I3+/I5). */
	requirePerActionApprovalForRole?: (role: AgentRulesetRole) => boolean;
	/** F2.3b queue shared by the proxy waiter and the authenticated HTTP control leaf. */
	confirmQueue?: EgressConfirmQueue;
	/** F2.3b/F2.5b effectful control leaf for confirms plus task-credential issue/revoke. */
	confirmControlServer?: EgressConfirmControlServer;
	/** F2.5b authenticated per-task proxy identity validation. */
	validateTaskIdentity?: (taskId: string, token: string) => boolean;
	requireTaskIdentity?: boolean;
	/** Root dir for the audit JSONL (RW mount). Default: the store's `~/.nklein/sandbox-audit`. */
	auditRootDir?: string;
	/** Host resolution seam. Default: `dns.lookup(host, { all: true })` → the resolved addresses. */
	resolveHost?: (hostname: string) => Promise<readonly string[]>;
	/** Upstream dial seam. Default: `net.connect`, resolved once the socket connects. */
	dial?: (host: string, port: number) => Promise<Duplex>;
	/** Audit sink seam. Default: the JSONL append store. */
	auditSink?: (record: EgressProxyAuditRecord) => void;
	/**
	 * Best-effort observer for each DNS-stub query name (§4 injection signal), in addition to the durable anonymous
	 * DNS-denial audit. A shared UDP/network namespace cannot truthfully identify one task or role.
	 */
	onDnsQuery?: (queryName: string) => void;
	/** Durable anonymous DNS-denial trail; task attribution is impossible in the shared container network namespace. */
	dnsAuditSink?: (record: EgressProxyDnsAuditRecord) => void;
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
	const dnsAuditSink = deps.dnsAuditSink ?? createEgressProxyDnsAuditSink({ rootDir: deps.auditRootDir });
	const now = deps.now ?? Date.now;
	const generateId = deps.generateId ?? randomUUID;

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
		confirmQueue: deps.confirmQueue,
		validateTaskIdentity: deps.validateTaskIdentity,
		requireTaskIdentity: deps.requireTaskIdentity,
	});

	// The DNS stub answers NXDOMAIN to every query (§4 exfil-channel closure, risk Q1). Query names reach both the
	// optional observer and a separate durable trail that explicitly records the shared-namespace attribution limit.
	const dnsStub = createEgressProxyDnsStub({
		socketFactory: deps.dnsSocketFactory,
		onQuery: (queryName, rinfo) => {
			deps.onDnsQuery?.(queryName);
			dnsAuditSink(
				buildEgressProxyDnsAuditRecord({
					id: generateId(),
					queryName,
					sourceAddress: rinfo.address,
					sourcePort: rinfo.port,
					recordedAt: now(),
				}),
			);
		},
	});
	const dnsStubPort = deps.dnsStubPort ?? EGRESS_PROXY_DNS_STUB_PORT;

	return {
		listeners,
		async start(): Promise<void> {
			await server.start();
			await dnsStub.start(dnsStubPort);
			await deps.confirmControlServer?.start();
		},
		async stop(): Promise<void> {
			await deps.confirmControlServer?.stop();
			await dnsStub.stop();
			await server.stop();
		},
	};
}

/** Strict parser: a typo must fail the proxy closed instead of silently disabling a requested approval boundary. */
export function parseEgressConfirmRoles(raw: string | undefined): ReadonlySet<AgentRulesetRole> {
	const roles = new Set<AgentRulesetRole>();
	for (const token of (raw ?? "")
		.split(",")
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean)) {
		if (token === "all") {
			for (const role of AGENT_RULESET_ROLES) roles.add(role);
			continue;
		}
		if (!(AGENT_RULESET_ROLES as readonly string[]).includes(token)) {
			throw new Error(`invalid egress-confirm role: ${token}`);
		}
		roles.add(token as AgentRulesetRole);
	}
	return roles;
}

/** Build the production runtime from process env + defaults and start it (the bundle entry calls this). */
export async function runEgressProxyMain(): Promise<EgressProxyRuntime> {
	// §6 I3: the host manager hands the resolved global allowlist in via NKLEIN_EGRESS_PROXY_ALLOWLIST (set by
	// egress-proxy-lifecycle → startEgressProxyContainer from the persisted `sandboxEgressAllowlist` config).
	// `parseEgressAllowlist` is the canonical parser; v1 binds ONE global allowlist to EVERY role (per-role lists later).
	// Absent ⇒ empty ⇒ default-deny (fail-closed, R2).
	// F2.4: the same env now carries optional ROLE-SCOPED entries (`worker:host`); plain entries stay global,
	// so every v1 string binds byte-identically. Each role's listener resolves ONLY its own snapshot — a worker
	// can never use an architect-scoped host.
	const scoped = parseRoleScopedEgressAllowlist(process.env[EGRESS_PROXY_ALLOWLIST_ENV]);
	const hasEntries = scoped.global.length > 0 || Object.keys(scoped.byRole).length > 0;
	const confirmRoles = parseEgressConfirmRoles(process.env[EGRESS_CONFIRM_ROLES_ENV]);
	const taskIdentityRequired = isTruthyEnv(process.env[EGRESS_REQUIRE_TASK_IDENTITY_ENV]);
	const controlRequired = confirmRoles.size > 0 || taskIdentityRequired;
	const controlToken = process.env[EGRESS_CONFIRM_CONTROL_TOKEN_ENV]?.trim() ?? "";
	if (controlRequired && controlToken.length < 32) {
		throw new Error("egress proxy requires a host-generated control token");
	}
	const confirmQueue = controlRequired ? createEgressConfirmQueue() : undefined;
	const taskIdentities = taskIdentityRequired ? createEgressTaskIdentityRegistry() : undefined;
	const confirmControlServer = confirmQueue
		? createEgressConfirmControlServer({
				queue: confirmQueue,
				taskIdentities,
				token: controlToken,
				port: EGRESS_CONFIRM_CONTROL_PORT,
			})
		: undefined;
	const runtime = createEgressProxyRuntime({
		capabilityConfig: EGRESS_PROXY_CAPABILITY_CONFIG,
		auditRootDir: process.env.NKLEIN_EGRESS_PROXY_AUDIT_DIR?.trim() || undefined,
		allowlistForRole: hasEntries ? allowlistForRoleFromScoped(scoped) : undefined,
		requirePerActionApprovalForRole: confirmRoles.size > 0 ? (role) => confirmRoles.has(role) : undefined,
		confirmQueue,
		confirmControlServer,
		validateTaskIdentity: taskIdentities?.validate,
		requireTaskIdentity: taskIdentityRequired,
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
