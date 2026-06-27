import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RailEvidenceReport } from "../../../src/core/rail-evidence";
import { readRailEvidenceReports } from "../../../src/state/rail-evidence-store";

function report(model: string): RailEvidenceReport {
	return {
		schemaVersion: 1,
		at: new Date().toISOString(),
		model,
		maxWaitMs: 1000,
		concurrency: 1,
		projectCount: 1,
		delivered: 1,
		anomalyProjects: 0,
		lanes: [
			{
				label: "alpha",
				workspaceId: "ws",
				startedOk: true,
				startError: null,
				verdict: "delivered",
				cards: 0,
				decomposed: false,
				wsFrames: 0,
				sessionStates: {},
				toolCalls: {},
				totalToolCalls: 0,
				narrationLeaks: 0,
				hotRepeats: 0,
			},
		],
	};
}

describe("readRailEvidenceReports", () => {
	let rootDir: string;
	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-rail-ev-"));
	});
	afterEach(async () => {
		await rm(rootDir, { recursive: true, force: true });
	});

	it("returns [] when the harvest dir does not exist", async () => {
		expect(await readRailEvidenceReports({ rootDir: join(rootDir, "missing") })).toEqual([]);
	});

	it("reads valid rail-*.json reports", async () => {
		await writeFile(join(rootDir, "rail-1.json"), JSON.stringify(report("m1")), "utf8");
		await writeFile(join(rootDir, "rail-2.json"), JSON.stringify(report("m2")), "utf8");
		const reports = await readRailEvidenceReports({ rootDir });
		expect(reports.map((r) => r.model)).toEqual(["m1", "m2"]);
	});

	it("skips malformed / non-conforming files but keeps the rest", async () => {
		await writeFile(join(rootDir, "rail-good.json"), JSON.stringify(report("ok")), "utf8");
		await writeFile(join(rootDir, "rail-bad.json"), "{ not json", "utf8");
		await writeFile(join(rootDir, "rail-wrong.json"), JSON.stringify({ schemaVersion: 2 }), "utf8");
		await writeFile(join(rootDir, "notes.txt"), "ignored", "utf8");
		const reports = await readRailEvidenceReports({ rootDir });
		expect(reports.map((r) => r.model)).toEqual(["ok"]);
	});
});
