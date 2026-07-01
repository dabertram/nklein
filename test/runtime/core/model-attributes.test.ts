import { describe, expect, it } from "vitest";
import { type ModelAttributes, parseModelAttributes } from "../../../src/core/model-attributes";

describe("parseModelAttributes — resident-id examples (§5.AB-(B))", () => {
	// Each real resident id from the todo, with its full expected attribute triple.
	const cases: ReadonlyArray<readonly [string, ModelAttributes]> = [
		// mlx format token, no quant token, size 4b.
		["qwopus3.5-4b-coder-fable5-v1-mlx", { format: "mlx", quant: undefined, paramB: 4 }],
		// `@4bit` alias quant, no format token (bare alias is NOT proof of mlx). NO size: `phi-4-mini`'s `4` is `4-mini`,
		// not `4b`; and `@4bit` is a quant, not a size token — so paramB is undefined.
		["phi-4-mini-instruct@4bit", { format: "unknown", quant: "4bit", paramB: undefined }],
		// GGUF-style quant with `-` separators + a trailing machine tag that must NOT be swallowed; size 9b.
		["qwen3.5-9b-mtp-q4-k-xl-legion5pro", { format: "unknown", quant: "q4_k_xl", paramB: 9 }],
		// `@q8_0` alias with a trailing machine tag; no size (m4mini's 4 is letter-prefixed).
		["text-embedding-nomic-embed-text-v1.5@q8_0-m4mini", { format: "unknown", quant: "q8_0", paramB: undefined }],
		// mlx format AND `@4bit` quant together; size 35b.
		["ornith-1.0-35b-mlx@4bit", { format: "mlx", quant: "4bit", paramB: 35 }],
		// Neither format nor quant token; size 14b.
		["qwen2.5-coder-14b", { format: "unknown", quant: undefined, paramB: 14 }],
	];

	for (const [id, expected] of cases) {
		it(`parses ${id}`, () => {
			expect(parseModelAttributes(id)).toEqual(expected);
		});
	}
});

describe("parseModelAttributes — format inference", () => {
	it("infers mlx from an explicit mlx token in any position", () => {
		expect(parseModelAttributes("qwen3-8b-mlx").format).toBe("mlx");
		expect(parseModelAttributes("mlx-community/qwen3-8b").format).toBe("mlx");
		expect(parseModelAttributes("model.mlx").format).toBe("mlx");
		expect(parseModelAttributes("model-mlx@4bit").format).toBe("mlx");
	});

	it("infers gguf from an explicit gguf token in any position", () => {
		expect(parseModelAttributes("some-model.gguf").format).toBe("gguf");
		expect(parseModelAttributes("org/Qwen2.5-Coder-14B-Instruct-GGUF").format).toBe("gguf");
		expect(parseModelAttributes("gguf-something").format).toBe("gguf");
	});

	it("does NOT over-infer format: a bare @Nbit alias or a qN_k_m token alone stays unknown", () => {
		// LM Studio MLX often uses @Nbit and GGUF often uses qN_k_m, but the id alone is ambiguous — leave unknown.
		expect(parseModelAttributes("phi-4-mini-instruct@4bit").format).toBe("unknown");
		expect(parseModelAttributes("qwen3.5-9b-q4_k_m").format).toBe("unknown");
		expect(parseModelAttributes("qwen2.5-coder-14b").format).toBe("unknown");
	});

	it("does not fire on substrings (mlxfoo / ggufbar are not tokens)", () => {
		expect(parseModelAttributes("model-mlxfoo").format).toBe("unknown");
		expect(parseModelAttributes("ggufbar-model").format).toBe("unknown");
	});

	it("format is never undefined — always one of mlx/gguf/unknown", () => {
		expect(parseModelAttributes("").format).toBe("unknown");
		expect(parseModelAttributes("anything").format).toBe("unknown");
	});
});

describe("parseModelAttributes — quant normalization", () => {
	it("normalizes @Nbit aliases to Nbit", () => {
		expect(parseModelAttributes("m@4bit").quant).toBe("4bit");
		expect(parseModelAttributes("m@8bit").quant).toBe("8bit");
		expect(parseModelAttributes("m@16bit").quant).toBe("16bit");
	});

	it("lowercases and underscore-joins GGUF-style tokens", () => {
		expect(parseModelAttributes("model-Q6_K").quant).toBe("q6_k");
		expect(parseModelAttributes("model-q8_0").quant).toBe("q8_0");
		expect(parseModelAttributes("model-q4-k-xl").quant).toBe("q4_k_xl");
		expect(parseModelAttributes("model-Q4_K_M").quant).toBe("q4_k_m");
		expect(parseModelAttributes("model-q5_k_s").quant).toBe("q5_k_s");
		expect(parseModelAttributes("model-iq3_xxs").quant).toBe("iq3_xxs");
	});

	it("recognizes an @q8_0 alias (GGUF token behind an @)", () => {
		expect(parseModelAttributes("nomic-embed-text-v1.5@q8_0").quant).toBe("q8_0");
	});

	it("stops the quant token at a machine tag / format token (no greedy swallow)", () => {
		expect(parseModelAttributes("qwen3.5-9b-q4-k-xl-legion5pro").quant).toBe("q4_k_xl");
		expect(parseModelAttributes("llama-3.1-8b-q4_k_m-gguf").quant).toBe("q4_k_m");
		expect(parseModelAttributes("nomic@q8_0-m4mini").quant).toBe("q8_0");
	});

	it("is undefined when no quant token is present", () => {
		expect(parseModelAttributes("qwen2.5-coder-14b").quant).toBeUndefined();
		expect(parseModelAttributes("qwopus3.5-4b-coder-fable5-v1-mlx").quant).toBeUndefined();
		expect(parseModelAttributes("").quant).toBeUndefined();
	});

	it("does not read a bare 'q' or a non-quant q-word as a quant", () => {
		// `qwen` starts with q but has no digit after q; must not be a quant.
		expect(parseModelAttributes("qwen3-8b").quant).toBeUndefined();
	});
});

describe("parseModelAttributes — parameter size (MoE-token safety)", () => {
	it("reads an unambiguous standalone NNb token", () => {
		expect(parseModelAttributes("qwen2.5-coder-14b").paramB).toBe(14);
		expect(parseModelAttributes("gemma-2-27b-it").paramB).toBe(27);
		expect(parseModelAttributes("deepseek-v3-671b").paramB).toBe(671);
		expect(parseModelAttributes("122b-model").paramB).toBe(122);
	});

	it("supports fractional sizes", () => {
		expect(parseModelAttributes("qwen2.5-1.5b-instruct").paramB).toBe(1.5);
		expect(parseModelAttributes("model-0.5b").paramB).toBe(0.5);
	});

	it("is case-insensitive on the B", () => {
		expect(parseModelAttributes("Model-7B-Instruct").paramB).toBe(7);
	});

	it("REJECTS MoE effective/active-param tokens (a letter abutting the digits is not a size)", () => {
		// Gemma-3n effective-params `e4b`, Qwen MoE active-params `a3b`/`a22b`, Granite `a400m` — none are the size.
		expect(parseModelAttributes("gemma-3n-e4b-it").paramB).toBeUndefined();
		expect(parseModelAttributes("qwen3-a3b").paramB).toBeUndefined();
		expect(parseModelAttributes("some-a10b-thing").paramB).toBeUndefined();
	});

	it("reads the TOTAL size of a MoE id and ignores the active-params token", () => {
		// `qwen3-30b-a3b`: 30b is the parameter count, a3b (active) must not override or block it.
		expect(parseModelAttributes("qwen3-30b-a3b").paramB).toBe(30);
		expect(parseModelAttributes("qwen3-235b-a22b-instruct").paramB).toBe(235);
		expect(parseModelAttributes("granite-4.0-h-1b-a400m").paramB).toBe(1);
	});

	it("does not read the numeric prefix of a bit-quant or context token as a size", () => {
		// `@4bit` → the 4 is a quant, not a size; `4k`/`128k` context tokens are not `Nb`.
		expect(parseModelAttributes("model@8bit").paramB).toBeUndefined();
		expect(parseModelAttributes("model-128k-ctx").paramB).toBeUndefined();
	});

	it("is undefined when no size token is present", () => {
		expect(parseModelAttributes("nomic-embed-text-v1.5").paramB).toBeUndefined();
		expect(parseModelAttributes("").paramB).toBeUndefined();
	});
});

describe("parseModelAttributes — totality & edge cases", () => {
	it("never throws and returns the unknown/empty shape for blank or whitespace input", () => {
		expect(parseModelAttributes("")).toEqual({ format: "unknown", quant: undefined, paramB: undefined });
		expect(parseModelAttributes("   ")).toEqual({ format: "unknown", quant: undefined, paramB: undefined });
	});

	it("trims surrounding whitespace before parsing", () => {
		expect(parseModelAttributes("  ornith-1.0-35b-mlx@4bit  ")).toEqual({ format: "mlx", quant: "4bit", paramB: 35 });
	});

	it("tolerates a non-string argument without throwing (defensive totality)", () => {
		// Callers feed ids from external JSON; a malformed value must degrade to the empty shape, not crash.
		expect(parseModelAttributes(undefined as unknown as string)).toEqual({
			format: "unknown",
			quant: undefined,
			paramB: undefined,
		});
		expect(parseModelAttributes(null as unknown as string)).toEqual({
			format: "unknown",
			quant: undefined,
			paramB: undefined,
		});
	});

	it("is deterministic (same input → identical output across calls)", () => {
		const id = "qwen3.5-9b-mtp-q4-k-xl-legion5pro";
		expect(parseModelAttributes(id)).toEqual(parseModelAttributes(id));
	});

	it("case-insensitivity holds across all three fields at once", () => {
		expect(parseModelAttributes("ORNITH-35B-MLX@4BIT")).toEqual({ format: "mlx", quant: "4bit", paramB: 35 });
		expect(parseModelAttributes("Model-14B-Q4_K_M-GGUF")).toEqual({ format: "gguf", quant: "q4_k_m", paramB: 14 });
	});
});
