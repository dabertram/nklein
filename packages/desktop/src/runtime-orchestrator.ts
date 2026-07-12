import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { powerSaveBlocker } from "electron";

import { type DesktopBindPlan, resolveRuntimeConnectHost } from "./network-access-config.js";
import { RuntimeChildManager } from "./runtime-child.js";
import {
	DESKTOP_HEALTH_PATH,
	DESKTOP_NONCE_ENV,
	type DesktopHealthResponse,
	generateDesktopNonce,
	resolveDesktopTrust,
} from "./runtime-trust.js";

interface RuntimeOrchestratorOptions {

	/** The host the runtime BINDS to (`--host`). The orchestrator itself always dials the connect host. */
	host: string;
	port: number;
	/** The browse-to host advertised to LAN users (`--public-host`), when LAN serving is on. */
	publicHost?: string | null;
	/** Pass the runtime's `--insecure-remote-http` opt-out (required for a non-loopback plain-HTTP bind). */
	insecureRemoteHttp?: boolean;
	healthTimeoutMs: number;
	resolveCliShimPath: () => string;
	/**
	 * Whether this is a packaged (production) build. Controls the trust policy
	 * for pre-existing runtimes: packaged builds refuse to attach without a
	 * verified nonce; dev builds allow title-based liveness with a warning.
	 * Defaults to false (dev/test).
	 */
	isPackaged?: boolean;
	fetchImpl?: typeof fetch;
	attachedProbeIntervalMs?: number;
	attachedProbeFailureThreshold?: number;
	recoveryProbeIntervalMs?: number;
}

interface RuntimeOrchestratorEventMap {
	"url-changed": [url: string | null];
	crashed: [];
}

// Aggressive — defends against the attached runtime's own bundled web-ui
// rendering a stale in-app disconnected fallback before ours can take over.
const DEFAULT_ATTACHED_PROBE_INTERVAL_MS = 500;
const DEFAULT_ATTACHED_PROBE_FAILURE_THRESHOLD = 2;
const DEFAULT_RECOVERY_PROBE_INTERVAL_MS = 2_000;
const DEFAULT_CHILD_SHUTDOWN_TIMEOUT_MS = 5_000;
const POWER_SAVE_BLOCKER_INACTIVE = -1;

/**
 * Title strings checked as a *liveness hint* when the orchestrator falls
 * back to title-based health (pre-existing runtime in dev builds only).
 * These are NOT sufficient to authorise bridge attachment — nonce
 * verification (§5.Y #10) is the actual trust gate.
 *
 * Accept the legacy Kanban title for one release so an older already-
 * running runtime still counts as "live" during the rename transition.
 */
export const RUNTIME_HEALTH_TITLES = ["<title>!Klein</title>", "<title>Kanban</title>"] as const;

export class RuntimeOrchestrator extends EventEmitter<RuntimeOrchestratorEventMap> {

	private manager: RuntimeChildManager | null = null;
	private url: string | null = null;
	private ownsChild = false;
	private connectPromise: Promise<void> | null = null;
	private restartPromise: Promise<void> | null = null;
	private powerSaveBlockerId = POWER_SAVE_BLOCKER_INACTIVE;
	private attachedProbeTimer: NodeJS.Timeout | null = null;
	private attachedProbeFailures = 0;
	private recoveryProbeTimer: NodeJS.Timeout | null = null;
	private attachedProbeInFlight = false;
	private recoveryProbeInFlight = false;
	private lastKnownOrigin: string | null = null;
	// Monotonic generation counters used to invalidate in-flight probe ticks
	// across lifecycle transitions (restart/shutdown/dispose). The interval
	// timer can be cleared, but a tick already past the timer-fire boundary
	// is still awaiting `checkHealth` and would otherwise mutate state long
	// after the orchestrator has moved on. Each tick captures the gen at
	// entry and re-checks after every `await`; `stopX()` increments the
	// counter so any captured gen is now stale.
	private attachedProbeGen = 0;
	private recoveryProbeGen = 0;
	// Resolved + validated CLI shim path. Cached on first lookup so we
	// don't re-resolve on every child spawn (the option's
	// `resolveCliShimPath` is deterministic — it depends only on
	// `app.isPackaged` and `process.platform` — but re-running the same
	// `path.join` on every restart is wasteful, and more importantly we
	// want validation to run *once* with a clear, actionable error so a
	// missing shim doesn't surface as an opaque ENOENT from `child_process`
	// at spawn time. Initial value `null` distinguishes "not yet looked
	// up" from "looked up and resolved to a string".
	private cachedShimPath: string | null = null;

	// Latched once `shutdown()` / `dispose()` begin. Every `await` boundary
	// in the lifecycle methods (`connect`, `restart`, `startOwnRuntime`)
	// re-checks this flag and bails without side-effects when it flips.
	// Closes the otherwise-open race where a slow `checkHealth` /
	// `manager.start()` returns *after* the user has quit, and the
	// continuation would either resurrect URL state on a torn-down
	// orchestrator or spawn an orphan child process with no owner left
	// to ever shut it down. Probe gen tokens cover the inner ticks; this
	// flag is the equivalent for the outer promises.
	private terminated = false;

	// Nonce we passed to the most-recently-spawned child runtime. Cleared
	// when we enter attached mode (pre-existing runtime). The nonce is the
	// authoritative trust gate for bridge attachment (§5.Y #10).
	private activeNonce: string | null = null;

	// The bind plan for the NEXT spawn (§ desktop app #2 — LAN serving). Seeded from the
	// startup options; replaced by `setBindPlan()` when the user flips the Settings toggle,
	// so the follow-up runtime restart binds the new host without a full app relaunch.
	private bindPlan: DesktopBindPlan;

	constructor(private readonly opts: RuntimeOrchestratorOptions) {
		super();
		this.bindPlan = {
			host: opts.host,
			publicHost: opts.publicHost ?? null,
			insecureRemoteHttp: opts.insecureRemoteHttp ?? false,
		};
	}

	getUrl(): string | null {
		return this.url;
	}

	isOwned(): boolean {
		return this.ownsChild;
	}

	/** The bind plan the next spawned runtime will use. */
	getBindPlan(): DesktopBindPlan {
		return this.bindPlan;
	}

	/**
	 * Swap the bind plan for the NEXT runtime spawn. Called when the user toggles LAN serving
	 * in Settings; takes effect on the next `restart()` (the caller prompts for it) — the
	 * currently-running child keeps its bind until then.
	 */
	setBindPlan(plan: DesktopBindPlan): void {
		this.bindPlan = plan;
	}

	/**
	 * The nonce that was passed to the most-recently-spawned child runtime,
	 * or null if we are in attached mode (no owned child). Exposed for
	 * testing the §5.Y #10 handshake without process-level spawn.
	 */
	getActiveNonce(): string | null {
		return this.activeNonce;
	}

	defaultOrigin(): string {
		// Always a dialable same-machine address: on a wildcard bind the desktop still talks
		// to its runtime over loopback (see resolveRuntimeConnectHost).
		return `http://${resolveRuntimeConnectHost(this.bindPlan.host)}:${this.opts.port}`;
	}

	/**
	 * Title-based liveness probe — checks that `/` returns a recognised app
	 * title. Used as a supplementary liveness hint (attached probe, recovery
	 * probe) and as the dev-mode fallback for pre-existing runtimes.
	 * NOT sufficient to authorise bridge attachment on its own (§5.Y #10).
	 */
	async checkHealth(origin: string): Promise<boolean> {
		const fetchFn = this.opts.fetchImpl ?? globalThis.fetch;
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(),
			this.opts.healthTimeoutMs,
		);
		try {
			const res = await fetchFn(`${origin}/`, {
				signal: controller.signal,
			});
			if (!res.ok) return false;
			// See `RUNTIME_HEALTH_TITLES` for the body-match rationale.
			const body = await res.text();
			return RUNTIME_HEALTH_TITLES.some((title) => body.includes(title));
		} catch {

			return false;
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Fetch the nonce from the runtime's dedicated health endpoint.
	 * Returns null if the endpoint is absent (runtime predates §5.Y #10)
	 * or if the request fails for any reason.
	 */
	private async fetchDesktopNonce(origin: string): Promise<DesktopHealthResponse | null> {
		const fetchFn = this.opts.fetchImpl ?? globalThis.fetch;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.opts.healthTimeoutMs);
		try {
			const res = await fetchFn(`${origin}${DESKTOP_HEALTH_PATH}`, {
				signal: controller.signal,
			});
			if (!res.ok) return null;
			const json: unknown = await res.json();
			if (
				json !== null &&
				typeof json === "object" &&
				"nonce" in json &&
				typeof (json as Record<string, unknown>).nonce === "string"
			) {
				return { nonce: (json as Record<string, unknown>).nonce as string };
			}
			return null;
		} catch {
			return null;
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Determine whether the runtime at `origin` is trusted enough to attach
	 * the preload bridge.
	 *
	 * For owned (spawned) runtimes (activeNonce !== null): only the nonce
	 * endpoint matters. Title liveness is not checked — the nonce is the
	 * authoritative gate, and calling checkHealth would produce false negatives
	 * for dev stubs that don't serve real HTML.
	 *
	 * For pre-existing runtimes (activeNonce === null): title liveness is
	 * checked first (cheap liveness gate); if it passes, the nonce endpoint is
	 * then checked (sequential — avoids two concurrent in-flight fetches on
	 * the same connection/stub which would break test stubs that only queue
	 * one pending resolver at a time). The nonce will be absent for pre-existing
	 * runtimes, so the result falls through to the dev-mode leniency path.
	 *
	 * Throws if untrusted so the caller surfaces a visible failure.
	 */
	private async verifyRuntimeTrust(origin: string): Promise<void> {
		const isOwned = this.activeNonce !== null;
		let titleLiveness = false;
		let nonceResponse: DesktopHealthResponse | null = null;

		if (isOwned) {
			// Owned path: nonce only. Title is irrelevant for owned processes.
			nonceResponse = await this.fetchDesktopNonce(origin);
		} else if (this.opts.isPackaged ?? false) {
			// Packaged + pre-existing: check both title (liveness) and nonce
			// (the nonce will be absent, so the hard-refuse will fire).
			titleLiveness = await this.checkHealth(origin);
			if (!this.terminated) {
				nonceResponse = await this.fetchDesktopNonce(origin);
			}
		} else {
			// Dev + pre-existing: title liveness only. In dev mode a pre-existing
			// runtime is trusted by title alone (§5.Y #10 dev leniency). The
			// nonce endpoint will be absent since we didn't spawn this runtime,
			// so fetching it adds a round-trip that always returns null — skip it.
			titleLiveness = await this.checkHealth(origin);
		}

		const trust = resolveDesktopTrust({
			expectedNonce: this.activeNonce,
			nonceResponse,
			titleLiveness,
			isPackaged: this.opts.isPackaged ?? false,
		});
		if (!trust.trusted) {
			throw new Error(`[desktop] Runtime at ${origin} not trusted: ${trust.reason}`);
		}
		// Warn in dev mode for any unverified attach.
		if (!(this.opts.isPackaged ?? false) && nonceResponse === null) {
			if (isOwned) {
				console.warn(
					`[desktop] WARNING: spawned runtime at ${origin} did not respond on ` +
					"/api/desktop-health — nonce verification skipped (dev mode). " +
					"In packaged builds this would refuse to attach.",
				);
			} else {
				console.warn(
					`[desktop] WARNING: attaching to pre-existing runtime at ${origin} ` +
					"without nonce verification (dev mode). " +
					"In packaged builds this would be refused.",
				);
			}
		}
	}


	async connect(): Promise<void> {
		if (this.terminated) return;
		if (this.connectPromise) {
			await this.connectPromise;
			return;
		}
		this.connectPromise = (async () => {
			const origin = this.defaultOrigin();
			// Pre-existing runtime path: no activeNonce yet (we haven't spawned
			// anything). verifyRuntimeTrust performs title liveness + nonce check
			// and throws if the result is untrusted. On throw we fall through to
			// startOwnRuntime (spawning our own runtime with a nonce).
			let preExistingHealthy = false;
			try {
				// Clear nonce so resolveDesktopTrust knows this is a pre-existing attach.
				this.activeNonce = null;
				await this.verifyRuntimeTrust(origin);
				preExistingHealthy = true;
			} catch (trustErr) {
				// Not healthy OR not trusted. In packaged mode the trust failure
				// is a hard error for an existing runtime, but we still fall
				// through to spawn our own — the spawned child will be verified
				// with a nonce. Log only if it was a trust rejection (not just
				// "nothing there"), so we don't spam the log on cold start.
				const msg = trustErr instanceof Error ? trustErr.message : String(trustErr);
				if (!msg.includes("not trusted")) {
					// Ordinary "nothing there" failure — silent fall-through.
				} else {
					console.warn(msg);
				}
			}
			// Re-check after the await: a `dispose()` / `shutdown()` may have
			// fired during the in-flight health probe. Without this guard
			// the IIFE would keep going and `setUrl(origin, false)` on a
			// torn-down orchestrator (or call `startOwnRuntime` and spawn
			// an orphan child after teardown).
			if (this.terminated) return;
			if (preExistingHealthy) {
				console.log(`[desktop] Found existing runtime at ${origin}`);
				this.setUrl(origin, /* owns */ false);
				return;
			}
			console.log("[desktop] No trusted runtime found — starting child process.");
			await this.startOwnRuntime();
		})().finally(() => {
			this.connectPromise = null;
		});
		await this.connectPromise;
	}

	async restart(): Promise<void> {
		if (this.terminated) return;
		if (this.restartPromise) {
			await this.restartPromise;
			return;
		}
		this.stopAttachedProbe();
		this.stopRecoveryProbe();
		this.restartPromise = (async () => {
			// Let an in-flight connect() finish before tearing the manager
			// down, otherwise shutdown() races with the initial spawn. The
			// URL clear has to happen *after* this join — clearing earlier
			// would be overwritten by the connect()'s own setUrl().
			if (this.connectPromise) {
				await this.connectPromise.catch(() => {});
			}
			if (this.terminated) return;
			// Drop the URL before `manager.shutdown()` so `getUrl()` doesn't
			// keep returning the dead origin during the multi-second graceful
			// shutdown window. Without this hoist, anything that queries
			// `getUrl()` mid-restart (e.g. `loadUrlInAllWindows` triggered
			// from a new BrowserWindow) would load the about-to-be-killed
			// origin. Also covers attached-mode → restart, where the
			// shutdown branch below is skipped entirely.
			this.setUrl(null, /* owns */ false);
			if (this.manager) {
				// Detach `crashed` / `error` listeners *before* awaiting
				// `manager.shutdown()`. If the child times out and gets
				// SIGKILL'd, the manager fires a final `crashed` event
				// during graceful shutdown — and during `restart()` the
				// `terminated` flag is still false, so `handleCrash` would
				// emit a spurious `"crashed"` to listeners (e.g. a UI
				// dialog) and arm a recovery probe that immediately gets
				// cancelled by the imminent `startOwnRuntime()`. The
				// distinguishing semantics of restart vs crash is "I
				// asked for this teardown" — and that's encoded by
				// silencing the listeners up front.
				const dyingManager = this.manager;
				dyingManager.removeAllListeners("crashed");
				dyingManager.removeAllListeners("error");
				this.manager = null;
				await dyingManager.shutdown().catch((err) => {
					console.warn(
						"[desktop] Runtime shutdown during restart failed:",
						err instanceof Error ? err.message : err,
					);
				});
			}
			if (this.terminated) return;
			await this.startOwnRuntime();

		})().finally(() => {
			this.restartPromise = null;
		});
		await this.restartPromise;
	}

	async shutdown(): Promise<void> {
		if (this.terminated) return;
		// Latch *before* the awaits so any in-flight `connect`/`restart`
		// continuation that resumes during this drain sees the flag and
		// bails without side effects.
		this.terminated = true;
		// Drain in-flight lifecycle promises so we don't tear down the
		// manager while `manager.start()` is still spawning a child. After
		// the drain, the IIFE's post-await `terminated` check turns the
		// continuation into a no-op (or routes a just-spawned child into
		// the orphan-cleanup branch in `startOwnRuntime`).
		if (this.connectPromise) await this.connectPromise.catch(() => {});
		if (this.restartPromise) await this.restartPromise.catch(() => {});

		this.stopAppNapPrevention();
		this.stopAttachedProbe();
		this.stopRecoveryProbe();
		if (this.manager && this.ownsChild) {
			await this.manager.shutdown().catch((err) => {
				console.error(
					"[desktop] Runtime shutdown error:",
					err instanceof Error ? err.message : err,
				);
			});
		}
		// Clear orchestrator state so post-shutdown observers (`getUrl()`,
		// `isOwned()`) reflect "disconnected", and any subsequent
		// `connect()`/`startOwnRuntime()` does not reuse the dead manager
		// via the `if (!this.manager)` short-circuit. Routing through
		// `setUrl(null, false)` keeps lifecycle transitions consistent —
		// it emits `url-changed(null)` for any window listening, and stops
		// the attached probe in case it was somehow still running.
		if (this.manager) {
			this.manager.removeAllListeners("crashed");
			this.manager.removeAllListeners("error");
			this.manager = null;
		}
		this.setUrl(null, /* owns */ false);
	}

	async dispose(): Promise<void> {
		if (this.terminated) return;
		this.terminated = true;
		// Same drain as `shutdown()` — see the rationale there.
		if (this.connectPromise) await this.connectPromise.catch(() => {});
		if (this.restartPromise) await this.restartPromise.catch(() => {});

		// Same teardown as `shutdown()` plus `manager.dispose()`. Symmetric
		// state clear so post-dispose `getUrl()`/`isOwned()` don't lie.
		this.stopAppNapPrevention();
		this.stopRecoveryProbe();
		this.stopAttachedProbe();
		// Capture the manager reference before the await: a `crashed` event
		// can fire during `manager.dispose()` and re-enter `handleCrash`,
		// which would set `this.manager = null` mid-flight. Without the
		// local capture, the listener-removal calls below would throw
		// `Cannot read properties of null` and surface as an unhandled
		// rejection from `dispose()`. The post-await `this.manager ===
		// manager` re-check guards against the same case from the other
		// direction (don't null a manager somebody else already replaced).
		const manager = this.manager;
		if (manager) {
			await manager.dispose().catch((err) => {
				console.warn(
					"[desktop] Runtime dispose failed:",
					err instanceof Error ? err.message : err,
				);
			});
			manager.removeAllListeners("crashed");
			manager.removeAllListeners("error");
			if (this.manager === manager) this.manager = null;
		}
		this.setUrl(null, /* owns */ false);
	}


	startAppNapPrevention(): void {
		if (this.powerSaveBlockerId !== POWER_SAVE_BLOCKER_INACTIVE) return;
		this.powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
	}

	stopAppNapPrevention(): void {
		if (this.powerSaveBlockerId === POWER_SAVE_BLOCKER_INACTIVE) return;
		powerSaveBlocker.stop(this.powerSaveBlockerId);
		this.powerSaveBlockerId = POWER_SAVE_BLOCKER_INACTIVE;
	}

	private async startOwnRuntime(): Promise<void> {
		// Skip the spawn entirely if a teardown already began. Without
		// this, a `connect()` IIFE that fell through to `startOwnRuntime`
		// after `dispose()` cleared the URL would still create a fresh
		// `RuntimeChildManager` and spawn an orphan child process.
		if (this.terminated) return;
		if (!this.manager) {
			// Generate a fresh nonce for this spawn. The manager's extraEnv
			// carries it to the child process via NKLEIN_DESKTOP_NONCE, and
			// we verify the runtime echoes it on /api/desktop-health before
			// exposing the bridge (§5.Y #10).
			const nonce = generateDesktopNonce();
			this.activeNonce = nonce;
			this.manager = this.createManager(nonce);
		}
		try {
			const url = await this.manager.start({
				host: this.bindPlan.host,
				port: this.opts.port,
				publicHost: this.bindPlan.publicHost,
				insecureRemoteHttp: this.bindPlan.insecureRemoteHttp,
			});
			if (this.terminated) {
				// `shutdown()` / `dispose()` fired while `manager.start()`
				// was still spawning. The child is now alive but the
				// orchestrator is torn down — clean up the orphan
				// directly here so we don't leak a runtime process.
				// `shutdown()`/`dispose()` themselves can't catch this:
				// they sampled `this.manager` before the spawn completed
				// (it was created in `createManager()` above, but only
				// became *running* with a real child after the await
				// resolved), and by the time their drain unblocks they've
				// already moved past the manager-teardown branch.
				//
				// Capture the manager reference before the await for the
				// same reason as `dispose()`: a `crashed` event during
				// `manager.shutdown()` re-enters `handleCrash`, which sets
				// `this.manager = null`. Without the local capture, the
				// post-await listener-removal would throw `Cannot read
				// properties of null` — silently swallowed by the drain's
				// `.catch(() => {})` in shutdown/dispose, but still wrong:
				// the listener-removal never runs, leaving stale
				// `crashed`/`error` listeners attached to the doomed
				// manager. The `this.manager === manager` re-check before
				// nulling guards against racing with anybody else who
				// already replaced the field.
				const manager = this.manager;
				await manager.shutdown().catch(() => {});
				manager.removeAllListeners("crashed");
				manager.removeAllListeners("error");
				if (this.manager === manager) this.manager = null;
				return;
			}

			// Verify the spawned runtime echoes our nonce before attaching.
			// This is the §5.Y #10 trust gate for owned children.
			await this.verifyRuntimeTrust(url);

			if (this.terminated) return;

			this.setUrl(url, /* owns */ true);
		} catch (err) {
			// On spawn failure, drop the rejected manager so the next
			// `connect()`/`restart()` doesn't reuse this dead instance via
			// the `if (!this.manager)` short-circuit (which would either
			// hide the real failure mode or call `start()` twice on a
			// manager that didn't expect it).
			if (this.manager) {
				this.manager.removeAllListeners("crashed");
				this.manager.removeAllListeners("error");
				this.manager = null;
			}
			this.activeNonce = null;
			// Suppress on terminated — caller (drain inside shutdown/dispose)
			// already moved past the point where it cares about the spawn
			// failure, and re-throwing would surface as an unhandled
			// rejection on the abandoned promise.
			if (this.terminated) return;
			throw err;
		}
	}

	/**
	 * Resolve the CLI shim path on first call and validate it exists. The
	 * path itself is deterministic (depends only on `app.isPackaged` and
	 * `process.platform`), so we cache it after the first lookup. Validation
	 * runs only once: a missing shim is a packaging or dev-stage issue,
	 * not a transient one — re-checking on every restart would just delay
	 * surfacing the same error.
	 *
	 * Throws with an actionable message rather than letting Node fail at
	 * `child_process.spawn` time with an opaque ENOENT — the user sees
	 * exactly which path was checked and the most likely remediation.
	 */
	private getValidatedShimPath(): string {
		if (this.cachedShimPath !== null) return this.cachedShimPath;
		const resolved = this.opts.resolveCliShimPath();
		if (!existsSync(resolved)) {
			throw new Error(
				`CLI shim not found at ${resolved}. ` +
					`In dev, run \`npm run stage:cli\` to populate build/bin/. ` +
					`In packaged builds, this indicates a corrupted install — ` +
					`expected the shim under Resources/bin/.`,
			);
		}
		this.cachedShimPath = resolved;
		return resolved;
	}

	private createManager(nonce: string): RuntimeChildManager {
		const manager = new RuntimeChildManager({
			cliPath: this.getValidatedShimPath(),
			shutdownTimeoutMs: DEFAULT_CHILD_SHUTDOWN_TIMEOUT_MS,
			// Pass the nonce to the spawned runtime so it can echo it on
			// /api/desktop-health (§5.Y #10).
			extraEnv: { [DESKTOP_NONCE_ENV]: nonce },
		});


		manager.on("crashed", (exitCode, signal, stderrTail) => {
			console.error(
				`[desktop] Runtime crashed (code=${exitCode}, signal=${signal})`,
			);
			if (stderrTail.trim().length > 0) {
				console.error(`[desktop] Runtime stderr tail:\n${stderrTail}`);
			}
			this.handleCrash();
		});

		manager.on("error", (message: string) => {
			console.error(`[desktop] Runtime error: ${message}`);
		});

		return manager;
	}

	private handleCrash(): void {
		// Detach listeners on the dead manager before dropping it so a
		// stray `error` from child cleanup can't re-enter `handleCrash`.
		if (this.manager) {
			this.manager.removeAllListeners("crashed");
			this.manager.removeAllListeners("error");
		}
		this.manager = null;
		if (this.terminated) {
			// Teardown raced with the child's own crash; clear URL but
			// don't arm recovery or emit `crashed` to a torn-down owner.
			this.setUrl(null, /* owns */ false);
			return;
		}
		// Arm recovery BEFORE the synchronous `setUrl(null)` emit. A
		// `url-changed` listener that calls `restart()` synchronously
		// must see an already-armed probe to stop — otherwise its
		// `stopRecoveryProbe()` runs first, then handleCrash arms a
		// fresh probe AFTER restart cleaned up, and that stray probe
		// can re-attach to the dead origin during restart's spawn
		// window before `startOwnRuntime` lands the new URL.
		this.startRecoveryProbe();
		this.setUrl(null, /* owns */ false);
		this.emit("crashed");
	}



	private setUrl(url: string | null, ownsChild: boolean): void {
		const urlChanged = url !== this.url;
		if (url) {
			this.lastKnownOrigin = url;
			this.stopRecoveryProbe();
		}
		this.url = url;
		this.ownsChild = ownsChild;
		// `url-changed` is the signal that drives `loadUrlInAllWindows()` in
		// main.ts — fire it only when the URL itself actually changed.
		// An ownership-only transition (same origin, owned ↔ attached) does
		// not change what renderers should be loading, so triggering a full
		// reload would be wasteful and visible as a flash. Currently no call
		// site actually produces a same-URL/different-owns transition, but
		// keeping this guard tight means any future hot-handover code path
		// won't need to re-prove this property; it falls out of the contract.
		if (urlChanged) {
			this.emit("url-changed", url);
		}


		// Owned children emit "crashed" directly via process.exit; only
		// attached runtimes need polling to detect crashes.
		if (url && !ownsChild) {
			this.startAttachedProbe(url);
		} else {
			this.stopAttachedProbe();
		}
	}

	private startAttachedProbe(origin: string): void {
		this.stopAttachedProbe();
		const intervalMs =
			this.opts.attachedProbeIntervalMs ?? DEFAULT_ATTACHED_PROBE_INTERVAL_MS;
		if (intervalMs <= 0) return;

		const threshold =
			this.opts.attachedProbeFailureThreshold ??
			DEFAULT_ATTACHED_PROBE_FAILURE_THRESHOLD;
		this.attachedProbeFailures = 0;

		// Capture the generation that's valid for this probe lifetime. Any
		// `stopAttachedProbe()` (including the implicit one inside
		// `restart()` / `shutdown()` / `dispose()`) will bump the counter,
		// invalidating ticks that have already advanced past their timer
		// fire and are awaiting `checkHealth`.
		const gen = ++this.attachedProbeGen;

		// `setInterval` doesn't await the previous tick — if `checkHealth`
		// hangs longer than `intervalMs` (slow runtime, network blip), naive
		// scheduling would stack overlapping probes and inflate the failure
		// count. Skip ticks while one is in flight.
		const tick = async (): Promise<void> => {
			if (gen !== this.attachedProbeGen) return;
			if (this.attachedProbeInFlight) return;
			if (this.url !== origin || this.ownsChild) return;
			this.attachedProbeInFlight = true;
			try {
				const healthy = await this.checkHealth(origin);
				if (gen !== this.attachedProbeGen) return;
				if (this.url !== origin || this.ownsChild) return;
				if (healthy) {
					this.attachedProbeFailures = 0;
					return;
				}
				this.attachedProbeFailures += 1;
				if (this.attachedProbeFailures >= threshold) {
					console.error(
						`[desktop] Attached runtime at ${origin} unreachable after ${this.attachedProbeFailures} probes — classifying as crashed.`,
					);
					this.stopAttachedProbe();
					this.handleCrash();
				}
			} finally {
				this.attachedProbeInFlight = false;
			}
		};

		this.attachedProbeTimer = setInterval(() => {
			// Listener exceptions inside `setUrl → emit` would otherwise
			// surface as unhandled rejections via `void tick()`. Catch and
			// log them locally — a rogue listener shouldn't take down the
			// orchestrator's monitoring loop.
			tick().catch((err) => {
				console.warn(
					"[desktop] Attached probe tick error:",
					err instanceof Error ? err.message : err,
				);
			});
		}, intervalMs);
		this.attachedProbeTimer.unref();
	}

	private stopAttachedProbe(): void {
		this.attachedProbeGen += 1;
		if (this.attachedProbeTimer) {
			clearInterval(this.attachedProbeTimer);
			this.attachedProbeTimer = null;
		}
		this.attachedProbeFailures = 0;
	}

	private startRecoveryProbe(): void {
		this.stopRecoveryProbe();
		const origin = this.lastKnownOrigin;
		if (!origin) return;
		const intervalMs =
			this.opts.recoveryProbeIntervalMs ?? DEFAULT_RECOVERY_PROBE_INTERVAL_MS;
		if (intervalMs <= 0) return;

		// Capture the generation valid for this probe lifetime. Critical
		// for the `restart()` race: that path *intentionally* leaves
		// `this.url === null` until `startOwnRuntime()` resolves, so the
		// post-await `url !== null` check below cannot distinguish "still
		// crashed" from "mid-restart". The gen check fills that gap — when
		// `restart()` calls `stopRecoveryProbe()`, the gen advances and a
		// late-arriving `checkHealth` resolution becomes a no-op instead
		// of overwriting state that `startOwnRuntime()` is about to set.
		const gen = ++this.recoveryProbeGen;

		const tick = async (): Promise<void> => {
			if (gen !== this.recoveryProbeGen) return;
			if (this.recoveryProbeInFlight) return;
			if (this.url !== null) {
				this.stopRecoveryProbe();
				return;
			}
			this.recoveryProbeInFlight = true;
			try {
				// Title liveness check first: cheap and avoids spinning
				// verifyRuntimeTrust on every poll interval.
				const healthy = await this.checkHealth(origin);
				if (gen !== this.recoveryProbeGen) return;
				if (this.url !== null) return;
				if (!healthy) return;
				// Runtime is live; now verify trust before attaching.
				// Clear activeNonce: we no longer own this runtime (our
				// previous child crashed), so resolveDesktopTrust will treat
				// it as a pre-existing attach. verifyRuntimeTrust throws if
				// trust is refused (packaged build with no nonce).
				this.activeNonce = null;
				try {
					await this.verifyRuntimeTrust(origin);
				} catch (trustErr) {
					const msg = trustErr instanceof Error ? trustErr.message : String(trustErr);
					console.warn(`[desktop] Recovery probe: ${msg} — skipping re-attach.`);
					return;
				}
				if (gen !== this.recoveryProbeGen) return;
				if (this.url !== null) return;
				console.log(
					`[desktop] Recovery probe found runtime at ${origin} — auto-attaching.`,
				);
				this.setUrl(origin, /* owns */ false);
			} finally {
				this.recoveryProbeInFlight = false;
			}
		};

		this.recoveryProbeTimer = setInterval(() => {
			tick().catch((err) => {
				console.warn(
					"[desktop] Recovery probe tick error:",
					err instanceof Error ? err.message : err,
				);
			});
		}, intervalMs);
		this.recoveryProbeTimer.unref();
	}

	private stopRecoveryProbe(): void {
		this.recoveryProbeGen += 1;
		if (this.recoveryProbeTimer) {
			clearInterval(this.recoveryProbeTimer);
			this.recoveryProbeTimer = null;
		}
	}
}
