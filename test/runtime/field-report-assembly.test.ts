import { describe, expect, it } from "vitest";
import {
	assembleFieldReportCandidates,
	defaultReviewItems,
	type ObservationForAssembly,
} from "../../src/core/field-report-assembly";
import { buildFieldReport, renderReviewPayload } from "../../src/core/field-report-content";
import { checkLayerAAlwaysProducible, planFieldReportGeneration } from "../../src/core/field-report-generation";

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_750_000_000_000;

function observation(overrides: Partial<ObservationForAssembly>): ObservationForAssembly {
	return {
		signal: "custom",
		severity: "info",
		message: "mechanism ticked",
		createdAt: T0,
		...overrides,
	};
}

describe("assembleFieldReportCandidates (P16.7b)", () => {
	it("produces a Layer A field even for ZERO observations — Layer A is never empty", () => {
		const fields = assembleFieldReportCandidates([]);
		expect(fields).toHaveLength(1);
		expect(fields[0]).toMatchObject({ layer: "A", key: "observations.count" });
		expect(fields[0]?.value).toBe("0 observations recorded");
		const check = checkLayerAAlwaysProducible({
			structuralFieldCount: fields.filter((field) => field.layer === "A").length,
			plan: planFieldReportGeneration({ modelAvailable: false }),
		});
		expect(check.ok).toBe(true);
	});

	it("aggregates counts by severity/signal/mechanism and NEVER copies message text into Layer A", () => {
		const fields = assembleFieldReportCandidates([
			observation({ severity: "error", signal: "tool_error", message: "/Users/alice/secret-project exploded" }),
			observation({ severity: "error", signal: "tool_error", message: "boom in /Users/alice/secret-project" }),
			observation({
				severity: "info",
				signal: "custom",
				metadata: { category: "plan_integration_gate" },
				modelId: "qwen3-8b",
			}),
		]);
		const layerA = fields.filter((field) => field.layer === "A");
		expect(layerA.map((field) => field.key)).toEqual([
			"observations.count",
			"observations.by_severity",
			"observations.by_signal",
			"mechanisms.fired",
			"models.distinct_count",
		]);
		expect(layerA.find((field) => field.key === "observations.by_severity")?.value).toBe("error: 2\ninfo: 1");
		expect(layerA.find((field) => field.key === "mechanisms.fired")?.value).toBe("plan_integration_gate: 1");
		// Model COUNT is arithmetic; the id itself would disclose what the user runs.
		const models = layerA.find((field) => field.key === "models.distinct_count");
		expect(models?.value).toContain("1 distinct");
		for (const field of layerA) {
			expect(field.value).not.toContain("secret-project");
			expect(field.value).not.toContain("qwen3-8b");
		}
	});

	it("offers recent warning/error messages as Layer C excerpts, REDACTED before they become candidates", () => {
		const fields = assembleFieldReportCandidates([
			observation({
				severity: "error",
				signal: "runtime_error",
				message: "crash while reading /Users/alice/secret-project/src/index.ts with key sk-abcdefghijkl0123",
			}),
			observation({ severity: "debug", message: "noise that must not appear verbatim" }),
		]);
		const verbatim = fields.filter((field) => field.layer === "C");
		expect(verbatim).toHaveLength(1);
		expect(verbatim[0]?.value).not.toContain("/Users/alice");
		expect(verbatim[0]?.value).not.toContain("sk-abcdefghijkl0123");
		expect(verbatim[0]?.value).toContain("crash while reading");
		expect(fields.some((field) => field.value.includes("noise that must not appear"))).toBe(false);
	});

	it("caps excerpts at 5 newest and states the mechanism tail instead of hiding it", () => {
		const noisy = Array.from({ length: 8 }, (_, index) =>
			observation({
				severity: "error",
				signal: "tool_error",
				message: `failure ${index}`,
				createdAt: T0 + index * DAY,
			}),
		);
		const manyCategories = Array.from({ length: 12 }, (_, index) =>
			observation({ metadata: { category: `mechanism_${String(index).padStart(2, "0")}` } }),
		);
		const fields = assembleFieldReportCandidates([...noisy, ...manyCategories]);
		const verbatim = fields.filter((field) => field.layer === "C");
		expect(verbatim).toHaveLength(5);
		expect(verbatim[0]?.value).toContain("failure 7");
		expect(fields.find((field) => field.key === "mechanisms.fired")?.value).toContain("(+2 more categories");
	});

	it("defaultReviewItems includes Layer A and EXCLUDES everything above by default", () => {
		const fields = assembleFieldReportCandidates([
			observation({ severity: "error", signal: "runtime_error", message: "plain failure text" }),
		]);
		const report = buildFieldReport(fields, { maxLayer: "C" });
		const items = defaultReviewItems(renderReviewPayload(report));
		expect(items.filter((item) => item.layer === "A").every((item) => item.included)).toBe(true);
		expect(items.filter((item) => item.layer !== "A").every((item) => !item.included)).toBe(true);
	});
});
