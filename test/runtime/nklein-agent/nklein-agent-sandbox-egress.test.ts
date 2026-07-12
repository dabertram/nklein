import type { execFile } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EGRESS_PROXY_ROLE_PORTS } from "../../../src/nklein-agent/egress-proxy-entrypoint";
import { AgentSandboxManager } from "../../../src/nklein-agent/nklein-agent-sandbox";

/**
 * I2b-wire unit tests (docs/dev/egress-proxy-design.md §4/§6, §10c#18): the AgentSandboxManager wiring of the
 * already-built egress-proxy lifecycle. These assert the SECURITY-CRITICAL invariants with a fake `docker` (the
 * injected `execFile`) and the flag toggled via `vi.stubEnv`:
 *
 *  - flag OFF ⇒ NO ensure call, NO proxy env, `allowlist` still `--network none` (byte-identical to pre-proxy).
 *  - flag ON + proxy AVAILABLE ⇒ the sandbox joins the internal egress network + gets `--dns <ip>`, and every
 *    `docker exec` gets the WORKER-port `HTTP(S)_PROXY` env.
 *  - flag ON + proxy UNAVAILABLE (unhealthy / no bundle) ⇒ FAIL CLOSED to `--network none`, NO proxy env.
 *  - the proxy ensure is MEMOIZED (one probe across N container creates).
 *  - `none` / `full` never touch any egress Docker resources or inject proxy env.
 */

const WORKER_PORT = EGRESS_PROXY_ROLE_PORTS.worker;
const EGRESS_NETWORK = "nklein-egress-int";
const PROXY_CONTAINER = "nklein-egress-proxy";
const PROXY_IP = "172.30.0.9";
const BUNDLE_PATH = "/host/egress/entrypoint.mjs";

interface EgressStubOptions {
	/** Proxy health-probe outcome (exec into the proxy container). Default healthy. */
	healthy?: boolean;
	/** The proxy internal IP the IP-resolve inspect returns. Default {@link PROXY_IP}. */
	ip?: string;
}

/**
 * A fake `docker` (execFile shape) that services BOTH the egress-proxy lifecycle commands and the sandbox pool
 * commands, so the whole manager wiring runs against one recorder. Egress commands are disambiguated by the
 * `nklein-egress-*` names + the proxy-container inspect format strings; everything else falls through to the
 * generic sandbox handling (a `run` yields a container id; other commands succeed with empty output).
 */
function createEgressExecFileStub(options: EgressStubOptions = {}): { execFile: typeof execFile; calls: string[][] } {
	const healthy = options.healthy ?? true;
	const ip = options.ip ?? PROXY_IP;
	const calls: string[][] = [];
	const stub = vi.fn((file: string, args: readonly string[], _options: unknown, callback: unknown) => {
		expect(file).toBe("docker");
		calls.push([...args]);
		const a = args as string[];
		const done = callback as (error: unknown, result?: { stdout: string; stderr: string }) => void;
		const ok = (stdout = ""): ReturnType<typeof execFile> => {
			done(null, { stdout, stderr: "" });
			return {} as ReturnType<typeof execFile>;
		};
		const fail = (code: number, stderr = "err"): ReturnType<typeof execFile> => {
			done(Object.assign(new Error(stderr), { code, stdout: "", stderr }));
			return {} as ReturnType<typeof execFile>;
		};
		// --- egress network lifecycle ---
		if (a[0] === "network" && a[1] === "inspect") {
			return fail(1, "no such network"); // not found ⇒ exercise the create path
		}
		if (a[0] === "network" && (a[1] === "create" || a[1] === "connect" || a[1] === "rm")) {
			return ok();
		}
		// --- proxy container inspects ---
		if (a[0] === "inspect" && a[2] === "{{.State.Running}}") {
			// Proxy running-check ⇒ report NOT running so the lifecycle does a fresh start; sandbox liveness ⇒ alive.
			return ok(a[3]?.includes(PROXY_CONTAINER) ? "false\n" : "true\n");
		}
		if (a[0] === "inspect" && typeof a[2] === "string" && a[2].startsWith("{{with index .NetworkSettings")) {
			return ok(`${ip}\n`); // proxy internal-IP resolve
		}
		// --- proxy health probe: exec <proxy> node -e <script> ---
		if (a[0] === "exec" && typeof a[1] === "string" && a[1].includes(PROXY_CONTAINER) && a[2] === "node") {
			return healthy ? ok() : fail(1, "unhealthy");
		}
		// --- generic sandbox commands ---
		if (a[0] === "run") {
			return ok("container-id\n");
		}
		return ok();
	});
	return { execFile: stub as unknown as typeof execFile, calls };
}

const runCalls = (calls: string[][]): string[][] => calls.filter((a) => a[0] === "run");
const sandboxRunCalls = (calls: string[][]): string[][] =>
	runCalls(calls).filter((a) => a.some((arg) => arg.startsWith("nklein-agent-sandbox")));
const proxyRunCalls = (calls: string[][]): string[][] => runCalls(calls).filter((a) => a.includes(PROXY_CONTAINER));
const healthProbeCalls = (calls: string[][]): string[][] =>
	calls.filter(
		(a) => a[0] === "exec" && typeof a[1] === "string" && a[1].includes(PROXY_CONTAINER) && a[2] === "node",
	);
const execCallsInto = (calls: string[][], containerPrefix: string): string[][] =>
	calls.filter((a) => a[0] === "exec" && a.some((arg) => arg.startsWith(containerPrefix)));
const hasProxyEnv = (a: string[]): boolean => a.some((arg) => arg.startsWith("HTTP_PROXY="));

function enableFlag(bundle: string | null = BUNDLE_PATH): void {
	vi.stubEnv("NKLEIN_SANDBOX_EGRESS_PROXY", "1");
	vi.stubEnv("NKLEIN_EGRESS_PROXY_BUNDLE", bundle ?? "");
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("AgentSandboxManager egress-proxy wiring (I2b, §10c#18)", () => {
	it("flag OFF: allowlist stays --network none, no ensure call, no proxy env (byte-identical)", async () => {
		vi.stubEnv("NKLEIN_SANDBOX_EGRESS_PROXY", ""); // explicitly off
		vi.stubEnv("NKLEIN_EGRESS_PROXY_BUNDLE", BUNDLE_PATH); // present but must be ignored while the flag is off
		const { execFile, calls } = createEgressExecFileStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile,
			networkPolicy: "allowlist",
			poolConfig: { maxContainers: 1, agentsPerContainer: 0, idleTimeoutMs: 0 },
		});

		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		await manager.exec("task-1", ["echo", "hi"]);

		// No egress Docker resources touched at all.
		expect(calls.some((a) => a[0] === "network")).toBe(false);
		expect(proxyRunCalls(calls)).toHaveLength(0);
		expect(healthProbeCalls(calls)).toHaveLength(0);
		// allowlist fail-closes to --network none, no --dns.
		const run = sandboxRunCalls(calls)[0] ?? [];
		expect(run.join(" ")).toContain("--network none");
		expect(run).not.toContain("--dns");
		expect(run).not.toContain(EGRESS_NETWORK);
		// No exec carries proxy env.
		expect(execCallsInto(calls, "nklein-agent-sandbox").every((a) => !hasProxyEnv(a))).toBe(true);
	});

	it("flag ON + available: sandbox joins the internal network + --dns, execs get the WORKER-port proxy env", async () => {
		enableFlag();
		const { execFile, calls } = createEgressExecFileStub({ healthy: true, ip: PROXY_IP });
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile,
			networkPolicy: "allowlist",
			poolConfig: { maxContainers: 1, agentsPerContainer: 0, idleTimeoutMs: 0 },
		});

		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		await manager.exec("task-1", ["echo", "hi"]);

		// Create seam: the sandbox container joins the internal egress network and pins DNS at the proxy stub.
		const run = sandboxRunCalls(calls)[0] ?? [];
		expect(run).toContain("--network");
		expect(run).toContain(EGRESS_NETWORK);
		expect(run.join(" ")).not.toContain("--network none");
		expect(run).toContain("--dns");
		expect(run).toContain(PROXY_IP);

		// Ensure actually ran: network created, proxy started + dual-homed, health-probed, IP resolved.
		expect(calls).toContainEqual([
			"network",
			"create",
			"--internal",
			"--label",
			"nklein.kind=egress",
			EGRESS_NETWORK,
		]);
		expect(proxyRunCalls(calls)).toHaveLength(1);
		expect(calls).toContainEqual(["network", "connect", "bridge", PROXY_CONTAINER]);
		expect(healthProbeCalls(calls)).toHaveLength(1);

		// Exec seam: the tool exec carries the WORKER-port HTTP(S)_PROXY env, NO_PROXY empty (nothing bypasses).
		const toolExec = execCallsInto(calls, "nklein-agent-sandbox").find((a) => a.includes("echo")) ?? [];
		expect(toolExec).toContain(`HTTP_PROXY=http://${PROXY_IP}:${WORKER_PORT}`);
		expect(toolExec).toContain(`HTTPS_PROXY=http://${PROXY_IP}:${WORKER_PORT}`);
		expect(toolExec).toContain("NO_PROXY=");
		// The env args precede the container name / command (valid `docker exec [OPTIONS] CONTAINER COMMAND`).
		expect(toolExec.indexOf(`HTTP_PROXY=http://${PROXY_IP}:${WORKER_PORT}`)).toBeLessThan(
			toolExec.indexOf("nklein-agent-sandbox-1"),
		);
	});

	it("flag ON + UNHEALTHY proxy: FAIL CLOSED to --network none, no --dns, no proxy env", async () => {
		enableFlag();
		const { execFile, calls } = createEgressExecFileStub({ healthy: false });
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile,
			networkPolicy: "allowlist",
			poolConfig: { maxContainers: 1, agentsPerContainer: 0, idleTimeoutMs: 0 },
		});

		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		await manager.exec("task-1", ["echo", "hi"]);

		// The ensure was attempted (health-probed) but the unhealthy verdict fails closed.
		expect(healthProbeCalls(calls)).toHaveLength(1);
		const run = sandboxRunCalls(calls)[0] ?? [];
		expect(run.join(" ")).toContain("--network none");
		expect(run).not.toContain("--dns");
		expect(run).not.toContain(EGRESS_NETWORK);
		expect(execCallsInto(calls, "nklein-agent-sandbox").every((a) => !hasProxyEnv(a))).toBe(true);
	});

	it("flag ON but NO shipped bundle path: FAIL CLOSED without touching Docker (no ensure at all)", async () => {
		enableFlag(null); // flag on, NKLEIN_EGRESS_PROXY_BUNDLE empty
		const { execFile, calls } = createEgressExecFileStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile,
			networkPolicy: "allowlist",
			poolConfig: { maxContainers: 1, agentsPerContainer: 0, idleTimeoutMs: 0 },
		});

		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });

		// No bundle ⇒ no proxy ⇒ no egress Docker interaction whatsoever, and allowlist fails closed.
		expect(calls.some((a) => a[0] === "network")).toBe(false);
		expect(proxyRunCalls(calls)).toHaveLength(0);
		expect(healthProbeCalls(calls)).toHaveLength(0);
		expect((sandboxRunCalls(calls)[0] ?? []).join(" ")).toContain("--network none");
		// Never ensured ⇒ stopNow does no teardown (byte-identical shutdown).
		await manager.stopNow();
		expect(calls.some((a) => a[0] === "rm" && a.includes(PROXY_CONTAINER))).toBe(false);
		expect(calls.some((a) => a[0] === "network" && a[1] === "rm")).toBe(false);
	});

	it("memoizes the ensure: ONE probe across N allowlist container creates", async () => {
		enableFlag();
		const { execFile, calls } = createEgressExecFileStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile,
			networkPolicy: "allowlist",
			poolConfig: { maxContainers: 2, agentsPerContainer: 1, idleTimeoutMs: 0 },
		});

		// Two tasks force two distinct sandbox containers (agentsPerContainer=1), i.e. two startContainer calls.
		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		await manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" });

		expect(sandboxRunCalls(calls).length).toBe(2);
		// ...but the shared proxy is ensured exactly ONCE (memoized promise).
		expect(proxyRunCalls(calls)).toHaveLength(1);
		expect(healthProbeCalls(calls)).toHaveLength(1);
		expect(calls.filter((a) => a[0] === "network" && a[1] === "create")).toHaveLength(1);
		// Both sandbox containers still join the egress network + get --dns.
		for (const run of sandboxRunCalls(calls)) {
			expect(run).toContain(EGRESS_NETWORK);
			expect(run).toContain("--dns");
			expect(run).toContain(PROXY_IP);
		}
	});

	it("flag ON + policy 'none' / 'full': never touches egress resources or injects proxy env", async () => {
		for (const policy of ["none", "full"] as const) {
			enableFlag();
			const { execFile, calls } = createEgressExecFileStub();
			const manager = new AgentSandboxManager({
				image: "test-image",
				execFile,
				networkPolicy: policy,
				poolConfig: { maxContainers: 1, agentsPerContainer: 0, idleTimeoutMs: 0 },
			});

			await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
			await manager.exec("task-1", ["echo", "hi"]);

			expect(calls.some((a) => a[0] === "network")).toBe(false);
			expect(proxyRunCalls(calls)).toHaveLength(0);
			expect(healthProbeCalls(calls)).toHaveLength(0);
			const run = sandboxRunCalls(calls)[0] ?? [];
			expect(run.join(" ")).toContain(policy === "full" ? "--network bridge" : "--network none");
			expect(run).not.toContain("--dns");
			expect(execCallsInto(calls, "nklein-agent-sandbox").every((a) => !hasProxyEnv(a))).toBe(true);
			vi.unstubAllEnvs();
		}
	});

	it("stopNow tears down the shared proxy + network once ensured", async () => {
		enableFlag();
		const { execFile, calls } = createEgressExecFileStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile,
			networkPolicy: "allowlist",
			poolConfig: { maxContainers: 1, agentsPerContainer: 0, idleTimeoutMs: 0 },
		});

		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		await manager.stopNow();

		expect(calls).toContainEqual(["rm", "-f", PROXY_CONTAINER]);
		expect(calls).toContainEqual(["network", "rm", EGRESS_NETWORK]);
	});

	it("setNetworkPolicy switch TO allowlist re-triggers the ensure on the next container create", async () => {
		enableFlag();
		const { execFile, calls } = createEgressExecFileStub();
		const manager = new AgentSandboxManager({
			image: "test-image",
			execFile,
			networkPolicy: "none", // starts fully isolated
			poolConfig: { maxContainers: 1, agentsPerContainer: 1, idleTimeoutMs: 0 },
		});

		await manager.acquireSlot({ taskId: "task-1", projectRepoPath: "/repo" });
		// Isolated pool: no egress resources yet.
		expect(proxyRunCalls(calls)).toHaveLength(0);

		await manager.disposeWorkspace("task-1"); // free the container so the idle one retires on the switch
		await manager.setNetworkPolicy("allowlist");
		await manager.acquireSlot({ taskId: "task-2", projectRepoPath: "/repo" });

		// The switch re-triggered the ensure: the proxy is now started and the new container joins the egress network.
		expect(proxyRunCalls(calls)).toHaveLength(1);
		const lastSandboxRun = sandboxRunCalls(calls).at(-1) ?? [];
		expect(lastSandboxRun).toContain(EGRESS_NETWORK);
		expect(lastSandboxRun).toContain("--dns");
	});
});
