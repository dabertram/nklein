import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * P21.6b ENFORCE half (David-authorized flip 2026-08-23, NKLEIN_PLAN_SIZING_ENFORCE): the decompose tool
 * rejects a graph whose planned task the empirical two-ceiling verdict says MUST split, and routes the
 * remedy through the tool's own `expansions` channel. Evidence-first — no verdict, no enforcement.
 */

const selfObservationMocks = vi.hoisted(() => ({
	recordSelfObservation: vi.fn(async (_event: unknown) => undefined),
	readSelfObservationEvents: vi.fn(async (): Promise<unknown[]> => []),
}));

vi.mock("../../../src/telemetry/self-observation-sink.js", () => ({
	recordSelfObservation: selfObservationMocks.recordSelfObservation,
	readSelfObservationEvents: selfObservationMocks.readSelfObservationEvents,
}));

const routingCandidateMocks = vi.hoisted(() => ({
	buildDecompositionRoutingCandidates: vi.fn(async (): Promise<unknown[]> => []),
}));

vi.mock("../../../src/nklein-agent/decomposition/build-decomposition-routing-candidates.js", () => ({
	buildDecompositionRoutingCandidates: routingCandidateMocks.buildDecompositionRoutingCandidates,
}));

import { createNKleinDecompositionTools } from "../../../src/nklein-agent/nklein-decomposition-tool";

/** Five successful judgments at 40 lines: review ceiling 40 (p90), diff baseline 40 (median) — both halves present. */
function seedReviewCapacityEvidence(): void {
	selfObservationMocks.readSelfObservationEvents.mockResolvedValue(
		Array.from({ length: 5 }, () => ({
			metadata: { outcome: "delivered", diffLines: 40, reviewerModelId: "reviewer-m" },
		})),
	);
}

/** A 4,000-token effective window is below the start guard's working-room floor alone — every task overshoots. */
function seedTinyContextCandidate(): void {
	routingCandidateMocks.buildDecompositionRoutingCandidates.mockResolvedValue([
		{ entry: { contextWindow: { effective: 4_000 } } },
	]);
}

function decomposeInput(slug: string) {
	return {
		slug,
		title: "Sizing gate",
		spec: "Loosely-coupled slices.",
		plan: "Slices.",
		summary: "Cards.",
		defaultAcceptanceCommand: "npm test",
		tasks: [
			{ id: "a", title: "Card a", prompt: "Do a." },
			{ id: "b", title: "Card b", prompt: "Do b.", dependsOn: ["a"] },
		],
	};
}

async function buildTool() {
	const workspacePath = await mkdtemp(join(tmpdir(), "kanban-decompose-sizing-gate-"));
	const tool = createNKleinDecompositionTools({ workspacePath }).find(
		(candidate) => candidate.name === "decompose_project",
	);
	if (!tool) throw new Error("missing decompose_project");
	return tool;
}

describe("P21.6b sizing enforcement at decompose", () => {
	afterEach(() => {
		delete process.env.NKLEIN_PLAN_SIZING_ENFORCE;
		selfObservationMocks.readSelfObservationEvents.mockResolvedValue([]);
		routingCandidateMocks.buildDecompositionRoutingCandidates.mockResolvedValue([]);
		selfObservationMocks.recordSelfObservation.mockClear();
	});

	it("rejects an oversized planned task with the expansions remedy and records the enforcement", async () => {
		process.env.NKLEIN_PLAN_SIZING_ENFORCE = "1";
		seedReviewCapacityEvidence();
		seedTinyContextCandidate();
		const tool = await buildTool();

		await expect(tool.execute(decomposeInput("sizing-reject"), undefined as never)).rejects.toThrow(
			/sizing invariant[\s\S]*"a"[\s\S]*expansions/,
		);
		const enforcement = selfObservationMocks.recordSelfObservation.mock.calls.find(
			(call) =>
				(call[0] as { metadata?: { category?: string } } | undefined)?.metadata?.category ===
				"plan_sizing_enforced",
		);
		expect(enforcement).toBeDefined();
		const enforcedEvent = enforcement?.[0] as unknown as { metadata: { oversizedTaskIds: string[] } };
		expect(enforcedEvent.metadata.oversizedTaskIds).toContain("a");
	});

	it("does not reject when the flag is off, even with the same oversize evidence", async () => {
		seedReviewCapacityEvidence();
		seedTinyContextCandidate();
		const tool = await buildTool();

		const result = (await tool.execute(decomposeInput("sizing-flag-off"), undefined as never)) as { ok: boolean };
		expect(result.ok).toBe(true);
	});

	it("does not reject without evidence — a missing verdict never splits a cold system", async () => {
		process.env.NKLEIN_PLAN_SIZING_ENFORCE = "1";
		seedTinyContextCandidate();
		const tool = await buildTool();

		const result = (await tool.execute(decomposeInput("sizing-no-evidence"), undefined as never)) as {
			ok: boolean;
		};
		expect(result.ok).toBe(true);
	});
});
