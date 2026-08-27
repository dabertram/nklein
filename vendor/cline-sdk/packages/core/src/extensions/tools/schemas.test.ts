import { describe, expect, it } from "vitest";
import { ReadFileRequestSchema, ReadFilesInputUnionSchema } from "./schemas";

// §5.BD — quantized local models send a 0-based `start_line: 0` despite the one-based contract (live-observed 20
// times in one plan-mode decompose, qwen3.8-27b, 2026-08-27). The schema coerces any line number below one to
// "omitted" (read from the start / to the end) instead of rejecting the whole turn.

describe("ReadFileRequestSchema — sub-one line coercion", () => {
	it("coerces start_line: 0 to omitted (read from the start)", () => {
		const parsed = ReadFileRequestSchema.parse({ path: "/ws/src/x.ts", start_line: 0 });
		expect(parsed.start_line).toBeUndefined();
	});

	it("coerces end_line: 0 (and a negative start_line) to omitted", () => {
		const parsed = ReadFileRequestSchema.parse({ path: "/ws/src/x.ts", start_line: -3, end_line: 0 });
		expect(parsed.start_line).toBeUndefined();
		expect(parsed.end_line).toBeUndefined();
	});

	it("passes a valid one-based range through unchanged", () => {
		const parsed = ReadFileRequestSchema.parse({ path: "/ws/src/x.ts", start_line: 5, end_line: 40 });
		expect(parsed.start_line).toBe(5);
		expect(parsed.end_line).toBe(40);
	});

	it("keeps null and omission as the from-start / to-end sentinels", () => {
		expect(ReadFileRequestSchema.parse({ path: "/ws/src/x.ts", start_line: null }).start_line).toBeNull();
		expect(ReadFileRequestSchema.parse({ path: "/ws/src/x.ts" }).start_line).toBeUndefined();
	});

	it("still rejects a non-integer line number (a real mistake, not a 0-based one)", () => {
		expect(ReadFileRequestSchema.safeParse({ path: "/ws/src/x.ts", start_line: 2.5 }).success).toBe(false);
	});

	it("applies through the real tool entry point (ReadFilesInputUnionSchema)", () => {
		const result = ReadFilesInputUnionSchema.safeParse({ files: [{ path: "/ws/src/x.ts", start_line: 0 }] });
		expect(result.success).toBe(true);
		if (result.success && "files" in result.data) {
			expect(result.data.files[0]?.start_line).toBeUndefined();
		}
	});
});
