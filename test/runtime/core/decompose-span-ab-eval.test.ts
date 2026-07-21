import { describe, expect, test } from "vitest";
import {
	localizationMatchesTarget,
	parseDecomposeLocalizationResponse,
	selectPushedSpan,
	summarizeDecomposeSpanAb,
} from "../../../src/core/decompose-span-ab-eval";

describe("F11.2d decompose span A/B evaluation", () => {
	test("selects the strongest lexical span with stable path tie-breaking", () => {
		const selected = selectPushedSpan("reject a default flip when McNemar is not significant", [
			{ path: "z.ts", symbol: "other", snippet: "report model latency" },
			{ path: "b.ts", symbol: "decideDefaultFlip", snippet: "McNemar significant candidate improvement" },
			{ path: "a.ts", symbol: "decideDefaultFlip", snippet: "McNemar significant candidate improvement" },
		]);
		expect(selected).toMatchObject({ path: "a.ts", symbol: "decideDefaultFlip" });
	});

	test("parses final and pull responses even when flat JSON is fenced", () => {
		expect(parseDecomposeLocalizationResponse('```json\n{"path":"./src/a.ts","symbol":"go"}\n```')).toEqual({
			kind: "final",
			path: "src/a.ts",
			symbol: "go",
		});
		expect(parseDecomposeLocalizationResponse('<think>later</think> {"pullSymbol":"go"}')).toEqual({
			kind: "pull",
			symbol: "go",
		});
		expect(parseDecomposeLocalizationResponse('{"action":"pull","path":"","symbol":"go"}')).toEqual({
			kind: "pull",
			symbol: "go",
		});
		expect(parseDecomposeLocalizationResponse("not json")).toBeNull();
	});

	test("requires the exact normalized file and symbol", () => {
		const target = { path: "src/a.ts", symbol: "go" };
		expect(localizationMatchesTarget({ kind: "final", path: ".\\src\\a.ts", symbol: "go" }, target)).toBe(true);
		expect(localizationMatchesTarget({ kind: "final", path: "src/a.ts", symbol: "stop" }, target)).toBe(false);
		expect(localizationMatchesTarget({ kind: "pull", symbol: "go" }, target)).toBe(false);
	});

	test("uses paired significance rather than an eyeballed mean", () => {
		const inconclusive = summarizeDecomposeSpanAb(
			Array.from({ length: 12 }, (_, index) => ({
				model: "m",
				taskId: `${index}`,
				pullPassed: index < 8,
				pushPassed: index < 9,
			})),
		);
		expect(inconclusive.decision.flip).toBe(false);

		const decisive = summarizeDecomposeSpanAb(
			Array.from({ length: 20 }, (_, index) => ({
				model: "m",
				taskId: `${index}`,
				pullPassed: false,
				pushPassed: true,
			})),
		);
		expect(decisive.decision.flip).toBe(true);
	});
});
