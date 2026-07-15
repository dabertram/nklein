import { describe, expect, it } from "vitest";
import {
	inputsToMemoryAudit,
	isMemoryAuditInputOutOfRange,
	MEMORY_AUDIT_DAY_BOUNDS,
	memoryAuditToInputs,
} from "@/components/runtime-settings-memory-audit";
import type { RuntimeMemoryFreshnessAudit } from "@/runtime/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function audit(cadenceMs: number, stalenessThresholdMs: number): RuntimeMemoryFreshnessAudit {
	return { enabled: true, paused: false, cadenceMs, stalenessThresholdMs } as RuntimeMemoryFreshnessAudit;
}

describe("memoryAuditToInputs (F5.2)", () => {
	it("renders ms as day strings — integers plain, fractions to 2dp", () => {
		const inputs = memoryAuditToInputs(audit(7 * MS_PER_DAY, 1.5 * MS_PER_DAY));
		expect(inputs).toMatchObject({ enabled: true, paused: false, cadenceDays: "7", stalenessDays: "1.5" });
	});
});

describe("isMemoryAuditInputOutOfRange (F5.2)", () => {
	const bounds = MEMORY_AUDIT_DAY_BOUNDS.cadence;

	it("flags empty / non-numeric / out-of-range and accepts an in-range value", () => {
		expect(isMemoryAuditInputOutOfRange("", bounds)).toBe(true);
		expect(isMemoryAuditInputOutOfRange("abc", bounds)).toBe(true);
		expect(isMemoryAuditInputOutOfRange(`${bounds.min - 1}`, bounds)).toBe(true);
		expect(isMemoryAuditInputOutOfRange(`${bounds.max + 1}`, bounds)).toBe(true);
		expect(isMemoryAuditInputOutOfRange(`${(bounds.min + bounds.max) / 2}`, bounds)).toBe(false);
	});
});

describe("inputsToMemoryAudit (F5.2)", () => {
	it("round-trips a valid in-bounds audit to within a day", () => {
		const mid = Math.round((MEMORY_AUDIT_DAY_BOUNDS.cadence.min + MEMORY_AUDIT_DAY_BOUNDS.cadence.max) / 2);
		const original = audit(mid * MS_PER_DAY, mid * MS_PER_DAY);
		const restored = inputsToMemoryAudit(memoryAuditToInputs(original));
		expect(restored.enabled).toBe(true);
		expect(restored.paused).toBe(false);
		expect(Math.abs(restored.cadenceMs - original.cadenceMs)).toBeLessThan(MS_PER_DAY);
	});

	it("normalizes non-numeric day input to a finite cadence (never NaN persisted)", () => {
		const result = inputsToMemoryAudit({ enabled: true, paused: false, cadenceDays: "abc", stalenessDays: "abc" });
		expect(Number.isFinite(result.cadenceMs)).toBe(true);
		expect(Number.isFinite(result.stalenessThresholdMs)).toBe(true);
	});
});
