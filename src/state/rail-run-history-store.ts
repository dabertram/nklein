/**
 * F1.32b — the persisted rail run history: one JSONL row per background-eval dispatch, the recent-coverage
 * window's basis for `selectBackgroundEvalTarget` (a (project, model) pair run recently is excluded until the
 * window lapses). Lives beside the rail's lease checkpoint under `~/.nklein/nklein/background-eval-runner/`.
 * Best-effort + bounded: an unreadable file is an empty history (the picker then behaves as if nothing ran).
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { BackgroundEvalRecentRun } from "../core/background-eval-selection";

const HISTORY_READ_CAP = 500;

export function railRunHistoryPath(root: string = homedir()): string {
	return join(root, ".nklein", "nklein", "background-eval-runner", "rail-run-history.jsonl");
}

export async function appendRailRunHistory(run: BackgroundEvalRecentRun, options?: { path?: string }): Promise<void> {
	const path = options?.path ?? railRunHistoryPath();
	try {
		await mkdir(dirname(path), { recursive: true });
		await appendFile(path, `${JSON.stringify(run)}\n`, "utf8");
	} catch {
		// Best-effort — a failed history append only widens the picker's view, never breaks the rail.
	}
}

export async function readRailRunHistory(options?: { path?: string }): Promise<BackgroundEvalRecentRun[]> {
	const path = options?.path ?? railRunHistoryPath();
	try {
		const raw = await readFile(path, "utf8");
		const runs: BackgroundEvalRecentRun[] = [];
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			try {
				const parsed = JSON.parse(trimmed) as Partial<BackgroundEvalRecentRun>;
				if (
					typeof parsed.projectId === "string" &&
					typeof parsed.modelId === "string" &&
					typeof parsed.at === "number"
				) {
					runs.push({ projectId: parsed.projectId, modelId: parsed.modelId, at: parsed.at });
				}
			} catch {
				// One corrupt line never poisons the history.
			}
		}
		return runs.slice(-HISTORY_READ_CAP);
	} catch {
		return [];
	}
}
