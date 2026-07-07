/**
 * §5.AZ built-artifact smoke — the release gate no unit/integration test replaces.
 *
 * The entire test suite runs SOURCE (via tsx/vitest), never the production BUNDLE, so bundle-only failures ship
 * silently. Three P0 release blockers proved this on 2026-07-07 (playwright not externalized → build failed; eager
 * dev-test disk reads → `dist/cli.js` crashed on load; a CJS dep's `__filename` → the built SERVER crashed on start).
 * This script builds nothing; it assumes `npm run build` already produced `dist/`, then starts the BUILT binary in an
 * isolated temp HOME on a free port and asserts it actually serves the board (GET / + a tRPC query → HTTP 200) and
 * shuts down cleanly. Run in CI/release right after `npm run build`.
 *
 * Usage:  npm run build && npx tsx scripts/verify-built-artifact.mts
 */
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "dist", "cli.js");
const libEntry = join(repoRoot, "dist", "index.js");
const webUiIndex = join(repoRoot, "dist", "web-ui", "index.html");

function fail(message: string, log?: string): never {
	console.error(`✗ ${message}`);
	if (log) {
		console.error("--- built server output ---");
		console.error(log.trimEnd());
	}
	process.exit(1);
}

// Preconditions: the build artifacts must exist. A missing dir is a build failure, not a smoke failure.
if (!existsSync(cliPath)) {
	fail(`Missing ${cliPath}. Run \`npm run build\` first (this smoke does not build).`);
}
if (!existsSync(webUiIndex)) {
	fail(`Missing ${webUiIndex} (web UI assets). Run the full \`npm run build\` (it packages web-ui/dist).`);
}
if (!existsSync(libEntry)) {
	fail(`Missing ${libEntry} (the programmatic/library entry). Run \`npm run build\`.`);
}

// The library entry (`dist/index.js`, imported by Agent-SDK consumers) must load without side-effect crashes — the same
// class of bundle bug that broke `dist/cli.js` would break it too. Importing it exercises its module-init chain.
try {
	const lib = (await import(libEntry)) as Record<string, unknown>;
	const exportCount = Object.keys(lib).length;
	if (exportCount === 0) {
		fail(`Library entry ${libEntry} loaded but exported nothing.`);
	}
	console.log(`✓ Library entry dist/index.js loads (${exportCount} exports).`);
} catch (error) {
	fail(`Library entry ${libEntry} failed to import: ${error instanceof Error ? error.message : String(error)}`);
}

/** Reserve a free ephemeral port (bind :0, read the assigned port, release it). */
async function freePort(): Promise<number> {
	return await new Promise<number>((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			if (address && typeof address === "object") {
				const { port } = address;
				probe.close(() => resolve(port));
			} else {
				reject(new Error("could not reserve an ephemeral port"));
			}
		});
	});
}

const tempHome = mkdtempSync(join(tmpdir(), "nklein-smoke-home-"));
const tempCwd = mkdtempSync(join(tmpdir(), "nklein-smoke-cwd-"));
execFileSync("git", ["init", "-q"], { cwd: tempCwd });

const port = await freePort();
console.log(`Starting built CLI: ${cliPath} --port ${port} (HOME=${tempHome})`);

const child = spawn(process.execPath, [cliPath, "--port", String(port), "--no-open", "--no-passcode"], {
	cwd: tempCwd,
	env: { ...process.env, HOME: tempHome, NKLEIN_NO_AUTO_UPDATE: "1" },
	stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
child.stdout?.on("data", (chunk) => {
	serverLog += String(chunk);
});
child.stderr?.on("data", (chunk) => {
	serverLog += String(chunk);
});

let exited: number | null = null;
child.on("exit", (code) => {
	exited = code ?? 1;
});

function cleanup(): void {
	if (exited === null) {
		child.kill("SIGTERM");
		setTimeout(() => child.kill("SIGKILL"), 1500);
	}
	rmSync(tempHome, { recursive: true, force: true });
	rmSync(tempCwd, { recursive: true, force: true });
}

async function httpStatus(path: string): Promise<number> {
	try {
		const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2000) });
		return response.status;
	} catch {
		return 0;
	}
}

// Poll up to ~20s for the server to come up (or die).
let rootStatus = 0;
for (let attempt = 0; attempt < 40; attempt += 1) {
	if (exited !== null) {
		cleanup();
		fail(`Built server exited (code ${exited}) before serving.`, serverLog);
	}
	rootStatus = await httpStatus("/");
	if (rootStatus !== 0) {
		break;
	}
	await new Promise((resolve) => setTimeout(resolve, 500));
}

if (rootStatus === 0) {
	cleanup();
	fail("Built server did not respond on / within ~20s.", serverLog);
}

const trpcStatus = await httpStatus("/api/trpc/projects.list");
cleanup();

if (rootStatus !== 200) {
	fail(`GET / returned HTTP ${rootStatus} (expected 200).`, serverLog);
}
if (trpcStatus !== 200) {
	fail(`GET /api/trpc/projects.list returned HTTP ${trpcStatus} (expected 200).`, serverLog);
}

console.log(`✓ Built artifact smoke passed: server started, GET / → 200, projects.list → 200, clean shutdown.`);
process.exit(0);
