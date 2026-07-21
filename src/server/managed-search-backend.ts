import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
	effectiveRetrievalSearchBackendUrl,
	MANAGED_RETRIEVAL_BACKEND_URL,
	normalizeRetrievalProviderMode,
} from "../config/runtime-config-retrieval-resolver";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";

export const MANAGED_SEARCH_CONTAINER_NAME = "nklein-search-backend";
export const MANAGED_SEARCH_CONTAINER_LABEL = "nklein.kind=managed-search";
export const DEFAULT_MANAGED_SEARCH_IDLE_TTL_MS = 10 * 60 * 1_000;
const MANAGED_SEARCH_IMAGE = "searxng/searxng:latest";

export type ManagedSearchState = "stopped" | "starting" | "running" | "stopping" | "error";

export interface ManagedSearchStatus {
	state: ManagedSearchState;
	backendUrl: string;
	activeSearches: number;
	idleTtlMs: number;
	lastError: string | null;
	lastStartedAt: number | null;
}

export interface ManagedSearchBackendAdapter {
	start(): Promise<void>;
	stop(): Promise<void>;
}

export interface ManagedSearchBackendControllerOptions {
	idleTtlMs?: number;
	now?: () => number;
	schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	cancelSchedule?: (handle: ReturnType<typeof setTimeout>) => void;
}

/** Single-flight managed-backend lifecycle. A live search holds a lease; idle TTL starts only after the final release. */
export class ManagedSearchBackendController {
	private state: ManagedSearchState = "stopped";
	private activeSearches = 0;
	private lastError: string | null = null;
	private lastStartedAt: number | null = null;
	private startPromise: Promise<void> | null = null;
	private stopPromise: Promise<void> | null = null;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly idleTtlMs: number;
	private readonly now: () => number;
	private readonly schedule: NonNullable<ManagedSearchBackendControllerOptions["schedule"]>;
	private readonly cancelSchedule: NonNullable<ManagedSearchBackendControllerOptions["cancelSchedule"]>;

	constructor(
		private readonly adapter: ManagedSearchBackendAdapter,
		options: ManagedSearchBackendControllerOptions = {},
	) {
		this.idleTtlMs = Math.max(1_000, Math.trunc(options.idleTtlMs ?? DEFAULT_MANAGED_SEARCH_IDLE_TTL_MS));
		this.now = options.now ?? Date.now;
		this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
		this.cancelSchedule = options.cancelSchedule ?? clearTimeout;
	}

	status(): ManagedSearchStatus {
		return {
			state: this.state,
			backendUrl: MANAGED_RETRIEVAL_BACKEND_URL,
			activeSearches: this.activeSearches,
			idleTtlMs: this.idleTtlMs,
			lastError: this.lastError,
			lastStartedAt: this.lastStartedAt,
		};
	}

	async start(): Promise<void> {
		this.clearIdleTimer();
		if (this.state === "running") {
			this.armIdleTimer();
			return;
		}
		if (this.startPromise) return await this.startPromise;
		if (this.stopPromise) {
			await this.stopPromise;
			return await this.start();
		}
		this.state = "starting";
		this.lastError = null;
		this.startPromise = this.adapter
			.start()
			.then(() => {
				this.state = "running";
				this.lastStartedAt = this.now();
				this.armIdleTimer();
			})
			.catch((error) => {
				this.state = "error";
				this.lastError = error instanceof Error ? error.message : String(error);
				throw error;
			})
			.finally(() => {
				this.startPromise = null;
			});
		return await this.startPromise;
	}

	async stop(options: { force?: boolean } = {}): Promise<void> {
		if (this.activeSearches > 0 && options.force !== true) {
			throw new Error(`Managed search backend is busy with ${this.activeSearches} active search(es).`);
		}
		this.clearIdleTimer();
		if (this.stopPromise) return await this.stopPromise;
		this.stopPromise = (async () => {
			if (this.startPromise) await this.startPromise.catch(() => undefined);
			if (this.state === "stopped") return;
			this.state = "stopping";
			await this.adapter.stop();
			this.state = "stopped";
			this.lastError = null;
		})()
			.catch((error) => {
				this.state = "error";
				this.lastError = error instanceof Error ? error.message : String(error);
				throw error;
			})
			.finally(() => {
				this.stopPromise = null;
			});
		return await this.stopPromise;
	}

	async use<T>(operation: (backendUrl: string) => Promise<T>): Promise<T> {
		await this.start();
		this.clearIdleTimer();
		this.activeSearches += 1;
		try {
			return await operation(MANAGED_RETRIEVAL_BACKEND_URL);
		} finally {
			this.activeSearches -= 1;
			this.armIdleTimer();
		}
	}

	async close(): Promise<void> {
		await this.stop({ force: true });
	}

	private clearIdleTimer(): void {
		if (!this.idleTimer) return;
		this.cancelSchedule(this.idleTimer);
		this.idleTimer = null;
	}

	private armIdleTimer(): void {
		this.clearIdleTimer();
		if (this.state !== "running" || this.activeSearches > 0) return;
		this.idleTimer = this.schedule(() => {
			this.idleTimer = null;
			void this.stop().catch(() => undefined);
		}, this.idleTtlMs);
	}
}

/** Route one search through none/user-supplied/managed-local without weakening the caller's separate egress gate. */
export async function withConfiguredSearchBackend<T>(
	config: { providerMode?: unknown; searchBackendUrl?: unknown },
	managed: ManagedSearchBackendController,
	operation: (backendUrl: string) => Promise<T>,
): Promise<T> {
	const mode = normalizeRetrievalProviderMode(config.providerMode, config.searchBackendUrl);
	if (mode === "managed_local") return await managed.use(operation);
	const backendUrl = effectiveRetrievalSearchBackendUrl(config);
	if (!backendUrl) throw new Error("No retrieval search provider is enabled.");
	return await operation(backendUrl);
}

interface DockerResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export type ManagedSearchDockerRunner = (args: readonly string[]) => Promise<DockerResult>;

export function createManagedSearchDockerRunner(): ManagedSearchDockerRunner {
	return async (args) => {
		try {
			const result = await promisify(execFile)("docker", [...args], { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
			return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
		} catch (error) {
			const failure = error as { code?: number; stdout?: string; stderr?: string; message?: string };
			return {
				exitCode: typeof failure.code === "number" ? failure.code : null,
				stdout: failure.stdout ?? "",
				stderr: failure.stderr ?? failure.message ?? String(error),
			};
		}
	};
}

function managedSettingsPath(): string {
	return join(resolveNkleinRuntimeHomePath(homedir()), "managed-search", "settings.yml");
}

async function ensureManagedSettings(path: string): Promise<void> {
	const existing = await readFile(path, "utf8").catch(() => null);
	if (existing?.includes("formats:") && existing.includes("json")) return;
	await mkdir(dirname(path), { recursive: true });
	const secret = randomBytes(32).toString("hex");
	await writeFile(
		path,
		[
			"use_default_settings: true",
			"server:",
			`  secret_key: "${secret}"`,
			'  bind_address: "0.0.0.0"',
			"  port: 8080",
			"search:",
			"  formats:",
			"    - html",
			"    - json",
			"",
		].join("\n"),
		{ mode: 0o600 },
	);
}

export function createDockerManagedSearchBackend(
	runDocker: ManagedSearchDockerRunner = createManagedSearchDockerRunner(),
	options: { fetchImpl?: typeof fetch; settingsPath?: string } = {},
): ManagedSearchBackendAdapter {
	const settingsPath = options.settingsPath ?? managedSettingsPath();
	const fetchImpl = options.fetchImpl ?? fetch;
	return {
		async start() {
			let alreadyRunning = false;
			const inspect = await runDocker([
				"inspect",
				"-f",
				'{{index .Config.Labels "nklein.kind"}} {{.State.Running}}',
				MANAGED_SEARCH_CONTAINER_NAME,
			]);
			if (inspect.exitCode === 0) {
				const [label, running] = inspect.stdout.trim().split(/\s+/u);
				if (label !== "managed-search") {
					throw new Error(`Docker name ${MANAGED_SEARCH_CONTAINER_NAME} is occupied by an unmanaged container.`);
				}
				alreadyRunning = running === "true";
				if (!alreadyRunning) {
					const removed = await runDocker(["rm", "-f", MANAGED_SEARCH_CONTAINER_NAME]);
					if (removed.exitCode !== 0) {
						throw new Error(`Could not remove stale managed search container: ${removed.stderr}`);
					}
				}
			}
			if (!alreadyRunning) {
				await ensureManagedSettings(settingsPath);
				const started = await runDocker([
					"run",
					"-d",
					"--name",
					MANAGED_SEARCH_CONTAINER_NAME,
					"--label",
					MANAGED_SEARCH_CONTAINER_LABEL,
					"--restart",
					"no",
					"--publish",
					"127.0.0.1:18888:8080",
					"--cap-drop",
					"ALL",
					"--security-opt",
					"no-new-privileges",
					"--memory",
					"512m",
					"--cpus",
					"1",
					"--mount",
					`type=bind,src=${settingsPath},dst=/etc/searxng/settings.yml,readonly`,
					MANAGED_SEARCH_IMAGE,
				]);
				if (started.exitCode !== 0) {
					throw new Error(`Could not start managed search backend: ${started.stderr.trim()}`);
				}
			}
			// Probe only the local UI. A readiness check must never itself query public engines or bypass the
			// runtime's separate retrieval-egress gate.
			for (let attempt = 0; attempt < 20; attempt += 1) {
				const response = await fetchImpl(`${MANAGED_RETRIEVAL_BACKEND_URL}/`, {
					signal: AbortSignal.timeout(2_000),
				}).catch(() => null);
				if (response?.ok) return;
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
			await runDocker(["rm", "-f", MANAGED_SEARCH_CONTAINER_NAME]);
			throw new Error("Managed search backend did not become ready within 5 seconds.");
		},
		async stop() {
			const inspect = await runDocker([
				"inspect",
				"-f",
				'{{index .Config.Labels "nklein.kind"}}',
				MANAGED_SEARCH_CONTAINER_NAME,
			]);
			if (inspect.exitCode !== 0) return;
			if (inspect.stdout.trim() !== "managed-search") {
				throw new Error(`Refusing to remove unmanaged Docker container ${MANAGED_SEARCH_CONTAINER_NAME}.`);
			}
			const removed = await runDocker(["rm", "-f", MANAGED_SEARCH_CONTAINER_NAME]);
			if (removed.exitCode !== 0) throw new Error(`Could not stop managed search backend: ${removed.stderr.trim()}`);
		},
	};
}
