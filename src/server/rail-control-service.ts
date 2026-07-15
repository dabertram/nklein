import {
	applyRailControlCommand,
	composeRailStatus,
	type RailControlCommand,
	type RailOutcomeLog,
	type RailStatusSnapshot,
} from "../core/background-eval-controls.js";
import type { RailControlSettings } from "../state/rail-control-store.js";
import type { BackgroundEvalService } from "./background-eval-service.js";

/**
 * F1.35b (§5.AI) — the runtime-side COORDINATOR that binds the pure rail-control cores to the durable store and the
 * (optional) F1.31 service. It is the single seam the tRPC control/status procedures call, so those procedures stay
 * thin and this stays unit-testable over injected fakes.
 *
 * The `service` is null whenever the runtime did NOT opt into hosting the background-eval rail (the `NKLEIN_EVAL_RAIL`
 * boot flag is off — the default, byte-identical production path): the operator can still read/persist the control
 * intent + tunables and the status reads `disabled`/`idle`, but there is nothing to start/stop. When the service IS
 * hosted, a control transition's start/stop action drives it (best-effort — a start/stop failure never rejects the
 * control mutation; the enhancement must never break the operator surface).
 */

export interface RailControlCoordinator {
	/** Apply an enable/disable/pause/resume command: persist the new intent, drive the service, return fresh status. */
	applyCommand: (command: RailControlCommand) => Promise<RailStatusSnapshot>;
	/** Persist new cadence/cap tunables (a running service picks them up on its next (re)start). */
	updateTunables: (tunables: { cadenceMs?: number; maxConcurrentEvals?: number }) => Promise<RailStatusSnapshot>;
	/** The current status snapshot (controls + tunables + live service status + recent outcomes). */
	getStatus: () => Promise<RailStatusSnapshot>;
	/** Boot hook: start the hosted service iff the persisted intent is active (enabled and not paused). */
	syncServiceToPersistedIntent: () => Promise<void>;
}

const EMPTY_SERVICE_STATUS = {
	activeLeases: [] as const,
	lastTick: null,
	lastTickError: null,
	cleanupErrors: [] as const,
};

export function createRailControlCoordinator(deps: {
	loadSettings: () => Promise<RailControlSettings>;
	saveSettings: (settings: RailControlSettings) => Promise<void>;
	/** The hosted F1.31 service, or null when this runtime did not opt into the rail. */
	service: BackgroundEvalService | null;
	outcomeLog: RailOutcomeLog;
	/** Optional long-timeout profile label surfaced verbatim in the status. */
	timeoutProfile?: string | null;
}): RailControlCoordinator {
	const composeStatus = (settings: RailControlSettings): RailStatusSnapshot => {
		const serviceStatus = deps.service ? deps.service.getStatus() : EMPTY_SERVICE_STATUS;
		return composeRailStatus({
			control: settings.control,
			cadenceMs: settings.cadenceMs,
			maxConcurrentEvals: settings.maxConcurrentEvals,
			timeoutProfile: deps.timeoutProfile ?? null,
			service: {
				activeLeases: serviceStatus.activeLeases,
				lastTick: serviceStatus.lastTick,
				lastTickError: serviceStatus.lastTickError,
				cleanupErrors: serviceStatus.cleanupErrors,
			},
			recentOutcomes: deps.outcomeLog.list(),
		});
	};

	const driveService = async (action: "start" | "stop" | "none"): Promise<void> => {
		if (!deps.service || action === "none") {
			return;
		}
		try {
			await (action === "start" ? deps.service.start() : deps.service.stop());
		} catch {
			// Best-effort: a service start/stop failure must never reject the operator's control mutation.
		}
	};

	return {
		async applyCommand(command): Promise<RailStatusSnapshot> {
			const settings = await deps.loadSettings();
			const transition = applyRailControlCommand(settings.control, command);
			const next: RailControlSettings = { ...settings, control: transition.state };
			await deps.saveSettings(next);
			await driveService(transition.action);
			return composeStatus(next);
		},

		async updateTunables(tunables): Promise<RailStatusSnapshot> {
			const settings = await deps.loadSettings();
			const next: RailControlSettings = {
				...settings,
				...(typeof tunables.cadenceMs === "number"
					? { cadenceMs: Math.max(1_000, Math.trunc(tunables.cadenceMs)) }
					: {}),
				...(typeof tunables.maxConcurrentEvals === "number"
					? { maxConcurrentEvals: Math.max(1, Math.trunc(tunables.maxConcurrentEvals)) }
					: {}),
			};
			await deps.saveSettings(next);
			return composeStatus(next);
		},

		async getStatus(): Promise<RailStatusSnapshot> {
			return composeStatus(await deps.loadSettings());
		},

		async syncServiceToPersistedIntent(): Promise<void> {
			if (!deps.service) {
				return;
			}
			const { control } = await deps.loadSettings();
			if (control.enabled && !control.paused) {
				await driveService("start");
			}
		},
	};
}
