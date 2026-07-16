import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type { PinnedArtifact } from "../core/skill-pin-drift.js";
import { parseValidatedJsonl } from "./jsonl-store";

/**
 * Phase 7S / S7 — the persisted PIN store for skills / MCP servers (rug-pull guard). Records the content hash + version an
 * artifact had at first approval so {@link detectPinDrift} can flag a later silent swap. A snapshot keyed by artifact id
 * (re-pinning an id replaces its record — TOFU re-review updates the pin), read-modify-write since the set is tiny and
 * rarely written. Schema-invalid lines are skipped, never trusted; a missing store reads empty.
 */

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "skill-pins");

export interface StoredPin extends PinnedArtifact {
	/** Trust label at pin time (mirrors skill-source-trust tiers). */
	trust: string;
	/** ms epoch the pin was recorded (the caller stamps it). */
	pinnedAt: number;
}

export const storedPinSchema: z.ZodType<StoredPin> = z.object({
	id: z.string(),
	contentHash: z.string(),
	version: z.string().nullable(),
	trust: z.string(),
	pinnedAt: z.number(),
});

function resolveLogPath(rootDir?: string): string {
	return join(rootDir ?? DEFAULT_ROOT, "pins.jsonl");
}

/** Read every pin (empty when the store is missing/unreadable — never throws). */
export async function readSkillPins(options?: { rootDir?: string }): Promise<StoredPin[]> {
	const raw = await readFile(resolveLogPath(options?.rootDir), "utf8").catch(() => "");
	if (raw.trim() === "") {
		return [];
	}
	return parseValidatedJsonl(raw, storedPinSchema, "skill-pin-store");
}

/** The current pin for an artifact id, or null when it has never been pinned (TOFU). */
export async function getSkillPin(id: string, options?: { rootDir?: string }): Promise<StoredPin | null> {
	const pins = await readSkillPins(options);
	return pins.find((pin) => pin.id === id) ?? null;
}

/** Record (or re-record, replacing) the pin for an artifact id. Re-pinning updates the stored hash/version/trust. */
export async function upsertSkillPin(pin: StoredPin, options?: { rootDir?: string }): Promise<void> {
	const pins = (await readSkillPins(options)).filter((existing) => existing.id !== pin.id);
	pins.push(pin);
	const body = pins.map((entry) => JSON.stringify(storedPinSchema.parse(entry))).join("\n");
	await mkdir(rootOf(options?.rootDir), { recursive: true });
	await writeFile(resolveLogPath(options?.rootDir), body.length > 0 ? `${body}\n` : "", "utf8");
}

function rootOf(rootDir?: string): string {
	return rootDir ?? DEFAULT_ROOT;
}
