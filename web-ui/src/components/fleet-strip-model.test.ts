import { describe, expect, it } from "vitest";

import {
	compactFleetActivityText,
	composeFleetRows,
	type FleetGroup,
	resolveFleetLineage,
	summarizeIdleFleetRows,
	toEndpointLabel,
} from "@/components/fleet-strip-model";
import type { RuntimeNKleinModelRegistryEntry, RuntimeTaskSessionSummary } from "@/runtime/types";

function makeEntry(
	overrides: Partial<RuntimeNKleinModelRegistryEntry> & { modelId: string; key: string },
): RuntimeNKleinModelRegistryEntry {
	return {
		key: overrides.key,
		providerId: overrides.providerId ?? "lmstudio",
		modelId: overrides.modelId,
		// Respect an explicit `null` (a model with no endpoint) — only default when `endpoint` is absent.
		endpoint: "endpoint" in overrides ? (overrides.endpoint ?? null) : "http://localhost:1234",
		contextWindow: overrides.contextWindow ?? {
			advertised: null,
			observed: null,
			userOverride: null,
			effective: null,
		},
		speed: overrides.speed ?? {
			samples: 0,
			promptTokensEwma: null,
			outputTokensEwma: null,
			totalTokensEwma: null,
			prefillTokensPerSecondEwma: null,
			decodeTokensPerSecondEwma: null,
			ttftMsEwma: null,
			wallTimeMsEwma: null,
			wallTimeMsPer1kPromptTokensEwma: null,
			lastPromptTokens: null,
			lastOutputTokens: null,
			lastWallTimeMs: null,
			lastObservedAt: null,
		},
		capability: overrides.capability ?? {
			samples: 0,
			staticPrior: 50,
			evalScore: null,
			externalScore: null,
			observedPassRate: null,
			effectiveScore: 50,
			lastObservedAt: null,
		},
		constraints: overrides.constraints ?? {
			sharedEndpointId: null,
			inputCostPerMillionTokens: null,
			outputCostPerMillionTokens: null,
			maxConcurrentRequests: null,
		},
		createdAt: overrides.createdAt ?? 1,
		updatedAt: overrides.updatedAt ?? 1,
	};
}

function makeSession(overrides: Partial<RuntimeTaskSessionSummary> & { taskId: string }): RuntimeTaskSessionSummary {
	return {
		taskId: overrides.taskId,
		state: overrides.state ?? "running",
		agentId: overrides.agentId ?? "nklein",
		workspacePath: overrides.workspacePath ?? null,
		pid: overrides.pid ?? null,
		startedAt: overrides.startedAt ?? null,
		updatedAt: overrides.updatedAt ?? 1,
		lastOutputAt: overrides.lastOutputAt ?? null,
		reviewReason: overrides.reviewReason ?? null,
		exitCode: overrides.exitCode ?? null,
		lastHookAt: overrides.lastHookAt ?? null,
		latestHookActivity: overrides.latestHookActivity ?? null,
		role: overrides.role,
		modelId: overrides.modelId,
		endpoint: overrides.endpoint,
		sharedEndpointId: overrides.sharedEndpointId,
	};
}

describe("resolveFleetLineage", () => {
	it("classifies known families by first-hit order and lowercases the id", () => {
		expect(resolveFleetLineage("GPT-OSS-120B")).toBe("gpt-oss");
		expect(resolveFleetLineage("qwen3.6-27b")).toBe("qwen");
		expect(resolveFleetLineage("ornith9-m5")).toBe("qwen");
		// An R1 distill of qwen resolves to deepseek (specific training wins over base arch).
		expect(resolveFleetLineage("DeepSeek-R1-Distill-Qwen-7B")).toBe("deepseek");
		expect(resolveFleetLineage("phi-4-reasoning")).toBe("phi");
		expect(resolveFleetLineage("devstral-small")).toBe("mistral");
		expect(resolveFleetLineage("coder-gpu")).toBe("unknown");
	});
});

describe("toEndpointLabel", () => {
	it("condenses a URL to host:port, passes through a non-URL id, and falls back to local", () => {
		expect(toEndpointLabel("http://192.168.1.9:1234/v1")).toBe("192.168.1.9:1234");
		expect(toEndpointLabel("http://localhost")).toBe("local"); // loopback aliases normalize to ONE machine group
		expect(toEndpointLabel("http://127.0.0.1:1234/v1")).toBe("local");
		// Shared-endpoint ids append "#<model>" and provider-default ids mean THIS machine (live shapes 2026-07-09).
		expect(toEndpointLabel("http://localhost:1234/v1#qwen/qwen3-8b")).toBe("local");
		expect(toEndpointLabel("lmstudio:default#qwopus3.5-9b-coder-mtp")).toBe("local");
		expect(toEndpointLabel("http://192.168.1.9:1234/v1#some/model")).toBe("192.168.1.9:1234");
		expect(toEndpointLabel("m5max")).toBe("m5max");
		expect(toEndpointLabel(null)).toBe("local");
		expect(toEndpointLabel("   ")).toBe("local");
	});
});

describe("composeFleetRows", () => {
	it("composes a running worker, an idle model, and a ::spec twin into the right rows/groups/lineage/role/isSpec/tokensPerSecond", () => {
		const registryModels: RuntimeNKleinModelRegistryEntry[] = [
			makeEntry({
				key: "qwop4b-a",
				modelId: "qwen3-4b-a",
				constraints: {
					sharedEndpointId: "m5max",
					inputCostPerMillionTokens: null,
					outputCostPerMillionTokens: null,
					maxConcurrentRequests: null,
				},
				speed: {
					samples: 5,
					promptTokensEwma: null,
					outputTokensEwma: null,
					totalTokensEwma: null,
					prefillTokensPerSecondEwma: null,
					decodeTokensPerSecondEwma: 33.4,
					ttftMsEwma: null,
					wallTimeMsEwma: null,
					wallTimeMsPer1kPromptTokensEwma: null,
					lastPromptTokens: null,
					lastOutputTokens: null,
					lastWallTimeMs: null,
					lastObservedAt: null,
				},
			}),
			makeEntry({
				key: "ornith9-m5",
				modelId: "ornith9",
				constraints: {
					sharedEndpointId: "m5max",
					inputCostPerMillionTokens: null,
					outputCostPerMillionTokens: null,
					maxConcurrentRequests: null,
				},
				// No samples ⇒ tokensPerSecond null even though an EWMA is present.
				speed: {
					samples: 0,
					promptTokensEwma: null,
					outputTokensEwma: null,
					totalTokensEwma: null,
					prefillTokensPerSecondEwma: null,
					decodeTokensPerSecondEwma: 99,
					ttftMsEwma: null,
					wallTimeMsEwma: null,
					wallTimeMsPer1kPromptTokensEwma: null,
					lastPromptTokens: null,
					lastOutputTokens: null,
					lastWallTimeMs: null,
					lastObservedAt: null,
				},
			}),
		];
		const runningSessions: RuntimeTaskSessionSummary[] = [
			makeSession({
				taskId: "classify-trends",
				state: "running",
				role: "worker",
				modelId: "qwen3-4b-a",
				sharedEndpointId: "m5max",
			}),
			// A ::spec twin on the SAME model — sets isSpec, not the driver.
			makeSession({
				taskId: "classify-trends::spec",
				state: "running",
				role: "worker",
				modelId: "qwen3-4b-a",
				sharedEndpointId: "m5max",
			}),
			// A running session on a model that is NOT loaded — ignored (no registry row to attach to).
			makeSession({ taskId: "orphan", state: "running", modelId: "not-loaded" }),
		];
		const cardTitleByTaskId = new Map<string, string>([["classify-trends", "Classify trends"]]);

		const groups = composeFleetRows({ registryModels, runningSessions, cardTitleByTaskId });

		expect(groups).toHaveLength(1);
		const group = groups[0] as FleetGroup;
		expect(group.endpointLabel).toBe("m5max");
		expect(group.rows).toHaveLength(2);

		const [running, idle] = group.rows;
		// Deterministic sort: the running row comes first.
		expect(running?.servedId).toBe("qwop4b-a");
		expect(running?.modelId).toBe("qwen3-4b-a");
		expect(running?.state).toBe("running");
		expect(running?.role).toBe("worker");
		expect(running?.lineage).toBe("qwen");
		expect(running?.drivingTaskId).toBe("classify-trends");
		expect(running?.drivingCardTitle).toBe("Classify trends");
		expect(running?.isSpec).toBe(true);
		expect(running?.tokensPerSecond).toBe(33); // rounded from 33.4

		expect(idle?.servedId).toBe("ornith9-m5");
		expect(idle?.state).toBe("idle");
		expect(idle?.role).toBeNull();
		expect(idle?.drivingTaskId).toBeNull();
		expect(idle?.drivingCardTitle).toBeNull();
		expect(idle?.isSpec).toBe(false);
		expect(idle?.lineage).toBe("qwen");
		expect(idle?.tokensPerSecond).toBeNull(); // no samples ⇒ null
	});

	it("groups by endpoint (sharedEndpointId → endpoint → local) and sorts groups by label", () => {
		const registryModels: RuntimeNKleinModelRegistryEntry[] = [
			// shared-endpoint id wins over the URL endpoint.
			makeEntry({
				key: "coder-gpu",
				modelId: "qwen-coder",
				endpoint: "http://192.168.1.9:1234",
				constraints: {
					sharedEndpointId: "legion5pro",
					inputCostPerMillionTokens: null,
					outputCostPerMillionTokens: null,
					maxConcurrentRequests: null,
				},
			}),
			// No shared id ⇒ fall back to the URL endpoint, condensed to host:port.
			makeEntry({ key: "brain27", modelId: "gpt-oss-27b", endpoint: "http://m5max.local:1234/v1" }),
			// No shared id and no endpoint ⇒ "local".
			makeEntry({ key: "solo", modelId: "gpt-oss-3b", endpoint: null }),
		];

		const groups = composeFleetRows({
			registryModels,
			runningSessions: [],
			cardTitleByTaskId: new Map(),
		});

		// Sorted by label: "legion5pro" < "local" < "m5max.local:1234".
		expect(groups.map((group) => group.endpointLabel)).toEqual(["legion5pro", "local", "m5max.local:1234"]);
	});

	it("§5.AX: machine names (LM-Link map) beat endpoint labels for grouping, keyed by served or real id", () => {
		const groups = composeFleetRows({
			registryModels: [makeEntry({ key: "qwop4b-a", modelId: "qwen3-4b-a" })],
			runningSessions: [],
			cardTitleByTaskId: new Map(),
			machineByModelId: { "qwop4b-a": "m5max" },
		});
		expect(groups.map((group) => group.endpointLabel)).toEqual(["m5max"]);
	});

	it("§5.AQ: fresh warmth renders a warmKind; stale warmth (>10min) does not", () => {
		const nowMs = 1_000_000_000;
		const compose = (at: number) =>
			composeFleetRows({
				registryModels: [makeEntry({ key: "qwop4b-a", modelId: "qwen3-4b-a" })],
				runningSessions: [],
				cardTitleByTaskId: new Map(),
				warmthByModelId: { "qwop4b-a": { kind: "worker", at } },
				now: () => nowMs,
			});
		expect(compose(nowMs - 60_000)[0]?.rows[0]?.warmKind).toBe("worker");
		expect(compose(nowMs - 11 * 60_000)[0]?.rows[0]?.warmKind).toBeNull();
	});

	it("§5.AB swarm legibility: the driver's latest hook activity populates the row's live snippet", () => {
		const groups = composeFleetRows({
			registryModels: [makeEntry({ modelId: "qwen3-8b", key: "coder8" })],
			runningSessions: [
				makeSession({
					taskId: "t1",
					modelId: "qwen3-8b",
					role: "worker",
					latestHookActivity: {
						activityText: "  Editing src/recipes.ts  ",
						toolName: "edit_file",
						toolInputSummary: null,
						finalMessage: null,
						hookEventName: null,
						notificationType: null,
						source: null,
					},
				}),
			],
			cardTitleByTaskId: new Map([["t1", "Search bar"]]),
		});
		const row = groups[0]?.rows[0];
		expect(row?.activityText).toBe("Editing src/recipes.ts"); // trimmed
		expect(row?.activityToolName).toBe("edit_file");

		// Idle rows and drivers without activity stay null (blank text normalizes to null, not "").
		const idle = composeFleetRows({
			registryModels: [makeEntry({ modelId: "qwen3-8b", key: "coder8" })],
			runningSessions: [],
			cardTitleByTaskId: new Map(),
		});
		expect(idle[0]?.rows[0]?.activityText).toBeNull();
		expect(idle[0]?.rows[0]?.activityToolName).toBeNull();
	});

	it("ignores non-running sessions and models with a blank modelId when matching drivers", () => {
		const registryModels: RuntimeNKleinModelRegistryEntry[] = [
			makeEntry({
				key: "brain27",
				modelId: "gpt-oss-27b",
				constraints: {
					sharedEndpointId: "m5max",
					inputCostPerMillionTokens: null,
					outputCostPerMillionTokens: null,
					maxConcurrentRequests: null,
				},
			}),
		];
		const runningSessions: RuntimeTaskSessionSummary[] = [
			// Queued (not running) ⇒ must not become the driver.
			makeSession({
				taskId: "later",
				state: "queued",
				role: "architect",
				modelId: "gpt-oss-27b",
				sharedEndpointId: "m5max",
			}),
		];

		const groups = composeFleetRows({ registryModels, runningSessions, cardTitleByTaskId: new Map() });
		expect(groups[0]?.rows[0]?.state).toBe("idle");
		expect(groups[0]?.rows[0]?.role).toBeNull();
	});
});

describe("compactFleetActivityText", () => {
	it("cuts at the first JSON payload and caps length (glance surface, tooltip keeps the full text)", () => {
		const soup =
			'Retrying after error: 1 tool call(s) failed: [list_files] {"error":"Sandbox tool kanbanExtraTool failed.\\n{\\"ok\\":false}"}';
		expect(compactFleetActivityText(soup)).toBe("Retrying after error: 1 tool call(s) failed: [list_files]");
		expect(compactFleetActivityText("Reading specification.md")).toBe("Reading specification.md");
		expect(compactFleetActivityText(`${"x".repeat(120)}`)).toHaveLength(80);
		// Pure-JSON activity falls back to a raw prefix instead of an empty line.
		expect(compactFleetActivityText('{"ok":true}').length).toBeGreaterThan(0);
	});
});

describe("loaded vs available states (David 2026-07-10: unloaded models must not read as idle)", () => {
	const entry = (key: string) => makeEntry({ key, modelId: key });

	it("marks registry models NOT in the lms-ps machine map as 'available', loaded ones as 'idle'", () => {
		const groups = composeFleetRows({
			registryModels: [entry("loaded-model"), entry("catalog-only-model")],
			runningSessions: [],
			cardTitleByTaskId: new Map(),
			machineByModelId: { "loaded-model": "local" },
		});
		const rows = groups.flatMap((group) => group.rows);
		expect(rows.find((row) => row.servedId === "loaded-model")?.state).toBe("idle");
		expect(rows.find((row) => row.servedId === "catalog-only-model")?.state).toBe("available");
	});

	it("keeps the plain 'idle' reading when the machine map is absent/empty (cannot distinguish)", () => {
		const groups = composeFleetRows({
			registryModels: [entry("some-model")],
			runningSessions: [],
			cardTitleByTaskId: new Map(),
		});
		expect(groups.flatMap((g) => g.rows)[0]?.state).toBe("idle");
	});

	it("summarizes idle and available separately with the lineage mix", () => {
		const rows = composeFleetRows({
			registryModels: [entry("qwen-a"), entry("qwen-b"), entry("deepseek-c")],
			runningSessions: [],
			cardTitleByTaskId: new Map(),
			machineByModelId: { "qwen-a": "local" },
		}).flatMap((g) => g.rows);
		const summary = summarizeIdleFleetRows(rows);
		expect(summary).toContain("1 idle");
		expect(summary).toContain("2 available");
		expect(summary).toContain("qwen ×2");
	});
});

describe("duplicate registry variants", () => {
	it("collapses the ':default' role-wiring twin onto one row, keeping the better-informed state", () => {
		const groups = composeFleetRows({
			registryModels: [
				makeEntry({ modelId: "lmstudio:sim/qwen-fast-coder", key: "sim/qwen-fast-coder" }),
				makeEntry({ modelId: "lmstudio:sim/qwen-fast-coder:default", key: "sim/qwen-fast-coder:default" }),
				makeEntry({
					modelId: "lmstudio:sim/qwen-fast-coder:http://localhost:49383/v1",
					key: "sim/qwen-fast-coder@49383",
				}),
			],
			runningSessions: [],
			cardTitleByTaskId: new Map(),
		});
		const rows = groups.flatMap((group) => group.rows);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.modelId).toBe("lmstudio:sim/qwen-fast-coder");
	});
});
