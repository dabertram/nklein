/**
 * §13 "simulation-based fast path" — boot a REAL !Klein runtime against the LLM SIMULATOR (no models, memory
 * speed) and drive a seeded project flow end-to-end: decompose → cards → worker turns → review.
 *
 * Isolation: refuses to run against the real HOME (like the other verify scripts). Everything (config, provider
 * settings, workspaces) lives under the isolated HOME; the simulator serves both the OpenAI chat surface and the
 * LM Studio /api/v0 catalog shim on one origin.
 *
 * Usage:  HOME=$(mktemp -d /tmp/nklein-simflow-XXXX) npx tsx scripts/verify-simulated-flow.mts
 * Env:    NKLEIN_SIMFLOW_TIMEOUT_MS (default 240000) — overall budget for the monitored flow.
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSimulatorServer } from "../packages/llm-simulator/src/index.js";
import type { ScenarioScript } from "../packages/llm-simulator/src/index.js";

const TIMEOUT_MS = Number(process.env.NKLEIN_SIMFLOW_TIMEOUT_MS) || 240_000;
const RUNTIME_PORT = 3986;
const SIM_MODEL = "sim/qwen-fast-coder";

function fail(message: string): never {
	console.error(`FAIL ✗ ${message}`);
	process.exit(1);
}

if (homedir() === "/Users/david" || process.env.HOME === "/Users/david") {
	fail("Refusing to run against HOME=/Users/david. Set HOME to an isolated dir (e.g. mktemp -d /tmp/nklein-simflow-XXXX).");
}

// ---------------------------------------------------------------------------
// The inline SMOKE scenario: a 2-card decompose + per-card worker turns + review approvals. The big
// project scenario sets live in packages/llm-simulator/scenarios/ — this inline one keeps the harness
// self-contained and fast.
// ---------------------------------------------------------------------------
const script: ScenarioScript = {
	name: "simflow-smoke",
	seed: 7,
	tracks: [
		{
			id: "perfect-decompose",
			requestClass: "decompose",
			turns: [
				{
					behavior: {
						kind: "tool_calls",
						calls: [
							{
								name: "decompose_project",
								arguments: {
									slug: "sim-smoke",
									spec: "Two tiny tasks proving the simulated fast path.",
									plan: "Write a greeting module, then a farewell module.",
									defaultAcceptanceCommand: 'node -e "process.exit(0)"',
									tasks: [
										{ id: "card-greet", title: "Greeting module", prompt: "Create greet.ts exporting greet(name)." },
										{ id: "card-farewell", title: "Farewell module", prompt: "Create farewell.ts exporting farewell(name)." },
									],
								},
							},
						],
					},
				},
			],
		},
		{
			id: "perfect-worker-greet",
			requestClass: "worker",
			userMessageIncludes: "greet.ts",
			turns: [
				{
					behavior: {
						kind: "tool_calls",
						calls: [
							{
								name: "write_files",
								arguments: {
									files: [{ path: "greet.ts", content: "export function greet(name: string): string {\n\treturn `Hello, ${name}!`;\n}\n" }],
								},
							},
						],
					},
				},
				{ behavior: { kind: "text", content: "Created greet.ts with the greet(name) export. Task complete." } },
			],
			repeatLastTurn: true,
		},
		{
			id: "perfect-worker-farewell",
			requestClass: "worker",
			userMessageIncludes: "farewell.ts",
			turns: [
				{
					behavior: {
						kind: "tool_calls",
						calls: [
							{
								name: "write_files",
								arguments: {
									files: [{ path: "farewell.ts", content: "export function farewell(name: string): string {\n\treturn `Goodbye, ${name}.`;\n}\n" }],
								},
							},
						],
					},
				},
				{ behavior: { kind: "text", content: "Created farewell.ts with the farewell(name) export. Task complete." } },
			],
			repeatLastTurn: true,
		},
		{
			id: "perfect-review",
			requestClass: "review",
			turns: [
				{
					behavior: {
						kind: "tool_calls",
						calls: [
							{
								name: "submit_review",
								arguments: { verdict: "approve", feedback: "Clean, matches the task. Valued sign-off." },
							},
						],
					},
				},
			],
			repeatLastTurn: true,
		},
		{
			id: "perfect-any-fallback",
			requestClass: "any",
			turns: [{ behavior: { kind: "text", content: "Acknowledged. Proceeding as instructed." } }],
			repeatLastTurn: true,
		},
	],
};

async function main(): Promise<void> {
	const home = process.env.HOME as string;
	console.log(`Isolated HOME: ${home}`);

	// 1) Simulator (chat surface + LM Studio /api shim on one origin).
	const simulator = createSimulatorServer(script, {
		models: [{ id: SIM_MODEL, state: "loaded", family: "qwen", maxContextLength: 65536 }],
	});
	await simulator.start();
	const simBase = simulator.url(); // http://127.0.0.1:<port>/v1
	console.log(`Simulator: ${simBase}`);

	// 2) Isolated HOME wiring: config + provider settings + selection.
	await mkdir(join(home, ".nklein", "nklein"), { recursive: true });
	await mkdir(join(home, ".nklein", "data", "settings"), { recursive: true });
	await writeFile(
		join(home, ".nklein", "config.json"),
		JSON.stringify(
			{
				selectedAgentId: "nklein",
				developerModeEnabled: true,
				setupWizardCompletedAt: Date.now(),
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
	await writeFile(
		join(home, ".nklein", "nklein", "nklein-provider-selection.json"),
		JSON.stringify({ providerId: "lmstudio" }),
	);

	// 3) Boot the runtime under the isolated HOME.
	const runtime = spawn(
		"npx",
		["tsx", "src/cli.ts", "--port", String(RUNTIME_PORT), "--no-open", "--host", "127.0.0.1"],
		{
			env: {
				...process.env,
				HOME: home,
				NODE_ENV: "development",
				NKLEIN_RUNTIME_PORT: String(RUNTIME_PORT),
				KANBAN_RUNTIME_PORT: String(RUNTIME_PORT),
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const runtimeLogs: string[] = [];
	runtime.stdout?.on("data", (chunk: Buffer) => runtimeLogs.push(chunk.toString()));
	runtime.stderr?.on("data", (chunk: Buffer) => runtimeLogs.push(chunk.toString()));
	const stopRuntime = () => {
		runtime.kill("SIGTERM");
	};

	try {
		// Wait for the runtime API.
		const deadline = Date.now() + 60_000;
		for (;;) {
			try {
				const response = await fetch(`http://127.0.0.1:${RUNTIME_PORT}/api/trpc/projects.list`);
				if (response.ok) break;
			} catch {
				/* not up yet */
			}
			if (Date.now() > deadline) {
				console.error(runtimeLogs.join("").slice(-2000));
				fail("runtime did not come up within 60s");
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		console.log("Runtime is up. Seeding the dev-test scenario…");

		// 4) Seed a dev-test scenario against the RUNNING runtime and monitor to a classified outcome.
		const seed = spawn(
			"npx",
			[
				"tsx",
				"src/cli.ts",
				"dev",
				"test-project",
				"--preset",
				"mid_task",
				"--poll-interval-ms",
				"4000",
				"--max-wait-ms",
				String(TIMEOUT_MS),
				"--json",
			],
			{
				env: {
					...process.env,
					HOME: home,
					NODE_ENV: "development",
					NKLEIN_RUNTIME_PORT: String(RUNTIME_PORT),
					KANBAN_RUNTIME_PORT: String(RUNTIME_PORT),
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let seedOut = "";
		seed.stdout?.on("data", (chunk: Buffer) => {
			seedOut += chunk.toString();
			process.stdout.write(chunk);
		});
		seed.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
		const seedExit: number = await new Promise((resolve) => seed.on("close", (code) => resolve(code ?? 1)));

		console.log(`\nSeed monitor exited ${seedExit}.`);
		const catalogHits = (runtimeLogs.join("").match(/no_fixture_match/g) ?? []).length;
		console.log(`Unmatched simulator requests observed in runtime logs: ${catalogHits}`);
		if (seedExit !== 0) {
			console.error(runtimeLogs.join("").slice(-3000));
			fail(`dev-test monitor exit ${seedExit} — see output above (classification is printed by the monitor)`);
		}
		const reviewLines = runtimeLogs.join("").split("\n").filter((line) => /review|acceptance|sandbox/i.test(line)).slice(-12);
		console.log("Review/acceptance trail:\n" + reviewLines.join("\n"));
		console.log("PASS ✓ simulated fast path drove a real runtime flow with zero LLM compute.");
	} finally {
		await writeFile(join(home, "runtime.log"), runtimeLogs.join("")).catch(() => undefined);
		console.log(`Full runtime log: ${join(home, "runtime.log")}`);
		stopRuntime();
		await simulator.stop();
	}
}

await main();
