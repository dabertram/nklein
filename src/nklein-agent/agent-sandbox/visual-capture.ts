import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { deriveFrontendPreviewPlan, type FrontendPreviewPlan } from "../../core/frontend-preview-plan";
import { captureRouteScreenshot, type RouteScreenshotResult } from "../nklein-route-screenshot";

export interface OwnedPreviewProcess {
	readonly pid?: number;
	readonly exitCode: number | null;
}

export interface OwnedPreviewDeps {
	spawn(plan: FrontendPreviewPlan): OwnedPreviewProcess;
	waitUntilReady(process: OwnedPreviewProcess, url: string, timeoutMs: number): Promise<void>;
	capture(url: string, timeoutMs: number, width?: number, height?: number): Promise<RouteScreenshotResult>;
	terminate(process: OwnedPreviewProcess): Promise<void>;
}

/** The one-owner invariant: every path after spawn, including readiness/capture failure, tears down the process tree. */
export async function runOwnedPreviewCapture(
	input: {
		plan: FrontendPreviewPlan;
		port: number;
		timeoutMs: number;
		width?: number;
		height?: number;
	},
	deps: OwnedPreviewDeps,
): Promise<RouteScreenshotResult> {
	const process = deps.spawn(input.plan);
	const url = `http://127.0.0.1:${input.port}${input.plan.route}`;
	try {
		await deps.waitUntilReady(process, url, input.timeoutMs);
		return await deps.capture(url, input.timeoutMs, input.width, input.height);
	} finally {
		await deps.terminate(process);
	}
}

async function reserveEphemeralPort(): Promise<number> {
	return await new Promise<number>((resolvePort, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close((error) => (error ? reject(error) : resolvePort(port)));
		});
	});
}

async function packageManagerFor(cwd: string): Promise<string> {
	for (const [lockfile, manager] of [
		["pnpm-lock.yaml", "pnpm"],
		["yarn.lock", "yarn"],
		["bun.lockb", "bun"],
		["bun.lock", "bun"],
	] as const) {
		try {
			await access(join(cwd, lockfile));
			return manager;
		} catch {
			// Try the next lockfile.
		}
	}
	return "npm";
}

async function terminateProcessTree(previewProcess: ChildProcessWithoutNullStreams): Promise<void> {
	if (!previewProcess.pid || previewProcess.exitCode !== null) return;
	try {
		process.kill(-previewProcess.pid, "SIGTERM");
	} catch {
		// It may have exited between the check and signal.
	}
	await Promise.race([
		new Promise<void>((resolveExit) => previewProcess.once("exit", () => resolveExit())),
		new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 1_500)),
	]);
	if (previewProcess.exitCode === null) {
		try {
			process.kill(-previewProcess.pid, "SIGKILL");
		} catch {
			// Already gone.
		}
	}
}

export async function runSandboxVisualCapture(
	input: { route?: string; timeoutMs?: number; width?: number; height?: number },
	cwd: string,
): Promise<{
	rendered: boolean;
	consoleErrors: readonly string[];
	pngBase64: string | null;
	width: number | null;
	height: number | null;
	route: string;
	framework: FrontendPreviewPlan["framework"] | null;
}> {
	const packageJson = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as Record<string, unknown>;
	const port = await reserveEphemeralPort();
	const plan = deriveFrontendPreviewPlan({
		packageJson,
		packageManager: await packageManagerFor(cwd),
		port,
		route: input.route,
	});
	if (!plan) {
		return {
			rendered: false,
			consoleErrors: ["No allowlisted dev/start/preview package script exists."],
			pngBase64: null,
			width: null,
			height: null,
			route: input.route?.trim() || "/",
			framework: null,
		};
	}
	const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 30_000, 1_000), 120_000);
	let child: ChildProcessWithoutNullStreams | null = null;
	let spawnError: Error | null = null;
	let output = "";
	const result = await runOwnedPreviewCapture(
		{ plan, port, timeoutMs, width: input.width, height: input.height },
		{
			spawn(selectedPlan) {
				child = spawn(selectedPlan.argv[0] as string, selectedPlan.argv.slice(1), {
					cwd,
					detached: true,
					stdio: ["pipe", "pipe", "pipe"],
					env: { ...process.env, ...selectedPlan.env, NO_COLOR: "1" },
				});
				// ChildProcess emits `error` (rather than `exit`) when the executable cannot be spawned. Always attach a
				// listener: an unhandled error would crash the sandbox tool runner and bypass the structured gate result.
				child.once("error", (error) => {
					spawnError = error;
				});
				for (const stream of [child.stdout, child.stderr]) {
					stream.setEncoding("utf8");
					stream.on("data", (chunk: string) => {
						output = `${output}${chunk}`.slice(-8_000);
					});
				}
				return child;
			},
			async waitUntilReady(previewProcess, url, deadlineMs) {
				const deadline = Date.now() + deadlineMs;
				while (Date.now() < deadline) {
					if (spawnError) {
						throw new Error(`Preview process failed to start: ${spawnError.message}. ${output}`);
					}
					if (previewProcess.exitCode !== null) {
						throw new Error(`Preview process exited before readiness (${previewProcess.exitCode}). ${output}`);
					}
					try {
						const response = await fetch(url, { signal: AbortSignal.timeout(1_000), redirect: "manual" });
						if (response.status >= 200 && response.status < 400) return;
					} catch {
						// Server is still booting.
					}
					await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
				}
				throw new Error(`Preview route did not become ready within ${deadlineMs}ms. ${output}`);
			},
			async capture(url, captureTimeoutMs, width, height) {
				const { chromium } = await import("playwright");
				return await captureRouteScreenshot(
					{ url, timeoutMs: captureTimeoutMs, width, height },
					{
						launch: async (options) =>
							await chromium.launch({ ...options, args: ["--disable-dev-shm-usage", "--no-sandbox"] }),
					},
				);
			},
			async terminate() {
				if (child) await terminateProcessTree(child);
			},
		},
	).catch((error) => ({
		image: null,
		png: null,
		rendered: false,
		consoleErrors: [error instanceof Error ? error.message : String(error)],
	}));
	return {
		rendered: result.rendered,
		consoleErrors: result.consoleErrors,
		pngBase64: result.png ? Buffer.from(result.png).toString("base64") : null,
		width: result.image?.width ?? null,
		height: result.image?.height ?? null,
		route: plan.route,
		framework: plan.framework,
	};
}
