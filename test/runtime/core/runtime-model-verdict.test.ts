import { describe, expect, it } from "vitest";
import {
	assessRuntimeModelVerdict,
	combineSuitabilityVerdicts,
	MIN_RUNS_FOR_VERDICT,
	type RuntimeModelVerdict,
	type RuntimeRunOutcome,
} from "../../../src/core/runtime-model-verdict";
import type { SelfObservationEventRecord, SelfObservationSignal } from "../../../src/telemetry/self-observation-sink";

function event(
	modelId: string | null,
	signal: SelfObservationSignal,
	runId?: string | null,
): SelfObservationEventRecord {
	return {
		schemaVersion: 1,
		signal,
		severity: "warning",
		message: signal,
		modelId,
		runId: runId ?? null,
		createdAt: 1,
	};
}

describe("assessRuntimeModelVerdict", () => {
	it("reports UNKNOWN (low confidence) with no evidence", () => {
		const v = assessRuntimeModelVerdict({ modelId: "qwopus3.6-27b-v2-mlx", events: [] });
		expect(v.verdict).toBe("UNKNOWN");
		expect(v.confidence).toBe("low");
		expect(v.sampleCount).toBe(0);
		expect(v.signalCounts.model_stalled).toBe(0);
		expect(v.reason).toMatch(/No runtime evidence/);
	});

	it("stays UNKNOWN below the minimum run count even with a stall (too little evidence to condemn)", () => {
		const v = assessRuntimeModelVerdict({
			modelId: "m",
			events: [event("m", "model_stalled", "r1")],
		});
		expect(v.sampleCount).toBe(1);
		expect(v.verdict).toBe("UNKNOWN");
		expect(v.reason).toMatch(new RegExp(`need ≥${MIN_RUNS_FOR_VERDICT}`));
	});

	it("chronic stalling (≥50% of runs) ⇒ TOOL_UNSUITABLE", () => {
		const events = [
			event("m", "model_stalled", "r1"),
			event("m", "model_stalled", "r2"),
			event("m", "verification_failed", "r3"),
			event("m", "model_stalled", "r4"),
		];
		const v = assessRuntimeModelVerdict({ modelId: "m", events });
		expect(v.sampleCount).toBe(4);
		expect(v.signalCounts.model_stalled).toBe(3);
		expect(v.stallRate).toBeCloseTo(0.75);
		expect(v.verdict).toBe("TOOL_UNSUITABLE");
	});

	it("counts DISTINCT stalled runs, not stall events — multiple empty turns in one run count once (rate stays ≤1)", () => {
		// 5 runs; run r1 stalled THREE times (3 empty turns), the rest clean. Only 1 of 5 runs stalled ⇒ 20% ⇒ TOOL_WEAK,
		// NOT 3/5=60% TOOL_UNSUITABLE (the pre-fix bug counted total stall EVENTS over distinct runs).
		const events = [
			event("m", "model_stalled", "r1"),
			event("m", "model_stalled", "r1"),
			event("m", "model_stalled", "r1"),
		];
		const runs: RuntimeRunOutcome[] = ["r1", "r2", "r3", "r4", "r5"].map((runId) => ({ runId, modelId: "m" }));
		const v = assessRuntimeModelVerdict({ modelId: "m", events, runs });
		expect(v.sampleCount).toBe(5);
		expect(v.signalCounts.model_stalled).toBe(3); // raw event count preserved for detail
		expect(v.stallRate).toBeCloseTo(0.2); // 1 distinct stalled run / 5 — bounded, not 0.6
		expect(v.verdict).toBe("TOOL_WEAK");
	});

	it("moderate stalling (≥20%, <50%) ⇒ TOOL_WEAK", () => {
		// 1 stall across 4 runs (runIds widen the sample) = 25%.
		const events = [event("m", "model_stalled", "r1")];
		const runs: RuntimeRunOutcome[] = [
			{ runId: "r1", modelId: "m" },
			{ runId: "r2", modelId: "m" },
			{ runId: "r3", modelId: "m" },
			{ runId: "r4", modelId: "m" },
		];
		const v = assessRuntimeModelVerdict({ modelId: "m", events, runs });
		expect(v.sampleCount).toBe(4);
		expect(v.stallRate).toBeCloseTo(0.25);
		expect(v.verdict).toBe("TOOL_WEAK");
	});

	it("repeated malformed tool-args ⇒ TOOL_WEAK even without stalls", () => {
		const events = [
			event("m", "tool_argument_error", "r1"),
			event("m", "tool_argument_error", "r2"),
			event("m", "tool_argument_error", "r3"),
		];
		const v = assessRuntimeModelVerdict({ modelId: "m", events });
		expect(v.signalCounts.tool_argument_error).toBe(3);
		expect(v.stallRate).toBe(0);
		expect(v.verdict).toBe("TOOL_WEAK");
	});

	it("enough clean runs ⇒ TOOL_CAPABLE with rising confidence", () => {
		const runs: RuntimeRunOutcome[] = Array.from({ length: 10 }, (_, i) => ({ runId: `r${i}`, modelId: "m" }));
		const v = assessRuntimeModelVerdict({ modelId: "m", events: [], runs });
		expect(v.sampleCount).toBe(10);
		expect(v.verdict).toBe("TOOL_CAPABLE");
		expect(v.confidence).toBe("high");
	});

	it("filters evidence to the target model (normalized id match)", () => {
		const events = [
			event("other-model", "model_stalled", "r1"),
			event("other-model", "model_stalled", "r2"),
			event("m", "verification_failed", "r3"),
		];
		const runs: RuntimeRunOutcome[] = [
			{ runId: "r3", modelId: "m" },
			{ runId: "r4", modelId: "m" },
			{ runId: "r5", modelId: "m" },
		];
		const v = assessRuntimeModelVerdict({ modelId: "m", events, runs });
		// only the m events/runs count: 0 stalls, 3 runs ⇒ capable.
		expect(v.signalCounts.model_stalled).toBe(0);
		expect(v.sampleCount).toBe(3);
		expect(v.verdict).toBe("TOOL_CAPABLE");
	});
});

describe("combineSuitabilityVerdicts", () => {
	function runtimeVerdict(verdict: RuntimeModelVerdict["verdict"], sampleCount: number): RuntimeModelVerdict {
		return {
			modelId: "m",
			verdict,
			confidence: "medium",
			sampleCount,
			signalCounts: { model_stalled: 0, tool_argument_error: 0, verification_failed: 0, task_abandoned: 0 },
			stallRate: 0,
			reason: "test",
		};
	}

	it("insufficient runtime evidence ⇒ the catalog verdict stands", () => {
		const c = combineSuitabilityVerdicts("TOOL_NATIVE", runtimeVerdict("UNKNOWN", 1));
		expect(c.recommended).toBe("TOOL_NATIVE");
		expect(c.flag).toBe("insufficient_runtime_evidence");
	});

	it("UNKNOWN catalog ⇒ runtime fills it, flagged for a provisional entry", () => {
		const c = combineSuitabilityVerdicts("UNKNOWN", runtimeVerdict("TOOL_CAPABLE", 6));
		expect(c.recommended).toBe("TOOL_CAPABLE");
		expect(c.flag).toBe("runtime_fills_unknown");
	});

	it("a contradiction takes the more conservative verdict + flags reconciliation", () => {
		// catalog optimistic, runtime worse ⇒ recommend the worse one.
		const c = combineSuitabilityVerdicts("TOOL_NATIVE", runtimeVerdict("TOOL_WEAK", 8));
		expect(c.recommended).toBe("TOOL_WEAK");
		expect(c.flag).toBe("runtime_contradicts_catalog");
		// catalog pessimistic, runtime better ⇒ still take the more conservative (catalog).
		const c2 = combineSuitabilityVerdicts("TOOL_WEAK", runtimeVerdict("TOOL_CAPABLE", 8));
		expect(c2.recommended).toBe("TOOL_WEAK");
		expect(c2.flag).toBe("runtime_contradicts_catalog");
	});

	it("agreement passes through", () => {
		const c = combineSuitabilityVerdicts("TOOL_CAPABLE", runtimeVerdict("TOOL_CAPABLE", 5));
		expect(c.recommended).toBe("TOOL_CAPABLE");
		expect(c.flag).toBe("agree");
	});

	it("NATIVE catalog + CAPABLE runtime is NOT a contradiction (runtime can't prove NATIVE) — agree, keep NATIVE", () => {
		const c = combineSuitabilityVerdicts("TOOL_NATIVE", runtimeVerdict("TOOL_CAPABLE", 8));
		expect(c.flag).toBe("agree");
		expect(c.recommended).toBe("TOOL_NATIVE");
	});
});
