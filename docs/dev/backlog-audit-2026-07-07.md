# Backlog audit 2026-07-07 — every unchecked `- [ ]` in todo.md, classified

David asked why ~460 `- [ ]` occurrences sat in todo.md and when the plan schedules them. This audit answered it:
8 parallel read-only agents verified every unchecked box against the shipped code/done.md/CHANGELOG/git history.
**25 boxes were flipped in todo.md with per-box evidence** (23 `[x]` done + stale, 5 `[-]` superseded — see the
inline notes on each flipped line). The remainder is genuinely open and is now CLASSIFIED so it can be scheduled
deliberately. The old §5.U section additionally carries a section-wide ❌ REJECTED-FOR-NOW callout (~25 boxes,
excluded below).

## Verdict totals (genuinely-open boxes, by owner class)

| Class | ~Count | What it means |
|---|---|---|
| **opus-code** | ~160 | Deterministic backend/code/test work — no live models or David needed |
| **fleet-time** | ~40 | Needs live local-model runs, sweeps, or loaded-project live checks |
| **fable-ui** | ~35 | Visual/UI build work (panels, dialogs, badges, tooltips, browsers) |
| **needs-david** | ~19 | His decision, credentials, hardware, or multi-machine setup |
| research/background | ~8 | Literature/design reading (§5.AV research boxes etc.) |

## The FABLE-territory list (next up, per David 2026-07-07)

- §5.L: delivery-override UI (project L1679 + per-card L1680) · host-escape double-confirm UI (L2087)
- §5.M: image-attachment modality-gate UI (L2075) · chat focus-chain §5.M surface (L2221) · execution-mode
  selector (L3137) · memory-scope toggles (L3138)
- §5.S: clarification header badge (L2627) · per-card clarification indicators (L2628) · the clarification
  dialog itself (L2639)
- §5.AA: model-telemetry surface in Settings (L4843)
- §5.AB: fitness-table browser (L5878/L5879) · "Evaluate connected models" trigger (L5669/L5882) ·
  wait-vs-attempt policy selector (L5881) · board-level live-reasoning/reflection summary (L5759/L5763) ·
  debate/review selector (L5896) · model-DB refresh allowlist UI (L5617)
- §5.AL: user-facing model-suggestions surface (L7979)
- §5.AK: shared Playwright mock helper + boot-smoke spec (L7792/L7793)
- §5.AP: skill browser UI — user-controlled mode C (L8488)
- §5.AQ: resource observability panel (L8847)
- §5.AR: curated-MCP toggle settings UI (L8878)
- §5.A/§5.I: paused-card UX polish (L1084) · embedding-discovery surfacing (L1067) · per-role override UI
  (L1631) · settings tooltips registry (L1651/L1652)

## The OPUS-territory list (after the Fable pass — switch models)

Highest-leverage first (repeat finding: **pure cores exist + tested, wiring is the gap**):
1. **Retry-policy engine adoption** (§5.AA): ⚠️ **RECLASSIFIED to FLEET-TIME-GATED (2026-07-07 Opus, after
   characterization).** The full engine stack (`decideNextRetryStrategy` → `planNextAttempt` →
   `runAdaptiveAttemptLoop`) is built + tested but has ZERO real callers — the audit finding is accurate. BUT it is
   NOT a safe deterministic wire: the chat seam (`chat-local-llm-adapter`) already runs an equivalent, **live-tuned**
   inline ladder (raise_token_budget → reduced_tool_set → narrated-recovery → prompt_variant → constrained_schema,
   with 2026-07-05 bug fixes), and that live order **diverges** from the engine's declared
   `RELEVANT_STRATEGIES_BY_OUTCOME` (e.g. `no_tool_call`: live does reduced→prompt_variant→constrained; engine
   declares reduced→constrained→alternate→prompt_variant→cross_model). Routing rung choice through the engine would
   therefore **change** small-model reliability behavior — the project's core value — so it needs a cross-model live
   validation session (the 9-model roster), NOT a blind Opus rewrite. The `raise_token_budget` sub-item is already
   DONE (heads the aborted ladder + applied at the chat seam; the stale "owed wiring" note in retry-policy.ts was
   corrected). **Owner: a fleet-time session** — align the engine ladder to the live-validated order first, then wire
   + re-validate per rung.
2. **Escalation hot-path** (§5.AB): `decideEscalationAction` core done; wire runtime signals + model-switch +
   ledger events (L5806-5808).
3. **Test-driven mode splice** (§5.AI L7550): `test-driven-delivery.ts` core done, 0 callers; seam identified
   at the delivery gate.
4. **Fitness verdict blending** (§5.AL/§5.AB): ✅ **RESOLVED 2026-07-07 (Opus) — the audit finding was STALE.** The
   runtime-verdict penalty already steers ROUTING via `createCapabilityBlender`'s inline `verdictMultiplier`
   (W2.6b, 2026-07-02: TOOL_UNSUITABLE ×0.1 / TOOL_WEAK ×0.5). `penalizeFitnessByRuntimeVerdict` itself was genuinely
   DEAD (0 callers, 0 tests) — now given a real caller: `nklein dev ledger`'s "routing recommendation" ranking
   (`rankModelsByLedgerFitnessWithVerdict`) applies the SAME penalty so the display matches routing instead of ranking
   by raw fitness. Unit-tested (raw→penalized flip, empty-evidence identity, <3-run UNKNOWN). `combineSuitabilityVerdicts`
   remains a dev-display helper by design.
5. **§5.M memory wiring cluster** — ⚠️ **PARTIALLY STALE + write-path FLEET-GATED (2026-07-07 Opus, characterized).**
   The summarizer (L2097) is DONE — a real wired model call (`deps.summarize` → `consolidateChatContextWindow`). The
   RECALL/read side is DONE too — `recallChatMemories` is wired into `chat-turn-context` (memories injected per turn).
   The genuine gap is the WRITE path: `proposeConsolidatedMemories` + `appendChatMemory` (extract→dedup→persist) have
   ZERO callers, so the store is never populated (recall reads an empty store). Wiring it needs a NEW extractor
   model-call prompt whose VALUE is unvalidatable without live models — a FLEET-TIME feature, not safe deterministic
   polish. Cores are pure + injected-deps + already unit-tested. **Owner: a fleet-time session** (or a deliberate
   flag-OFF dark ship like the §5.AF durable scheduler, if David wants the wiring landed ahead of validation).
6. **Delivery actions** (§5.L): commit (L1676) + open_pr (L1677) automation; sandbox pool by network policy
   (L1681/L1683).
7. **§5.AC**: retrieval telemetry into the ledger, freshness gate into decompose roles (L6175), online-retrieval
   test harness (L6170), `retriever`/`researcher` role enum (L6529 — one line).
8. **CI dogfood gate** (§5.G L1415-1420) · **§5.AK acceptance-gate executor** (L7932-7936) · **§5.AN native
   /api/v1 clients** (L8322-8329) · **§5.AQ load-knob wiring** (L8851-8857) · localization fallbacks + patch
   validators (§5.B) · recall@k harness (§5.I).

## Needs-David queue (park until he weighs in)

Egress proxy infra (L1682) · docker-compose packaging decisions (L1405/1409/1411/1413) · core-py packaging
(L1579) · dense-retrieval decision (L1613) · VST docs (L1250) · §5.AA collision-point decisions (L4886) ·
roster orchestration greenlight (L5512) · MCF Phase C (L5571) · qwopus-4B load plan + max-difficulty config
(L9119/L9125) · §5.AL standing catalog cadence (L8090) · auto-escalation policy (L7940) · §5.Z re-verify
matrix decision (L6398).

## Fleet-time queue (needs live models; batch into sweep sessions)

§5.A six live Settings/pool checks (L1061-1070) + Playwright UI pass (L987) · cross-machine reconcile
(L1394-1397) · compose smoke (L1414) · reasoning-model sweeps (L5762/L4828-4830) · escalation multi-model runs
(L5810) · §5.AA re-verify sweeps (L4990-4993) · §5.AI dschinn bug repro + PARTIAL-class repro (L7534/L7573) ·
per-family reasoning-switch verify (L8349) · CPU benchmarks (L1606) · §5.AB punching-power trial (L5513).

Raw per-agent reports: session scratchpad `audit/agent*.md` (8 clusters). Line numbers refer to todo.md at
commit `c56e6fd1` (pre-tick state; flipped lines moved by 0 — edits were in-place).
