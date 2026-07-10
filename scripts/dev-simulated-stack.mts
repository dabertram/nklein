/**
 * §13g PERSISTENT SIMULATED DEV STACK — the UI-deep-dive workhorse. Boots the LLM simulator + a REAL runtime on
 * the STANDARD port (:3484, so the stock web-ui dev server proxies to it), then seeds scenario projects one after
 * another so the board shows continuous, deterministic activity with ZERO LLM compute. Unlike
 * verify-simulated-flow.mts this never tears down — Ctrl-C ends it.
 *
 * Usage:  HOME=$(mktemp -d /tmp/nklein-sim-stack-XXXX) npx tsx scripts/dev-simulated-stack.mts
 * Env:    NKLEIN_SIM_STACK_PROJECTS  comma list of scenario ids/prefixes (default "01,02,19")
 *         NKLEIN_SIM_STACK_RUN       perfect|flaky (default perfect)
 *         NKLEIN_SIM_STACK_PACE      watchable|instant (default watchable — injects latency + streaming physics
 *                                    so flows unfold visibly instead of finishing in seconds)
 *         NKLEIN_SIM_STACK_LOOP      1 to re-seed the project list forever (default 0 — re-seeding duplicates projects)
 *         NKLEIN_SIM_STACK_PORT      runtime port (default 3484)
 * Web-ui: run `npm run dev --prefix web-ui` (or preview_start "web-ui") — it proxies /api to :3484.
 */

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSimulatorServer } from "../packages/llm-simulator/src/index.js";
import type { ScenarioScript, ScenarioTrack } from "../packages/llm-simulator/src/index.js";

const RUNTIME_PORT = Number(process.env.NKLEIN_SIM_STACK_PORT) || 3484;
const PROJECTS = (process.env.NKLEIN_SIM_STACK_PROJECTS || "01,02,19").split(",").map((entry) => entry.trim()).filter(Boolean);
const RUN_FILE = process.env.NKLEIN_SIM_STACK_RUN === "flaky" ? "flaky-run" : "perfect-run";
const PACE = process.env.NKLEIN_SIM_STACK_PACE === "instant" ? "instant" : "watchable";
// Loop OFF by default: re-seeding duplicates projects (live-found 2026-07-10 — the round-1 monitor classified
// early and round 2 spawned a twin project). Opt in with NKLEIN_SIM_STACK_LOOP=1 for endless demo activity.
const LOOP = process.env.NKLEIN_SIM_STACK_LOOP === "1";
const SIM_MODEL = "sim/qwen-fast-coder";

function fail(message: string): never {
	console.error(`FAIL ✗ ${message}`);
	process.exit(1);
}

if (homedir() === "/Users/david" || process.env.HOME === "/Users/david") {
	fail("Refusing to run against HOME=/Users/david. Set HOME to an isolated dir (mktemp -d /tmp/nklein-sim-stack-XXXX).");
}

const scenariosDir = new URL("../packages/llm-simulator/scenarios/", import.meta.url).pathname;
const scenarioDirs = readdirSync(scenariosDir).sort();

function resolveScenarioDir(selector: string): string {
	const match = scenarioDirs.find((dir) => dir === selector || dir.startsWith(`${selector}_`));
	if (!match) fail(`no scenario set matches "${selector}" under packages/llm-simulator/scenarios/`);
	return match;
}

/** Watchable pacing: give un-paced turns visible latency + token streaming so the UI shows real motion. */
function paceTracks(tracks: ScenarioTrack[]): ScenarioTrack[] {
	if (PACE === "instant") return tracks;
	return tracks.map((track) => ({
		...track,
		turns: track.turns.map((turn) => ({
			...turn,
			latencyMs: turn.latencyMs ?? (track.requestClass === "review" ? 2_200 : 1_600),
			streaming: turn.streaming ?? { ttftMs: 450, tokensPerSecond: 45 },
		})),
	}));
}

async function loadMergedScript(): Promise<ScenarioScript> {
	// One simulator serves ALL selected projects: per-project needles keep tracks from cross-matching, and each
	// set's any-fallback answers whatever falls through (last set's fallback wins ties — identical text anyway).
	const tracks: ScenarioTrack[] = [];
	for (const selector of PROJECTS) {
		const dir = resolveScenarioDir(selector);
		const script = JSON.parse(await readFile(join(scenariosDir, dir, `${RUN_FILE}.json`), "utf8")) as ScenarioScript;
		for (const track of script.tracks) {
			tracks.push({ ...track, id: `${dir.slice(0, 2)}:${track.id}` });
		}
	}
	return { name: `sim-stack ${PROJECTS.join("+")} (${RUN_FILE}, ${PACE})`, seed: 42, tracks: paceTracks(tracks) };
}

async function main(): Promise<void> {
	const home = process.env.HOME as string;
	// Fail LOUDLY if the runtime port is already taken: otherwise the health check greets a FOREIGN runtime and
	// every seed lands in it with "Unknown workspace ID" while our own runtime child dies on EADDRINUSE
	// (live-hit 2026-07-10 — a leftover stack from an earlier session still held :3484).
	try {
		const response = await fetch(`http://127.0.0.1:${RUNTIME_PORT}/api/trpc/projects.list`);
		if (response.status !== 0) {
			fail(
				`port ${RUNTIME_PORT} already serves a runtime — stop it first (lsof -nP -iTCP:${RUNTIME_PORT} -sTCP:LISTEN) or set NKLEIN_SIM_STACK_PORT.`,
			);
		}
	} catch {
		/* connection refused = port free, proceed */
	}
	const script = await loadMergedScript();
	const simulator = createSimulatorServer(script, {
		models: [{ id: SIM_MODEL, state: "loaded", family: "qwen", maxContextLength: 65536 }],
	});
	await simulator.start();
	const simBase = simulator.url();
	console.log(`Simulator: ${simBase} (${script.tracks.length} tracks, pace=${PACE})`);

	await mkdir(join(home, ".nklein", "nklein"), { recursive: true });
	await mkdir(join(home, ".nklein", "data", "settings"), { recursive: true });
	await writeFile(
		// The runtime's GLOBAL config lives at ~/.nklein/nklein/config.json (runtime-config-paths.ts) — writing
		// ~/.nklein/config.json is silently ignored (live-found 2026-07-10: the setup wizard auto-fired anyway).
		join(home, ".nklein", "nklein", "config.json"),
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
	await writeFile(join(home, ".nklein", "nklein", "nklein-provider-selection.json"), JSON.stringify({ providerId: "lmstudio" }));

	const env = {
		...process.env,
		HOME: home,
		NODE_ENV: "development",
		NKLEIN_RUNTIME_PORT: String(RUNTIME_PORT),
		KANBAN_RUNTIME_PORT: String(RUNTIME_PORT),
	};
	const runtime = spawn("npx", ["tsx", "src/cli.ts", "--port", String(RUNTIME_PORT), "--no-open", "--host", "127.0.0.1"], {
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	runtime.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
	runtime.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
	runtime.on("exit", (code) => {
		console.error(`runtime exited (${code}) — stack going down`);
		process.exit(code ?? 1);
	});

	const deadline = Date.now() + 60_000;
	for (;;) {
		try {
			const response = await fetch(`http://127.0.0.1:${RUNTIME_PORT}/api/trpc/projects.list`);
			if (response.ok) break;
		} catch {
			/* not up yet */
		}
		if (Date.now() > deadline) fail("runtime did not come up within 60s");
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	console.log(`\nRuntime: http://127.0.0.1:${RUNTIME_PORT}`);
	console.log(`Web-ui:  start it with \`npm run dev --prefix web-ui\` → http://127.0.0.1:4173/<workspaceId>`);
	console.log(`Seeding projects ${PROJECTS.join(", ")} (${RUN_FILE}); loop=${LOOP}.\n`);

	// Seed the projects one after another; each monitor runs to completion, then the next starts.
	// eslint-disable-next-line no-constant-condition
	for (let round = 0; ; round += 1) {
		for (const selector of PROJECTS) {
			const registryId = resolveScenarioDir(selector);
			console.log(`\n=== seeding ${registryId} (round ${round + 1})`);
			const seed = spawn(
				"npx",
				[
					"tsx",
					"src/cli.ts",
					"dev",
					"test-project",
					"--preset",
					registryId,
					"--poll-interval-ms",
					"5000",
					"--max-wait-ms",
					"1800000",
					"--json",
				],
				{ env, stdio: ["ignore", "pipe", "pipe"] },
			);
			seed.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
			seed.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
			await new Promise((resolve) => seed.on("close", resolve));
		}
		if (!LOOP) break;
	}
	console.log("Seeding finished (loop off). Stack stays up — Ctrl-C to stop.");
	await new Promise(() => {});
}

await main();
