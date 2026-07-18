import { describe, expect, it } from "vitest";
import {
	ContentAddressableCache,
	canonicalJson,
	computeModelResponseCacheKey,
	computeToolResultCacheKey,
	isToolResultCacheable,
} from "../../../src/core/content-addressable-cache";

describe("canonicalJson", () => {
	it("hashes semantically-equal objects identically regardless of key order, at every depth", () => {
		expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
			canonicalJson({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }),
		);
	});

	it("drops undefined-valued keys (absent === undefined for keying) but keeps null and array order", () => {
		expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
		expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
		expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
	});
});

describe("cache keys", () => {
	it("tool keys separate by tool, args, and context fingerprint", () => {
		const base = { toolName: "read_files", args: { path: "a.ts" }, contextFingerprint: "f1" };
		const same = computeToolResultCacheKey(base);
		expect(computeToolResultCacheKey({ ...base })).toBe(same);
		expect(computeToolResultCacheKey({ ...base, args: { path: "b.ts" } })).not.toBe(same);
		expect(computeToolResultCacheKey({ ...base, contextFingerprint: "f2" })).not.toBe(same);
		expect(computeToolResultCacheKey({ ...base, toolName: "list_files" })).not.toBe(same);
	});

	it("model keys separate by model, messages, tools, and sampling params", () => {
		const base = {
			modelId: "m",
			messages: [{ role: "user", content: "hi" }],
			tools: [{ name: "t" }],
			params: { temperature: 0 },
		};
		const same = computeModelResponseCacheKey(base);
		expect(computeModelResponseCacheKey({ ...base })).toBe(same);
		expect(computeModelResponseCacheKey({ ...base, modelId: "m2" })).not.toBe(same);
		expect(computeModelResponseCacheKey({ ...base, params: { temperature: 0.7 } })).not.toBe(same);
	});
});

describe("cacheability policy", () => {
	it("allows read-only retrieval tools and fails closed on mutation/execution", () => {
		for (const tool of ["read_files", "search_code", "repo_map", "ast_search"]) {
			expect(isToolResultCacheable(tool)).toBe(true);
		}
		for (const tool of ["write_file", "edit_file", "run_commands", "decompose_project", "unknown_tool"]) {
			expect(isToolResultCacheable(tool)).toBe(false);
		}
	});
});

describe("ContentAddressableCache LRU", () => {
	it("hits, misses, evicts least-recently-USED, and counts honestly", () => {
		const cache = new ContentAddressableCache<string>(2);
		cache.set("a", "A");
		cache.set("b", "B");
		expect(cache.get("a")).toBe("A"); // refresh a → b is now oldest
		cache.set("c", "C"); // evicts b
		expect(cache.get("b")).toBeUndefined();
		expect(cache.get("a")).toBe("A");
		expect(cache.get("c")).toBe("C");
		expect(cache.stats()).toMatchObject({ hits: 3, misses: 1, evictions: 1, size: 2 });
	});

	it("re-setting an existing key refreshes without eviction; capacity must be >= 1", () => {
		const cache = new ContentAddressableCache<number>(2);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.set("a", 10); // refresh, no eviction
		cache.set("c", 3); // evicts b (a was refreshed)
		expect(cache.get("a")).toBe(10);
		expect(cache.get("b")).toBeUndefined();
		expect(() => new ContentAddressableCache(0)).toThrow();
	});
});
