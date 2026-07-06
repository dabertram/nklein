import { describe, expect, it } from "vitest";
import {
	rekeyTableToStableModelKeys,
	resolveStableModelKey,
	type StableModelKeySource,
} from "../../../src/core/stable-model-identity";

const descriptors = new Map<string, StableModelKeySource>([
	["qwen3-8b-m5max", { modelKey: "qwen3-8b" }],
	["coder-gpu", { modelKey: "qwen2.5-coder-14b" }],
	["blank-key", { modelKey: "   " }],
]);

describe("resolveStableModelKey", () => {
	it("maps a loaded runtime id to its stable publisher key (drops the machine/instance suffix)", () => {
		expect(resolveStableModelKey("qwen3-8b-m5max", descriptors)).toBe("qwen3-8b");
		expect(resolveStableModelKey("coder-gpu", descriptors)).toBe("qwen2.5-coder-14b");
	});

	it("falls back to the (trimmed) runtime id when no descriptor matches — e.g. a cloud provider id is already stable", () => {
		expect(resolveStableModelKey("openai/gpt-5", descriptors)).toBe("openai/gpt-5");
		expect(resolveStableModelKey("  spaced-id  ", descriptors)).toBe("spaced-id");
	});

	it("falls back to the runtime id when the descriptor's key is blank (never returns empty)", () => {
		expect(resolveStableModelKey("blank-key", descriptors)).toBe("blank-key");
	});
});

describe("rekeyTableToStableModelKeys", () => {
	const sum = (a: { n: number }, b: { n: number }) => ({ n: a.n + b.n });

	it("re-keys runtime-id rows to their stable keys", () => {
		const table = { "qwen3-8b-m5max": { n: 3 }, "openai/gpt-5": { n: 1 } };
		const out = rekeyTableToStableModelKeys(table, (k) => resolveStableModelKey(k, descriptors), sum);
		expect(out).toEqual({ "qwen3-8b": { n: 3 }, "openai/gpt-5": { n: 1 } });
	});

	it("MERGES two runtime ids that collapse to the same stable key (rename fragmentation is healed)", () => {
		// the model was measured under two instance names that both map to `qwen3-8b`
		const resolve = (k: string) => (k === "qwen3-8b-old" || k === "qwen3-8b-new" ? "qwen3-8b" : k);
		const table = { "qwen3-8b-old": { n: 2 }, "qwen3-8b-new": { n: 5 } };
		expect(rekeyTableToStableModelKeys(table, resolve, sum)).toEqual({ "qwen3-8b": { n: 7 } });
	});

	it("keeps an unresolvable row under its original key (it decays, not lost)", () => {
		const table = { "unknown-instance": { n: 4 } };
		// resolver can't improve it (returns the same string) ⇒ row survives under its stored key
		expect(rekeyTableToStableModelKeys(table, (k) => k, sum)).toEqual({ "unknown-instance": { n: 4 } });
	});

	it("is a no-op-shaped identity when every key is already stable", () => {
		const table = { a: { n: 1 }, b: { n: 2 } };
		expect(rekeyTableToStableModelKeys(table, (k) => k, sum)).toEqual(table);
	});
});
