import { describe, expect, it } from "vitest";
import {
	buildEgressProxyExecEnv,
	buildEgressProxyExecEnvArgs,
	EGRESS_PROXY_BUNDLE_HOST_PATH_ENV,
	type EgressProxyDockerResult,
	type EgressProxyRunDocker,
	egressNetworkName,
	ensureEgressNetwork,
	ensureEgressProxyAvailable,
	isEgressProxyEnabled,
	resolveEgressProxyBundleHostPath,
	resolveSandboxEgressWiring,
	startEgressProxyContainer,
} from "../../../src/nklein-agent/egress-proxy-lifecycle";

const OK: EgressProxyDockerResult = { exitCode: 0, stdout: "", stderr: "" };
const FAIL: EgressProxyDockerResult = { exitCode: 1, stdout: "", stderr: "boom" };

/** A fake docker: a router maps an argv to a result (default OK), and every call is recorded for assertions. */
function makeDocker(router: (argv: readonly string[]) => EgressProxyDockerResult | undefined): {
	runDocker: EgressProxyRunDocker;
	calls: string[][];
} {
	const calls: string[][] = [];
	const runDocker: EgressProxyRunDocker = async (argv) => {
		calls.push([...argv]);
		return router(argv) ?? OK;
	};
	return { runDocker, calls };
}

const has = (argv: readonly string[], ...needles: string[]): boolean => needles.every((n) => argv.includes(n));

describe("isEgressProxyEnabled — DEFAULT OFF (§7)", () => {
	it("is false when the flag is unset/empty/falsy", () => {
		expect(isEgressProxyEnabled({})).toBe(false);
		expect(isEgressProxyEnabled({ NKLEIN_SANDBOX_EGRESS_PROXY: "" })).toBe(false);
		expect(isEgressProxyEnabled({ NKLEIN_SANDBOX_EGRESS_PROXY: "0" })).toBe(false);
		expect(isEgressProxyEnabled({ NKLEIN_SANDBOX_EGRESS_PROXY: "false" })).toBe(false);
	});
	it("is true only for a truthy flag", () => {
		expect(isEgressProxyEnabled({ NKLEIN_SANDBOX_EGRESS_PROXY: "1" })).toBe(true);
		expect(isEgressProxyEnabled({ NKLEIN_SANDBOX_EGRESS_PROXY: "true" })).toBe(true);
	});
});

describe("isEgressProxyEnabled — env-over-config precedence (§6 I3)", () => {
	it("falls through to the configured value when the env var is unset or blank", () => {
		expect(isEgressProxyEnabled({}, true)).toBe(true);
		expect(isEgressProxyEnabled({}, false)).toBe(false);
		expect(isEgressProxyEnabled({}, undefined)).toBe(false);
		expect(isEgressProxyEnabled({ NKLEIN_SANDBOX_EGRESS_PROXY: "" }, true)).toBe(true);
		expect(isEgressProxyEnabled({ NKLEIN_SANDBOX_EGRESS_PROXY: "   " }, true)).toBe(true);
	});
	it("lets a SET env var win over the config in BOTH directions (real environment wins)", () => {
		// Truthy env forces ON even when the persisted config is false.
		expect(isEgressProxyEnabled({ NKLEIN_SANDBOX_EGRESS_PROXY: "1" }, false)).toBe(true);
		// An explicit falsy env forces OFF even when the persisted config is true.
		expect(isEgressProxyEnabled({ NKLEIN_SANDBOX_EGRESS_PROXY: "0" }, true)).toBe(false);
		expect(isEgressProxyEnabled({ NKLEIN_SANDBOX_EGRESS_PROXY: "false" }, true)).toBe(false);
	});
	it("defaults to false when neither the env var nor the config enables it", () => {
		expect(isEgressProxyEnabled({})).toBe(false);
		expect(isEgressProxyEnabled({}, false)).toBe(false);
	});
});

describe("ensureEgressProxyAvailable — DEFAULT OFF invariant", () => {
	it("flag OFF ⇒ ZERO docker calls and available:false (byte-identical old path)", async () => {
		const docker = makeDocker(() => OK);
		const availability = await ensureEgressProxyAvailable(docker.runDocker, {
			env: {}, // flag unset
			bundleHostPath: "/app/egress-proxy.mjs",
		});
		expect(docker.calls).toEqual([]); // NOTHING touched docker
		expect(availability.available).toBe(false);
		expect(availability.internalIp).toBeNull();
	});
});

describe("resolveSandboxEgressWiring — the keystone fail-closed mapping", () => {
	it("unavailable ⇒ egressProxyAvailable:false (⇒ --network none)", () => {
		expect(resolveSandboxEgressWiring({ available: false, networkName: "n", internalIp: null })).toEqual({
			egressProxyAvailable: false,
		});
	});
	it("available + IP ⇒ join the internal egress network", () => {
		expect(
			resolveSandboxEgressWiring({ available: true, networkName: "nklein-egress-int", internalIp: "172.30.0.2" }),
		).toEqual({ egressProxyAvailable: true, egressNetworkName: "nklein-egress-int" });
	});
	it("available BUT no IP still fails closed (a proxy we cannot address is not a route)", () => {
		expect(resolveSandboxEgressWiring({ available: true, networkName: "n", internalIp: null })).toEqual({
			egressProxyAvailable: false,
		});
	});
});

describe("ensureEgressProxyAvailable — FAIL CLOSED (R2)", () => {
	it("an UNHEALTHY probe ⇒ available:false even though the container started", async () => {
		const docker = makeDocker((argv) => {
			if (has(argv, "network", "inspect")) return OK; // network exists
			if (has(argv, "inspect", "-f", "{{.State.Running}}")) return { exitCode: 0, stdout: "true", stderr: "" };
			if (has(argv, "exec")) return FAIL; // health probe fails
			return OK;
		});
		const availability = await ensureEgressProxyAvailable(docker.runDocker, {
			env: { NKLEIN_SANDBOX_EGRESS_PROXY: "1" },
			bundleHostPath: "/app/egress-proxy.mjs",
		});
		expect(availability.available).toBe(false);
		expect(resolveSandboxEgressWiring(availability)).toEqual({ egressProxyAvailable: false });
	});

	it("an orchestration error (network create + recheck both fail) ⇒ available:false (caught)", async () => {
		const docker = makeDocker((argv) => {
			if (has(argv, "network")) return FAIL; // inspect fails, create fails, recheck fails
			return OK;
		});
		const availability = await ensureEgressProxyAvailable(docker.runDocker, {
			env: { NKLEIN_SANDBOX_EGRESS_PROXY: "1" },
			bundleHostPath: "/app/egress-proxy.mjs",
		});
		expect(availability.available).toBe(false);
	});

	it("healthy probe but empty internal IP ⇒ available:false", async () => {
		const docker = makeDocker((argv) => {
			if (has(argv, "network", "inspect")) return OK;
			if (has(argv, "inspect", "-f", "{{.State.Running}}")) return { exitCode: 0, stdout: "true", stderr: "" };
			if (has(argv, "exec")) return OK; // probe healthy
			if (argv[0] === "inspect") return { exitCode: 0, stdout: "   ", stderr: "" }; // IP resolves empty
			return OK;
		});
		const availability = await ensureEgressProxyAvailable(docker.runDocker, {
			env: { NKLEIN_SANDBOX_EGRESS_PROXY: "1" },
			bundleHostPath: "/app/egress-proxy.mjs",
		});
		expect(availability.available).toBe(false);
	});
});

describe("ensureEgressProxyAvailable — healthy path", () => {
	it("network + start + dual-home + healthy probe + IP ⇒ available:true", async () => {
		const docker = makeDocker((argv) => {
			if (has(argv, "network", "inspect")) return FAIL; // network absent ⇒ create
			if (has(argv, "inspect", "-f", "{{.State.Running}}")) return FAIL; // not running ⇒ start
			if (has(argv, "exec")) return OK; // probe healthy
			if (argv[0] === "inspect") return { exitCode: 0, stdout: "172.30.0.2\n", stderr: "" }; // IP
			return OK;
		});
		const availability = await ensureEgressProxyAvailable(docker.runDocker, {
			env: { NKLEIN_SANDBOX_EGRESS_PROXY: "1" },
			bundleHostPath: "/app/egress-proxy.mjs",
		});
		expect(availability).toEqual({
			available: true,
			networkName: egressNetworkName(),
			internalIp: "172.30.0.2",
		});
		// It created the internal network and dual-homed the proxy onto bridge.
		expect(docker.calls.some((c) => has(c, "network", "create", "--internal"))).toBe(true);
		expect(docker.calls.some((c) => has(c, "network", "connect", "bridge"))).toBe(true);
		// The proxy run used the shared image hardening + read-only bundle mount + reap label.
		const runCall = docker.calls.find((c) => c[0] === "run");
		expect(runCall).toBeDefined();
		expect(has(runCall as string[], "--cap-drop", "ALL", "--read-only", "--entrypoint", "node")).toBe(true);
		expect((runCall as string[]).some((a) => a.includes("nklein.kind=egress-proxy"))).toBe(true);
		expect((runCall as string[]).some((a) => a.includes("readonly") && a.includes("egress-proxy.mjs"))).toBe(true);
	});
});

describe("ensureEgressNetwork — idempotent", () => {
	it("does NOT create when the network already exists", async () => {
		const docker = makeDocker((argv) => (has(argv, "network", "inspect") ? OK : OK));
		await ensureEgressNetwork(docker.runDocker, "nklein-egress-int");
		expect(docker.calls.some((c) => has(c, "network", "create"))).toBe(false);
	});
	it("creates when absent", async () => {
		const docker = makeDocker((argv) => (has(argv, "network", "inspect") ? FAIL : OK));
		await ensureEgressNetwork(docker.runDocker, "nklein-egress-int");
		expect(docker.calls.some((c) => has(c, "network", "create", "--internal"))).toBe(true);
	});
});

describe("startEgressProxyContainer — errors surface", () => {
	it("throws if the proxy container fails to start", async () => {
		const docker = makeDocker((argv) => (argv[0] === "run" ? FAIL : OK));
		await expect(
			startEgressProxyContainer(docker.runDocker, {
				containerName: "nklein-egress-proxy",
				networkName: "nklein-egress-int",
				bundleHostPath: "/app/egress-proxy.mjs",
			}),
		).rejects.toThrow(/failed to start/);
	});
	it("throws if the bridge dual-home fails", async () => {
		const docker = makeDocker((argv) => (has(argv, "network", "connect") ? FAIL : OK));
		await expect(
			startEgressProxyContainer(docker.runDocker, {
				containerName: "nklein-egress-proxy",
				networkName: "nklein-egress-int",
				bundleHostPath: "/app/egress-proxy.mjs",
			}),
		).rejects.toThrow(/dual-home/);
	});
});

describe("buildEgressProxyExecEnv — per-role proxy env", () => {
	it("points HTTP(S)_PROXY at the role's listener port with empty NO_PROXY (nothing bypasses)", () => {
		expect(buildEgressProxyExecEnv("172.30.0.2", "worker")).toEqual({
			HTTP_PROXY: "http://172.30.0.2:3129",
			HTTPS_PROXY: "http://172.30.0.2:3129",
			NO_PROXY: "",
		});
		expect(buildEgressProxyExecEnv("172.30.0.2", "architect").HTTP_PROXY).toBe("http://172.30.0.2:3128");
		expect(buildEgressProxyExecEnv("172.30.0.2", "reviewer").HTTP_PROXY).toBe("http://172.30.0.2:3130");
	});
	it("flattens to -e KEY=VALUE argv (mirrors the manager exec-env precedent)", () => {
		expect(buildEgressProxyExecEnvArgs("172.30.0.2", "worker")).toEqual([
			"-e",
			"HTTP_PROXY=http://172.30.0.2:3129",
			"-e",
			"HTTPS_PROXY=http://172.30.0.2:3129",
			"-e",
			"NO_PROXY=",
		]);
	});
});

describe("resolveEgressProxyBundleHostPath — §6 I4 auto-discovery + override", () => {
	// A bundled-app module URL: once esbuilt, every module collapses into dist/cli.js, so the module dir IS dist/.
	const bundledModuleUrl = "file:///opt/app/dist/cli.js";
	const shippedPath = "/opt/app/dist/egress-proxy/entrypoint.mjs";

	it("returns the NKLEIN_EGRESS_PROXY_BUNDLE override when set (override always wins, no discovery)", () => {
		const seen: string[] = [];
		const resolved = resolveEgressProxyBundleHostPath(
			{ [EGRESS_PROXY_BUNDLE_HOST_PATH_ENV]: "/custom/proxy.mjs" },
			{
				moduleUrl: bundledModuleUrl,
				fileExists: (p) => {
					seen.push(p);
					return true;
				},
			},
		);
		expect(resolved).toBe("/custom/proxy.mjs");
		// The override short-circuits — auto-discovery's fileExists is never consulted.
		expect(seen).toEqual([]);
	});

	it("auto-discovers dist/egress-proxy/entrypoint.mjs next to the bundled app module when present", () => {
		const resolved = resolveEgressProxyBundleHostPath(
			{},
			{ moduleUrl: bundledModuleUrl, fileExists: (p) => p === shippedPath },
		);
		expect(resolved).toBe(shippedPath);
	});

	it("returns null (⇒ manager fail-closes) when there is no override and no shipped bundle (unbundled src tree)", () => {
		const resolved = resolveEgressProxyBundleHostPath(
			{},
			{ moduleUrl: "file:///repo/src/nklein-agent/egress-proxy-lifecycle.ts", fileExists: () => false },
		);
		expect(resolved).toBeNull();
	});

	it("treats a whitespace-only override as absent and falls through to discovery", () => {
		const resolved = resolveEgressProxyBundleHostPath(
			{ [EGRESS_PROXY_BUNDLE_HOST_PATH_ENV]: "   " },
			{ moduleUrl: bundledModuleUrl, fileExists: (p) => p === shippedPath },
		);
		expect(resolved).toBe(shippedPath);
	});
});

describe("F2.4 — allowlist changes apply immediately (restart on drift)", () => {
	const ENV_ON = { NKLEIN_SANDBOX_EGRESS_PROXY: "1" };

	function routerWithRunningProxy(runningAllowlist: string | null) {
		return (argv: readonly string[]) => {
			if (has(argv, "network", "inspect")) {
				return OK;
			}
			if (has(argv, "inspect", "-f") && argv.some((a) => a.includes("State.Running"))) {
				return { exitCode: 0, stdout: "true\n", stderr: "" };
			}
			if (has(argv, "inspect", "-f") && argv.some((a) => a.includes("Config.Env"))) {
				const line = runningAllowlist === null ? "" : `NKLEIN_EGRESS_PROXY_ALLOWLIST=${runningAllowlist}\n`;
				return { exitCode: 0, stdout: `PATH=/usr/bin\n${line}`, stderr: "" };
			}
			return undefined;
		};
	}

	it("a TIGHTENED allowlist replaces the running container before health probing", async () => {
		const docker = makeDocker(routerWithRunningProxy("a.com,worker:b.com"));
		await ensureEgressProxyAvailable(docker.runDocker, {
			namespace: "t",
			bundleHostPath: "/tmp/bundle.js",
			env: ENV_ON,
			allowlist: ["a.com"], // tightened: worker:b.com removed
		});
		expect(docker.calls.some((argv) => has(argv, "rm", "-f"))).toBe(true); // stale wider policy replaced
	});

	it("an UNCHANGED allowlist leaves the running container alone", async () => {
		const docker = makeDocker(routerWithRunningProxy("a.com,worker:b.com"));
		await ensureEgressProxyAvailable(docker.runDocker, {
			namespace: "t",
			bundleHostPath: "/tmp/bundle.js",
			env: ENV_ON,
			allowlist: ["a.com", "worker:b.com"],
		});
		expect(docker.calls.some((argv) => has(argv, "rm", "-f"))).toBe(false);
	});
});
