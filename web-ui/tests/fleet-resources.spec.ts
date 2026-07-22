import { expect, test } from "@playwright/test";
import { gotoBoard } from "./harness/board-actions";
import { installRuntimeMock } from "./harness/runtime-mock";

test.describe("fleet resource panel", () => {
	test("stays dormant while collapsed and renders the sampled resource contract when opened", async ({ page }) => {
		await installRuntimeMock(page, {
			queryStubs: {
				"runtime.getNKleinModelRegistry": { schemaVersion: 1, updatedAt: 1, models: [], fleetSuggestions: [] },
				"runtime.getFleetStatus": {
					machineByModelId: {},
					warmthByModelId: {},
					resources: {
						sampledAt: 1_700_000_000_000,
						host: {
							logicalCpuCount: 12,
							processCpuPercent: 5,
							systemCpuPercent: 25,
							processRssBytes: 2 * 1024 ** 3,
							processHeapUsedBytes: 512 * 1024 ** 2,
							systemTotalBytes: 128 * 1024 ** 3,
							systemFreeBytes: 32 * 1024 ** 3,
						},
						disk: { totalBytes: 2_000 * 1024 ** 3, freeBytes: 800 * 1024 ** 3 },
						devices: [
							{
								machineId: "m5max",
								fastMemoryCapacityBytes: 96 * 1024 ** 3,
								residentBytes: 27 * 1024 ** 3,
								residentBytesKnownCount: 1,
								residents: [
									{
										identifier: "bonsai-27b",
										modelKey: "prism/bonsai-27b",
										status: "idle",
										contextLength: 40_000,
										sizeBytes: 27 * 1024 ** 3,
									},
								],
							},
						],
						promptCache: {
							comparisons: 4,
							perfectHits: 2,
							averageReuseRatio: 0.8,
							latestReuseRatio: 1,
							latestAt: 1_700_000_000_000,
						},
						reservations: {
							holderCount: 1,
							totals: [{ kind: "kv_bytes", key: "m5max", amount: 4 * 1024 ** 3 }],
						},
					},
				},
			},
		});
		await gotoBoard(page);
		await expect(page.getByTestId("fleet-resources")).toHaveCount(0);
		await page.getByTestId("fleet-strip-toggle").click();
		const panel = page.getByTestId("fleet-resources");
		await expect(panel).toBeVisible();
		await expect(panel).toContainText("96 GiB / 128 GiB");
		await expect(panel).toContainText("25% system");
		await expect(panel).toContainText("80% avg reuse");
		await expect(panel).toContainText("1 task hold");
		await expect(panel).toContainText("bonsai-27b @40k");
		await expect(panel).toContainText("not presented as measured free VRAM");
	});
});
