import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { NKLEIN_RUNTIME_HOME_DIR_NAME } from "../config/runtime-path-constants";
import { lockedFileSystem } from "../fs/locked-file-system";

/**
 * Auto-start hold markers (factory outage 2026-09-06). The auto-start failure guard pauses a card after five
 * consecutive start failures through the SAME persisted pause set the operator's own pause gesture uses — so once
 * the environmental cause is fixed (a provider selection restored, a model reloaded at ≥32k), nothing distinguishes
 * "the guard held this" from "the operator parked this", and the sweep never re-attempts either. Live: the ready
 * card sat paused for good after the provider files were restored; only an explicit RESUME moved it.
 *
 * The marker names the guard's holds. On boot — when environments get fixed — each held card that is still paused is
 * released ONCE and re-attempted; if the cause persists the guard pauses it again after five more failures, so the
 * retry stays bounded by boots. A manual pause or resume clears the marker: the operator's gesture owns the card.
 */

const AUTO_START_HOLDS_FILENAME = "auto-start-holds.json";

const autoStartHoldSchema = z.object({
	errorCode: z.string(),
	error: z.string().nullable(),
	consecutiveFailures: z.number(),
	heldAt: z.number(),
});

const autoStartHoldsSchema = z.record(z.string(), autoStartHoldSchema).default({});

export type AutoStartHold = z.infer<typeof autoStartHoldSchema>;

export function getAutoStartHoldsPath(workspacePath: string): string {
	return join(workspacePath, NKLEIN_RUNTIME_HOME_DIR_NAME, AUTO_START_HOLDS_FILENAME);
}

export async function readAutoStartHolds(workspacePath: string): Promise<Record<string, AutoStartHold>> {
	try {
		return autoStartHoldsSchema.parse(JSON.parse(await readFile(getAutoStartHoldsPath(workspacePath), "utf8")));
	} catch {
		return {};
	}
}

async function writeAutoStartHolds(workspacePath: string, holds: Record<string, AutoStartHold>): Promise<void> {
	const path = getAutoStartHoldsPath(workspacePath);
	await mkdir(dirname(path), { recursive: true });
	await lockedFileSystem.writeJsonFileAtomic(path, holds, { lock: null });
}

export async function recordAutoStartHold(input: {
	workspacePath: string;
	taskId: string;
	hold: AutoStartHold;
}): Promise<void> {
	const taskId = input.taskId.trim();
	if (!taskId) {
		throw new Error("Task ID cannot be empty.");
	}
	const holds = await readAutoStartHolds(input.workspacePath);
	holds[taskId] = input.hold;
	await writeAutoStartHolds(input.workspacePath, holds);
}

/** Drops the marker; true when one existed. */
export async function clearAutoStartHold(input: { workspacePath: string; taskId: string }): Promise<boolean> {
	const taskId = input.taskId.trim();
	const holds = await readAutoStartHolds(input.workspacePath);
	if (!(taskId in holds)) {
		return false;
	}
	delete holds[taskId];
	await writeAutoStartHolds(input.workspacePath, holds);
	return true;
}

export interface AutoStartHoldRelease {
	taskId: string;
	hold: AutoStartHold;
	/** The card is no longer paused (the operator resumed it, or it moved on) — drop the marker, nothing to release. */
	stale: boolean;
}

/** Pure: which holds to act on at boot — still-paused cards are released, the rest are stale markers. */
export function selectAutoStartHoldsToRelease(input: {
	holds: Record<string, AutoStartHold>;
	pausedTaskIds: ReadonlySet<string>;
}): AutoStartHoldRelease[] {
	return Object.entries(input.holds)
		.map(([taskId, hold]) => ({ taskId, hold, stale: !input.pausedTaskIds.has(taskId) }))
		.sort((left, right) => left.taskId.localeCompare(right.taskId));
}

export function formatAutoStartHoldReleaseMessage(input: { taskId: string; hold: AutoStartHold }): string {
	return (
		`Released the auto-start hold on ${input.taskId} at boot (held after ${input.hold.consecutiveFailures} ` +
		`failures: ${input.hold.errorCode}${input.hold.error ? ` — ${input.hold.error}` : ""}). ` +
		"Retrying once; if the cause persists the failure guard pauses it again."
	);
}
