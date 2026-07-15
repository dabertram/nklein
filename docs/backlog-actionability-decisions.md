# Backlog actionability & decisions (2026-07-15)

Purpose: convert the whole todo.md backlog into an actionable queue so an agent can finish it autonomously.
Every open/partial/deferred item was triaged (three parallel surveys, verified against source) into one of four gates.

## The shape

| Gate | Count (~) | Meaning | Needs David? |
|---|---|---|---|
| **BUILDABLE-NOW** | ~90 | No gate — build + verify headlessly or against the dev stack | No (just an engineering convention) |
| **FLEET-RUN** | ~40 | Code built; needs a real local-model run to validate / a default-on flip | One policy decision |
| **EXTERNAL** | ~20 | Needs certs / vision model / live Docker / live LM Studio native API | David provides or accepts deferral |
| **DECISION** | ~15 | A real human design/product choice | Yes |

## BUILDABLE-NOW (no gate — the autonomous work queue)

The bulk. Recommended house pattern for the orphaned-core cluster: the **observe-first hook** used for F3.5 (record
into the persisted store / mount a `dev` CLI / wire behind a default-off flag; never change live behavior until telemetry
justifies it). Grouped:

- **Orphaned pure cores → wire/mount** (read an existing persisted store, no new seam): F3.11 strategy-effectiveness,
  F3.12 outer-controller FSM, F3.29 stubborn-failure escalation, F3.33 confidence/resource routing, F3.T2 typed tool
  errors, F3.T4 provider schema profiles, F4.2 freshness gate, F4.5 citation-conflict, F4.7 smart-zone, F4.9 context-size
  recommender, F4.10 answer-budget prior, F4.14 context-pressure triage, F4.19 procedural skill bank, F4.23 skill gate
  logic, F3.26 eval-freshness (reads fitness only, NOT the catalog), F3.30 learned retry budgets.
- **Routing/pools headless** (seeded state): F3.7 profile-at-attempt-start, F3.21 per-pool capacity, F3.22 pool-aware
  routing, F3.23 machine-pool settings panel, F3.27 difficulty calibration, F3.28 role assignment, F3.31 routing Settings,
  F3.32 llmfit blend (update-check is the only egress sub-part).
- **Loop/prompt/context wiring**: F3.1 loop detection everywhere, F3.3 prompt variation, F3.6 reason-then-act, F3.8
  retry-policy on chat, F3.T3 ActionPlan IR, F4.1 richer retrieval recording, F4.6 span trimming, F4.12 reasoning-aware
  budgets, F4.15 skill feature-profiles, F4.16 dynamics-level config, F4.17 skill-fragment composition, F4.37 tiered
  sysprompt, F4.38 AUTO depth, F4.39 intent modes, F4.40 cache-stable layout, F4.46 context compaction, F4.48 fast-memory
  fit, F4.20 SKILL.md load (no-execute), F4.22 import flow, F4.24 bundle screening, F4.27 skill provenance ledger,
  F4.28/29 curated-MCP overrides+panel, F4.53 resource panel.
- **Operator/UI slices (Phase 1-2)**: F1.27b queue migration, F1.37b N-eyes panel runner (injected judge sessions),
  F2.2b/F2.12b confirm 5-field + grant/revoke UI + swarm park, F2.6b picker Playwright, F2.16 stream drill-down,
  F2.23-redactor span-level.
- **Phase 5 surfaces**: F5.1 settings coverage, F5.2 memory-audit panel, F5.3 guided setup, F5.5 updater (mock manifest),
  F5.6 migrations+backup.
- **Phase 6 test coverage**: G6.1 pure-core sweep, G6.2 sim pipeline e2e, G6.3 chat e2e, G6.4 board browser, G6.5/5a
  settings+portable, G6.6 diagnostic oracles.
- **Phase 7 perf/cache infra**: H7.1-3 sim behaviors, H7.19-25 cache infra/adapters/playbook/scheduling/memory/disk,
  H7.29-35 sampler/structured-output/lever-selection/native-TS-core.
- **Phase 8 polish**: P8.1 tokens (if approved), P8.2/3 controls+dense surfaces, P8.4 render churn.
- **Phase 9**: R9.1 repo curation (judgment), R9.6 security/legal scans (final sign-off external).

## FLEET-RUN (needs a real local-model run — one policy decision unblocks all)

F1.3e clarify loop, F1.18b durable-scheduler flip, F1.19b pool occupancy, F1.31b eval rail, F1.32b rail picker, F1.34b
test-driven flip, F1.36b idle-work routing, F2.10b recall benchmark, F3.4 native tool-calls, F3.5-interrupt, F3.13
cross-model bounce, F3.14 persona bounce, F3.15 self-consistency, F3.16 enforced-reasoning enable, F3.T1 two-phase tool,
F3.25 eval-matrix, F4.4 stale-vs-fresh, F4.11 learned-budget quality, F4.13 distractor probe. Plus **Phase 6 challenges**
G6.7-6.13 (C3-C8 + rail + capstone) and the **Phase 7 model sweeps** H7.4-18, H7.26-28, H7.31, and R9.5 clean-profile.

## EXTERNAL (David provides or accepts deferral)

- **Certs/release chain**: F5.7 signing (Apple notarization + Windows cert), R9.3 hosted CI, R9.4/R9.7 publishing+gate.
- **Vision model**: F2.7b (no VL model in the fleet).
- **Live Docker egress**: F2.3b loopback server, F2.4b per-role allowlist validation, F2.5b issuance, F4.30-32 curated-MCP
  + Basic-Memory container.
- **Live LM Studio native API**: F4.33-36, F4.45 (probe the real `/api/v1/chat` contract).
- **Multi-machine fleet**: F3.20 discovery, F3.24 fan-out proof.
- **Packaged-app smokes**: D10.12-14.

## DECISION (real choices — the questions for David)

1. **Fleet-validation policy** — run the ~40 FLEET-RUN items autonomously (David granted fleet use), or observe/defer?
2. **Default-on flip criterion** — for shipped-but-gated learners (F3.5/16/T1, F4.13, F1.18b/34b, F1.21b taint gate):
   what telemetry threshold justifies flipping default-on, and may the agent flip when green?
3. **Multi-machine fleet** — stand up a real ≥2-machine pool now (unblocks F3.20/24 + validates pool logic) or headless-only?
4. **LM Studio native API** — commit to probing/implementing native `/api/v1/chat` (unblocks F4.33-36/45) or stay
   OpenAI-compatible stateless?
5. **Catalog + vision sourcing** — F3.34/F3.35 candidate-model ranking rule; which VL model to provision for F2.7b.
6. **Community-skill trust posture** — F4.21/23/26: build the gate/screening logic now (recommended); what live
   execution boundary, if any, to ever trust.
7. **Egress security design** — F2.5b DNS-stub attribution + deny-vs-allow-unattributed for unauthenticated egress.
8. **Release provenance** — R9.2 squash/clean-root history strategy (irreversible).
9. **Design sign-off** — P8.1 token system approval, P8.5 final visual acceptance (human/Fable).
10. **Phase 10 optional ideas** — D10.1-11: survey recommends REJECT/DEFER most (orchestrator role, sacrificial skills,
    auto-skill-mode, Mission layer, digest summarizer, multi-workspace, cloud, messenger, Python port). Confirm en masse?
11. **Onboarding media** — F5.4: text/SVG-only (recommended) vs recorded media.
12. **F3.9 wrapper approach** — non-vendored single-turn wrapper (recommended) vs vendor-and-patch the SDK.
</content>
