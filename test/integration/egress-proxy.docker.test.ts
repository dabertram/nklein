import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EgressProxyAuditRecord } from "../../src/core/egress-proxy-audit";
import { isTruthyEnv } from "../../src/core/env-flag";
import { EGRESS_PROXY_ROLE_PORTS } from "../../src/nklein-agent/egress-proxy-entrypoint";
import {
	type EgressProxyRunDocker,
	egressNetworkName,
	egressProxyContainerName,
	ensureEgressNetwork,
	probeEgressProxyHealthy,
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
const DENIED_HOST = "denied.example.org";
const WORKER_PORT = EGRESS_PROXY_ROLE_PORTS.worker;
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

/** Run a curl inside a throwaway container on the internal egress network, optionally with the proxy env. */
function curlInSandbox(networkName: string, url: string, proxyEnv: Record<string, string> | null): number {
	const envArgs = proxyEnv ? Object.entries(proxyEnv).flatMap(([k, v]) => ["-e", `${k}=${v}`]) : [];
	const noproxy = proxyEnv ? [] : ["--noproxy", "*"];
	const result = spawnSync(
		"docker",
		[
			"run",
			"--rm",
			"--network",
			networkName,
			"--cap-drop",
			"ALL",
			...envArgs,
			resolveAgentSandboxImageName(),
			"curl",
			"-sS",
			"--max-time",
			"15",
			"-o",
			"/dev/null",
			...noproxy,
			url,
		],
		{ encoding: "utf8", timeout: 60_000 },
	);
	return result.status ?? 1;
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

const gate = probeEgressGate();

if (gate.ready) {
	describe.sequential("egress-proxy Docker integration", () => {
		const networkName = egressNetworkName(NAMESPACE);
		const containerName = egressProxyContainerName(NAMESPACE);

		it("allows a listed host, denies an unlisted one, and has no route without the proxy", async () => {
			try {
				await teardownEgressProxy(runDocker, { containerName, networkName });
				await ensureEgressNetwork(runDocker, networkName);
				await startEgressProxyContainer(runDocker, {
					containerName,
					networkName,
					bundleHostPath: gate.bundlePath,
					env: {
						NKLEIN_EGRESS_PROXY_ALLOWLIST: ALLOWED_HOST,
						NKLEIN_EGRESS_PROXY_AUDIT_DIR: AUDIT_DIR_IN_PROXY,
					},
				});

				expect(await probeEgressProxyHealthy(runDocker, { containerName, port: WORKER_PORT })).toBe(true);
				const ip = await resolveEgressProxyInternalIp(runDocker, containerName, networkName);
				expect(ip).toBeTruthy();
				const proxyEnv = {
					HTTP_PROXY: `http://${ip}:${WORKER_PORT}`,
					HTTPS_PROXY: `http://${ip}:${WORKER_PORT}`,
					NO_PROXY: "",
				};

				// Allowlisted host connects through the proxy.
				expect(curlInSandbox(networkName, `https://${ALLOWED_HOST}`, proxyEnv)).toBe(0);
				// Unlisted host is refused by the proxy (non-zero curl exit).
				expect(curlInSandbox(networkName, `https://${DENIED_HOST}`, proxyEnv)).not.toBe(0);
				// Without the proxy env, the `--internal` network gives no route (fail-closed backstop).
				expect(curlInSandbox(networkName, `https://${ALLOWED_HOST}`, null)).not.toBe(0);

				const audit = readProxyAudit(containerName);
				const allowRecord = audit.find((r) => r.host === ALLOWED_HOST && r.decision === "allow");
				const denyRecord = audit.find((r) => r.host === DENIED_HOST && r.decision === "deny");
				expect(allowRecord?.executed).toBe(true);
				expect(denyRecord?.executed).toBe(false);
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
