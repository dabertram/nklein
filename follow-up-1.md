# Follow-up — review checklist for the local-autonomous swarm implementation

> Review of the gpt5.5-medium implementation of [plan.md](plan.md) (181 commits since `main`, 239 files,
> +44k/−5k), checked against phases L0–L4 and the carried-forward debts. This is an actionable checklist
> in the same style as `plan.md`: `- [x]` = verified/healthy · `- [ ]` = open work to do.

## Verdict

The implementation is **high quality and broadly faithful to the plan**. No build-breaking or core-flow
bug was found; the open items below are design/robustness improvements and remaining debts. **F0 is the
change you flagged (200k clamp).**

### Health checks (verified this review)
- [x] ~~`npm run typecheck` (server) passes~~
- [x] ~~`npm run web:typecheck` passes~~
- [x] ~~`npm run lint` (biome, 496 files) clean~~
- [x] ~~`npm run check:nklein-boundary` passes~~
- [x] ~~`npx vitest run test/runtime/nklein-sdk test/runtime/telemetry` → 324 tests / 41 files pass (9.4s, no hang)~~
- [x] ~~Working tree clean; CHANGELOG `## [Upcoming]` present and diff-grounded~~

### Spot-verified as correctly implemented
- [x] ~~L0 cloud lockdown is broad: gate at `resolveLaunchConfig` chokepoint + save/add/update + `runtime-api` start + router + scheduler + registry + dev command~~
- [x] ~~L1.1 guard blocks/compacts **before** dispatch and emits proactive `context_overflow` telemetry (`blocked`/`compacted`)~~
- [x] ~~L1.2 overflow restart reuses persisted launch config with a `startRuntimeTaskSessionFromLaunchConfig` fallback~~
- [x] ~~L1.3 timeouts default to local-friendly values (request 1h, stream/tool/agent 24h, conversation 7d); the 1s bug is gone~~
- [x] ~~Router H2 fixed: a feasible preferred model is `assign`ed, not downgraded ([nklein-task-router.ts:161-168](src/nklein-sdk/nklein-task-router.ts#L161))~~

---

## F0 — Must change (you flagged this)

- [x] **Drop / relax the hard 200k effective-context clamp** so local models can use all available context.
      [nklein-task-session-service.ts:86](src/nklein-sdk/nklein-task-session-service.ts#L86),
      [normalizeEffectiveContextWindow :1060-1062](src/nklein-sdk/nklein-task-session-service.ts#L1060)
  - Context: the 200k cap was a reaction to the cloud 1.1M-token incident. **Cloud is now hard-blocked
    (L0), so the cost risk is gone.** Capping local models at 200k throttles Qwen-1M / 256k / 512k local
    builds and contradicts "use all available context."
  - [x] Honor the model's **real resolved window** — remove the clamp and trust `resolveContextWindowForTask`
        (already sources from launch/MCSR window with the 80k fallback), **or** keep only a very high named
        sanity bound (e.g. ≥2M) purely to guard against an absurdly misreported window. The operative limit
        must be the per-model resolved window, not a global 200k throttle.
  - [x] **Single-source-of-truth check:** ensure the guard's effective window, the value fed to
        `buildNKleinContextCompactionConfig` ([nklein-session-runtime.ts:362](src/nklein-sdk/nklein-session-runtime.ts#L362),
        default 80k), and the L1.6 context bar all read the **same** unclamped window, so guard / SDK
        compaction / bar never disagree.
  - [x] Add/adjust a test asserting a model advertising > 200k (e.g. 1M) keeps its full window end-to-end.

---

## F1 — Robustness / correctness

- [x] **Oversized *single* prompt should degrade gracefully, not hard-throw.**
      [prepareMessagesForKnownContextWindow :1138-1152](src/nklein-sdk/nklein-task-session-service.ts#L1138)
  - Today, if `projectedTokens > contextWindow` after maximal history compaction, the guard records a
    `blocked` signal and throws — correct for "never send oversized," but the common trigger (one huge
    incoming user message / file paste) can't be fixed by history compaction, so the user gets a generic error.
  - [x] Detect "the next prompt **alone** exceeds the working budget" and surface a specific message
        ("Your message (~Nk tokens) is larger than this model's ~Mk working budget — shorten it or pick a
        larger-window model"), distinct from the history-overflow case.
  - [x] Optionally offer to truncate/summarize the incoming prompt instead of failing the turn.
- [x] **Cold-start timeout floor.** `applyMcsrAwareLocalTimeoutScaling` is inert until `speed.samples > 0`
      ([nklein-timeout-scaling.ts:139](src/nklein-sdk/nklein-timeout-scaling.ts#L139)). Defaults are large so
      this is low-risk, but seed a conservative first-request floor from advertised window × a pessimistic
      tok/s prior so the very first turn on a brand-new slow model is generously bounded before EWMA kicks in.
- [x] **`route_up` reason-string accuracy.** When the preferred model is infeasible (e.g. window too small)
      the router assigns `feasible[0]` and labels it `route_up`, which can be lower capability
      ([nklein-task-router.ts:169-178](src/nklein-sdk/nklein-task-router.ts#L169)). The decision is correct;
      reword to "preferred model doesn't fit; selected the smallest model satisfying capability + window."
- [x] **Regression test: cloud-pinned card on the resume/overflow-restart path.** The start path maps
      `CloudProviderDisabledError → errorCode "cloud_provider_disabled"`
      ([runtime-api.ts:606](src/trpc/runtime-api.ts#L606)); add a test that a persisted cloud-pinned card
      hitting `startRuntimeTaskSessionFromLaunchConfig`
      ([:1234-1245](src/nklein-sdk/nklein-task-session-service.ts#L1234)) is also blocked, not silently
      restarted with the stale cloud config.

---

## F2 — Carried-forward debts still open (parked in plan, but affect coding quality)

- [x] **Syntax-tree + PageRank repo map.** Replaced JS/TS regex extraction with TypeScript AST extraction plus
      PageRank-style symbol ranking; repo maps still fall back to lexical extraction for non-JS/TS files and refresh
      after mutating tools.
      ([nklein-repo-map.ts](src/nklein-sdk/nklein-repo-map.ts), plan §M4). **Highest-leverage
      remaining item for small-model navigation** — recommend promoting from "parked" to active.
- [x] **Real local embeddings.** "Local embeddings" are bag-of-words token counts and search is lexical-first
      with semantic only as a zero-result fallback ([nklein-code-embeddings.ts](src/nklein-sdk/nklein-code-embeddings.ts),
      [nklein-code-search.ts](src/nklein-sdk/nklein-code-search.ts), plan §M2/M3). Either ship real offline ONNX
      embeddings (no API key) or rename to `local_lexical` so the capability isn't oversold.
- [x] **MCSR cold-start prior never decays** — weight by `1/(1+samples)` (plan §M1).
- [x] **Self-review can't detect "claimed done, no diff"** — feed a real files-changed signal (plan §M5).
- [x] **Dogfood backlog can emit graphs its own validator rejects** (complexity 80 > 75 cap, plan §M6).
- [x] **Trusted auto-merge passes on `null` regression delta** — treat unknown as block (plan §M7). Lower
      priority while self-merge stays off, but it's a safety bug.

---

## F3 — UX improvements

- [x] **First-run wizard / MCSR model panel discoverability.** Confirm the first-run local-endpoint setup
      and the model panel are reachable from an obvious place (empty-state CTA + settings), and that the
      panel prompts **"set context window"** when the window is unknown (the exact state behind the
      80k-looked-healthy-at-87k bug). Auto-prefill the window from the LM Studio/Ollama API on detect.
- [x] **Board-card context bar.** Verify [board-card.tsx](web-ui/src/components/board-card.tsx) renders the
      segmented health-colored bar (not just a number) so non-technical users see context pressure at a glance.
- [x] **Plain-language park reasons.** When a card parks (routing guard, repeated failure, overflow, cloud
      disabled), show a one-line human reason + suggested action on the card, not a raw error string.
- [x] **Decomposition dry-run preview.** Before applying a task graph, show estimated per-card wall-time
      (from MCSR tok/s) and total (e.g. "~40 min across 12 cards on your worker model").

---

## F4 — Coding ability

- [x] **Promote syntax-tree repo map + real embeddings naming** (see F2) — biggest quality lever for local models.
- [x] **Inject the shared decision blackboard** (plan L2.4) into dependent cards so parallel agents stay
      consistent on shared contracts — verify it's actually wired.
- [x] **Default test-first decomposition for suitable cards** — small models code far more reliably against a
      concrete failing test than an open-ended spec.

---

## F5 — Efficiency / speed on local models

- [x] **Prompt-prefix caching.** Keep the system prompt + tool schemas + repo map **stable and ordered first**
      so llama.cpp / LM Studio prompt caching hits across turns; avoid reshuffling injected context
      (invalidating the cache forces a full re-prefill — the dominant cost on local GPUs).
- [x] **Multi-endpoint parallelism nudges.** The scheduler serializes per local endpoint correctly; document /
      surface "all tasks waiting on one endpoint" in the swarm header and nudge users toward Ollama + LM Studio
      (or two GPUs) for real parallelism (one endpoint is time-sliced).
- [x] **Revisit model-load-aware batching.** Batch runnable cards for the *already-loaded* model before
      switching, to avoid LM Studio/Ollama weight-reload thrash (deselected during planning; worth
      reconsidering now the executor is live).
- [x] **Trim tool schemas aggressively for weak models.** Per-model tool routing exists; measure the token
      cost of the full tool surface against small working budgets and confirm the trimmed set is genuinely
      small (tool schemas are a large fixed prefill cost every turn).

---

## Done in this review pass
- [x] ~~CHANGELOG: note the effectively unlimited timeout mode is the fix for the undici "body timeout error" on long local streams~~

---

## Suggested order
1. **F0** (relax the 200k clamp) — small, safe, explicitly requested; do first.
2. **F1** oversized-prompt graceful degrade + the cloud-pinned resume regression test — low effort, high value.
3. Decide whether to promote **tree-sitter repo map + real local embeddings** (F2/F4) from parked to active —
   highest-leverage remaining item for local coding quality.
