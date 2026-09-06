import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type AutoStartHold,
	clearAutoStartHold,
	formatAutoStartHoldReleaseMessage,
	getAutoStartHoldsPath,
	readAutoStartHolds,
	recordAutoStartHold,
	selectAutoStartHoldsToRelease,
} from "../../src/core/auto-start-hold";

let workspacePath: string;

const providerHold: AutoStartHold = {
	errorCode: "unknown_code",
	error: "No native !Klein provider is configured. Open Settings, choose a provider, and then start the task again.",
	consecutiveFailures: 5,
	heldAt: 1_788_692_123_000,
};

beforeEach(() => {
	workspacePath = mkdtempSync(join(tmpdir(), "nklein-auto-start-hold-"));
});

afterEach(() => {
	rmSync(workspacePath, { recursive: true, force: true });
});

describe("auto-start hold store (2026-09-06)", () => {
	it("lives next to the paused-tasks file and reads empty when absent", async () => {
		expect(getAutoStartHoldsPath(workspacePath)).toBe(
			join(workspacePath, ".nklein", "nklein", "auto-start-holds.json"),
		);
		expect(await readAutoStartHolds(workspacePath)).toEqual({});
	});

	it("records, re-reads, and clears a hold", async () => {
		await recordAutoStartHold({ workspacePath, taskId: "redecompose-s09", hold: providerHold });
		await recordAutoStartHold({
			workspacePath,
			taskId: "s44a",
			hold: { ...providerHold, errorCode: "context_floor_unmet", error: null },
		});
		expect(await readAutoStartHolds(workspacePath)).toEqual({
			"redecompose-s09": providerHold,
			s44a: { ...providerHold, errorCode: "context_floor_unmet", error: null },
		});
		expect(await clearAutoStartHold({ workspacePath, taskId: "redecompose-s09" })).toBe(true);
		expect(await clearAutoStartHold({ workspacePath, taskId: "redecompose-s09" })).toBe(false);
		expect(Object.keys(await readAutoStartHolds(workspacePath))).toEqual(["s44a"]);
	});

	it("rejects an empty task id", async () => {
		await expect(recordAutoStartHold({ workspacePath, taskId: "  ", hold: providerHold })).rejects.toThrow(
			"Task ID cannot be empty.",
		);
	});
});

describe("selectAutoStartHoldsToRelease", () => {
	it("releases still-paused holds and marks the rest stale, in a stable order", () => {
		expect(
			selectAutoStartHoldsToRelease({
				holds: { zeta: providerHold, alpha: providerHold },
				pausedTaskIds: new Set(["zeta"]),
			}),
		).toEqual([
			{ taskId: "alpha", hold: providerHold, stale: true },
			{ taskId: "zeta", hold: providerHold, stale: false },
		]);
	});
});

describe("formatAutoStartHoldReleaseMessage", () => {
	it("names the card, the failure count, the cause, and the bounded retry", () => {
		const line = formatAutoStartHoldReleaseMessage({ taskId: "redecompose-s09", hold: providerHold });
		expect(line).toContain("Released the auto-start hold on redecompose-s09 at boot");
		expect(line).toContain("5 failures: unknown_code — No native !Klein provider");
		expect(line).toContain("pauses it again");
	});
});
