import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EgressProxyAuditRecord } from "../../src/core/egress-proxy-audit";
import type { EgressProxyDnsAuditRecord } from "../../src/core/egress-proxy-dns-audit";
import { buildTaskProxyUrl } from "../../src/core/egress-task-identity";
import { isTruthyEnv } from "../../src/core/env-flag";
import {
	issueEgressTaskIdentity,
	listPendingEgressConfirms,
	resolvePendingEgressConfirm,
	revokeEgressTaskIdentity,
} from "../../src/nklein-agent/egress-confirm-control-client";
import {
	EGRESS_CONFIRM_CONTROL_TOKEN_ENV,
	EGRESS_CONFIRM_ROLES_ENV,
	EGRESS_PROXY_ROLE_PORTS,
	EGRESS_REQUIRE_TASK_IDENTITY_ENV,
} from "../../src/nklein-agent/egress-proxy-entrypoint";
import {
	type EgressProxyRunDocker,
	egressNetworkName,
	egressProxyContainerName,
	ensureEgressNetwork,
	probeEgressProxyHealthy,
	resolveEgressConfirmControlHostPort,
	resolveEgressProxyInternalIp,
	startEgressProxyContainer,
	teardownEgressProxy,
} from "../../src/nklein-agent/egress-proxy-lifecycle";
import { resolveAgentSandboxImageName } from "../../src/nklein-agent/nklein-agent-sandbox";

/**
 * LIVE Docker integration for the egress-proxy I2b lifecycle (docs/dev/egress-proxy-design.md §6 I2 gate). SKIPPED
 * unless BOTH Docker (+ the `nklein/agent-sandbox` image) is present AND the default-off flag `NKLEIN_SANDBOX_EGRESS_PROXY`
 * is truthy — so it never runs (nor fails) in a Docker-less/flag-off CI or worktree. Run it live with:
 *
 *   NKLEIN_SANDBOX_EGRESS_PROXY=1 npx vitest run test/integration/egress-proxy.docker.test.ts
 *
 * It builds the app-shipped proxy bundle, creates the `--internal` network, starts the dual-homed proxy, and asserts the
 * two invariants end-to-end: an ALLOWLISTED host connects (audit `allow`, `executed:true`) and an UNLISTED host is
 * refused (audit `deny`, `executed:false`) — plus that a NON-proxied request has no route (the `--internal` backstop).
 */

const NAMESPACE = "itest";
const ALLOWED_HOST = "example.com";
const DENIED_HOST = "example.org";
const DNS_PROBE_HOST = "taskless-leak.example";
const WORKER_PORT = EGRESS_PROXY_ROLE_PORTS.worker;
const REVIEWER_PORT = EGRESS_PROXY_ROLE_PORTS.reviewer;
const AUDIT_DIR_IN_PROXY = "/tmp/audit";

interface EgressGate {
	ready: boolean;
	reason: string;
	image: string;
	bundlePath: string;
}

/** The effectful runner for the lifecycle helpers — spawns the real `docker` CLI. */
const runDocker: EgressProxyRunDocker = async (argv, options) => {
	const result = spawnSync("docker", [...argv], { encoding: "utf8", timeout: options?.timeoutMs ?? 30_000 });
	return {
		exitCode: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
};

function probeEgressGate(): EgressGate {
	const image = resolveAgentSandboxImageName();
	const bundlePath = join(mkdtempSync(join(tmpdir(), "nklein-egress-bundle-")), "entrypoint.mjs");
	if (!isTruthyEnv(process.env.NKLEIN_SANDBOX_EGRESS_PROXY)) {
		return { ready: false, reason: "NKLEIN_SANDBOX_EGRESS_PROXY is not set (default OFF)", image, bundlePath };
	}
	if (spawnSync("docker", ["version"], { encoding: "utf8" }).status !== 0) {
		return { ready: false, reason: "docker version failed", image, bundlePath };
	}
	if (spawnSync("docker", ["image", "inspect", image], { encoding: "utf8" }).status !== 0) {
		return { ready: false, reason: `image ${image} unavailable; run npm run sandbox:build`, image, bundlePath };
	}
	// Bundle the real entrypoint to a single ESM file the proxy container runs (R1: app-shipped bits, no runtime pull).
	const entry = fileURLToPath(new URL("../../src/nklein-agent/egress-proxy-entrypoint.ts", import.meta.url));
	const build = spawnSync(
		"npx",
		["esbuild", entry, "--bundle", "--platform=node", "--format=esm", "--target=node22", `--outfile=${bundlePath}`],
		{ encoding: "utf8" },
	);
	if (build.status !== 0) {
		return { ready: false, reason: `esbuild bundle failed: ${build.stderr}`, image, bundlePath };
	}
	return { ready: true, reason: "", image, bundlePath };
}

// Fetch a URL from a throwaway sandbox container on the internal egress network, via python3's urllib (the image ships
// node + python3 but NOT curl/wget). When `proxyEnv` is set, its HTTPS_PROXY is used as the CONNECT proxy; when null,
// no proxy is used (a direct attempt, which must fail on the `--internal` network — the fail-closed backstop). Returns
// the process exit code: 0 = the fetch succeeded end-to-end (proxy allowed + egress reached the host).
const PY_HTTP_PROBE =
	"import sys,urllib.request as u\n" +
	"p=sys.argv[1] or None\n" +
	"o=u.build_opener(u.ProxyHandler({'http':p,'https':p} if p else {}))\n" +
	"try:\n o.open(sys.argv[2],timeout=15).read(1);sys.exit(0)\n" +
	"except Exception as e:\n sys.stderr.write(repr(e));sys.exit(1)\n";
function httpGetInSandbox(networkName: string, url: string, proxyEnv: Record<string, string> | null): number {
	const proxyUrl = proxyEnv?.HTTPS_PROXY ?? "";
	const result = spawnSync(
		"docker",
		[
			"run",
			"--rm",
			"--network",
			networkName,
			"--cap-drop",
			"ALL",
			"--entrypoint",
			"python3",
			resolveAgentSandboxImageName(),
			"-c",
			PY_HTTP_PROBE,
			proxyUrl,
			url,
		],
		{ encoding: "utf8", timeout: 60_000 },
	);
	return result.status ?? 1;
}

function httpGetInSandboxAsync(networkName: string, url: string, proxyEnv: Record<string, string>): Promise<number> {
	const proxyUrl = proxyEnv.HTTPS_PROXY ?? "";
	return new Promise((resolve) => {
		const child = spawn(
			"docker",
			[
				"run",
				"--rm",
				"--network",
				networkName,
				"--cap-drop",
				"ALL",
				"--entrypoint",
				"python3",
				resolveAgentSandboxImageName(),
				"-c",
				PY_HTTP_PROBE,
				proxyUrl,
				url,
			],
			{ stdio: "ignore", timeout: 60_000 },
		);
		child.once("error", () => resolve(1));
		child.once("close", (code) => resolve(code ?? 1));
	});
}

const PY_HTTP_STATUS_PROBE =
	"import sys,urllib.request as u\n" +
	"try:\n r=u.urlopen(sys.argv[1],timeout=5);print(r.status)\n" +
	"except u.HTTPError as e:\n print(e.code)\n";

function httpStatusInSandbox(networkName: string, url: string): number | null {
	const result = spawnSync(
		"docker",
		[
			"run",
			"--rm",
			"--network",
			networkName,
			"--cap-drop",
			"ALL",
			"--entrypoint",
			"python3",
			resolveAgentSandboxImageName(),
			"-c",
			PY_HTTP_STATUS_PROBE,
			url,
		],
		{ encoding: "utf8", timeout: 30_000 },
	);
	const status = Number(result.stdout.trim());
	return result.status === 0 && Number.isInteger(status) ? status : null;
}

const PY_DNS_PROBE =
	"import socket,struct,sys\n" +
	"name=sys.argv[2]\n" +
	"q=b''.join(bytes([len(x)])+x.encode() for x in name.split('.'))+b'\\0'\n" +
	"packet=struct.pack('!HHHHHH',1,0x100,1,0,0,0)+q+struct.pack('!HH',1,1)\n" +
	"s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.settimeout(5);s.sendto(packet,(sys.argv[1],53))\n" +
	"response=s.recv(512);sys.exit(0 if response[3]&15==3 else 1)\n";

function dnsQueryIsDeniedInSandbox(networkName: string, proxyIp: string, queryName: string): boolean {
	const result = spawnSync(
		"docker",
		[
			"run",
			"--rm",
			"--network",
			networkName,
			"--cap-drop",
			"ALL",
			"--entrypoint",
			"python3",
			resolveAgentSandboxImageName(),
			"-c",
			PY_DNS_PROBE,
			proxyIp,
			queryName,
		],
		{ encoding: "utf8", timeout: 30_000 },
	);
	return result.status === 0;
}

function readProxyAudit(containerName: string): EgressProxyAuditRecord[] {
	const result = spawnSync("docker", ["exec", containerName, "cat", `${AUDIT_DIR_IN_PROXY}/egress-attempts.jsonl`], {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		return [];
	}
	return result.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as EgressProxyAuditRecord);
}

function readProxyDnsAudit(containerName: string): EgressProxyDnsAuditRecord[] {
	const result = spawnSync(
		"docker",
		["exec", containerName, "cat", `${AUDIT_DIR_IN_PROXY}/egress-dns-queries.jsonl`],
		{
			encoding: "utf8",
		},
	);
	if (result.status !== 0) return [];
	return result.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line) as EgressProxyDnsAuditRecord);
}

async function waitForProxyAudit(containerName: string, minimumRecords: number): Promise<EgressProxyAuditRecord[]> {
	const deadline = Date.now() + 5_000;
	let records = readProxyAudit(containerName);
	while (records.length < minimumRecords && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		records = readProxyAudit(containerName);
	}
	return records;
}

async function waitForProxyDnsAudit(containerName: string): Promise<EgressProxyDnsAuditRecord[]> {
	const deadline = Date.now() + 5_000;
	let records = readProxyDnsAudit(containerName);
	while (records.length === 0 && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		records = readProxyDnsAudit(containerName);
	}
	return records;
}

const gate = probeEgressGate();

if (gate.ready) {
	describe.sequential("egress-proxy Docker integration", () => {
		const networkName = egressNetworkName(NAMESPACE);
		const containerName = egressProxyContainerName(NAMESPACE);

		it("isolates role-scoped hosts, approves one worker CONNECT, and has no direct route", async () => {
			try {
				const controlToken = "d".repeat(64);
				const taskToken = "e".repeat(64);
				const taskId = "docker-live-task";
				await teardownEgressProxy(runDocker, { containerName, networkName });
				await ensureEgressNetwork(runDocker, networkName);
				await startEgressProxyContainer(runDocker, {
					containerName,
					networkName,
					bundleHostPath: gate.bundlePath,
					env: {
						NKLEIN_EGRESS_PROXY_ALLOWLIST: `worker:${ALLOWED_HOST}`,
						NKLEIN_EGRESS_PROXY_AUDIT_DIR: AUDIT_DIR_IN_PROXY,
						[EGRESS_CONFIRM_ROLES_ENV]: "worker",
						[EGRESS_CONFIRM_CONTROL_TOKEN_ENV]: controlToken,
						[EGRESS_REQUIRE_TASK_IDENTITY_ENV]: "1",
					},
					publishConfirmControl: true,
				});

				expect(await probeEgressProxyHealthy(runDocker, { containerName, port: WORKER_PORT })).toBe(true);
				const ip = await resolveEgressProxyInternalIp(runDocker, containerName, networkName);
				expect(ip).toBeTruthy();
				const controlPort = await resolveEgressConfirmControlHostPort(runDocker, containerName);
				expect(controlPort).toBeTruthy();
				const endpoint = { baseUrl: `http://127.0.0.1:${controlPort}`, token: controlToken };
				expect((await fetch(`${endpoint.baseUrl}/egress-confirms`)).status).toBe(401);
				// Host-loopback publishing is not container auth: the sandbox can address the listener, but lacks its token.
				expect(httpStatusInSandbox(networkName, `http://${ip}:3131/egress-confirms`)).toBe(401);
				await issueEgressTaskIdentity(endpoint, { taskId, token: taskToken });
				const workerProxyUrl = buildTaskProxyUrl({
					proxyHost: ip as string,
					proxyPort: WORKER_PORT,
					taskId,
					token: taskToken,
				});
				const reviewerProxyUrl = buildTaskProxyUrl({
					proxyHost: ip as string,
					proxyPort: REVIEWER_PORT,
					taskId,
					token: taskToken,
				});
				const proxyEnv = { HTTP_PROXY: workerProxyUrl, HTTPS_PROXY: workerProxyUrl, NO_PROXY: "" };
				const reviewerProxyEnv = { HTTP_PROXY: reviewerProxyUrl, HTTPS_PROXY: reviewerProxyUrl, NO_PROXY: "" };
				const unauthenticatedProxyEnv = {
					HTTP_PROXY: `http://${ip}:${WORKER_PORT}`,
					HTTPS_PROXY: `http://${ip}:${WORKER_PORT}`,
					NO_PROXY: "",
				};

				// Allowlisted host parks, appears on the host-only control channel, and proceeds after one bound approval.
				const allowedRequest = httpGetInSandboxAsync(networkName, `https://${ALLOWED_HOST}`, proxyEnv);
				let pending = await listPendingEgressConfirms(endpoint);
				const deadline = Date.now() + 15_000;
				while (pending.length === 0 && Date.now() < deadline) {
					await new Promise((resolve) => setTimeout(resolve, 100));
					pending = await listPendingEgressConfirms(endpoint);
				}
				expect(pending).toHaveLength(1);
				expect(pending[0]).toMatchObject({ host: ALLOWED_HOST, port: 443, role: "worker" });
				expect(await resolvePendingEgressConfirm(endpoint, { ...pending[0], approve: true })).toBe("applied");
				expect(await allowedRequest).toBe(0);
				// The same host is absent from the reviewer listener's snapshot and must be denied rather than confirmed.
				expect(httpGetInSandbox(networkName, `https://${ALLOWED_HOST}`, reviewerProxyEnv)).not.toBe(0);
				// Unlisted host is refused by the proxy (non-zero exit).
				expect(httpGetInSandbox(networkName, `https://${DENIED_HOST}`, proxyEnv)).not.toBe(0);
				// Missing auth and a revoked credential both fail before policy evaluation or upstream dial.
				expect(httpGetInSandbox(networkName, `https://${ALLOWED_HOST}`, unauthenticatedProxyEnv)).not.toBe(0);
				await revokeEgressTaskIdentity(endpoint, taskId);
				expect(httpGetInSandbox(networkName, `https://${ALLOWED_HOST}`, proxyEnv)).not.toBe(0);
				// Without the proxy env, the `--internal` network gives no route (fail-closed backstop).
				expect(httpGetInSandbox(networkName, `https://${ALLOWED_HOST}`, null)).not.toBe(0);
				expect(dnsQueryIsDeniedInSandbox(networkName, ip as string, DNS_PROBE_HOST)).toBe(true);
				const dnsAudit = await waitForProxyDnsAudit(containerName);
				expect(dnsAudit.map((record) => record.queryName)).toContain(DNS_PROBE_HOST);
				expect(
					dnsAudit.every(
						(record) =>
							record.decision === "deny" &&
							record.taskId === null &&
							record.attribution === "shared_network_namespace",
					),
				).toBe(true);

				// Audit is emitted when each tunnel closes; the sandbox process can exit just before the proxy's close event.
				const audit = await waitForProxyAudit(containerName, 5);
				const allowRecord = audit.find(
					(r) => r.host === ALLOWED_HOST && r.role === "worker" && r.decision === "confirm",
				);
				const roleDenyRecord = audit.find(
					(r) => r.host === ALLOWED_HOST && r.role === "reviewer" && r.decision === "deny",
				);
				const denyRecord = audit.find(
					(r) => r.host === DENIED_HOST && r.role === "worker" && r.decision === "deny",
				);
				const identityDenials = audit.filter(
					(r) => r.host === ALLOWED_HOST && r.role === "worker" && r.reasonCode === "task_identity_required",
				);
				expect(allowRecord?.executed).toBe(true);
				expect(allowRecord?.taskId).toBe(taskId);
				expect(roleDenyRecord?.executed).toBe(false);
				expect(roleDenyRecord?.taskId).toBe(taskId);
				expect(roleDenyRecord?.reasonCode).toBe("not_on_allowlist");
				expect(denyRecord?.executed).toBe(false);
				expect(denyRecord?.taskId).toBe(taskId);
				expect(denyRecord?.reasonCode).toBe("not_on_allowlist");
				expect(identityDenials).toHaveLength(2);
				expect(identityDenials.every((record) => record.taskId === null && record.executed === false)).toBe(true);
			} finally {
				await teardownEgressProxy(runDocker, { containerName, networkName });
				rmSync(gate.bundlePath, { force: true });
			}
		}, 180_000);
	});
} else {
	describe.skip(`egress-proxy Docker integration (${gate.reason})`, () => {
		it("skipped", () => {
			expect(gate.ready).toBe(false);
		});
	});
}
