/**
 * F12.106 autonomous trigger sources — cron + file-watch over the same intake path as the webhook.
 *
 * One 60s reconcile tick: rescan every registered workspace's `.nklein/triggers/*.json`, fire templates whose
 * `cron` matches the minutes elapsed since the previous tick (each minute fires at most once), and reconcile
 * `watch` templates against live fs.watch handles (arm new, drop removed/changed, debounce events). Every fire
 * flows through {@link handleTriggerIntake} — the SAME validation, alarm-storm damping, seeding, and audit trail
 * as a webhook fire — with a `{source: "cron"|"watch", …}` payload so templates can substitute the provenance.
 *
 * Local-only invariant: this module only ever reads workspace files and calls the in-process intake; nothing
 * binds or dials out. Best-effort throughout — a broken template or unwatchable path logs once per reconcile and
 * never breaks the tick.
 */

import { type FSWatcher, watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { cronMatchesMinute, parseCronExpression } from "../core/cron-match";
import { isSafeTriggerName, triggerCardTemplateSchema } from "../core/trigger-intake";
import {
	handleTriggerIntake,
	loadTriggerTemplateFile,
	type TriggerIntakeDeps,
	type TriggerWorkspaceEntry,
} from "./trigger-intake-handler";

export const TRIGGER_RECONCILE_INTERVAL_MS = 60_000;
const MAX_SCHEDULED_WORKSPACES = 50;

interface WatchHandle {
	watcher: FSWatcher;
	/** The template's watch config fingerprint, so a config edit re-arms the watcher. */
	fingerprint: string;
	debounceTimer: NodeJS.Timeout | null;
}

export interface TriggerSchedulerDeps {
	listWorkspaces(): Promise<TriggerWorkspaceEntry[]>;
	/** The same deps the HTTP route hands to handleTriggerIntake (seeding, audit, cooldowns). */
	intakeDeps: TriggerIntakeDeps;
	log(line: string): void;
	now(): number;
}

export interface TriggerSchedulerHandle {
	/** One reconcile pass (also runs on the interval) — exposed for tests and boot warm-up. */
	reconcileNow(): Promise<void>;
	dispose(): void;
}

async function listTriggerNames(repoPath: string): Promise<string[]> {
	try {
		return (await readdir(join(repoPath, ".nklein", "triggers")))
			.filter((entry) => entry.endsWith(".json"))
			.map((entry) => entry.replace(/\.json$/, ""))
			.filter((name) => isSafeTriggerName(name));
	} catch {
		return [];
	}
}

export function startExternalTriggerScheduler(deps: TriggerSchedulerDeps): TriggerSchedulerHandle {
	const watchHandles = new Map<string, WatchHandle>(); // key: workspaceId:trigger
	let lastCronSweepMs = deps.now();
	let disposed = false;

	const fire = async (entry: TriggerWorkspaceEntry, name: string, payload: Record<string, unknown>) => {
		const result = await handleTriggerIntake(
			{ name, bodyText: JSON.stringify(payload), workspaceIdParam: entry.workspaceId },
			deps.intakeDeps,
		);
		if (result.status === 201) {
			deps.log(`Trigger scheduler: "${name}" (${payload.source}) seeded ${String(result.body.taskId)}.`);
		} else if (result.status !== 429) {
			// 429 is the intake's own alarm-storm damping doing its job — not worth a log line per tick.
			deps.log(
				`Trigger scheduler: "${name}" (${payload.source}) refused (${result.status}): ${String(result.body.error ?? "")}`,
			);
		}
	};

	const reconcile = async () => {
		const sweepEndMs = deps.now();
		const sweepStartMs = lastCronSweepMs;
		lastCronSweepMs = sweepEndMs;
		const seenWatchKeys = new Set<string>();
		const workspaces = (await deps.listWorkspaces().catch(() => [])).slice(0, MAX_SCHEDULED_WORKSPACES);
		for (const entry of workspaces) {
			for (const name of await listTriggerNames(entry.repoPath)) {
				const raw = await loadTriggerTemplateFile(entry.repoPath, name).catch(() => null);
				if (raw === null) {
					continue;
				}
				let template: ReturnType<typeof triggerCardTemplateSchema.parse>;
				try {
					template = triggerCardTemplateSchema.parse(JSON.parse(raw));
				} catch {
					continue; // invalid templates are reported by the HTTP intake path; the scheduler stays quiet
				}

				// ── cron source: fire once per matching minute in (sweepStart, sweepEnd] ──
				if (template.cron) {
					try {
						const expression = parseCronExpression(template.cron);
						const firstMinute = Math.floor(sweepStartMs / 60_000) + 1;
						const lastMinute = Math.floor(sweepEndMs / 60_000);
						for (let minute = firstMinute; minute <= lastMinute; minute += 1) {
							if (cronMatchesMinute(expression, minute * 60_000)) {
								await fire(entry, name, { source: "cron", cron: template.cron });
								break; // one fire per reconcile; the intake cooldown damps the rest anyway
							}
						}
					} catch (error) {
						deps.log(
							`Trigger scheduler: "${name}" has an invalid cron ("${template.cron}"): ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}

				// ── watch source: reconcile fs.watch handles ──
				if (template.watch) {
					const key = `${entry.workspaceId}:${name}`;
					seenWatchKeys.add(key);
					const fingerprint = `${template.watch.path}:${template.watch.debounceMs}`;
					const existing = watchHandles.get(key);
					if (existing && existing.fingerprint === fingerprint) {
						continue;
					}
					if (existing) {
						existing.watcher.close();
						if (existing.debounceTimer) {
							clearTimeout(existing.debounceTimer);
						}
						watchHandles.delete(key);
					}
					const watchedPath = join(entry.repoPath, template.watch.path);
					const debounceMs = template.watch.debounceMs;
					try {
						const handle: WatchHandle = {
							watcher: null as unknown as FSWatcher,
							fingerprint,
							debounceTimer: null,
						};
						handle.watcher = watch(watchedPath, (event) => {
							if (disposed) {
								return;
							}
							if (handle.debounceTimer) {
								clearTimeout(handle.debounceTimer);
							}
							handle.debounceTimer = setTimeout(() => {
								handle.debounceTimer = null;
								void fire(entry, name, {
									source: "watch",
									path: template.watch?.path ?? "",
									event,
								});
							}, debounceMs);
							handle.debounceTimer.unref?.();
						});
						handle.watcher.on("error", () => {
							watchHandles.delete(key);
						});
						watchHandles.set(key, handle);
						deps.log(`Trigger scheduler: watching ${watchedPath} for "${name}".`);
					} catch {
						deps.log(
							`Trigger scheduler: cannot watch ${watchedPath} for "${name}" (missing path?) — will retry next reconcile.`,
						);
					}
				}
			}
		}
		// Drop watchers whose template disappeared.
		for (const [key, handle] of watchHandles) {
			if (!seenWatchKeys.has(key)) {
				handle.watcher.close();
				if (handle.debounceTimer) {
					clearTimeout(handle.debounceTimer);
				}
				watchHandles.delete(key);
			}
		}
	};

	const interval = setInterval(() => {
		void reconcile().catch(() => undefined);
	}, TRIGGER_RECONCILE_INTERVAL_MS);
	interval.unref?.();

	return {
		reconcileNow: async () => {
			await reconcile();
		},
		dispose: () => {
			disposed = true;
			clearInterval(interval);
			for (const handle of watchHandles.values()) {
				handle.watcher.close();
				if (handle.debounceTimer) {
					clearTimeout(handle.debounceTimer);
				}
			}
			watchHandles.clear();
		},
	};
}
