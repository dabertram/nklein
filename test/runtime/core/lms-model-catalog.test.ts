import { describe, expect, it } from "vitest";
import { parseLmsLsCatalog, parseLmsSizeToGB } from "../../../src/core/lms-model-catalog.js";

const SAMPLE = `You have 71 models, taking up 1.39 TB of disk space.

LLM                                          PARAMS     ARCH              SIZE         DEVICE
deepseek-v4-flash-dq                                    deepseek_v4       96.53 GB     Local
gemma-4-12b-it-qat                           12B        gemma4            7.15 GB      legion5pro
qwen/qwen3.6-35b-a3b (2 variants)            35B        qwen3_5_moe       37.75 GB     Local
qwen3-0.6b-mlx                               0.6B       qwen3             351.38 MB    m4mini

EMBEDDING                                    PARAMS    ARCH          SIZE         DEVICE
text-embedding-nomic-embed-text-v1.5@q4_k_m            Nomic BERT    84.11 MB     m4mini`;

describe("parseLmsSizeToGB", () => {
	it("normalizes GB/MB/TB to GB", () => {
		expect(parseLmsSizeToGB("7.15 GB")).toBeCloseTo(7.15);
		expect(parseLmsSizeToGB("351.38 MB")).toBeCloseTo(0.3431, 3);
		expect(parseLmsSizeToGB("1.39 TB")).toBeCloseTo(1423.36);
	});
	it("returns null for a non-size token", () => {
		expect(parseLmsSizeToGB("qwen3_5_moe")).toBeNull();
		expect(parseLmsSizeToGB("")).toBeNull();
	});
});

describe("parseLmsLsCatalog", () => {
	it("parses each LLM row's model key, device, and size", () => {
		const catalog = parseLmsLsCatalog(SAMPLE, { localDeviceName: "m5max" });
		expect(catalog).toEqual([
			{ modelKey: "deepseek-v4-flash-dq", device: "m5max", sizeGB: 96.53 }, // blank PARAMS column tolerated
			{ modelKey: "gemma-4-12b-it-qat", device: "legion5pro", sizeGB: 7.15 },
			{ modelKey: "qwen/qwen3.6-35b-a3b", device: "m5max", sizeGB: 37.75 }, // "(2 variants)" stripped, Local aliased
			{ modelKey: "qwen3-0.6b-mlx", device: "m4mini", sizeGB: expect.closeTo(0.3431, 3) },
		]);
	});

	it("skips the EMBEDDING section entirely (infra, not chat candidates)", () => {
		const catalog = parseLmsLsCatalog(SAMPLE, { localDeviceName: "m5max" });
		expect(catalog.some((m) => m.modelKey.includes("embed"))).toBe(false);
	});

	it("defaults the Local alias to 'local' when no name is given", () => {
		const catalog = parseLmsLsCatalog("deepseek-v4-flash-dq    deepseek_v4    96.53 GB    Local");
		expect(catalog[0]?.device).toBe("local");
	});

	it("returns [] for empty / header-only output", () => {
		expect(parseLmsLsCatalog("")).toEqual([]);
		expect(parseLmsLsCatalog("You have 0 models, taking up 0 B of disk space.")).toEqual([]);
	});
});
