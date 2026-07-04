# Autonomous run — started 2026-07-04

Standing goal (David): work the whole backlog autonomously for 2+ days; decide anything that
won't cause major reworks later; don't wait for greenlighting; don't stop; load/unload LLMs as
needed without overloading the 3 fleet machines; collect anything that genuinely needs David's
guidance here for a clarify-when-back session.

**Operating rules I'm holding myself to**
- Every commit GREEN (tsc + biome + `npm run test:fast`).
- Behavior-changing work is **flag-gated / additive with a byte-identical default** → zero rework risk.
- Hot paths (security / scheduler / model-call) get an adversarial-verify workflow before commit.
- Prefer wiring built-but-dark cores; verify ripeness (data exists at the seam) before building.
- Fleet: check `lms ps` before loading; unload before loading to stay within RAM; restore baseline.

---

## NEEDS-GUIDANCE queue (clarify when back)

These are genuine forks / product decisions where guessing risks rework — I did NOT build these,
to avoid locking in a direction you'd want to choose:

1. **§5.L swarm-path capability broker** — the CHAT-path broker is live (opt-in). The SWARM (agent
   task) tool seam is different: it has a *real* requested manifest + egress requests, so the
   broker's escalation + egress gates become live (not no-ops). Wiring it well needs a decision on
   *what a tool call's requested manifest is* on the SDK tool path (per-tool declared vs. derived) —
   a modeling choice that, if guessed wrong, would rework the broker inputs. **Q: is per-tool static
   manifest acceptable for v1, or do you want per-call requested caps?**
2. **§5.L egress-read manifest** — today `browse_url` is `host_command`, so after one browse the
   turn is tainted and further host actions (incl. another browse) are refused. A distinct
   "egress-read" action kind would let benign multi-page browsing through without laundering the
   write/exec sinks — but that's a change to the capability *model* (a new ChatActionKind + manifest
   mapping). **Q: add an egress-read action kind, or keep the strict single-browse-per-turn v1?**
3. **Default-on flips** — several opt-in flags are proven + could default ON (e.g.
   `NKLEIN_CHAT_ADAPTIVE_TRUNCATION`, `DURABLE_DEPTH_PRIORITY`, retrieval synthesis). I'm leaving
   them opt-in (no rework risk). **Q: which, if any, should ship default-on?**
4. **Capability-broker default** — `capabilityBrokerEnabled` is off by default (opt-in). It's a real
   prompt-injection defense; should it default ON once the swarm seam is also covered? (Strictness:
   the single-browse-per-turn behavior above.)

5. **§5.AE skill-fragment → prompt-assembly mapping** — the skill registry's `ContextFragmentId`s
   (repo_map, focus_chain, refinement_preamble, temporal, freshness_rail, online_retrieval) do NOT
   map 1:1 to `assembleSessionSystemPrompt`'s keys (base, efficiency-rules, temporal-context,
   planning-workflow, home-agent-append, session-env). **Q: what's the intended fragment-id→text
   mapping, and which registry fragments are blocks that don't exist yet (repo_map, focus_chain)?**
6. **§5.AE apiProfile plumbing** — `resolveApiProfileRequest` has zero live callers; the resolved
   `activeSkillSet.apiProfile` (thinkingDirective/response_format/temperature/forceToolCall) is never
   threaded to the client. **Q: session-scoped config vs per-call? And how does it reconcile with the
   chat adapter's EXISTING reasoning/force-tool logic so they don't double-apply?**
7. **§5.AV apply-time enforcement strictness** — beyond the creation-gate cycle rejection (which I
   may do, it's bounded), should `decideRedecomposeTrigger`'s split/merge/refine verdicts ever BLOCK
   (not just redo)? At what bounce-budget threshold, given weak models must not spiral? **Q: how
   strict at apply time vs. letting the SCC-condense repair net handle it?**
8. **§5.AW opportunistic-work value-ladder** — the idle-detector + work-ahead picker are buildable,
   but composing them into the ranker (work-ahead vs review vs deliberation-seed vs spec-mirror vs
   context-prep) is an undecided design. **Q: intended priority order + the veto rule when real
   queued work exists?**
9. **§5.AN native /api/v0 stats** — todo's own note says auto-feeding per-request is low-value /
   high-latency; keep it on-demand (`dev model-speed`)? **Q: confirm on-demand only, or is there a
   perf investigation that justifies per-request live stats?**
10. **§5.AN/§5.AL runtime model-research needs a real web-SEARCH tool** — `browse_url` only fetches a
    known URL, can't search. **Q: build a web-search tool now (behind what egress gate), or keep
    deferred per the §5.AO strong-driver-first steer?** (Note: the §5.AC retrieval loop already has a
    SearXNG search adapter — this may be mostly wiring, worth a look.)

(Appended as I hit more forks.)

---

## Work log (newest first)

- **Bug-hunt batch 1 (8 complex src/core cores, review → adversarial-verify → CONFIRMED-only) → 2 real bugs FIXED:**
  (HIGH) `assessToolArgumentRepair` ran the enum gate on the RAW value before coercion, so a
  losslessly-coercible enum value (`"1"` for `[1,2,3]`) was refused a repairable tool call live —
  fixed by coercing first, then gating on the effective value (`771c6e72`, +4 regression tests).
  (LOW) `normalizeAllowlistEntry` didn't strip a trailing FQDN-root dot, so an `example.com.` entry
  matched nothing — fixed (`edbcb97a`, +1 test). Both verified with tests that fail on the old code.
- **Bug-hunt batch 6 (12 config + nklein-agent pure modules) → 1 real bug FIXED:** (MED)
  `parseConstrainedToolCall` committed to the FIRST balanced `{…}` span and gave up — a non-JSON
  brace group (`{1,2}`), a tool-less decoy (`{}` or an inline `{"command":"ls"}`), or an
  unoffered-name object shadowed a genuine `{tool,arguments}` call later in the same string. Weak
  models narrate exactly such prose before the structured call, so valid tool calls were silently
  dropped to the next (worse) rung. Fixed: scan ALL balanced parseable objects in order, return the
  first naming an OFFERED tool (`extractJsonObjectCandidates` + `findBalancedObjectEnd`). +5 tests
  (4 fail on old scanner). Directly lifts weak-model tool-call reliability — the module's whole point.
- **Bug-hunt batches 4+5 (24 more cores) → 1 doc bug** (`isLeaseActionFenced` inverted docstring
  polarity — code was correct; `1c…` fixed the comment). Yield tapering to ~0 confirms src/core
  logic is substantially swept (52 modules reviewed, 9 logic + 1 doc bug total). **Vendored suites
  health-checked (a documented rot risk): all GREEN** — core 1224, agents 46, shared 205, llms 339
  = 1814 tests passing, no rot. Pivoting the hunt to our own pure logic in src/config +
  src/nklein-agent (config normalizers, decomposition parse/expand, tool-call cores).
- **Bug-hunt batches 2+3 (20 more cores) → 7 real bugs FIXED (9 total across 28 modules):**
  (HIGH) `judgeCellStability` passRateDoubt INVERTED — coin-flip rated most-confident (`dafd5f96`);
  (MED) its settled_fail decisiveness degenerated to 0 at a clamped fail-floor (same commit);
  (HIGH) `recommendSandboxPoolSizing` — MY regression this session: a tiny VM out-recommended a
  bigger one (unclamped ceiling) (`9cb83d67`); (HIGH) `isKnowledgeStale` rounded a fractional
  realtime age to 0 → reused a stale live price (`940d30ec`); (LOW×2) `api-validation` kept
  empty-VALUE provider headers (`d62ae51d`); (HIGH) `summarizeModelSpeed` samples undercounted on
  split ttft/tps coverage (`60683152`). Each with a regression test that fails on the old code.
  The hunt earns its keep — incl. catching my own fresh regression.
- **Triage batch assessed (5 "ready-now" leaves) — most were over-credited on verification:**
  #4 TTL-suggester seam is DARK (`loadModelExclusive`/`planGuardedModelLoad` have no live callers —
  the live load path is elsewhere); #3 spec-ledger-field needs a NEW producer call threaded into
  `second-opinion-review-runner` arbitration (not "just add a field"); #1 self-check tool + #2 WBS
  prompt are flag-gated *behavior changes* (buildable, but #2 needs model-validation to know it
  helps); #5 creation-gate rejection is a design-fork (routed to guidance #7). Net: the clean
  5-minute additive-wire vein is confirmed harvested (matches 3 prior scout rounds). **Pivoting to a
  TEST-COVERAGE push (§5.V)** — purely additive, zero rework risk, always valuable, sustainable for a
  multi-day run: find under-tested pure cores → comprehensive tests → GREEN. Surfaced bugs get fixed
  (never waived).
- **§5.AC extract-into-synthesis** — `buildSynthesisPrompt` now narrows LONG evidence to
  query-relevant spans via the tested-but-dark `extractRelevantSpans` (lights it up) instead of an
  arbitrary head slice; short evidence + no-match fall back unchanged. +1 test. GREEN.
- _(run start)_ — §5.L capability broker (chat path) + §5.AC synthesis shipped + validated in the
  prior session (23 commits). Starting the autonomous backlog grind from here.
