import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cronMatchesMinute, parseCronExpression } from "../../../src/core/cron-match";
import {
	loadTriggerTemplateFile,
	resetTriggerCooldowns,
	type TriggerIntakeDeps,
} from "../../../src/server/trigger-intake-handler";
import { startExternalTriggerScheduler, type TriggerSchedulerHandle } from "../../../src/server/trigger-scheduler";

describe("cron-match", () => {
	it("parses the practical envelope and matches minutes", () => {
		const everyFifteen = parseCronExpression("*/15 * * * *");
		expect(cronMatchesMinute(everyFifteen, new Date(2026, 6, 18, 10, 30).getTime())).toBe(true);
		expect(cronMatchesMinute(everyFifteen, new Date(2026, 6, 18, 10, 31).getTime())).toBe(false);

		const weekdayMornings = parseCronExpression("0 9 * * 1-5");
		expect(cronMatchesMinute(weekdayMornings, new Date(2026, 6, 17, 9, 0).getTime())).toBe(true); // Friday
		expect(cronMatchesMinute(weekdayMornings, new Date(2026, 6, 18, 9, 0).getTime())).toBe(false); // Saturday

		const sundayAsSeven = parseCronExpression("0 0 * * 7");
		expect(cronMatchesMinute(sundayAsSeven, new Date(2026, 6, 19, 0, 0).getTime())).toBe(true); // Sunday
	});

	it("applies the standard either-match rule when BOTH dom and dow are restricted", () => {
		const both = parseCronExpression("0 0 15 * 1");
		expect(cronMatchesMinute(both, new Date(2026, 6, 15, 0, 0).getTime())).toBe(true); // the 15th (a Wednesday)
		expect(cronMatchesMinute(both, new Date(2026, 6, 20, 0, 0).getTime())).toBe(true); // a Monday (not the 15th)
		expect(cronMatchesMinute(both, new Date(2026, 6, 18, 0, 0).getTime())).toBe(false); // Saturday the 18th
	});

	it("rejects malformed expressions loudly", () => {
		expect(() => parseCronExpression("* * * *")).toThrow(/5 fields/);
		expect(() => parseCronExpression("61 * * * *")).toThrow(/out of range/);
		expect(() => parseCronExpression("a * * * *")).toThrow(/Invalid cron/);
		expect(() => parseCronExpression("*/0 * * * *")).toThrow(/step/);
	});
});

describe("startExternalTriggerScheduler", () => {
	let repoPath: string;
	let handle: TriggerSchedulerHandle | null = null;

	afterEach(async () => {
		handle?.dispose();
		handle = null;
		resetTriggerCooldowns();
		await rm(repoPath, { recursive: true, force: true }).catch(() => undefined);
	});

	async function makeWorkspace(templates: Record<string, unknown>): Promise<void> {
		repoPath = await mkdtemp(join(tmpdir(), "trigger-sched-"));
		await mkdir(join(repoPath, ".nklein", "triggers"), { recursive: true });
		for (const [name, template] of Object.entries(templates)) {
			await writeFile(join(repoPath, ".nklein", "triggers", `${name}.json`), JSON.stringify(template), "utf8");
		}
	}

	function makeIntakeDeps(seeded: string[]): TriggerIntakeDeps {
		return {
			listWorkspaces: async () => [{ workspaceId: "ws-1", repoPath }],
			readTemplateFile: loadTriggerTemplateFile,
			seedCard: async ({ card }) => {
				seeded.push(card.taskId);
			},
			audit: async () => {},
			now: () => Date.now(),
			randomUuid: () => "aaaabbbb-cccc-dddd-eeee-ffff00001111",
		};
	}

	it("fires a due cron template once per sweep through the normal intake path", async () => {
		resetTriggerCooldowns();
		await makeWorkspace({
			"minutely-audit": {
				title: "Audit sweep {timestamp}",
				prompt: "Run the scheduled audit ({payload.source}).",
				cron: "* * * * *",
			},
		});
		const seeded: string[] = [];
		let fakeNow = Date.now();
		handle = startExternalTriggerScheduler({
			listWorkspaces: async () => [{ workspaceId: "ws-1", repoPath }],
			intakeDeps: { ...makeIntakeDeps(seeded), now: () => fakeNow },
			log: () => {},
			now: () => fakeNow,
		});
		// First reconcile covers zero elapsed minutes — nothing due yet.
		await handle.reconcileNow();
		expect(seeded).toHaveLength(0);
		// A minute passes: the every-minute cron is due exactly once.
		fakeNow += 60_000;
		await handle.reconcileNow();
		expect(seeded).toHaveLength(1);
		// Same sweep window again (no minutes elapsed): no double fire.
		await handle.reconcileNow();
		expect(seeded).toHaveLength(1);
	});

	it("fires a watch template when the watched file changes (debounced)", async () => {
		resetTriggerCooldowns();
		await makeWorkspace({
			"log-watch": {
				title: "Log changed",
				prompt: "Investigate {payload.path} ({payload.event}).",
				watch: { path: "logs/error.log", debounceMs: 30 },
			},
		});
		await mkdir(join(repoPath, "logs"), { recursive: true });
		await writeFile(join(repoPath, "logs", "error.log"), "boot\n", "utf8");
		const seeded: string[] = [];
		handle = startExternalTriggerScheduler({
			listWorkspaces: async () => [{ workspaceId: "ws-1", repoPath }],
			intakeDeps: makeIntakeDeps(seeded),
			log: () => {},
			now: () => Date.now(),
		});
		await handle.reconcileNow(); // arms the watcher
		await writeFile(join(repoPath, "logs", "error.log"), "boot\nERROR kaboom\n", "utf8");
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(seeded.length).toBeGreaterThanOrEqual(1);
	});
});
