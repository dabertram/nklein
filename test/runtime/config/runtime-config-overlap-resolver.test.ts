import { describe, expect, it } from "vitest";

import {
	DEFAULT_FILE_OVERLAP_PARALLELISM,
	normalizeFileOverlapParallelism,
	normalizeFileOverlapParallelismOverride,
	resolveRuntimeFileOverlapConfig,
} from "../../../src/config/runtime-config-overlap-resolver";
import type {
	RuntimeGlobalConfigFileShape,
	RuntimeProjectConfigFileShape,
} from "../../../src/config/runtime-config-types";

const globalConfig = (partial: Partial<RuntimeGlobalConfigFileShape>): RuntimeGlobalConfigFileShape =>
	partial as RuntimeGlobalConfigFileShape;
const projectConfig = (partial: Partial<RuntimeProjectConfigFileShape>): RuntimeProjectConfigFileShape =>
	partial as RuntimeProjectConfigFileShape;

describe("resolveRuntimeFileOverlapConfig", () => {
	it("resolves 'serialize' everywhere for empty configs (today's defer-on-overlap default)", () => {
		expect(DEFAULT_FILE_OVERLAP_PARALLELISM).toBe("serialize");
		expect(resolveRuntimeFileOverlapConfig(null, null)).toEqual({
			fileOverlapParallelism: "serialize",
			fileOverlapParallelismOverride: null,
			effectiveFileOverlapParallelism: "serialize",
		});
	});

	it("fails safe: only the literal string 'allow' enables parallelism", () => {
		for (const value of [true, 1, "ALLOW", "Allow", "yes", "parallel", "", {}, [], null, undefined, "allow "]) {
			expect(normalizeFileOverlapParallelism(value)).toBe("serialize");
			expect(
				resolveRuntimeFileOverlapConfig(globalConfig({ fileOverlapParallelism: value as unknown as "allow" }), null)
					.effectiveFileOverlapParallelism,
			).toBe("serialize");
		}
		expect(normalizeFileOverlapParallelism("allow")).toBe("allow");
		expect(normalizeFileOverlapParallelism("serialize")).toBe("serialize");
	});

	it("reads a configured global 'allow' through to the effective value", () => {
		expect(resolveRuntimeFileOverlapConfig(globalConfig({ fileOverlapParallelism: "allow" }), null)).toEqual({
			fileOverlapParallelism: "allow",
			fileOverlapParallelismOverride: null,
			effectiveFileOverlapParallelism: "allow",
		});
	});

	it("normalizes the per-project override sparsely: valid values pass, anything else means 'use global'", () => {
		expect(normalizeFileOverlapParallelismOverride("allow")).toBe("allow");
		expect(normalizeFileOverlapParallelismOverride("serialize")).toBe("serialize");
		for (const value of [true, 1, "ALLOW", "", {}, [], null, undefined]) {
			expect(normalizeFileOverlapParallelismOverride(value)).toBeNull();
		}
	});

	it("derives effective = project override ?? global (both directions)", () => {
		expect(
			resolveRuntimeFileOverlapConfig(
				globalConfig({ fileOverlapParallelism: "serialize" }),
				projectConfig({ fileOverlapParallelismOverride: "allow" }),
			),
		).toEqual({
			fileOverlapParallelism: "serialize",
			fileOverlapParallelismOverride: "allow",
			effectiveFileOverlapParallelism: "allow",
		});
		expect(
			resolveRuntimeFileOverlapConfig(
				globalConfig({ fileOverlapParallelism: "allow" }),
				projectConfig({ fileOverlapParallelismOverride: "serialize" }),
			),
		).toEqual({
			fileOverlapParallelism: "allow",
			fileOverlapParallelismOverride: "serialize",
			effectiveFileOverlapParallelism: "serialize",
		});
	});

	it("falls back to the global value when the project override is absent or garbage", () => {
		expect(
			resolveRuntimeFileOverlapConfig(globalConfig({ fileOverlapParallelism: "allow" }), projectConfig({}))
				.effectiveFileOverlapParallelism,
		).toBe("allow");
		expect(
			resolveRuntimeFileOverlapConfig(
				globalConfig({ fileOverlapParallelism: "allow" }),
				projectConfig({ fileOverlapParallelismOverride: "garbage" as unknown as "allow" }),
			),
		).toEqual({
			fileOverlapParallelism: "allow",
			fileOverlapParallelismOverride: null,
			effectiveFileOverlapParallelism: "allow",
		});
	});
});
