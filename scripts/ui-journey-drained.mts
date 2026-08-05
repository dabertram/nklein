/**
 * N14 — drained-board UI journey launcher.
 *
 *   tsx scripts/ui-journey-drained.mts [<drained-out-dir>]     (default: .real-runs/soak-green)
 *
 * Boots the REAL stack on a COPY of a retained drained HOME (the retained dir is evidence — never mutated):
 * copy home+ws → rewrite the workspace index to the copied paths → runtime (pinned tsx, loopback) → vite dev
 * proxying /api to it → playwright with the drained config → teardown. Exit code = playwright's.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = process.cwd();
const source = resolve(process.argv[2] ?? ".real-runs/soak-green");
const RUNTIME_PORT = Number(process.env.NKLEIN_E2E_RUNTIME_PORT ?? "3499");
const UI_PORT = Number(process.env.NKLEIN_E2E_UI_PORT ?? "4599");
const TSX = join(REPO, "node_modules", ".bin", "tsx");

function waitForExit(child: ChildProcess): Promise<number> {
	return new Promise((settle) => child.on("exit", (code) => settle(code ?? 1)));
}

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

// realpath is load-bearing: macOS mkdtemp returns /var/folders/… while the runtime normalizes workspace
// paths to /private/var/… — an index rewritten with the un-normalized path MISSES on lookup and the runtime
// silently RE-REGISTERS the workspace as a fresh one (new id, no config, guided setup fires). Live-found.
const work = await realpath(await mkdtemp(join(tmpdir(), "ui-journey-")));
const home = join(work, "home");
const workspace = join(work, "ws");
process.stdout.write(`copying drained state from ${source} → ${work}\n`);
await cp(join(source, "home"), home, { recursive: true });
await cp(join(source, "ws"), workspace, { recursive: true });
const indexPath = join(home, ".nklein", "nklein", "workspaces", "index.json");
const index = JSON.parse(await readFile(indexPath, "utf8")) as {
	entries: Record<string, { repoPath: string }>;
	repoPathToId: Record<string, string>;
};
const rewritten = {
	...index,
	entries: Object.fromEntries(
		Object.entries(index.entries).map(([id, entry]) => [id, { ...entry, repoPath: workspace }]),
	),
	repoPathToId: Object.fromEntries(Object.entries(index.repoPathToId).map(([, id]) => [workspace, id])),
};
await writeFile(indexPath, `${JSON.stringify(rewritten, null, 1)}\n`);

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
	await rm(work, { recursive: true, force: true });
};

try {
	process.stdout.write(`booting runtime on :${RUNTIME_PORT} (HOME=${home})\n`);
	const runtime = spawn(TSX, ["src/cli.ts", "--host", "127.0.0.1", "--port", String(RUNTIME_PORT)], {
		cwd: REPO,
		// NKLEIN_WEB_UI_PORT on the RUNTIME side is load-bearing: the WS/CORS origin gate only allowlists the
		// vite-dev origin when the runtime knows its port — without it every browser socket 403s and the UI
		// renders "Disconnected" while curl/node probes (no Origin header) sail through. Live-found here.
		env: { ...process.env, HOME: home, NODE_ENV: "development", NKLEIN_WEB_UI_PORT: String(UI_PORT) },
		stdio: ["ignore", "pipe", "pipe"],
	});
	children.push(runtime);
	runtime.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
	await waitForHttp(`http://127.0.0.1:${RUNTIME_PORT}/`, 60_000);

	process.stdout.write(`booting web-ui on :${UI_PORT}\n`);
	const ui = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(UI_PORT)], {
		cwd: join(REPO, "web-ui"),
		env: {
			...process.env,
			NKLEIN_WEB_UI_PORT: String(UI_PORT),
			NKLEIN_RUNTIME_PORT: String(RUNTIME_PORT),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	children.push(ui);
	await waitForHttp(`http://127.0.0.1:${UI_PORT}/`, 90_000);

	process.stdout.write(`running drained journeys…\n`);
	const playwright = spawn(
		join(REPO, "web-ui", "node_modules", ".bin", "playwright"),
		["test", "--config", "playwright.drained.config.ts"],
		{
			cwd: join(REPO, "web-ui"),
			env: { ...process.env, NKLEIN_E2E_BASE_URL: `http://127.0.0.1:${UI_PORT}` },
			stdio: "inherit",
		},
	);
	const code = await waitForExit(playwright);
	process.exitCode = code;
	process.stdout.write(code === 0 ? "DRAINED JOURNEYS PASS\n" : `DRAINED JOURNEYS FAIL (exit ${code})\n`);
} finally {
	await shutdown();
}
