import type { AgentRulesetRole } from "../core/agent-rulesets";
import { isTruthyEnv } from "../core/env-flag";
import { EGRESS_PROXY_ROLE_PORTS } from "./egress-proxy-entrypoint";
import { type AgentSandboxEgressWiring, resolveAgentSandboxImageName } from "./nklein-agent-sandbox-docker";

/**
 * Host-side Docker LIFECYCLE for the §5.L egress proxy (docs/dev/egress-proxy-design.md §4 topology, §6 I2, risk
 * table). Composes the already-built cores into a runnable proxy behind a DEFAULT-OFF flag: create the `--internal`
 * egress network, start the dual-homed proxy container from the app-shipped bundle, HEALTH-probe it, and derive the
 * `allowlist` sandbox wiring + per-exec proxy env.
 *
 * THREE HARD INVARIANTS, each with fail-closed branches §-cited below (todo §1 prime directives + the design risk table):
 *  - DEFAULT OFF (§7): everything gates on `NKLEIN_SANDBOX_EGRESS_PROXY`. Off ⇒ ZERO docker calls, `allowlist` stays
 *    `--network none` (the wiring resolves to `egressProxyAvailable:false`).
 *  - FAIL CLOSED (R2): `allowlist` gets the internal network ONLY when the proxy is confirmed HEALTHY (a real probe).
 *    Any failure — unavailable/unhealthy/no-IP/throw — resolves to `egressProxyAvailable:false` ⇒ `--network none`.
 *  - LOCAL-ONLY (R1): reuse `nklein/agent-sandbox` (no runtime image pull); the proxy runs the app-shipped bundle
 *    bind-mounted read-only.
 *
 * The command RUNNER is the one effectful edge, injected as `runDocker` (same shape as `AgentSandboxManager.runDocker`),
 * so all orchestration is unit-testable against a fake docker.
 */

export const EGRESS_PROXY_ENABLED_ENV = "NKLEIN_SANDBOX_EGRESS_PROXY";
/**
 * HOST path to the app-shipped, esbuild-bundled proxy entrypoint the proxy container bind-mounts read-only (the host
 * end of {@link EGRESS_PROXY_BUNDLE_CONTAINER_PATH}). I2b interim seam: there is no app bundling step yet, so the
 * manager reads the bundle path from this env var; ABSENT ⇒ the manager fail-closes availability to `false` (no
 * bundle ⇒ no proxy ⇒ `allowlist` stays `--network none`). A real bundling step (§6 I4) will supply it automatically.
 */
export const EGRESS_PROXY_BUNDLE_HOST_PATH_ENV = "NKLEIN_EGRESS_PROXY_BUNDLE";
export const EGRESS_NETWORK_LABEL = "nklein.kind=egress";
export const EGRESS_PROXY_CONTAINER_LABEL = "nklein.kind=egress-proxy";
const EGRESS_NETWORK_PREFIX = "nklein-egress-int";
const EGRESS_PROXY_CONTAINER_PREFIX = "nklein-egress-proxy";
/** Where the app-shipped proxy bundle is bind-mounted read-only inside the proxy container. */
export const EGRESS_PROXY_BUNDLE_CONTAINER_PATH = "/opt/nklein/egress-proxy/entrypoint.mjs";
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_DOCKER_TIMEOUT_MS = 30_000;

/** The `docker` command result (mirrors `AgentSandboxExecResult`): a non-zero/failed run yields a result, never throws. */
export interface EgressProxyDockerResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

/** The injected effectful runner — same signature as `AgentSandboxManager.runDocker`. */
export type EgressProxyRunDocker = (
	argv: readonly string[],
	options?: { timeoutMs?: number },
) => Promise<EgressProxyDockerResult>;

/** DEFAULT-OFF gate (§7). Truthy `NKLEIN_SANDBOX_EGRESS_PROXY` ⇒ enabled; anything else ⇒ the byte-identical old path. */
export function isEgressProxyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return isTruthyEnv(env[EGRESS_PROXY_ENABLED_ENV]);
}

/** Namespaced egress-network name (`nklein-egress-int[-<ns>]`), matching the sandbox pool's namespacing discipline. */
export function egressNetworkName(namespace?: string): string {
	const ns = namespace?.trim();
	return ns ? `${EGRESS_NETWORK_PREFIX}-${ns}` : EGRESS_NETWORK_PREFIX;
}

/** Namespaced proxy-container name (`nklein-egress-proxy[-<ns>]`). */
export function egressProxyContainerName(namespace?: string): string {
	const ns = namespace?.trim();
	return ns ? `${EGRESS_PROXY_CONTAINER_PREFIX}-${ns}` : EGRESS_PROXY_CONTAINER_PREFIX;
}

/**
 * Idempotently ensure the `--internal` egress network exists. `--internal` is the SECURITY BOUNDARY (§3/§4): no NAT, no
 * default gateway — the dual-homed proxy is the ONLY route out, so a container that ignores the proxy simply has no
 * route (fail-closed, R2). Inspect first (idempotent); create only when absent; tolerate a create race by re-inspecting.
 */
export async function ensureEgressNetwork(runDocker: EgressProxyRunDocker, name: string): Promise<void> {
	const existing = await runDocker(["network", "inspect", name], { timeoutMs: DEFAULT_DOCKER_TIMEOUT_MS });
	if (existing.exitCode === 0) {
		return;
	}
	const created = await runDocker(["network", "create", "--internal", "--label", EGRESS_NETWORK_LABEL, name], {
		timeoutMs: DEFAULT_DOCKER_TIMEOUT_MS,
	});
	if (created.exitCode === 0) {
		return;
	}
	// Create can lose a race with a concurrent instance ("network with name ... already exists"); re-inspect to confirm.
	const recheck = await runDocker(["network", "inspect", name], { timeoutMs: DEFAULT_DOCKER_TIMEOUT_MS });
	if (recheck.exitCode !== 0) {
		throw new Error(`egress-proxy: failed to create internal network ${name}: ${created.stderr.trim()}`);
	}
}

export interface StartEgressProxyContainerOptions {
	containerName: string;
	networkName: string;
	/** Host path to the app-shipped, esbuild-bundled proxy entry — bind-mounted READ-ONLY (R1, local-only bundle). */
	bundleHostPath: string;
	image?: string;
	memoryMb?: number;
	cpus?: number;
	/** Extra `-e KEY=VALUE` env for the proxy process (e.g. the audit-dir override, or the pre-I3 allowlist bootstrap). */
	env?: Record<string, string>;
}

/**
 * Start the dual-homed proxy container: created on the `--internal` egress network, then also connected to `bridge` so
 * it — and ONLY it — can reach the internet (§4 "DUAL-HOMED: internal+bridge"). Runs the app-shipped bundle under
 * `--entrypoint node`, bind-mounted read-only, with the SAME hardening flags as the sandbox (`--cap-drop ALL`,
 * `no-new-privileges`, `--read-only`, tmpfs, pids/mem/cpu caps) and the `nklein.kind=egress-proxy` reap label.
 */
export async function startEgressProxyContainer(
	runDocker: EgressProxyRunDocker,
	options: StartEgressProxyContainerOptions,
): Promise<void> {
	const image = options.image ?? resolveAgentSandboxImageName();
	const args = [
		"run",
		"-d",
		"--name",
		options.containerName,
		"--label",
		EGRESS_PROXY_CONTAINER_LABEL,
		"--network",
		options.networkName,
		// Same unconditional hardening as the sandbox — only outbound reachability differs (design §4, R1/Q5).
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--pids-limit",
		"512",
		"--memory",
		`${options.memoryMb ?? 256}m`,
		"--cpus",
		String(options.cpus ?? 1),
		"--read-only",
		"--tmpfs",
		"/tmp:noexec,nosuid,size=64m",
		"--mount",
		`type=bind,src=${options.bundleHostPath},dst=${EGRESS_PROXY_BUNDLE_CONTAINER_PATH},readonly`,
		"--user",
		"0:0",
		...Object.entries(options.env ?? {}).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
		"--entrypoint",
		"node",
		image,
		EGRESS_PROXY_BUNDLE_CONTAINER_PATH,
	];
	const run = await runDocker(args, { timeoutMs: DEFAULT_DOCKER_TIMEOUT_MS });
	if (run.exitCode !== 0) {
		throw new Error(`egress-proxy: failed to start proxy container ${options.containerName}: ${run.stderr.trim()}`);
	}
	// Second home: attach the bridge leg so the proxy has a route out. Without it the proxy is trapped on `--internal`
	// and every allow would fail — but that fails CLOSED (no egress), never open.
	const connect = await runDocker(["network", "connect", "bridge", options.containerName], {
		timeoutMs: DEFAULT_DOCKER_TIMEOUT_MS,
	});
	if (connect.exitCode !== 0) {
		throw new Error(
			`egress-proxy: failed to dual-home ${options.containerName} onto bridge: ${connect.stderr.trim()}`,
		);
	}
}

/**
 * REAL health probe (§6 I2 "health-check before any allowlist sandbox starts"): exec inside the proxy and TCP-connect
 * to a role listener port. "Started" is NOT "healthy" — only an accepted connection proves the listeners are bound.
 * Fail-closed: any non-zero exit, timeout, or throw ⇒ `false` (the caller then keeps `allowlist` on `--network none`).
 */
export async function probeEgressProxyHealthy(
	runDocker: EgressProxyRunDocker,
	options: { containerName: string; port?: number; timeoutMs?: number },
): Promise<boolean> {
	const port = options.port ?? EGRESS_PROXY_ROLE_PORTS.worker;
	const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
	// RETRY-connect INSIDE the single exec until the deadline: `docker run -d` returns before the container's node
	// process boots + binds its listeners, so a one-shot connect fails fast on ECONNREFUSED (live-found on the
	// low-power fleet, 2026-07-12). Re-attempting every 150ms within `timeoutMs` waits out the startup delay without
	// paying a fresh `docker exec` per attempt; still fail-closed — an unreachable proxy exits 1 at the deadline.
	const script =
		`const P=${port},D=Date.now()+${timeoutMs};` +
		`function t(){const s=require("net").connect(P,"127.0.0.1");` +
		`s.on("connect",()=>{s.destroy();process.exit(0)});` +
		`s.on("error",()=>{s.destroy();Date.now()>D?process.exit(1):setTimeout(t,150)})}t();`;
	try {
		const result = await runDocker(["exec", options.containerName, "node", "-e", script], {
			timeoutMs: timeoutMs + 2_000,
		});
		return result.exitCode === 0;
	} catch {
		// Fail-closed (R2): a probe that cannot even run means "not confirmed healthy" ⇒ no egress network.
		return false;
	}
}

/** Resolve the proxy's IP ON THE INTERNAL network (the address sandboxes point `HTTP(S)_PROXY` at). Null on any failure. */
export async function resolveEgressProxyInternalIp(
	runDocker: EgressProxyRunDocker,
	containerName: string,
	networkName: string,
): Promise<string | null> {
	const format = `{{with index .NetworkSettings.Networks ${JSON.stringify(networkName)}}}{{.IPAddress}}{{end}}`;
	const result = await runDocker(["inspect", "-f", format, containerName], { timeoutMs: DEFAULT_DOCKER_TIMEOUT_MS });
	if (result.exitCode !== 0) {
		return null;
	}
	const ip = result.stdout.trim();
	return ip.length > 0 ? ip : null;
}

/** Whether the proxy container currently exists AND is running (idempotent-start guard). */
export async function isEgressProxyRunning(runDocker: EgressProxyRunDocker, containerName: string): Promise<boolean> {
	const result = await runDocker(["inspect", "-f", "{{.State.Running}}", containerName], {
		timeoutMs: DEFAULT_DOCKER_TIMEOUT_MS,
	});
	return result.exitCode === 0 && result.stdout.trim() === "true";
}

/** Best-effort teardown (startup/shutdown reaping): remove the proxy container and its `--internal` network. */
export async function teardownEgressProxy(
	runDocker: EgressProxyRunDocker,
	options: { containerName: string; networkName: string },
): Promise<void> {
	await runDocker(["rm", "-f", options.containerName], { timeoutMs: DEFAULT_DOCKER_TIMEOUT_MS }).catch(() => null);
	await runDocker(["network", "rm", options.networkName], { timeoutMs: DEFAULT_DOCKER_TIMEOUT_MS }).catch(() => null);
}

/** The confirmed-availability result the sandbox wiring is derived from. */
export interface EgressProxyAvailability {
	available: boolean;
	networkName: string;
	internalIp: string | null;
}

export interface EnsureEgressProxyOptions {
	namespace?: string;
	bundleHostPath: string;
	image?: string;
	env?: NodeJS.ProcessEnv;
	probeTimeoutMs?: number;
}

/**
 * The top-level lifecycle: gate → ensure network → start (idempotent) → HEALTH-probe → resolve IP. Returns availability
 * that the sandbox wiring turns into a `--network` choice.
 *
 * Fail-closed at EVERY branch (R2): DEFAULT-OFF ⇒ no docker calls at all; any error ensuring/starting/probing, an
 * unhealthy probe, or a missing internal IP ⇒ `available:false`. `available:true` requires BOTH a healthy probe AND a
 * resolved internal IP — a proxy we cannot address is not a usable route, so we never over-grant.
 */
export async function ensureEgressProxyAvailable(
	runDocker: EgressProxyRunDocker,
	options: EnsureEgressProxyOptions,
): Promise<EgressProxyAvailability> {
	const networkName = egressNetworkName(options.namespace);
	const containerName = egressProxyContainerName(options.namespace);
	// DEFAULT-OFF (§7): return immediately with NO docker interaction — byte-identical to the pre-proxy world.
	if (!isEgressProxyEnabled(options.env)) {
		return { available: false, networkName, internalIp: null };
	}
	try {
		await ensureEgressNetwork(runDocker, networkName);
		if (!(await isEgressProxyRunning(runDocker, containerName))) {
			// Clear any dead/exited leftover of the same name before a fresh start (idempotent restart).
			await runDocker(["rm", "-f", containerName], { timeoutMs: DEFAULT_DOCKER_TIMEOUT_MS }).catch(() => null);
			await startEgressProxyContainer(runDocker, {
				containerName,
				networkName,
				bundleHostPath: options.bundleHostPath,
				image: options.image,
			});
		}
		const healthy = await probeEgressProxyHealthy(runDocker, {
			containerName,
			timeoutMs: options.probeTimeoutMs,
		});
		if (!healthy) {
			// FAIL CLOSED (R2): started-but-not-healthy is treated as unavailable ⇒ allowlist stays `--network none`.
			return { available: false, networkName, internalIp: null };
		}
		const internalIp = await resolveEgressProxyInternalIp(runDocker, containerName, networkName);
		if (!internalIp) {
			// FAIL CLOSED (R2): a healthy proxy we cannot address is not a usable route.
			return { available: false, networkName, internalIp: null };
		}
		return { available: true, networkName, internalIp };
	} catch {
		// FAIL CLOSED (R2): ANY orchestration error ⇒ no egress network; the tier degrades to fully-offline, never open.
		return { available: false, networkName, internalIp: null };
	}
}

/**
 * Derive the sandbox `--network` wiring from proxy availability (the keystone fail-closed mapping). Available ⇒ the
 * `allowlist` container joins the internal egress network; unavailable ⇒ `egressProxyAvailable:false`, which
 * `resolveAgentSandboxNetworkArgs` maps to `--network none` — exactly the pre-proxy behavior (R2, §4).
 */
export function resolveSandboxEgressWiring(availability: EgressProxyAvailability): AgentSandboxEgressWiring {
	if (availability.available && availability.internalIp) {
		return { egressProxyAvailable: true, egressNetworkName: availability.networkName };
	}
	return { egressProxyAvailable: false };
}

/**
 * The per-`docker exec` proxy env for a role (§4 "env is injected per docker exec", mirroring the `-e KEY=VALUE` MCP
 * precedent). `NO_PROXY` is empty so NOTHING bypasses the proxy. Only produced when the proxy is available — callers
 * gate on `resolveSandboxEgressWiring(...).egressProxyAvailable`.
 */
export function buildEgressProxyExecEnv(internalIp: string, role: AgentRulesetRole): Record<string, string> {
	const url = `http://${internalIp}:${EGRESS_PROXY_ROLE_PORTS[role]}`;
	return { HTTP_PROXY: url, HTTPS_PROXY: url, NO_PROXY: "" };
}

/** The same proxy env flattened to `docker exec` `-e KEY=VALUE` argv fragments (mirrors the manager's `envArgs` path). */
export function buildEgressProxyExecEnvArgs(internalIp: string, role: AgentRulesetRole): string[] {
	return Object.entries(buildEgressProxyExecEnv(internalIp, role)).flatMap(([key, value]) => [
		"-e",
		`${key}=${value}`,
	]);
}
