/**
 * The REAL-MODEL drain harness the P23.5 / N8 / P25.3 legs share: seed ONE card into a prepared workspace via
 * the A2A ingress (the proven external-trigger path — same call the soak harness makes), let the swarm work it
 * with the operator's ACTUALLY-LOADED model, and report the terminal lane plus where the workspace landed.
 *
 *   tsx scripts/real-model-drain.mts --workspace <dir> --prompt-file <f> [--out <dir>] [--max-min N]
 *
 * Deliberately NOT a simulator: the point of these legs is evidence from a real model. It therefore refuses to
 * invent a model — the roster comes from what is loaded RIGHT NOW (`/api/v0/models`), and an empty roster is a
 * refusal rather than a fallback, because a drain against a model nobody loaded proves nothing about the fleet.
 *
 * Never unloads or loads anything (directive: the resident set is the operator's). Tears down its runtime.
 */

import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPO = process.cwd();
const TSX = join(REPO, "node_modules", ".bin", "tsx");

function arg(name: string): string | null {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const workspaceSource = arg("workspace");
const promptFile = arg("prompt-file");
const maxMinutes = Number(arg("max-min") ?? "90");
const outDir = arg("out");
if (!workspaceSource || !promptFile) {
	process.stderr.write("usage: real-model-drain.mts --workspace <dir> --prompt-file <f> [--out <dir>] [--max-min N]\n");
	process.exit(64);
}

const LOCAL_BASE = process.env.NKLEIN_LOCAL_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const RUNTIME_PORT = Number(process.env.NKLEIN_DRAIN_PORT ?? "3496");

/** The loaded roster is the ONLY source of a model id — an empty roster refuses rather than inventing one. */
async function loadedModelIds(): Promise<string[]> {
	const root = LOCAL_BASE.replace(/\/+$/u, "").replace(/\/v1$/u, "");
	const response = await fetch(`${root}/api/v0/models`, { signal: AbortSignal.timeout(5_000) });
	const payload = (await response.json()) as { data?: { id?: string; state?: string }[] };
	return (payload.data ?? [])
		.filter((entry) => entry.state === "loaded" && typeof entry.id === "string")
		.map((entry) => entry.id as string);
}

const work = await realpath(await mkdtemp(join(tmpdir(), "real-drain-")));
const home = join(work, "home");
/**
 * The drain workspace ALWAYS lives outside !Klein's own checkout.
 *
 * `projects.add` refuses a path inside this repo — "this is !Klein's own source repository … needs
 * confirmation" (§5.W self-project guard). A workspace under `.real-runs/` is inside the repo, so registration
 * failed, the runtime had NO workspace, and every seeded card went nowhere while the harness polled a board
 * path that happened to exist locally (2026-08-08). The guard is right; the harness was wrong to fight it, and
 * passing confirmSelfProject to silence it would trade a real safety property for convenience.
 *
 * `--out` therefore means "copy the drained tree HERE when finished", not "work in place".
 */
const workspace = join(work, "ws");
const keepAt = outDir ? resolvePath(outDir) : null;
await mkdir(join(home, ".nklein", "nklein"), { recursive: true });
await mkdir(join(home, ".nklein", "data", "settings"), { recursive: true });
// `cp -R a b` NESTS a inside b when b already exists — a stale destination from a previous run silently
// produced a wrong tree that then got graded (live-found 2026-08-08). Always start from a clean destination.
await rm(workspace, { recursive: true, force: true });
await execFileAsync("cp", ["-R", workspaceSource, workspace]).catch(async () => {
	await mkdir(workspace, { recursive: true });
});
const git = (...args: string[]) => execFileAsync("git", ["-C", workspace, ...args]);
await git("rev-parse", "--git-dir").catch(async () => {
	await git("init", "--quiet", "--initial-branch=main");
	await git("add", "-A");
	await git("-c", "user.email=drain@local", "-c", "user.name=drain", "commit", "-qm", "init");
});

const loaded = await loadedModelIds().catch(() => []);
if (loaded.length === 0) {
	process.stderr.write(
		`REFUSED: no model is loaded at ${LOCAL_BASE}. This harness never loads models (the resident set is the operator's) and a drain against an unloaded model proves nothing.\n`,
	);
	process.exit(1);
}
const model = loaded[0] as string;
process.stdout.write(`real-model drain: model=${model} workspace=${workspace}\n`);

await writeFile(
	join(home, ".nklein", "nklein", "config.json"),
	JSON.stringify(
		{
			selectedAgentId: "nklein",
			developerModeEnabled: true,
			setupWizardCompletedAt: Date.now(),
			agentRulesets: { capability: { globalPreset: "strict" }, delivery: { globalPreset: "fully_open" } },
			modelRoles: {
				architect: { modelId: model, providerId: "lmstudio" },
				worker: { modelId: model, providerId: "lmstudio" },
				reviewer: { modelId: model, providerId: "lmstudio" },
			},
		},
		null,
		1,
	),
);
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
					settings: { provider: "lmstudio", model, baseUrl: LOCAL_BASE },
					updatedAt: new Date().toISOString(),
					tokenSource: "manual",
				},
			},
		},
		null,
		1,
	),
);

let runtime: ChildProcess | null = null;
const shutdown = async (): Promise<void> => {
	runtime?.kill("SIGTERM");
	await new Promise((tick) => setTimeout(tick, 5_000));
	if (runtime && runtime.exitCode === null) {
		runtime.kill("SIGKILL");
	}
};

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			await fetch(url, { signal: AbortSignal.timeout(2_000) });
			return;
		} catch {
			if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}`);
			await new Promise((tick) => setTimeout(tick, 1_000));
		}
	}
}

try {
	const logPath = join(work, "runtime.log");
	const { createWriteStream } = await import("node:fs");
	const runtimeLog = createWriteStream(logPath);
	runtime = spawn(TSX, ["src/cli.ts", "--host", "127.0.0.1", "--port", String(RUNTIME_PORT)], {
		cwd: REPO,
		env: { ...process.env, HOME: home, NODE_ENV: "development", NKLEIN_A2A_SERVER: "1" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	runtime.stdout?.pipe(runtimeLog);
	runtime.stderr?.pipe(runtimeLog);
	await waitForHttp(`http://127.0.0.1:${RUNTIME_PORT}/`, 90_000);

	await execFileAsync(TSX, ["-e", "void 0"]).catch(() => undefined); // no-op keeps tsx warm
	const register = await fetch(`http://127.0.0.1:${RUNTIME_PORT}/api/trpc/projects.add?batch=1`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ "0": { path: workspace } }),
	});
	// The BODY, not just the status: tRPC answers 200 with an error payload, so a status-only check reports
	// success for a registration that did not happen — precisely how the runtime ended up workspace-less.
	const registerBody = await register.text();
	process.stdout.write(`workspace registration: HTTP ${register.status} ${registerBody.slice(0, 200)}\n`);
	if (!register.ok || registerBody.includes('"error"')) {
		throw new Error(`workspace registration failed for ${workspace}: ${registerBody.slice(0, 300)}`);
	}

	const prompt = await readFile(promptFile, "utf8");
	const seeded = await fetch(`http://127.0.0.1:${RUNTIME_PORT}/a2a/v1`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: "real-drain-1",
			method: "SendMessage",
			params: { message: { messageId: "real-drain-m-1", role: "ROLE_USER", parts: [{ text: prompt }] } },
		}),
	});
	// JSON-RPC answers 200 WITH an error body — a status-only check reports a seed that never happened (the
	// same trap as projects.add above; both were hiding a rig failure behind a green HTTP code).
	const seededBody = await seeded.text();
	if (!seeded.ok || seededBody.includes('"error"')) {
		throw new Error(`A2A SendMessage failed (HTTP ${seeded.status}): ${seededBody.slice(0, 400)}`);
	}
	process.stdout.write(`card seeded: ${seededBody.slice(0, 200)}\n draining for up to ${maxMinutes}m…\n`);

	const boardPath = join(workspace, ".nklein", "nklein", "workspace", "board.json");
	const deadline = Date.now() + maxMinutes * 60_000;
	// A seeded card must APPEAR on this workspace's board quickly. An HTTP 200 from SendMessage means the
	// request was accepted, NOT that a card is being worked — and a board that stays empty is a broken rig, not
	// a slow model. Burned a 150-minute budget on `lanes: {}` before this existed (2026-08-08); silence is not
	// success, and the harness must say so in minutes rather than hours.
	const boardMustAppearBy = Date.now() + 3 * 60_000;
	let sawAnyCard = false;
	let lastSummary = "";
	for (;;) {
		await new Promise((tick) => setTimeout(tick, 30_000));
		// The persisted board is `{columns, dependencies}` — there is NO `board` wrapper. Reading `board.board`
		// yielded undefined and rendered every real lane as `{}`, so a card that was demonstrably being worked
		// looked like an empty board for the whole run (2026-08-08). Accept BOTH shapes and, crucially, treat an
		// unreadable/unparseable board as UNKNOWN rather than as empty.
		const parsed = await readFile(boardPath, "utf8")
			.then(
				(text) =>
					JSON.parse(text) as
						| { columns?: { id: string; cards: unknown[] }[] }
						| { board?: { columns: { id: string; cards: unknown[] }[] } },
			)
			.catch(() => null);
		if (parsed === null) {
			// No board file yet — say so, and let the fail-fast deadline below decide.
			process.stdout.write("  (board not readable yet)\n");
		}
		const columns =
			(parsed as { columns?: { id: string; cards: unknown[] }[] } | null)?.columns ??
			(parsed as { board?: { columns: { id: string; cards: unknown[] }[] } } | null)?.board?.columns ??
			[];
		const counts = Object.fromEntries(columns.map((column) => [column.id, column.cards.length]));
		const summary = JSON.stringify(counts);
		if (summary !== lastSummary) {
			lastSummary = summary;
			process.stdout.write(`  lanes: ${summary}\n`);
		}
		const active = (counts.backlog ?? 0) + (counts.planning ?? 0) + (counts.ready ?? 0) + (counts.in_progress ?? 0);
		const settled = (counts.completed ?? 0) + (counts.review ?? 0);
		if (active + settled > 0) {
			sawAnyCard = true;
		}
		if (!sawAnyCard && Date.now() > boardMustAppearBy) {
			process.stdout.write(
				`RIG BROKEN: no card reached ${boardPath} within 3m of seeding — the A2A accept did not become board work. Not burning the ${maxMinutes}m budget on an empty board.\n`,
			);
			process.exitCode = 2;
			break;
		}
		if (active === 0 && settled > 0) {
			process.stdout.write(`DRAIN SETTLED: ${summary}\n`);
			break;
		}
		if (Date.now() > deadline) {
			process.stdout.write(`DRAIN TIMEOUT after ${maxMinutes}m: ${summary}\n`);
			break;
		}
	}
	if (keepAt) {
		await rm(keepAt, { recursive: true, force: true });
		await execFileAsync("cp", ["-R", workspace, keepAt]).catch(() => undefined);
		process.stdout.write(`drained tree copied to: ${keepAt}\n`);
	}
	process.stdout.write(`workspace was: ${workspace}\nruntime log: ${logPath}\n`);
} finally {
	await shutdown();
	if (!outDir) {
		process.stdout.write(`(temp workdir ${work} retained for inspection)\n`);
	}
}
