import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type KleinCorePyConfig, probeKleinCorePyHealth, resolveKleinCorePyConfig } from "../config/klein-core-config";

/**
 * Auto-start for the local-only `core-py` sidecar (todo §5.H). The Python core defaults ON (with instant in-process
 * fallback), but nothing actually launched the sidecar — so the default never delivered unless the user ran it by
 * hand. This starts it on runtime boot, when enabled and not already running, so structured-generation / embedding
 * callers get the real sidecar.
 *
 * NON-FATAL by design: every failure path (disabled, core-py not on disk, `uv`/python missing, sidecar never becomes
 * healthy) returns `null` and the runtime keeps working exactly as before (the callers fall back in-process on the
 * immediate ECONNREFUSED). A returned handle's `stop()` MUST be called on shutdown so the child does not outlive us.
 */

export interface KleinCorePySidecar {
	stop: () => Promise<void>;
}

export interface StartKleinCorePySidecarOptions {
	config?: KleinCorePyConfig;
	/** Explicit core-py project dir; auto-located (dev: `<repo>/core-py`) when omitted. */
	corePyDir?: string;
	warn?: (message: string) => void;
	/** Max time to wait for the sidecar's `/health` before giving up and falling back. */
	healthTimeoutMs?: number;
	// Injected seams (testing):
	spawnImpl?: typeof spawn;
	probeImpl?: typeof probeKleinCorePyHealth;
	delayImpl?: (ms: number) => Promise<void>;
	existsImpl?: (path: string) => boolean;
}

function defaultDelay(ms: number): Promise<void> {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function resolveCorePyDir(explicit: string | undefined, existsImpl: (path: string) => boolean): string | null {
	const candidates = [
		explicit,
		process.env.NKLEIN_CORE_PY_DIR?.trim() || undefined,
		// src/server/klein-core-sidecar.ts → repo root is two levels up; core-py lives at `<root>/core-py`.
		resolve(dirname(fileURLToPath(import.meta.url)), "../../core-py"),
		resolve(process.cwd(), "core-py"),
	].filter((candidate): candidate is string => Boolean(candidate));
	for (const candidate of candidates) {
		if (existsImpl(candidate)) {
			return candidate;
		}
	}
	return null;
}

function resolveSidecarPort(config: KleinCorePyConfig): string {
	try {
		return new URL(config.sidecarUrl).port || "3585";
	} catch {
		return "3585";
	}
}

async function stopSidecarChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	await new Promise<void>((resolveStop) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			resolveStop();
		}, 4_000);
		child.once("exit", () => {
			clearTimeout(timer);
			resolveStop();
		});
		child.kill("SIGINT");
	});
}

export async function startKleinCorePySidecar(
	options: StartKleinCorePySidecarOptions = {},
): Promise<KleinCorePySidecar | null> {
	const config = options.config ?? resolveKleinCorePyConfig();
	const warn = options.warn ?? (() => undefined);
	const probe = options.probeImpl ?? probeKleinCorePyHealth;
	const spawnImpl = options.spawnImpl ?? spawn;
	const delay = options.delayImpl ?? defaultDelay;
	const existsImpl = options.existsImpl ?? existsSync;

	if (!config.enabled) {
		return null;
	}
	// Already running (a manually-started or previously-spawned sidecar) — reuse it; do not double-bind the port.
	if ((await probe({ config, timeoutMs: 800 })).reachable) {
		return null;
	}
	const corePyDir = resolveCorePyDir(options.corePyDir, existsImpl);
	if (!corePyDir) {
		// No sidecar on disk (e.g. a packaged build that does not bundle core-py yet) — stay on the in-process path.
		return null;
	}

	const port = resolveSidecarPort(config);
	const child = spawnImpl("uv", ["run", "python", "-m", "klein_core", "--port", port], {
		cwd: corePyDir,
		stdio: "ignore",
		env: { ...process.env },
	});

	// A holder object (not a bare `let`) so the async error from the spawn callback is observed in the loop —
	// TS narrows a closured `let` to `never` inside the guard, but re-reads an object property each iteration.
	const spawnState: { error: Error | null } = { error: null };
	child.once("error", (error: unknown) => {
		spawnState.error = error instanceof Error ? error : new Error(String(error));
	});

	const deadline = Date.now() + (options.healthTimeoutMs ?? 20_000);
	while (Date.now() < deadline) {
		if (spawnState.error !== null) {
			warn(`Could not start the core-py sidecar (${spawnState.error.message}); using the in-process path.`);
			return null;
		}
		if (child.exitCode !== null) {
			warn(`The core-py sidecar exited during startup (code ${child.exitCode}); using the in-process path.`);
			return null;
		}
		if ((await probe({ config, timeoutMs: 800 })).reachable) {
			return { stop: () => stopSidecarChild(child) };
		}
		await delay(500);
	}
	await stopSidecarChild(child);
	warn("The core-py sidecar did not become healthy in time; using the in-process path.");
	return null;
}
