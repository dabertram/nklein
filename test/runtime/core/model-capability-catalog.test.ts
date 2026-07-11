import { describe, expect, it } from "vitest";
import {
	assessModelSuitability,
	buildCatalogRosterRecommendation,
	DEFAULT_MODEL_SUITABILITY_POLICY,
	lookupModelCapability,
	MODEL_CAPABILITY_CATALOG,
	resolveActiveModelSuitabilityPolicy,
	resolveModelSuitabilityPolicy,
} from "../../../src/core/model-capability-catalog";

describe("model-capability-catalog: lookup", () => {
	it("resolves a known family from a served id / lms key, case- and quant-insensitively", () => {
		expect(lookupModelCapability("qwen/qwen3-8b")?.family).toBe("qwen3-8b");
		expect(lookupModelCapability("PHI-4-MINI-INSTRUCT@8bit")?.family).toBe("phi-4-mini-instruct");
		expect(lookupModelCapability("google/gemma-4-e2b")?.family).toBe("gemma-4-e2b");
	});

	it("resolves Qwen2.5 Coder 7B package/version aliases as the specific 7B row", () => {
		for (const id of [
			"qwen2.5-coder-7b-instruct",
			"qwen2.5.1-coder-7b-instruct",
			"mlx-community/Qwen2.5.1-Coder-7B-Instruct-4bit",
		]) {
			const entry = lookupModelCapability(id);
			expect(entry?.family, id).toBe("qwen2.5-coder-7b");
			expect(entry?.sizeGb, id).toBe(4.3);
			expect(entry?.synthesis, id).toBe("full");
			expect(assessModelSuitability(id, DEFAULT_MODEL_SUITABILITY_POLICY).severity, id).toBe("ok");
		}

		expect(lookupModelCapability("qwen/qwen2.5-coder-14b")?.family).toBe("qwen2.5-coder");
	});

	it("matches the most SPECIFIC family first (reasoning before mini-instruct; e4b before a generic gemma-4)", () => {
		// phi-4-mini-reasoning must NOT fall through to the broader phi-4-mini(-instruct) pattern.
		expect(lookupModelCapability("microsoft/phi-4-mini-reasoning")?.family).toBe("phi-4-mini-reasoning");
		expect(lookupModelCapability("phi-4-reasoning-plus")?.family).toBe("phi-4-reasoning-plus");
		// e4b is distinct from e2b.
		expect(lookupModelCapability("google/gemma-4-e4b")?.family).toBe("gemma-4-e4b");
		expect(lookupModelCapability("google/gemma-4-e2b")?.family).toBe("gemma-4-e2b");
	});

	it("matches the Nemotron Nano line across generations (nemotron-nano, nemotron-3-nano, llama-3.1-nemotron-nano)", () => {
		// Regression: the `nemotron-3-nano-4b` generation must resolve (broadened matcher, live-confirmed TOOL_WEAK 2026-06-29).
		expect(lookupModelCapability("nvidia/nemotron-3-nano-4b")?.family).toBe("nemotron-nano");
		expect(lookupModelCapability("nvidia/llama-3.1-nemotron-nano-4b-v1.1")?.family).toBe("nemotron-nano");
		expect(lookupModelCapability("nemotron-nano")?.family).toBe("nemotron-nano");
	});

	it("resolves the qwen3.5 reasoning family BEFORE the generic qwen3-8b row (specific wins)", () => {
		// Live 2026-07-01: qwen3.5-9b completes the 4-step agentic chain VIA the force-advance rung → TOOL_CAPABLE.
		expect(lookupModelCapability("qwen3.5-9b-mlx-m4")?.family).toBe("qwen3.5");
		expect(lookupModelCapability("qwen3.5-9b-mlx-m4")?.toolUse).toBe("TOOL_CAPABLE");
		// Ordering guard: the qwen3.5 row must NOT swallow the generic qwen3-8b family.
		expect(lookupModelCapability("qwen/qwen3-8b")?.family).toBe("qwen3-8b");
	});

	it("resolves the qwopus3.6 reasoning family BEFORE the generic qwopus-merge row (specific wins)", () => {
		// Live 2026-07-01: the 27B qwopus3.6 completes the chain VIA the force-advance rung → TOOL_CAPABLE (reasoning).
		expect(lookupModelCapability("qwopus3.6-27b-v2-mlx")?.family).toBe("qwopus3.6");
		expect(lookupModelCapability("qwopus3.6-27b-v2-mlx")?.toolUse).toBe("TOOL_CAPABLE");
		expect(lookupModelCapability("qwopus3.6-27b-v2-mlx")?.kind).toBe("reasoning");
		// A bare/other qwopus alias still falls through to the generic merge row.
		expect(lookupModelCapability("qwopus")?.family).toBe("qwopus-merge");
	});

	it("resolves the qwopus3.5 CODER family (the 4B outperforms the bigger reasoning variants)", () => {
		// Live 2026-07-01: qwopus3.5-4b-coder-fable5 FULLY passed the agentic chain (exit 0, incl. synthesis) — better than
		// the PARTIAL qwopus3.6-27b / qwen3.5-9b reasoning variants. Specific qwopus3.5 wins over the generic qwopus-merge.
		expect(lookupModelCapability("qwopus3.5-4b-coder-fable5-v1-mlx")?.family).toBe("qwopus3.5-coder");
		expect(lookupModelCapability("qwopus3.5-4b-coder-fable5-v1-mlx")?.toolUse).toBe("TOOL_CAPABLE");
		expect(lookupModelCapability("qwopus3.5-4b-coder-fable5-v1-mlx")?.kind).toBe("code");
		// qwopus3.6 (reasoning) still resolves to its own row, not the qwopus3.5 one.
		expect(lookupModelCapability("qwopus3.6-27b-v2-mlx")?.family).toBe("qwopus3.6");
	});

	it("returns null for a family not in the catalog", () => {
		expect(lookupModelCapability("some-obscure/model-v9")).toBeNull();
	});
});

describe("model-capability-catalog: 2026-07-01 sweep additions (ordering + verdicts)", () => {
	it("resolves qwen3.5-122b to its OWN high-tier row, NOT the 9B-calibrated qwen3.5 row", () => {
		// The 122B is a distinct MoE that passed CLEAN (native chain + full synth); it must not inherit the 9B via_force/weak verdict.
		const e = lookupModelCapability("qwen3.5-122b-a10b@4bit");
		expect(e?.family).toBe("qwen3.5-122b");
		expect(e?.toolUse).toBe("TOOL_CAPABLE");
		expect(e?.kind).toBe("reasoning");
		expect(e?.chaining).toBe("native"); // NOT via_force (the 9B row is via_force)
		expect(e?.synthesis).toBe("full"); // NOT weak (the 9B row is weak)
		expect(e?.speed).toBe("medium");
		expect(e?.sizeGb).toBe(69);
		// Ordering guard: the plain 9B still resolves to the 9B row (via_force / weak).
		const nine = lookupModelCapability("qwen3.5-9b-mlx-m4");
		expect(nine?.family).toBe("qwen3.5");
		expect(nine?.chaining).toBe("via_force");
	});

	it("resolves the NEW gemma-4-26b MoE as TOOL_CAPABLE (native chain, weak synth) — distinct from the ≤4B edge rows", () => {
		const e = lookupModelCapability("google/gemma-4-26b-a4b-qat");
		expect(e?.family).toBe("gemma-4-26b");
		expect(e?.toolUse).toBe("TOOL_CAPABLE");
		expect(e?.chaining).toBe("native");
		expect(e?.synthesis).toBe("weak");
		// The edge variants are unaffected (still their own TOOL_WEAK rows).
		expect(lookupModelCapability("google/gemma-4-e4b")?.family).toBe("gemma-4-e4b");
		expect(lookupModelCapability("google/gemma-4-e2b")?.family).toBe("gemma-4-e2b");
	});

	it("devstral + magistral (24B) resolve to their own rows; devstral is the full-synth agentic winner", () => {
		expect(lookupModelCapability("mistralai/devstral-small-2-2512")?.family).toBe("devstral-small");
		expect(lookupModelCapability("mistralai/devstral-small-2-2512")?.synthesis).toBe("full");
		// magistral's TOOL_WEAK verdict is NOT flipped by the single contradicting run (held pending a ×3 re-run).
		expect(lookupModelCapability("mistralai/magistral-small-2509")?.family).toBe("magistral-small");
		expect(lookupModelCapability("mistralai/magistral-small-2509")?.toolUse).toBe("TOOL_WEAK");
	});

	it("nemotron-3-nano stays TOOL_WEAK with chaining single_only (reconfirmed 2026-07-01)", () => {
		const e = lookupModelCapability("nvidia/nemotron-3-nano-4b");
		expect(e?.family).toBe("nemotron-nano");
		expect(e?.toolUse).toBe("TOOL_WEAK");
		expect(e?.chaining).toBe("single_only");
	});

	it("ornith-1.0-35b resolves to the research-backed CODER verdict (a load-fail ≠ incapable, NOT a reject) and does NOT catch the 9B", () => {
		// Corrected 2026-07-01 (user caught the conflation): the @4bit/@8bit MLX LOAD-FAIL is a CHECKPOINT issue, not a
		// capability verdict. Research: Ornith-1.0 is a top-tier SELF-SCAFFOLDING agentic CODER → TOOL_CAPABLE/code, no reject.
		const e = lookupModelCapability("ornith-1.0-35b-mlx@4bit");
		expect(e?.family).toBe("ornith-1.0-35b");
		expect(e?.toolUse).toBe("TOOL_CAPABLE");
		expect(e?.kind).toBe("code");
		expect(e?.verified).toBe(false); // research-based; not verified by us (our MLX checkpoints load-fail)
		expect(e?.selfScaffolding).toBe(true); // §5.AB-F: Ornith authors its own scaffold ⇒ !Klein should soften force-advance
		// A model that does NOT bring its own orchestration leaves the field undefined (opt-in metadata).
		expect(lookupModelCapability("qwopus3.5-4b-coder-fable5-v1-mlx")?.selfScaffolding).toBeUndefined();
		const v = assessModelSuitability("ornith-1.0-35b-mlx@4bit");
		expect(v.severity).not.toBe("reject"); // NOT rejected on a load-fail
		// The size-anchored 35B regex must NOT catch the 9B sibling — which now has its OWN entry (§11 sweep
		// 2026-07-11: the 9B LOADS + eval-harness 0.931, a fast reliable decompose+worker). So the 9B resolves to
		// the ornith-1.0-9b family (verified), NEVER to the 35B row.
		const nine = lookupModelCapability("ornith-1.0-9b-mlx");
		expect(nine?.family).toBe("ornith-1.0-9b");
		expect(nine?.verified).toBe(true);
	});

	it("gpt-oss chaining tracks ACTIVE params: 120b (~5.1B active) TOOL_CAPABLE full-synth vs 20b (~3.6B active) TOOL_WEAK chain-drop", () => {
		const big = lookupModelCapability("openai/gpt-oss-120b");
		expect(big?.family).toBe("gpt-oss-120b");
		expect(big?.toolUse).toBe("TOOL_CAPABLE");
		expect(big?.chaining).toBe("native");
		expect(big?.synthesis).toBe("full");
		const small = lookupModelCapability("gpt-oss-20b-mlx");
		expect(small?.family).toBe("gpt-oss-20b");
		expect(small?.toolUse).toBe("TOOL_WEAK");
		expect(small?.chaining).toBe("single_only"); // drives read+command, drops create_card+focus_chain (0/3)
	});

	it("qwen3-coder-next (80B agentic coder) resolves TOOL_CAPABLE native/full — a top-tier local driver", () => {
		const e = lookupModelCapability("qwen/qwen3-coder-next");
		expect(e?.family).toBe("qwen3-coder-next");
		expect(e?.toolUse).toBe("TOOL_CAPABLE");
		expect(e?.chaining).toBe("native");
		expect(e?.synthesis).toBe("full");
		expect(e?.kind).toBe("agentic");
	});

	it("gemma-4-12b is its OWN TOOL_CAPABLE full-synth row, distinct from the 26B MoE + the ≤4B edge rows", () => {
		const e = lookupModelCapability("gemma-4-12b-it-qat");
		expect(e?.family).toBe("gemma-4-12b");
		expect(e?.toolUse).toBe("TOOL_CAPABLE");
		expect(e?.synthesis).toBe("full");
		// distinct from the neighbors (regex can't cross-match)
		expect(lookupModelCapability("google/gemma-4-26b-a4b-qat")?.family).toBe("gemma-4-26b");
		expect(lookupModelCapability("google/gemma-4-e4b")?.family).toBe("gemma-4-e4b");
	});

	it("qwen3-14b stays PROVISIONAL; qwen3.6-27b is settled-verified (2026-07-10 eval) and does NOT shadow the qwopus3.6 driver", () => {
		const q14 = lookupModelCapability("qwen3-14b");
		expect(q14?.family).toBe("qwen3-14b");
		expect(q14?.toolUse).toBe("TOOL_WEAK");
		expect(q14?.verified).toBe(false); // n=1 legion fail — provisional
		const q36 = lookupModelCapability("qwen3.6-27b");
		expect(q36?.family).toBe("qwen3.6-27b");
		// 2026-07-10 settled eval + 2026-07-11 HIGH-power confirm: tool-use 12/12; reviewer deterministically weak
		// (the note documents the confirmed reviewer weakness — reworded from "RECALL" to "WEAKNESS CONFIRMED" §11).
		expect(q36?.verified).toBe(true);
		expect(q36?.toolUse).toBe("TOOL_CAPABLE");
		expect(q36?.note).toContain("REVIEWER WEAKNESS CONFIRMED");
		// the qwopus3.6 MERGE (backlog driver) still resolves to ITS own row, not the base qwen3.6-27b row.
		expect(lookupModelCapability("qwopus3.6-27b-v2-mlx")?.family).toBe("qwopus3.6");
	});
});

describe("model-capability-catalog: fine-grained metadata (§5.AL — chaining/synthesis/structuredOutput/speed/sizeGb)", () => {
	it("populates the 4B coder (qwopus3.5) as the native full-synthesis fast performer", () => {
		// Live 2026-07-01: qwopus3.5-4b-coder-fable5 chained natively (no force-advance) and echoed the marker (full synthesis).
		const e = lookupModelCapability("qwopus3.5-4b-coder-fable5-v1-mlx");
		expect(e?.chaining).toBe("native");
		expect(e?.synthesis).toBe("full");
		expect(e?.speed).toBe("fast");
		expect(e?.sizeGb).toBe(2.4);
		// Honestly left unprobed on it.
		expect(e?.structuredOutput).toBe("unknown");
	});

	it("populates the 27B reasoning (qwopus3.6) as via_force / weak-synthesis / slow with a native-tool-call structured path", () => {
		const e = lookupModelCapability("qwopus3.6-27b-v2-mlx");
		expect(e?.chaining).toBe("via_force"); // only completes the chain under the §5.AB force-advance rung
		expect(e?.synthesis).toBe("weak"); // chain ran but the final reply didn't reflect it
		expect(e?.speed).toBe("slow");
		expect(e?.structuredOutput).toBe("native_tool_call"); // json_schema dead-ends → forced tool call is the lever
		expect(e?.sizeGb).toBe(28.6);
	});

	it("populates the 9B reasoning (qwen3.5) as via_force / weak-synthesis / medium", () => {
		const e = lookupModelCapability("qwen3.5-9b-mlx-m4");
		expect(e?.chaining).toBe("via_force");
		expect(e?.synthesis).toBe("weak");
		expect(e?.structuredOutput).toBe("native_tool_call");
		expect(e?.speed).toBe("medium");
		expect(e?.sizeGb).toBe(6);
	});

	it("leaves the fine-grained fields undefined on entries not yet measured on those axes (research-only rows)", () => {
		// The new axes are OPTIONAL descriptive metadata — research-sourced entries carry none until a live sweep fills them.
		const e = lookupModelCapability("microsoft/phi-4-mini-reasoning");
		expect(e?.chaining).toBeUndefined();
		expect(e?.synthesis).toBeUndefined();
		expect(e?.speed).toBeUndefined();
		expect(e?.sizeGb).toBeUndefined();
	});
});

describe("model-capability-catalog: suitability gate", () => {
	it("allows a TOOL_NATIVE model with severity ok", () => {
		const v = assessModelSuitability("qwen/qwen3-8b");
		expect(v.toolUse).toBe("TOOL_NATIVE");
		expect(v.severity).toBe("ok");
		expect(v.allowed).toBe(true);
	});

	it("rejects a TOOL_UNSUITABLE reasoning model under the default (reject) policy", () => {
		const v = assessModelSuitability("microsoft/phi-4-mini-reasoning");
		expect(v.toolUse).toBe("TOOL_UNSUITABLE");
		expect(v.severity).toBe("reject");
		expect(v.allowed).toBe(false);
		expect(v.reason).toMatch(/math reasoning only/i);
	});

	it("warns (not rejects) a TOOL_WEAK model", () => {
		const v = assessModelSuitability("deepseek/deepseek-r1-0528-qwen3-8b");
		expect(v.toolUse).toBe("TOOL_WEAK");
		expect(v.severity).toBe("warn");
		expect(v.allowed).toBe(false);
	});

	it("honors a hard severityOverride even though the verdict alone would pass (Nemotron-Mini 4k context)", () => {
		const v = assessModelSuitability("nvidia/nemotron-mini-4b-instruct");
		expect(v.toolUse).toBe("TOOL_CAPABLE"); // would be "ok" on the verdict alone…
		expect(v.severity).toBe("reject"); // …but the 4k-context override forces reject
		expect(v.reason).toMatch(/4k context/i);
	});

	it("a verified entry carries NO unverified caveat (gemma-4-e4b, corrected to TOOL_WEAK from live e2e 2026-06-29)", () => {
		const v = assessModelSuitability("google/gemma-4-e4b");
		expect(v.toolUse).toBe("TOOL_WEAK");
		expect(v.reason).not.toMatch(/unverified/i);
	});

	it("passes the resident reasoning models (qwen3.5 / qwopus3.6) at ok — TOOL_CAPABLE via the force-advance rung", () => {
		for (const id of ["qwen3.5-9b-mlx-m4", "qwopus3.6-27b-v2-mlx"]) {
			const v = assessModelSuitability(id);
			expect(v.toolUse, id).toBe("TOOL_CAPABLE");
			expect(v.severity, id).toBe("ok");
			expect(v.allowed, id).toBe(true);
			expect(v.reason, id).not.toMatch(/unverified/i);
		}
	});

	it("defers an UNKNOWN model to policy.onUnknown (default warn) and explains how to investigate", () => {
		const v = assessModelSuitability("some-obscure/model-v9");
		expect(v.toolUse).toBe("UNKNOWN");
		expect(v.severity).toBe("warn");
		expect(v.entry).toBeNull();
		expect(v.reason).toMatch(/capability check|model sweep/i);
	});
});

describe("model-capability-catalog: active policy from env (§5.AL global setting)", () => {
	it("defaults to warn-and-reject when no env override is set", () => {
		expect(resolveActiveModelSuitabilityPolicy({})).toEqual({ onUnsuitable: "reject", onUnknown: "warn" });
	});

	it("NKLEIN_MODEL_GATE_UNSUITABLE relaxes the unsuitable action (allow/warn/reject)", () => {
		expect(resolveActiveModelSuitabilityPolicy({ NKLEIN_MODEL_GATE_UNSUITABLE: "warn" }).onUnsuitable).toBe("warn");
		expect(resolveActiveModelSuitabilityPolicy({ NKLEIN_MODEL_GATE_UNSUITABLE: "allow" }).onUnsuitable).toBe("ok");
	});

	it("NKLEIN_MODEL_GATE_UNKNOWN tightens/loosens the unknown action; unrecognized values keep the default", () => {
		expect(resolveActiveModelSuitabilityPolicy({ NKLEIN_MODEL_GATE_UNKNOWN: "reject" }).onUnknown).toBe("reject");
		expect(resolveActiveModelSuitabilityPolicy({ NKLEIN_MODEL_GATE_UNKNOWN: "nonsense" }).onUnknown).toBe("warn");
	});

	it("a relaxed env policy flows through assessModelSuitability (a reject becomes warn)", () => {
		const policy = resolveActiveModelSuitabilityPolicy({ NKLEIN_MODEL_GATE_UNSUITABLE: "warn" });
		expect(assessModelSuitability("microsoft/phi-4-mini-reasoning", policy).severity).toBe("warn");
	});

	it("layers priority env > runtime-config base > shipped default (the §5.AL settings integration)", () => {
		// base = the project's effective runtime-config policy (config vocabulary: allow|warn|reject; allow → ok).
		const base = { onUnsuitable: "warn", onUnknown: "allow" };
		// No env → the config base wins over the shipped default.
		expect(resolveActiveModelSuitabilityPolicy({}, base)).toEqual({ onUnsuitable: "warn", onUnknown: "ok" });
		// env override beats the config base.
		expect(resolveActiveModelSuitabilityPolicy({ NKLEIN_MODEL_GATE_UNSUITABLE: "reject" }, base).onUnsuitable).toBe(
			"reject",
		);
	});
});

describe("model-capability-catalog: policy resolution", () => {
	it("the shipped default is warn-and-reject (reject unsuitable, warn unknown)", () => {
		expect(DEFAULT_MODEL_SUITABILITY_POLICY).toEqual({ onUnsuitable: "reject", onUnknown: "warn" });
	});

	it("a project override wins per-field; unset fields inherit the global policy", () => {
		const merged = resolveModelSuitabilityPolicy(
			{ onUnsuitable: "reject", onUnknown: "warn" },
			{ onUnsuitable: "warn" },
		);
		expect(merged).toEqual({ onUnsuitable: "warn", onUnknown: "warn" });
	});

	it("a loosened onUnsuitable policy downgrades a plain unsuitable model to warn…", () => {
		const policy = resolveModelSuitabilityPolicy(undefined, { onUnsuitable: "warn" });
		expect(assessModelSuitability("microsoft/phi-4-mini-reasoning", policy).severity).toBe("warn");
	});

	it("…but a hard per-entry override is NOT loosened by a permissive policy", () => {
		const policy = resolveModelSuitabilityPolicy(undefined, { onUnsuitable: "warn" });
		// Nemotron-Mini's override is a reject regardless of policy (its base verdict is TOOL_CAPABLE anyway).
		expect(assessModelSuitability("nvidia/nemotron-mini-4b-instruct", policy).severity).toBe("reject");
	});
});

describe("model-capability-catalog: roster recommendation (§5.AL keep-list projection)", () => {
	it("groups every catalog family into exactly one of prefer/caution/avoid", () => {
		const tiers = buildCatalogRosterRecommendation();
		const total = tiers.reduce((n, t) => n + t.families.length, 0);
		expect(total).toBe(MODEL_CAPABILITY_CATALOG.length);
		expect(tiers.map((t) => t.tier)).toEqual(["prefer", "caution", "avoid"]);
	});

	it("puts TOOL_NATIVE/CAPABLE in prefer, TOOL_WEAK in caution, TOOL_UNSUITABLE in avoid", () => {
		const tiers = buildCatalogRosterRecommendation();
		const prefer = tiers.find((t) => t.tier === "prefer")?.families.map((f) => f.family) ?? [];
		const avoid = tiers.find((t) => t.tier === "avoid")?.families.map((f) => f.family) ?? [];
		const caution = tiers.find((t) => t.tier === "caution")?.families.map((f) => f.family) ?? [];
		expect(prefer).toContain("qwen3-8b"); // TOOL_NATIVE
		expect(avoid).toContain("phi-4-mini-reasoning"); // TOOL_UNSUITABLE
		expect(caution).toContain("gemma-4-e2b"); // TOOL_WEAK
	});

	it("a hard severityOverride:reject forces AVOID even for a TOOL_CAPABLE verdict (Nemotron-Mini's 4k context)", () => {
		const tiers = buildCatalogRosterRecommendation();
		const prefer = tiers.find((t) => t.tier === "prefer")?.families.map((f) => f.family) ?? [];
		const avoid = tiers.find((t) => t.tier === "avoid")?.families.map((f) => f.family) ?? [];
		expect(avoid).toContain("nemotron-mini"); // TOOL_CAPABLE verdict, but gate-rejected → avoid
		expect(prefer).not.toContain("nemotron-mini");
	});

	it("sorts each tier strongest-verdict first (NATIVE before CAPABLE in prefer)", () => {
		const prefer = buildCatalogRosterRecommendation().find((t) => t.tier === "prefer")?.families ?? [];
		const firstNativeIdx = prefer.findIndex((f) => f.toolUse === "TOOL_NATIVE");
		const firstCapableIdx = prefer.findIndex((f) => f.toolUse === "TOOL_CAPABLE");
		expect(firstNativeIdx).toBeGreaterThanOrEqual(0);
		expect(firstCapableIdx).toBeGreaterThan(firstNativeIdx);
	});
});

describe("model-capability-catalog: data integrity", () => {
	it("every entry carries a note and at least one source", () => {
		for (const entry of MODEL_CAPABILITY_CATALOG) {
			expect(entry.note.length, entry.family).toBeGreaterThan(0);
			expect(entry.sources.length, entry.family).toBeGreaterThan(0);
		}
	});
});
