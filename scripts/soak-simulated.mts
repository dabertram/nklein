/**
 * N15 SOAK — one long-lived runtime under sustained simulated load, with resource + egress watches.
 *
 * WHAT: boots the LLM simulator (generic needle-free tracks, so ANY card drains: worker writes a module AND a
 * test file, reviewer approves) + ONE !Klein runtime, then drives NKLEIN_SOAK_ROUNDS rounds of
 * NKLEIN_SOAK_CARDS A2A-seeded cards each against the SAME process. Between samples it records the runtime's
 * RSS, open-handle count, and on-disk ledger/telemetry growth; the run fails on runaway RSS (final round >3×
 * the round-1 baseline), a round failing to drain, or a non-loopback connection (the N15 egress assertion,
 * pid-tree scoped).
 *
 * WHY this shape: the leak question ("codebase-memory has OOM'd under load before") is only answerable by ONE
 * process accumulating history — the nightly's per-cell fresh HOMEs structurally cannot see it. Board growth
 * across rounds is deliberate: growth PROPORTIONAL to cards is bounded; the watch is for the runaway class.
 *
 * Deliberately reuses proven pieces byte-for-byte where possible: the simulator + HOME wiring mirror
 * verify-simulated-flow; the A2A seeding mirrors the P17.1 probe rig; the connection audit is the shipped
 * runtime-connection-audit core.
 */

import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildConnectionAuditVerdict, parseLsofEstablishedLine } from "../src/core/runtime-connection-audit.js";
import { createSimulatorServer } from "../packages/llm-simulator/src/index.js";
import type { ScenarioScript } from "../packages/llm-simulator/src/index.js";

const exec = promisify(execFile);
const ROUNDS = Math.max(1, Number(process.env.NKLEIN_SOAK_ROUNDS ?? "6"));
const CARDS = Math.max(1, Number(process.env.NKLEIN_SOAK_CARDS ?? "40"));
const ROUND_TIMEOUT_MS = Math.max(60_000, Number(process.env.NKLEIN_SOAK_ROUND_TIMEOUT_MS ?? String(30 * 60_000)));
const SAMPLE_MS = 30_000;
const SIM_MODEL = "sim/soak-coder";
const RUNTIME_PORT = Number(process.env.NKLEIN_SOAK_RUNTIME_PORT ?? "3487");
const OUT_DIR = process.env.NKLEIN_SOAK_OUT ?? join(process.cwd(), ".real-runs", `soak-${new Date().toISOString().replaceAll(/[:.]/g, "").slice(0, 15)}`);

/** Generic tracks: every worker turn writes the module AND a test (satisfying the test-driven gate), every
 *  review approves. cycleTurns keeps resumed sessions correct across rounds. */
function soakScript(): ScenarioScript {
	return {
		name: "soak-generic",
		seed: 7,
		tracks: [
			{
				id: "soak-worker",
				requestClass: "worker",
				cycleTurns: true,
				turns: [
					{
						behavior: {
							kind: "tool_calls",
							calls: [
								{
									name: "write_files",
									arguments: {
										files: [
											{
												path: "soak-note.md",
												content: "Soak round note: the card's requested line.\n",
											},
											{
												path: "soak-note.test.js",
												content:
													"const test = require('node:test');\nconst assert = require('node:assert');\ntest('soak note exists', () => { assert.ok(true); });\n",
											},
										],
									},
								},
							],
						},
					},
					{ behavior: { kind: "text", content: "Implemented the requested note plus a covering test." } },
				],
			},
			{
				id: "soak-review",
				requestClass: "review",
				cycleTurns: true,
				turns: [
					{
						behavior: {
							kind: "tool_calls",
							calls: [
								{
									name: "submit_review",
									arguments: { verdict: "approve", summary: "Soak review: change plus test present." },
								},
							],
						},
					},
					{ behavior: { kind: "text", content: "Review submitted." } },
				],
			},
			{
				id: "soak-any",
				requestClass: "any",
				repeatLastTurn: true,
				turns: [{ behavior: { kind: "text", content: "Acknowledged." } }],
			},
		],
	};
}

/** The runtime's whole pid TREE (tsx wrapper spawns the real node child) — sampling the wrapper alone sees a
 *  flat ~59MB and zero sockets (mini-soak finding, 2026-08-05). */
async function pidTree(root: number): Promise<string[]> {
	const all: string[] = [String(root)];
	let frontier = [String(root)];
	while (frontier.length > 0) {
		const { stdout } = await exec("pgrep", ["-P", frontier.join(",")]).catch(() => ({ stdout: "" }));
		frontier = stdout.split("\n").map((line) => line.trim()).filter((line) => /^\d+$/.test(line));
		all.push(...frontier);
	}
	return [...new Set(all)];
}

async function sampleRss(pid: number): Promise<number> {
	const pids = await pidTree(pid);
	const { stdout } = await exec("ps", ["-o", "rss=", "-p", pids.join(",")]).catch(() => ({ stdout: "0" }));
	return stdout.split("\n").reduce((total, line) => total + Number(line.trim() || "0"), 0);
}

async function sampleHandles(pid: number): Promise<number> {
	const pids = await pidTree(pid);
	const { stdout } = await exec("lsof", ["-p", pids.join(",")]).catch(() => ({ stdout: "" }));
	return stdout ? stdout.split("\n").length - 1 : 0;
}

async function sampleConnections(pid: number): Promise<string> {
	const pids = await pidTree(pid);
	const { stdout } = await exec("lsof", ["-a", "-p", pids.join(","), "-nP", "-iTCP", "-sTCP:ESTABLISHED"]).catch(
		() => ({ stdout: "" }),
	);
	if (!stdout) return stdout;
	// Finding-3 follow-up (first 2.5h soak): name WHICH child phoned — append a pid→argv map beside any
	// non-empty sample so a violation is attributable without a re-run.
	const { stdout: argvs } = await exec("ps", ["-o", "pid=,command=", "-p", pids.join(",")]).catch(() => ({
		stdout: "",
	}));
	return `${stdout}\n#argv\n${argvs}`;
}

async function dirBytes(path: string): Promise<number> {
	const { stdout } = await exec("du", ["-sk", path]).catch(() => ({ stdout: "0" }));
	return Number(stdout.split("\t")[0] || "0") * 1024;
}

async function main(): Promise<void> {
	await mkdir(OUT_DIR, { recursive: true });
	// NKLEIN_SOAK_REUSE_HOME: point at a PRIOR soak's OUT dir to resume its grown state — the lever for
	// profiling the per-turn overhead AT scale (a fresh home cannot show the accumulated-state cost).
	const reuse = process.env.NKLEIN_SOAK_REUSE_HOME?.trim();
	const home = reuse ? join(reuse, "home") : join(OUT_DIR, "home");
	const workspace = reuse ? join(reuse, "ws") : join(OUT_DIR, "ws");
	await mkdir(join(home, ".nklein", "nklein"), { recursive: true });
	await mkdir(join(home, ".nklein", "data", "settings"), { recursive: true });
	await mkdir(workspace, { recursive: true });

	// The soak workspace: a real git repo whose harness the acceptance gate can actually run.
	if (reuse) {
		process.stdout.write(`soak reusing grown state: ${reuse}\n`);
	} else {
		await exec("git", ["-C", workspace, "init", "-qb", "main"]);
		await writeFile(
			join(workspace, "package.json"),
			`${JSON.stringify({ name: "soak-ws", private: true, scripts: { test: "node --test" } }, null, 1)}\n`,
		);
		await writeFile(join(workspace, "README.md"), "soak workspace\n");
		await exec("git", ["-C", workspace, "add", "-A"]);
		await exec("git", ["-C", workspace, "-c", "user.email=soak@local", "-c", "user.name=soak", "commit", "-qm", "init"]);
	}

	const simulator = createSimulatorServer(soakScript(), {
		models: [{ id: SIM_MODEL, state: "loaded", family: "qwen", maxContextLength: 65536 }],
	});
	await simulator.start();
	const simBase = simulator.url();
	process.stdout.write(`soak simulator: ${simBase}\n`);

	await writeFile(
		join(home, ".nklein", "nklein", "config.json"),
		JSON.stringify(
			{
				selectedAgentId: "nklein",
				developerModeEnabled: true,
				setupWizardCompletedAt: Date.now(),
				agentRulesets: { capability: { globalPreset: "strict" }, delivery: { globalPreset: "fully_open" } },
				modelRoles: {
					architect: { modelId: SIM_MODEL, providerId: "lmstudio" },
					worker: { modelId: SIM_MODEL, providerId: "lmstudio" },
					reviewer: { modelId: SIM_MODEL, providerId: "lmstudio" },
				},
			},
			null,
			1,
		),
	);
	await writeFile(
		join(home, ".nklein", "data", "settings", "providers.json"),
		JSON.stringify(
			{
				version: 1,
				lastUsedProvider: "lmstudio",
				providers: {
					lmstudio: {
						settings: { provider: "lmstudio", model: SIM_MODEL, baseUrl: simBase },
						updatedAt: new Date().toISOString(),
						tokenSource: "manual",
					},
				},
			},
			null,
			1,
		),
	);
	await writeFile(join(home, ".nklein", "nklein", "nklein-provider-selection.json"), '{\n "providerId": "lmstudio"\n}\n');

	const runtimeLog = join(OUT_DIR, "runtime.log");
	const runtimeOut = await import("node:fs").then((fs) => fs.openSync(runtimeLog, "a"));
	const runtime = spawn(
		join(process.cwd(), "node_modules", ".bin", "tsx"),
		["src/cli.ts", "--host", "127.0.0.1", "--port", String(RUNTIME_PORT)],
		{
			env: { ...process.env, HOME: home, NODE_ENV: "development", NKLEIN_A2A_SERVER: "1" },
			stdio: ["ignore", runtimeOut, runtimeOut],
			detached: false,
		},
	);
	const runtimePid = runtime.pid;
	if (!runtimePid) throw new Error("runtime failed to spawn");

	const deadline = Date.now() + 90_000;
	let ready = false;
	while (Date.now() < deadline && !ready) {
		ready = await fetch(`http://127.0.0.1:${RUNTIME_PORT}/.well-known/agent-card.json`)
			.then((response) => response.ok)
			.catch(() => false);
		if (!ready) await new Promise((settle) => setTimeout(settle, 2_000));
	}
	if (!ready) throw new Error("runtime never became ready");
	process.stdout.write(`soak runtime: pid ${runtimePid} on :${RUNTIME_PORT}\n`);

	// Register the workspace by seeding the FIRST card (A2A registers/uses the active workspace via the
	// runtime's workspace index — the runtime boots with no workspace, so create it through the state API).
	const { loadWorkspaceContext } = await import("../src/state/workspace-state.js");
	const previousHome = process.env.HOME;
	process.env.HOME = home;
	await loadWorkspaceContext(workspace, { autoCreateIfMissing: true });
	process.env.HOME = previousHome;

	const samples: Array<{ at: number; rssKb: number; handles: number; ledgerBytes: number }> = [];
	const egressSamples: string[] = [];
	const sampler = setInterval(() => {
		void (async () => {
			const [rssKb, handles, ledgerBytes, connections] = await Promise.all([
				sampleRss(runtimePid),
				sampleHandles(runtimePid),
				dirBytes(join(home, ".nklein")),
				sampleConnections(runtimePid),
			]);
			samples.push({ at: Date.now(), rssKb, handles, ledgerBytes });
			if (connections) egressSamples.push(connections);
		})();
	}, SAMPLE_MS);

	// When reusing a grown home, prior completed cards are the baseline the per-round expectations sit on.
	let baselineCompleted = 0;
	{
		const { stdout } = await exec("find", [join(home, ".nklein", "nklein", "workspaces"), "-name", "board.json"]).catch(() => ({ stdout: "" }));
		const boardPath = stdout.split("\n").find((line) => line.trim().length > 0);
		if (boardPath) {
			try {
				const board = JSON.parse(await readFile(boardPath.trim(), "utf8")) as { columns: Array<{ id: string; cards: unknown[] }> };
				baselineCompleted = board.columns.find((column) => column.id === "completed")?.cards.length ?? 0;
			} catch {
				baselineCompleted = 0;
			}
		}
	}
	if (baselineCompleted > 0) process.stdout.write(`soak baseline completed: ${baselineCompleted}\n`);
	const roundResults: Array<{ round: number; seeded: number; completed: number; drainMs: number; ok: boolean }> = [];
	let aborted: string | null = null;
	for (let round = 1; round <= ROUNDS && !aborted; round += 1) {
		const started = Date.now();
		for (let index = 1; index <= CARDS; index += 1) {
			const response = await fetch(`http://127.0.0.1:${RUNTIME_PORT}/a2a/v1`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: `soak-${round}-${index}`,
					method: "SendMessage",
					params: {
						message: {
							messageId: `soak-m-${round}-${index}`,
							role: "ROLE_USER",
							parts: [
								{
									text: `Soak round ${round} card ${index}: create or update the file soak/r${round}-c${index}.md with one line describing this card, and include a covering test.`,
								},
							],
						},
					},
				}),
			}).catch(() => null);
			if (!response?.ok) {
				aborted = `round ${round}: SendMessage ${index} failed`;
				break;
			}
		}
		const expectedCompleted = baselineCompleted + round * CARDS;
		const boardPathCandidates = join(home, ".nklein", "nklein", "workspaces");
		let completed = 0;
		const roundDeadline = Date.now() + ROUND_TIMEOUT_MS;
		while (!aborted && Date.now() < roundDeadline) {
			const { stdout } = await exec("find", [boardPathCandidates, "-name", "board.json"]).catch(() => ({ stdout: "" }));
			const boardPath = stdout.split("\n").find((line) => line.trim().length > 0);
			if (boardPath) {
				try {
					const board = JSON.parse(await readFile(boardPath.trim(), "utf8")) as {
						columns: Array<{ id: string; cards: unknown[] }>;
					};
					completed = board.columns.find((column) => column.id === "completed")?.cards.length ?? 0;
				} catch {
					// Mid-write snapshot — next poll reads a settled file.
				}
			}
			if (completed >= expectedCompleted) break;
			await new Promise((settle) => setTimeout(settle, 5_000));
		}
		const ok = completed >= expectedCompleted;
		roundResults.push({ round, seeded: CARDS, completed, drainMs: Date.now() - started, ok });
		process.stdout.write(
			`soak round ${round}/${ROUNDS}: completed ${completed}/${expectedCompleted} in ${Math.round((Date.now() - started) / 1000)}s ${ok ? "OK" : "TIMEOUT"}\n`,
		);
		if (!ok) aborted = `round ${round} failed to drain (${completed}/${expectedCompleted})`;
	}

	clearInterval(sampler);
	const observations = egressSamples.flatMap((sample) => sample.split("\n")).map(parseLsofEstablishedLine)
		.filter((row): row is NonNullable<typeof row> => row !== null);
	const egress = buildConnectionAuditVerdict(observations);
	runtime.kill("SIGTERM");
	// Wait for a GRACEFUL exit before the hard kill: a --cpu-prof runtime flushes its profile at exit, and a
	// multi-GB process needs more than seconds (the first profiled soak SIGKILLed the profile away).
	{
		const exited = new Promise<void>((settle) => runtime.once("close", () => settle()));
		const graceful = await Promise.race([
			exited.then(() => true),
			new Promise<boolean>((settle) => setTimeout(() => settle(false), 30_000)),
		]);
		if (!graceful) runtime.kill("SIGKILL");
	}
	await simulator.stop().catch(() => undefined);

	const rssSeries = samples.map((sample) => sample.rssKb);
	const baseline = rssSeries.slice(0, Math.max(1, Math.floor(rssSeries.length / ROUNDS)));
	const baselineMax = Math.max(...(baseline.length ? baseline : [1]));
	const finalMax = Math.max(...(rssSeries.slice(-Math.max(1, Math.floor(rssSeries.length / ROUNDS))).length
		? rssSeries.slice(-Math.max(1, Math.floor(rssSeries.length / ROUNDS)))
		: [0]));
	const rssRunaway = finalMax > 3 * baselineMax;
	const report = {
		rounds: roundResults,
		aborted,
		samples,
		rss: { baselineMaxKb: baselineMax, finalMaxKb: finalMax, runaway: rssRunaway },
		egress: { ok: egress.ok, observedConnections: egress.observedConnections, violations: egress.violations },
	};
	await writeFile(join(OUT_DIR, "soak-report.json"), `${JSON.stringify(report, null, 1)}\n`);
	process.stdout.write(
		`SOAK ${aborted || rssRunaway || !egress.ok || egress.observedConnections === 0 ? "FAIL" : "PASS"} — rounds ${roundResults.filter((r) => r.ok).length}/${ROUNDS}, RSS ${baselineMax}→${finalMax}KB${rssRunaway ? " RUNAWAY" : ""}, egress ${egress.ok ? (egress.observedConnections > 0 ? "loopback-only" : "INDETERMINATE") : "VIOLATIONS"}; report ${join(OUT_DIR, "soak-report.json")}\n`,
	);
	if (aborted || rssRunaway || !egress.ok || egress.observedConnections === 0) process.exitCode = 1;
}

await main();
