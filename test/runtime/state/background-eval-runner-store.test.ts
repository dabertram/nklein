import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BackgroundEvalLease } from "../../../src/core/background-eval-runner";
import {
	loadBackgroundEvalRunnerLeases,
	saveBackgroundEvalRunnerLeases,
} from "../../../src/state/background-eval-runner-store";

const LEASES: BackgroundEvalLease[] = [
	{ runId: "run-1", project: "alpha", workspaceId: "ws-1", startedAt: 100, deadlineAt: 200 },
	{ runId: "run-2", project: "beta", workspaceId: null, startedAt: 150, deadlineAt: 250 },
];

describe("background-eval-runner-store", () => {
	let rootDir: string;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-runner-store-"));
	});
	afterEach(async () => {
		await rm(rootDir, { recursive: true, force: true });
	});

	it("round-trips the lease set", async () => {
		await saveBackgroundEvalRunnerLeases(LEASES, { rootDir });
		expect(await loadBackgroundEvalRunnerLeases({ rootDir })).toEqual(LEASES);
	});

	it("returns an empty set when no checkpoint exists yet (first run)", async () => {
		expect(await loadBackgroundEvalRunnerLeases({ rootDir })).toEqual([]);
	});

	it("recovers as empty (not throwing) when the checkpoint is corrupt", async () => {
		await saveBackgroundEvalRunnerLeases(LEASES, { rootDir });
		await writeFile(join(rootDir, "leases.json"), "{ not valid json", "utf8");
		expect(await loadBackgroundEvalRunnerLeases({ rootDir })).toEqual([]);
	});

	it("recovers as empty when the JSON is valid but fails the schema", async () => {
		await writeFile(join(rootDir, "leases.json"), JSON.stringify([{ runId: 5 }]), "utf8");
		expect(await loadBackgroundEvalRunnerLeases({ rootDir })).toEqual([]);
	});

	it("overwrites (snapshot semantics, not append)", async () => {
		await saveBackgroundEvalRunnerLeases(LEASES, { rootDir });
		await saveBackgroundEvalRunnerLeases([LEASES[0] as BackgroundEvalLease], { rootDir });
		expect(await loadBackgroundEvalRunnerLeases({ rootDir })).toHaveLength(1);
	});
});
