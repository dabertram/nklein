# Context "smart zones", effective context, and enforced reasoning — research notes

> **Why this doc exists.** The user (2026-06-26) asked !Klein to never forget that **context SIZE relates to a model's
> capability + reasoning quality** — too small a budget hurts hard, but *over-filling* a large window also degrades
> output — and to **research the "smart zone" idea** (that not all positions in the context are equally well-used, and
> even the *earliest* tokens aren't the "smartest" because the model hasn't yet read the background) and use it to
> **arrange context content as well as possible**. They also want **enforced reasoning loops** (bounce a model against
> itself with varied system prompts, or bounce between different models) for models that can't reason well on their own,
> and for all of this to feed the **"!Klein learns to use each model to its best"** feature (§5.AA/§5.AB) — !Klein
> figuring out by trying + observing how to feed each connected model optimally.
>
> This is the grounded research base for **todo.md §5.AD**. Citations are dated; re-judge freshness against "now" (the
> §5.AC temporal lighthouse) when revisiting — this area moves fast.

## 1. The user's intuition is correct, and the real shape is a **U**, not "early = best"

- **Lost in the Middle** (Liu et al., Stanford/UW, 2023): even models trained for long context use information **best
  when it is at the very start or the very end** of the input, and **worst when it's in the middle** — a **U-shaped**
  performance curve. Relevant content buried mid-context is effectively under-attended regardless of its relevance.
- **The U-shape is partly architectural, not just learned.** "Lost in the Middle at Birth: An Exact Theory of
  Transformer Position Bias" (2026) shows the U-shape is present **at initialization** — an inherent geometric property
  of a causal decoder with residual connections — before any training/positional-encoding effect. A complementary line
  ("Lost in the Middle: An Emergent Property from Information Retrieval Demands", OpenReview) argues training reinforces
  it. Takeaway: it is a **robust, structural** property to design around, not a quirk of one model.
- **The user's specific "early tokens aren't the smartest zone" point** is a real, *complementary* effect to the U:
  attention is **causal/left-to-right**, so the earliest tokens **cannot attend to background that appears later** — at
  the moment they're produced/read, the context hasn't "arrived" yet. The model only has the full picture **near the
  end** of the prompt. This is exactly why **reasoning helps**: chain-of-thought appends tokens at the **end** (the
  strong zone), letting the model **re-read and bring earlier background forward** before answering. So "some models
  work around [the early-zone weakness] by reasoning" is precisely right.
- **Mitigations exist** (mostly model-side, but they motivate our prompt-side analogs): "Found in the Middle"
  (positional-attention calibration, +up to 15pp, arXiv:2406.16008), pause-tuning (arXiv:2502.20405), spectral
  attention steering, SEAL (arXiv:2501.15225). We can't retrain local models, but the **arrangement** lessons transfer.

## 2. Over-filling a big window degrades quality — "context rot" and **effective ≪ advertised**

- **Context rot** (Chroma, 2025): tested 18 frontier models (incl. GPT-4.1, Claude Opus 4, Gemini 2.5) — **every one
  degrades as input grows, even far below the window limit**. Mechanisms: (a) lost-in-the-middle, (b) **attention
  dilution** (quadratic — more tokens spread attention thinner), (c) **distractor interference** (semantically-similar
  but irrelevant content actively misleads). "Context Length Alone Hurts LLM Performance" (EMNLP-Findings 2025) isolates
  length itself as a harm even with the *same* relevant info. **⇒ More context is not free; there is a sweet spot.**
- **Effective vs advertised context** (RULER; NoLiMa, Adobe, arXiv:2502.05167): **effective length is routinely a half
  to a quarter of advertised.** A 128K model often behaves like ~64K; **many 32K models are really usable to ~4K–16K**.
  NoLiMa: 10 of 12 models drop to **≤half their base score by 32K**. "Effective length" is commonly defined as the
  **longest context where the model keeps ≥85% of its short-context base score**.
- **Direct consequence for !Klein:** the ≥32k **floor** (invariant #3) is a *minimum capability gate*, NOT a target to
  fill. The actual operating budget should be a **learned per-model "quality-effective" window** — the point past which
  *output quality* (not just overflow) starts dropping — which is typically **well below** both the advertised window
  and even the over-budget compaction threshold. NIAH (needle-in-a-haystack) over-states this (it's lexical retrieval);
  real multi-hop/semantic work degrades earlier, so trust RULER/NoLiMa-style signals over a raw NIAH pass.

## 3. How to **arrange** context (actionable, prompt-side)

- **Anthropic context-engineering guidance** (anthropic.com/engineering/effective-context-engineering-for-ai-agents +
  the long-context tips): put **long background/documents FIRST**, and the **instructions/question LAST** (after the
  documents) — this measurably strengthens output because the task sits in the strong end-zone *after* the model has
  read the background. Delimit sections with **clear tags** (e.g. `<document>`, `<instructions>`). Keep context
  **"informative yet tight"** — don't pad.
- **Synthesized placement policy** (maps the U + causal + rot findings to our prompt assembly):
  1. **End-anchor the task.** The actual instruction / acceptance / current step goes **at the very end** (strongest
     zone, and after all background has "arrived"). Today the new user message is last — good; extend this to board
     agents (the card's concrete task/acceptance should be the final block, after repo-map/rules/history).
  2. **Front-load only durable framing.** System role + hard invariants + tool contract go first (also a strong zone).
  3. **Push the weakest material to the middle**, not the critical bits. Bulk reference (repo map, long files, history)
     belongs mid-context; never bury the one load-bearing fact there.
  4. **Cut, don't stuff.** Prefer compaction/summarization (we already have LLMLingua-style compression + lean-window
     summary) to fit the **quality-effective** budget rather than the max. Fewer, higher-signal tokens beat more tokens.
  5. **Re-anchor at the end on long runs.** Restate the goal/current step near the tail after big tool outputs (we
     already do this for the §5.N focus chain and now the §5.AC date — generalize it to the task instruction).
  6. **Drop distractors.** Retrieval/repo-map results that are similar-but-irrelevant *hurt* (distractor interference) —
     rank + prune aggressively; a smaller, cleaner set beats a larger noisy one.

## 4. Enforced reasoning loops (for models that can't reason well alone)

The user's idea — if a model can't reason on its own, !Klein **enforces** reasoning by (a) bouncing it against **itself**
with **varied system prompts**, or (b) bouncing reasoning **between different models** with varied prompts. The research:

- **Self-Refine / Reflexion** (Madaan 2023; Shinn 2023): a model drafts → critiques → revises iteratively via *verbal*
  feedback, **no weight updates**. Helps when there's a usable signal to critique against.
- **⚠️ Critical caveat — intrinsic self-correction often does NOT help** ("LLMs Cannot Self-Correct Reasoning Yet",
  Huang et al. 2023, arXiv:2310.01798): a model critiquing *its own* reasoning **without external feedback/an oracle**
  frequently **fails to improve and can degrade** the answer (it talks itself out of correct answers). **⇒ Prefer
  feedback that is genuinely external:** a test/acceptance result, a different model, a different persona/system prompt
  that injects real diversity — not "are you sure?" against the same model+prompt.
- **Multi-agent debate / "society of minds"** (Du et al. 2023; many 2024–2026 follow-ups): multiple agents propose +
  **critique each other** to consensus — **significantly improves math reasoning + cuts hallucination**. Crucially,
  **a stronger agent disseminates knowledge to weaker ones in as little as one debate round, sharply raising the weak
  models' accuracy** (King Saud Univ. 2025; "Sparse Communication Topology" arXiv:2406.11776). This is the strongest
  evidence for the user's **cross-model bounce**: a small/weak local model can be *carried* by one round against a
  stronger local model.
- **Self-consistency** (Wang et al. 2022): sample N reasoning paths, **majority-vote** the answer — a cheap reliability
  win for any model that can produce *some* chain-of-thought (ties the §5.AB "reliability across repeats" metric).
- **Watch-outs:** **problem drift** in long debates (arXiv:2502.19559 — agents wander off-task) and **cost** (debate is
  N× calls). So: **debate/loop only when needed** ("Debate Only When Necessary", arXiv:2504.05047) — gate it on
  difficulty + observed failure, bound the rounds (reuse the §5.K reviewer round-limit + stall/identical-loop
  detection), and keep the task pinned (reuse the §5.S no-progress detector).
- **!Klein already has the seams:** §5.K second-opinion reviewer (up to 20 rounds, stall + identical-loop detection),
  the §5.S auto-clarify architect↔reviewer ping-pong, the §5.AA prompt-variation rung, and the §5.AB multi-model
  scheduler. "Enforced reasoning" is largely **composing these into an explicit, difficulty-gated, cross-model
  reason→critique→revise loop** with a learned per-model "does this model need enforced reasoning, and which kind?".

## 5. Tie-in: "!Klein learns to use each model to its best" (§5.AA `ModelBehaviorProfile` + §5.AB fitness)

Everything above is **per-model and learnable by observation** — exactly the user's framing. Extend the profile/fitness
records with **learned, observed** fields:
- **Quality-effective context window** — the budget past which *this model's* output quality drops (learned from real
  outcomes + optional eval sweeps), distinct from the advertised window and the overflow threshold (§6.3/§6.4 already
  track advertised/observed/override; this adds the *quality* knee).
- **Best arrangement strategy** — does end-anchoring / tighter budget / heavier compaction measurably help this model?
- **Native reasoning quality + "needs enforced reasoning?"** — and *which* kind pays off (self-consistency vs.
  cross-model debate vs. a stronger-model carry), with a learned rounds budget.
- **Distractor sensitivity** — how aggressively to prune retrieval for this model.
These are inputs to the §5.AB selection/escalation: a model with a small quality-effective window gets a tighter budget
+ more compaction; a weak-reasoner gets enforced cross-model reasoning on hard cards; an easy card on a robust model
skips all of it.

## Sources
- Liu et al., **Lost in the Middle** — https://arxiv.org/abs/2307.03172 (overview: https://dev.to/thousand_miles_ai/the-lost-in-the-middle-problem-why-llms-ignore-the-middle-of-your-context-window-3al2)
- **Lost in the Middle at Birth: An Exact Theory of Transformer Position Bias** — https://arxiv.org/pdf/2603.10123
- **Found in the Middle: Calibrating Positional Attention Bias** — https://arxiv.org/abs/2406.16008
- **Lost in the Middle: An Emergent Property from Information Retrieval Demands** — https://openreview.net/forum?id=XSHP62BCXN
- **Context Rot** (Chroma, 2025) — https://www.morphllm.com/context-rot · https://www.zenml.io/llmops-database/context-rot-evaluating-llm-performance-degradation-with-increasing-input-tokens
- **Context Length Alone Hurts LLM Performance** (EMNLP-Findings 2025) — https://aclanthology.org/2025.findings-emnlp.1264.pdf
- **NoLiMa: Long-Context Evaluation Beyond Literal Matching** — https://arxiv.org/html/2502.05167v1 · https://github.com/adobe-research/NoLiMa
- **RULER** + effective-vs-advertised — https://acingai.com/articles/effective-context-length · https://ofox.ai/blog/long-context-llm-benchmarks-200k-tokens-2026/
- **Anthropic — Effective context engineering for AI agents** — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents · long-context tips: https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/long-context-tips
- **LLMs Cannot Self-Correct Reasoning Yet** (Huang et al. 2023) — https://arxiv.org/pdf/2310.01798
- **Multi-agent debate** — https://arxiv.org/abs/2305.14325 · sparse topology https://arxiv.org/html/2406.11776v1 · debate-only-when-necessary https://arxiv.org/pdf/2504.05047 · problem-drift https://arxiv.org/pdf/2502.19559
