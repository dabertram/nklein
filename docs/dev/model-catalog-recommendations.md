# Model catalog — recommendations & sweep plan

> Living list (goal.md mandate, 2026-06-29): which LOCAL models to make available + the order to work them. **!Klein now
> load/unload-tests them itself** (guarded: one resident at a time, context 40000, ≤35B for now). The **user downloads**
> new variants; !Klein tests what's resident/available. Sources at the bottom.

## ★ CAPABLE-MODEL-FIRST (current direction, user 2026-06-29)

Primary effort is now **driving !Klein's features + the backlog with a capable model**, not smallest-up robustness (that's
postponed — the Tier roadmap below stays valid for when it resumes). **Current driver = `qwopus3.6-27b-v2-mlx`** (8bit MLX,
qwen3.6×opus merge; single-tool live-verified + completed real multi-card chains 2026-06-29). Work it **until it walls a
real backlog item**, then escalate per the ladder below — and **TELL THE USER** with the recommendation (the user wants
to be told at that moment and is curious about the pick).

### NEXT-MODEL escalation ladder — when the driver walls (ALL already downloaded ⇒ !Klein can just load + try)

Pick by the *failure mode* the driver hits (verified live before relying — §5.AL gate + the runtime-verdict aggregator):

1. **Orchestration / tool-chaining walls** (drops chains, narrates instead of acting, stalls on multi-step):
   → **`mistralai/devstral-small-2-2512`** (24B, 4bit) — *purpose-built for tool-calling / multi-step agent loops*
     (OpenHands). The targeted fix when the wall is agentic control, not raw smarts. **Top pick for this failure mode.**
   → fallback **`qwen/qwen3-coder-next`** (8bit) — Qwen3 agentic-coder, q8.
2. **Raw capability / quality walls** (reasoning depth, plan quality, code correctness — but tools work):
   → **`qwen/qwen3.6-35b-a3b`** (35B MoE ~3B active, 4bit) — *same qwen3.6 generation as the driver* ⇒ least behavioral
     surprise, bigger, MoE-fast. **Top pick for this failure mode.** (Ideal q8 not downloaded — see gap below.)
   → then **`qwen3.5-122b-a10b`** (122B MoE ~10B active, 4bit) — the big jump; MoE keeps it viable on 128 GB.
3. **Deep reasoning needed for a specific skill** (reviewer/planner, not the general driver):
   → **`qwen/qwq-32b`** (8bit) — reasoning-heavy; assign to the `review`/`planning` skill, not the whole run (reasoning
     models can be tool-weaker).
4. **Heavyweight dense option** (only if MoE choices underperform): **`meta/llama-3.3-70b`** (Q8_0) — strong but slow
   (dense 70B ≈ 70 GB, no MoE speedup); fits 128 GB but expect lower throughput.

**Download gap to flag to the user (not yet local):** a **q8 of `qwen/qwen3.6-35b-a3b`** (only 4bit is downloaded) — the
cleanest "same family, bigger, full precision" step up from the q8 27B driver. Worth fetching before we lean on tier-2 raw
capability.

## The one cross-cutting recommendation: try GGUF for tool-calling

The current roster is almost all **MLX** (`-m5max` / `-mlx`). Independent 2026 testing is consistent on two points that
matter for !Klein specifically (we are a *tool-calling* agent, and our hardest wall is the multi-tool chain):

- **GGUF (llama.cpp) is the battle-tested default for tool-calling + structured output** — "if you are uncertain, ship
  GGUF." MLX tool-call/grammar support is newer.
- **GGUF is faster on SHORT tasks (tool calls, classification)** — measured on an M5 Max: ~1.0 s vs ~2.2 s MLX for a
  classification turn. Our agent turns are mostly short tool-driving calls.

⇒ **High-value experiment for the user to enable:** download **GGUF Q4_K_M + Q8_0** of the models we lean on most
(qwen3-8b, qwen2.5-coder-14b, qwen3.5-9b, phi-4-mini, gemma-4-e2b) and let !Klein A/B them vs the MLX variants on the
e2e capstone + the chat tool flows. If GGUF reduces the narration/early-stop (our §5.Z failure mode), that's a free
reliability tier on the *same* models — more impactful than going bigger. (The 2026-06-29 gemma q4-vs-q8 A/B already
showed *quant* isn't the lever for the 2B chaining failure; *format* is the next thing to isolate.)

## Tier roadmap (POSTPONED — robustness-first, smallest-up; resumes after the capable-model-first push)

> Kept intact for when broad weak-model hardening resumes. The *current* direction is the capable-model-first section above.

### Tier 1 — smallest (the eventual robustness focus; PAUSED for now)
Already downloaded (test these first, smallest-up):
- `google/gemma-4-e2b` — **2B**, the capability floor (have q4 `-m5max`, q8, + instruct@4/8bit). The chain wall lives here.
- `phi-4-mini` — **3.8B** (reasoning + instruct@4bit/@8bit + reasoning-plus; reasoning-q8 downloading). The
  reason-then-act target; instruct variants may tool-call more directly than reasoning.
- `nvidia/nemotron-3-nano-4b` — **4B**.
- `qwopus3.5-4b-coder` — **~4B** coder.
- `qwen/qwen3-8b` — **8B** north-star (passes the e2e spaced).
- **Gap to download:** GGUF Q4_K_M/Q8_0 of gemma-4-e2b, phi-4-mini-instruct, qwen3-8b (the format A/B above).

### Tier 2 — mid ≤40B (speed + quality/perf; after Tier 1 is robust)
Already downloaded: `qwen/qwen2.5-coder-14b` (the current ≤14B cap), `qwen3.5-9b`, `ornith-1.0-9b`, `qwopus3.5-9b-coder`,
`qwen/qwen3.6-27b`, `google/gemma-4-26b-a4b-qat`, `qwen/qwq-32b`, `ornith-1.0-35b` (35B MoE).
- **Recommended downloads (strong agentic ≤40B, 2026):**
  - **Qwen3-Coder-30B** (MoE, ~3B active) — top local agentic-coding default; ~50% SWE-bench, fast for its size, ~20+ tok/s
    on Apple silicon. (Have `qwen/qwen3-coder-next` — confirm it's this family.)
  - **Devstral Small 2 (24B)** — purpose-built for *tool-calling / multi-step agent* workflows (OpenHands). Have
    `mistralai/devstral-small-2-2512` ✅ — a prime Tier-2 agentic candidate.
  - **Mistral Small 3.2 (24B)** — have ✅; solid all-rounder.

### Tier 3 — ≤80B
Already downloaded: `meta/llama-3.3-70b` (Q8_0), `nvidia/nemotron-3-super` (MoE), `qwen/qwen3.6-35b-a3b`,
`ravenx-…-35b-a3b`. **Recommended:** GLM-4.x-Air-class (long, tool-heavy sessions) if a ≤80B build exists; a Qwen3.6
~70B-class if released. Test for whether the bigger model *reliably* clears C3+ (multi-card) where capability — not
control — is the bottleneck.

### Tier 4 — ≤130B ("fun", only if it runs without heavy swap on 128 GB)
Already downloaded: `zai-org/glm-4.7-flash`, `qwen3.5-122b-a10b` (MoE, ~10B active — likely viable on 128 GB; MoE is the
sweet spot here). **Recommended:** MoE models with low active-param counts (e.g. ~120B-A10B) — they fit + run far better
than dense models of the same nominal size. Avoid dense >70B (heavy swap).

### Above 130B — out of scope (heavy swapping) unless the user greenlights dedicated sessions / new hardware.

## Swarm rosters — per-machine (user hardware: `m5max-128gb`, `m4mini-24gb`, `legion-5pro` RTX 4070m 8 GB)
> Two named rosters for the §5.AB per-machine pools. Each assigns a SUITABLE model per role to a machine that can run
> it FAST (fully in memory/VRAM, no heavy CPU offload). All picks are tool-capable per the §5.AL catalog (avoid the
> reasoning-only tool traps) and honor the ≥32k floor (keep loaded context modest on the small machines for speed).

### Roster Q — quality-leaning (from a 2026-06-29 GPT suggestion, analyzed + lightly adapted)
| Machine | Role | Model (GGUF Q4_K_M unless noted) | Fit |
|---|---|---|---|
| m5max-128gb | architect / planner / final reviewer | `Qwen3-Coder-Next` (80B/3B-active) `UD-Q4_K_M` ~48 GB | big-brain agentic coder, 256k ctx; comfortably in 128 GB |
| m4mini-24gb | mid coder / reviewer / design critic | `Qwen2.5-Coder-14B-Instruct` ~9 GB | real code 14B; keep ctx 8–16k for speed in 24 GB |
| legion-5pro 8 GB | fast implementer / test+lint fixer | `Qwen2.5-Coder-7B-Instruct` ~4.7 GB | fully on the 4070m 8 GB with KV room at modest ctx |
| legion alt profile | general reasoning / critic / summarizer | `Qwen3-8B` ~5 GB (thinking/non-thinking) | fits 8 GB; TOOL_NATIVE in our catalog |

**GPT's analysis is sound** on the VRAM-fit math (7B Q4 fits 8 GB with KV room; 14B Q4 ≈9 GB does NOT genuinely fit 8 GB; 80B Q4 ≈48 GB fits 128 GB). **Adaptations I'd make:** (a) the m5max at 128 GB is under-used running ONE 48 GB model — per the user's "max out the roles," it can ALSO host a dedicated **reasoning reviewer** (e.g. a ~20–30 GB reasoning model) alongside the coder so architect-reasoning and code-review are distinct models (still well within 128 GB); keep single big-brain only if quality-per-card > swarm throughput. (b) For the **architect/decompose** role specifically, watch the §5.Z C1 finding (narrate-instead-of-emit) — pair whichever model with the §5.AA force-decompose rung. (c) Prefer GGUF here (the §5.AL "GGUF for tool-calling" cross-cutting rec).

### Roster M — absolute-minimum size (still maxing each role), user-requested 2026-06-29
> Goal: the SMALLEST model that still clears each role's bar — a deliberate "how low can we go" experiment. Leans HARD
> on the §5.AA ladder (constrained decoding / reason-then-act / endpoint iteration) to carry sub-8B models over the
> tool-call-chaining bar our §5.O/§5.Z sweeps flagged for ≤7B models.
| Machine | Role | Model (Q4_K_M) | Min-size rationale |
|---|---|---|---|
| m5max-128gb (or m4mini) | architect / planner / reviewer | `Qwen3-8B` ~5 GB | smallest with solid reasoning + thinking-mode + TOOL_NATIVE; below this, planning quality drops sharply |
| m4mini-24gb (or legion) | coder / reviewer | `Qwen2.5-Coder-7B-Instruct` ~4.7 GB | smallest reliably-tool-calling code model (3B is borderline on multi-tool chaining) |
| legion-5pro 8 GB | fast micro-worker (lint/type/test fix, small-file edits) | `Qwen2.5-Coder-3B-Instruct` ~2 GB | min for trivial single-edit cards; escalate to 7B when it stalls |

**Caveats (honest, from our own sweeps):** ≤7B models have real tool-call-chaining weaknesses (§5.O/§5.Z) — Roster M is only viable BECAUSE the §5.AA recovery ladder + the finite-state controller carry them; expect more retries/escalations and treat ceilings as provisional (§5.0.3). `Qwen2.5-Coder-3B` for non-trivial cards is the first thing to escalate off. The 8B architect must be paired with the force-decompose rung. Keep all loaded contexts ≥32k (floor) but lean (speed) on the small machines.

## Notes
- The existing catalog is already large (40+ models across all tiers) — most "recommendations" above are already
  downloaded; the real near-term gap is **GGUF variants of the small models** for the format A/B.
- MoE models (active-param « total) are the right way to reach the higher tiers on 128 GB unified memory.
- Embedding model (`text-embedding-nomic-…`) is pinned infra — !Klein never unloads it.

## Sources
- [Best Open-Source LLMs for Agentic Coding 2026 — MindStudio](https://www.mindstudio.ai/blog/best-open-source-llms-agentic-coding-2026)
- [Best Local Coding LLMs 2026: Kimi/Qwen/Devstral — PromptQuorum](https://www.promptquorum.com/local-llms/best-local-llms-for-coding)
- [GGUF vs MLX on Apple Silicon (2026) — Contra Collective](https://contracollective.com/blog/gguf-vs-mlx-quantization-formats-apple-silicon-2026)
- [GGUF vs MLX decision guide — Muhammad Raza](https://muhammadraza.me/2026/gguf-vs-mlx-decision-guide/)
- [Best Open Source Self-Hosted LLMs for Coding 2026 — Pinggy](https://pinggy.io/blog/best_open_source_self_hosted_llms_for_coding/)
- [LM Studio Model Catalog](https://lmstudio.ai/models)
