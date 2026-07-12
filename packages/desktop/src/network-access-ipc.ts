/**
 * IPC-facing glue for the LAN-serving opt-in (§ desktop app #2 — the Settings toggle's
 * `get-network-access` / `set-network-access` handlers). Pure orchestration over injected
 * seams — persistence, interface enumeration, and the orchestrator's bind plan all come in
 * as functions — so the whole get/set flow is unit-testable without Electron (the
 * autostart-config.ts pattern). main.ts wires the real seams.
 */
import {
	type DesktopBindPlan,
	detectPrimaryLanIpv4,
	resolveDesktopBindPlan,
} from "./network-access-config.js";

export interface NetworkAccessIpcDeps {
	/** Reads the persisted opt-in (`() => loadNetworkAccessEnabled(app.getPath("userData"))`). */
	loadEnabled: () => boolean;
	/** Persists the opt-in (`(enabled) => saveNetworkAccessEnabled(app.getPath("userData"), enabled)`). */
	saveEnabled: (enabled: boolean) => void;
	/** The OS network-interface snapshot (`os.networkInterfaces`). Only consulted when enabling. */
	networkInterfaces: () => Parameters<typeof detectPrimaryLanIpv4>[0];
	/** Hands the new plan to the orchestrator (`(plan) => orchestrator.setBindPlan(plan)`) for the next restart. */
	applyBindPlan: (plan: DesktopBindPlan) => void;
}

/** The `get-network-access` handler body: the persisted opt-in, fail-safe to false. */
export function getNetworkAccessEnabled(deps: Pick<NetworkAccessIpcDeps, "loadEnabled">): boolean {
	try {
		return deps.loadEnabled();
	} catch {
		return false;
	}
}

export interface SetNetworkAccessResult {
	ok: boolean;
	/** The value actually persisted (post fail-closed coercion) — the renderer syncs its switch to this. */
	enabled: boolean;
	error?: string;
}

/**
 * The `set-network-access` handler body: persist the opt-in, then stage the matching bind
 * plan on the orchestrator so the user's follow-up runtime restart applies it. Anything but
 * a literal `true` disables (fail closed — a malformed IPC payload can never turn LAN
 * serving ON). The runtime keeps its current bind until the caller triggers the restart.
 */
export function setNetworkAccessEnabled(deps: NetworkAccessIpcDeps, requestedEnabled: unknown): SetNetworkAccessResult {
	const enabled = requestedEnabled === true;
	try {
		deps.saveEnabled(enabled);
		const lanIpv4 = enabled ? detectPrimaryLanIpv4(deps.networkInterfaces()) : null;
		deps.applyBindPlan(resolveDesktopBindPlan({ enabled, lanIpv4 }));
		return { ok: true, enabled };
	} catch (error) {
		return { ok: false, enabled, error: error instanceof Error ? error.message : String(error) };
	}
}
