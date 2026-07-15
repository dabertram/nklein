import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths.js";
import { INITIAL_RAIL_CONTROL_STATE, type RailControlState } from "../core/background-eval-controls.js";

/**
 * F1.35b (§5.AI) — durable persistence for the background-eval RAIL's operator controls: the enable/pause intent
 * (`RailControlState`) plus the two tunable knobs (tick cadence + concurrent-eval cap). This is deliberately a small
 * dedicated JSON store rather than a field on the global runtime config — the control state is operational (it drives
 * whether the F1.31 service ticks), not user preference, and the F1.31b boot seam reads `enabled` from here to decide
 * whether to start the service. A missing or corrupt file reads as the defaults (rail OFF), matching the checkpoint
 * store's skip-and-recover philosophy. `rootDir` is injectable so tests never touch the real runtime home.
 */

/** The rail's default tick cadence (5 min) — generous, since a background eval is a long low-priority run. */
export const DEFAULT_RAIL_CADENCE_MS = 300_000;
/** The rail's default concurrent-eval cap — one at a time keeps the background load minimal. */
export const DEFAULT_RAIL_MAX_CONCURRENT_EVALS = 1;

export interface RailControlSettings {
	control: RailControlState;
	cadenceMs: number;
	maxConcurrentEvals: number;
}

export const DEFAULT_RAIL_CONTROL_SETTINGS: RailControlSettings = {
	control: INITIAL_RAIL_CONTROL_STATE,
	cadenceMs: DEFAULT_RAIL_CADENCE_MS,
	maxConcurrentEvals: DEFAULT_RAIL_MAX_CONCURRENT_EVALS,
};

const railControlStateSchema = z.object({
	enabled: z.boolean(),
	paused: z.boolean(),
	pauseReason: z.string().nullable(),
});

const railControlSettingsSchema = z.object({
	control: railControlStateSchema,
	// Clamp to sane floors on read so a hand-edited/corrupt value can't stall or hammer the runner.
	cadenceMs: z.number().int().min(1_000),
	maxConcurrentEvals: z.number().int().min(1),
});

function resolveRailControlPath(rootDir?: string): string {
	const root = rootDir ?? join(resolveNkleinRuntimeHomePath(homedir()), "background-eval-runner");
	return join(root, "rail-control.json");
}

export async function saveRailControlSettings(
	settings: RailControlSettings,
	options: { rootDir?: string } = {},
): Promise<void> {
	const path = resolveRailControlPath(options.rootDir);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export async function loadRailControlSettings(options: { rootDir?: string } = {}): Promise<RailControlSettings> {
	const path = resolveRailControlPath(options.rootDir);
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		return { ...DEFAULT_RAIL_CONTROL_SETTINGS }; // no control file yet ⇒ rail OFF at defaults
	}
	try {
		const parsed = railControlSettingsSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : { ...DEFAULT_RAIL_CONTROL_SETTINGS };
	} catch {
		return { ...DEFAULT_RAIL_CONTROL_SETTINGS }; // corrupt ⇒ recover at defaults rather than crash the boot
	}
}
