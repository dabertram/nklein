/**
 * Live verification of §5.M G6 — the chat agent actually BROWSES the web at runtime via the headless-browser
 * `browse_url` tool (user: "browser/internet access can also be enabled or disabled by the user" + the recurring
 * "test if things execute at runtime").
 *
 * Drives the REAL tool-using CLI agent (`nklein chat --workspace <dir> --browser`, the host-capable mode where the
 * `browse_url` host_command is confirm-gated) against a live local model. To stay offline-deterministic it serves a
 * tiny local HTML page (distinctive <title> + body marker) and asks the agent to browse it. It then asserts the agent
 * (a) USED browse_url and (b) its reply contains the page's body marker — which is only possible if Playwright/Chromium
 * genuinely launched, rendered the page, and the extracted text flowed back into the model's context.
 *
 * Run:  HOME=/tmp/nklein-verify PLAYWRIGHT_BROWSERS_PATH=~/Library/Caches/ms-playwright tsx scripts/verify-chat-browse.mts
 *   env: NKLEIN_VERIFY_MODEL, NKLEIN_VERIFY_BASE_URL (default LM Studio), NKLEIN_VERIFY_TIMEOUT_MS (default 180000).
 *   NOTE: because we isolate HOME, Playwright would otherwise look for its browser cache under the throwaway HOME — set
 *   PLAYWRIGHT_BROWSERS_PATH to the real `~/Library/Caches/ms-playwright` so Chromium is found (a test-harness artifact;
 *   in production the user's real HOME locates the browser normally). Requires `npx playwright install chromium` once.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const requireFromHere = createRequire(import.meta.url);

const MODEL_ID = process.env.NKLEIN_VERIFY_MODEL?.trim() || "";
const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_TIMEOUT_MS ?? "180000");
const PAGE_TITLE = "NKLEIN-BROWSE-TITLE-4242";
const PAGE_MARKER = "BROWSE-MARKER-4242-XYZ";

function log(line: string): void {
	process.stdout.write(`${line}\n`);
}

async function resolveModelId(): Promise<string> {
	if (MODEL_ID) {
		return MODEL_ID;
	}
	const response = await fetch(`${BASE_URL}/models`, { signal: AbortSignal.timeout(5000) });
	const payload = (await response.json()) as { data?: Array<{ id?: string }> };
	const id = payload.data?.[0]?.id;
	if (!id) {
		throw new Error(`Could not resolve a model id from ${BASE_URL}/models`);
	}
	return id;
}

/** Serve a one-page site with a distinctive title + body marker; returns the base URL + a close fn. */
async function startLocalSite(): Promise<{ url: string; close: () => Promise<void> }> {
	const html = `<!doctype html><html><head><title>${PAGE_TITLE}</title></head><body><h1>${PAGE_MARKER}</h1><p>A tiny local page for the live browse_url check.</p></body></html>`;
	const server = createServer((_req, res) => {
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		res.end(html);
	});
	await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("Could not bind the local site server.");
	}
	return {
		url: `http://127.0.0.1:${address.port}/`,
		close: () => new Promise<void>((closed) => server.close(() => closed())),
	};
}

async function main(): Promise<void> {
	const home = homedir();
	if (!home.includes("nklein-verify") && process.env.NKLEIN_VERIFY_ALLOW_REAL_HOME !== "1") {
		throw new Error(`Refusing to run against HOME=${home}. Set HOME to an isolated dir (e.g. /tmp/nklein-verify).`);
	}
	const modelId = await resolveModelId();
	log(`Model: ${modelId}  BaseUrl: ${BASE_URL}`);

	const site = await startLocalSite();
	log(`Local site: ${site.url}  (title "${PAGE_TITLE}", marker "${PAGE_MARKER}")`);

	const workspace = await mkdtemp(join(tmpdir(), "nklein-verify-browse-"));
	await writeFile(join(workspace, "README.md"), "# Demo project\n\nA tiny project for the live browse_url check.\n", "utf8");
	log(`Workspace: ${workspace}`);

	const cliEntry = resolve(process.cwd(), "src/cli.ts");
	const tsxLoader = pathToFileURL(requireFromHere.resolve("tsx")).href;
	const instruction = `Use the browse_url tool to open ${site.url} and then reply with the exact text of the page's main heading.`;

	const child = spawn(
		process.execPath,
		[
			"--import",
			tsxLoader,
			cliEntry,
			"chat",
			"--workspace",
			workspace,
			"--browser",
			"--message",
			instruction,
			"--base-url",
			BASE_URL,
			"--model",
			modelId,
		],
		{ cwd: process.cwd(), env: { ...process.env, NKLEIN_CORE_PY: "0" } },
	);

	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => {
		stdout += chunk.toString("utf8");
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString("utf8");
	});
	// browse_url is a confirmed host action — approve every prompt.
	child.stdin.write("y\ny\ny\ny\n");
	child.stdin.end();

	const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			rejectExit(new Error(`chat agent did not finish within ${TIMEOUT_MS}ms`));
		}, TIMEOUT_MS);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolveExit(code);
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			rejectExit(error);
		});
	}).catch((error: Error) => {
		log(`Spawn error: ${error.message}`);
		return -1;
	});

	await rm(workspace, { recursive: true, force: true }).catch(() => null);
	await site.close().catch(() => null);

	const usedBrowse = /\(used:[^)\n]*browse_url/.test(stdout);
	const markerEchoed = stdout.includes(PAGE_MARKER);

	log("");
	log("=== Chat agent browse_url result ===");
	log(`Exit code: ${exitCode}`);
	log(`Agent USED browse_url: ${usedBrowse ? "YES ✓" : "NO ⚠️"}`);
	log(`Reply echoed the page marker (proves Chromium rendered the page + text flowed back): ${markerEchoed ? "YES ✓" : "NO ⚠️"}`);
	if (!usedBrowse || !markerEchoed) {
		log("--- stdout (tail) ---");
		log(stdout.slice(-1400));
		if (stderr.trim()) {
			log("--- stderr (tail) ---");
			log(stderr.slice(-600));
		}
	}

	const ok = usedBrowse && markerEchoed;
	log("");
	log(ok ? "PASS ✓ the chat agent browsed a real page with a headless browser at runtime." : "INCOMPLETE — see above.");
	process.exit(ok ? 0 : 1);
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
