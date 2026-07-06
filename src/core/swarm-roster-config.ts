/**
 * §5.AB / §5.U — the USER's real swarm fleet, loaded from their own config file so the shipped `swarm-roster.ts`
 * carries only illustrative EXAMPLE presets (no real machine names / hardware budgets in the repo). A user drops a
 * `swarm-rosters.json` in their !Klein home (`~/.nklein/swarm-rosters.json`) declaring their machine budgets and/or
 * rosters; when present it OVERRIDES the shipped examples. Absent or malformed ⇒ fail-soft to the examples (never
 * blocks a `dev rosters` / Settings render). Pure parse + resolve here; the file read is the thin async wrapper.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { NKLEIN_HOME_DIR_NAME } from "../config/runtime-path-constants";
import { EXAMPLE_MACHINE_BUDGETS_GB, type RosterRole, SWARM_ROSTERS, type SwarmRoster } from "./swarm-roster";

const ROSTER_ROLES: readonly RosterRole[] = ["architect", "worker", "reviewer", "general"];

const rosterAssignmentSchema = z.object({
	machine: z.string().min(1),
	role: z.enum(ROSTER_ROLES as [RosterRole, ...RosterRole[]]),
	model: z.string().min(1),
	quant: z.string().min(1),
	approxSizeGb: z.number().positive(),
	alternate: z.boolean().optional(),
	note: z.string().default(""),
});

const swarmRosterSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	assignments: z.array(rosterAssignmentSchema).min(1),
});

/** The on-disk shape of `~/.nklein/swarm-rosters.json`. Both fields optional — a user can override just budgets. */
export const userSwarmConfigSchema = z.object({
	/** Machine-id → fast-resident budget in GB (RAM for unified-memory boxes, VRAM for discrete-GPU boxes). */
	machineBudgetsGb: z.record(z.string(), z.number().positive()).optional(),
	/** The user's own roster presets (replace the shipped examples wholesale when present). */
	rosters: z.array(swarmRosterSchema).optional(),
});

export type UserSwarmConfig = z.infer<typeof userSwarmConfigSchema>;

export const SWARM_ROSTER_CONFIG_FILENAME = "swarm-rosters.json";

/** The default path of the user's swarm-config file (`~/.nklein/swarm-rosters.json`). */
export function getUserSwarmConfigPath(): string {
	return join(homedir(), NKLEIN_HOME_DIR_NAME, SWARM_ROSTER_CONFIG_FILENAME);
}

/**
 * Pure: validate a parsed JSON value as a user swarm config. Fail-soft — returns null for anything that doesn't match
 * (a malformed override should degrade to the shipped examples, never throw into a diagnostics command).
 */
export function parseUserSwarmConfig(raw: unknown): UserSwarmConfig | null {
	const result = userSwarmConfigSchema.safeParse(raw);
	return result.success ? result.data : null;
}

/** The effective rosters: the user's when they supplied any, else the shipped examples. */
export function resolveEffectiveRosters(config: UserSwarmConfig | null): readonly SwarmRoster[] {
	return config?.rosters && config.rosters.length > 0 ? config.rosters : SWARM_ROSTERS;
}

/** The effective per-machine budgets: the user's when they supplied any, else the shipped example budgets. */
export function resolveEffectiveBudgets(config: UserSwarmConfig | null): Readonly<Record<string, number>> {
	return config?.machineBudgetsGb && Object.keys(config.machineBudgetsGb).length > 0
		? config.machineBudgetsGb
		: EXAMPLE_MACHINE_BUDGETS_GB;
}

/**
 * Load + validate the user's swarm config from `path` (defaults to `~/.nklein/swarm-rosters.json`). Absent, unreadable,
 * non-JSON, or schema-invalid ⇒ null (fail-soft to the shipped examples via the resolvers above).
 */
export async function loadUserSwarmConfig(path: string = getUserSwarmConfigPath()): Promise<UserSwarmConfig | null> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	return parseUserSwarmConfig(parsed);
}
