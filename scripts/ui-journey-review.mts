/**
 * N14 — operator-review journey launcher: fresh sim-backed stack (aimock scenario + runtime + vite), then the
 * tests-review/ Playwright suite drives the WHOLE loop through the UI (create with auto-review off → start →
 * sim worker → Review parks → operator Merge). After the suite, this launcher asserts the merge reached git:
 * `main` must contain the worker's file. Sim + HOME seeding mirror scripts/soak-simulated.mts (same wire
 * truths); teardown removes everything.
 */

import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createSimulatorServer } from "../packages/llm-simulator/src/server";
import type { ScenarioScript } from "../packages/llm-simulator/src/scenario/track-types";

const execFileAsync = promisify(execFile);
const REPO = process.cwd();
const RUNTIME_PORT = Number(process.env.NKLEIN_E2E_RUNTIME_PORT ?? "3498");
const UI_PORT = Number(process.env.NKLEIN_E2E_UI_PORT ?? "4598");
const SIM_MODEL = "sim/soak-coder";
const TSX = join(REPO, "node_modules", ".bin", "tsx");

/** Worker-only generic tracks: auto-review is OFF in this journey, so no reviewer track exists on purpose. */
function reviewJourneyScript(): ScenarioScript {
	return {
		name: "review-journey",
		seed: 11,
		tracks: [
			{
				id: "journey-worker",
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
											{ path: "soak-note.md", content: "Operator journey note.\n" },
											{
												path: "soak-note.test.js",
												content:
													"const test = require('node:test');\nconst assert = require('node:assert');\ntest('note exists', () => { assert.ok(true); });\n",
											},
										],
									},
								},
							],
						},
					},
					{ behavior: { kind: "text", content: "Wrote the note and its covering test." } },
				],
			},
			{
				id: "journey-any",
				requestClass: "any",
				repeatLastTurn: true,
				turns: [{ behavior: { kind: "text", content: "Acknowledged." } }],
			},
		],
	};
}

const work = await realpath(await mkdtemp(join(tmpdir(), "ui-review-")));
const home = join(work, "home");
const workspace = join(work, "ws");
await mkdir(join(home, ".nklein", "nklein"), { recursive: true });
await mkdir(join(home, ".nklein", "data", "settings"), { recursive: true });
await mkdir(workspace, { recursive: true });
await writeFile(
	join(workspace, "package.json"),
	`${JSON.stringify({ name: "review-ws", private: true, scripts: { test: "node --test" } }, null, 1)}\n`,
);
await writeFile(join(workspace, "README.md"), "review journey workspace\n");
const git = (...args: string[]) => execFileAsync("git", ["-C", workspace, ...args]);
await git("init", "--quiet", "--initial-branch=main");
await git("add", "-A");
await git("-c", "user.email=journey@local", "-c", "user.name=journey", "commit", "-qm", "init");

const simulator = createSimulatorServer(reviewJourneyScript(), {
	models: [{ id: SIM_MODEL, state: "loaded", family: "qwen", maxContextLength: 65536 }],
});
await simulator.start();
const simBase = simulator.url();
process.stdout.write(`review-journey simulator: ${simBase}\n`);

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
// Board-started cards resolve the NATIVE provider through this selection file (A2A cards carry per-card
// settings instead — which is why the soak never tripped on it; live-found: "No native !Klein provider").
await writeFile(
	join(home, ".nklein", "nklein", "nklein-provider-selection.json"),
	`${JSON.stringify({ providerId: "lmstudio" }, null, 2)}\n`,
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

const children: ChildProcess[] = [];
const shutdown = async (): Promise<void> => {
	for (const child of children) {
		child.kill("SIGTERM");
	}
	await new Promise((tick) => setTimeout(tick, 2_000));
	for (const child of children) {
		if (child.exitCode === null) {
			child.kill("SIGKILL");
		}
	}
	await simulator.stop().catch(() => undefined);
	await rm(work, { recursive: true, force: true });
};

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			await fetch(url, { signal: AbortSignal.timeout(2_000) });
			return;
		} catch {
			if (Date.now() > deadline) {
				throw new Error(`timed out waiting for ${url}`);
			}
			await new Promise((tick) => setTimeout(tick, 500));
		}
	}
}

try {
	process.stdout.write(`booting runtime on :${RUNTIME_PORT}\n`);
	const runtimeLogPath = join(work, "runtime.log");
	const runtimeLog = await import("node:fs").then((fs) => fs.createWriteStream(runtimeLogPath));
	const runtime = spawn(TSX, ["src/cli.ts", "--host", "127.0.0.1", "--port", String(RUNTIME_PORT)], {
		cwd: REPO,
		env: { ...process.env, HOME: home, NODE_ENV: "development", NKLEIN_WEB_UI_PORT: String(UI_PORT) },
		stdio: ["ignore", "pipe", "pipe"],
	});
	runtime.stdout?.pipe(runtimeLog);
	runtime.stderr?.pipe(runtimeLog);
	children.push(runtime);
	await waitForHttp(`http://127.0.0.1:${RUNTIME_PORT}/`, 60_000);

	// Register the workspace through the runtime's own API (the UI journey then just opens it).
	const register = await fetch(`http://127.0.0.1:${RUNTIME_PORT}/api/trpc/projects.add?batch=1`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ "0": { path: workspace } }),
	});
	process.stdout.write(`workspace registration: ${register.status} ${(await register.text()).slice(0, 160)}\n`);

	process.stdout.write(`booting web-ui on :${UI_PORT}\n`);
	const ui = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(UI_PORT)], {
		cwd: join(REPO, "web-ui"),
		env: { ...process.env, NKLEIN_WEB_UI_PORT: String(UI_PORT), NKLEIN_RUNTIME_PORT: String(RUNTIME_PORT) },
		stdio: ["ignore", "pipe", "pipe"],
	});
	children.push(ui);
	await waitForHttp(`http://127.0.0.1:${UI_PORT}/`, 90_000);

	process.stdout.write("running operator-review journey…\n");
	const playwright = spawn(
		join(REPO, "web-ui", "node_modules", ".bin", "playwright"),
		["test", "--config", "playwright.review.config.ts"],
		{
			cwd: join(REPO, "web-ui"),
			env: { ...process.env, NKLEIN_E2E_BASE_URL: `http://127.0.0.1:${UI_PORT}` },
			stdio: "inherit",
		},
	);
	const code = await new Promise<number>((settle) => playwright.on("exit", (value) => settle(value ?? 1)));

	// The merge's ground truth: main must now contain the worker's file.
	let merged = false;
	try {
		await git("show", "main:soak-note.md");
		merged = true;
	} catch {
		merged = false;
	}
	const pass = code === 0 && merged;
	if (!pass) {
		const tail = await import("node:fs/promises").then((fs) =>
			fs.readFile(runtimeLogPath, "utf8").then((text) => text.split("\n").slice(-40).join("\n")).catch(() => ""),
		);
		process.stdout.write(`--- runtime.log tail ---\n${tail}\n------------------------\n`);
	}
	process.stdout.write(
		pass
			? "REVIEW JOURNEY PASS (UI merge reached git main)\n"
			: `REVIEW JOURNEY FAIL (playwright=${code}, mergedToMain=${merged})\n`,
	);
	process.exitCode = pass ? 0 : 1;
} finally {
	await shutdown();
}
