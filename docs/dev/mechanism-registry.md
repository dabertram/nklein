# Mechanism registry

> **GENERATED — do not edit by hand.** Regenerate with `nklein dev mechanism-doc`.
> A hand-maintained registry rots the moment someone ships without updating it, which is exactly when it
> would matter most.

This report answers two DIFFERENT questions. Mistaking one for the other sends the fix in the wrong
direction, so they are kept side by side:

1. **Is it wired?** — does anything call it. An unwired core cannot run.
2. **Does it fire?** — it runs and records nothing. Reachable, tests green, feature never happens. This is
   the subtler failure: it survives code review, because the code is there and looks correct.

## 1. Mechanism firing status

Tallied **48990** observation(s) across **28** categories — exhaustive, not a capped window.

| category | item | enabled by | expectation | observations | status |
| --- | --- | --- | --- | ---: | --- |
| `focus_chain_nudge` | §5.N | NKLEIN_FOCUS_CHAIN_NUDGE | every_run | 0 | **too_new_to_judge** |
| `sandbox_mcp_offer` | §5.AR | NKLEIN_SANDBOX_MCP | every_run | 0 | **too_new_to_judge** |
| `unified_memory_recall` | F2.9b | NKLEIN_UNIFIED_MEMORY | every_run | 0 | **never_enabled** |
| `goal_reanchor` | F4.8 | NKLEIN_GOAL_REANCHOR | every_run | 0 | **too_new_to_judge** |
| `adaptive_budget_retry` | §5.AA | NKLEIN_ADAPTIVE_RETRY | exceptional | 0 | **never_enabled** |
| `model_lost_residency` | §5.AL | NKLEIN_RESIDENCY_HEARTBEAT | exceptional | 0 | **never_enabled** |
| `native_force_tool_call` | §5.AA | NKLEIN_NATIVE_FORCE_TOOL_CALL | exceptional | 0 | **never_enabled** |
| `review_lenses` | §5.AW | NKLEIN_REVIEW_LENSES | every_run | 0 | **too_new_to_judge** |
| `queue_aware_free_first` | §5.AB | NKLEIN_QUEUE_AWARE_FREE_FIRST | every_run | 0 | **never_enabled** |
| `opportunistic_idle_dispatch` | F1.36 | NKLEIN_OPPORTUNISTIC_IDLE_WORK | exceptional | 0 | **never_enabled** |
| `ledger_exemplars` | F12.81 | NKLEIN_LEDGER_EXEMPLARS | every_run | 0 | **never_enabled** |
| `fewshot_exemplars` | F11.2h | NKLEIN_FEWSHOT_EXEMPLARS | every_run | 0 | **never_enabled** |
| `knows_today_injection` | §5.AC | _(always on)_ | every_run | 4 | **healthy** |
| `review_path` | §5.AB | _(always on)_ | every_run | 0 | **too_new_to_judge** |
| `skill_prompt_fragments` | §5.AE | NKLEIN_SKILL_PROMPT_FRAGMENTS | every_run | 0 | **never_enabled** |
| `stall_replan_injected` | F12.22 | NKLEIN_STALL_REPLAN | exceptional | 0 | **never_enabled** |
| `procedural_skill_distillation` | F4.19 | NKLEIN_PROCEDURAL_SKILLS | every_run | 0 | **never_enabled** |
| `sysprompt_level` | §5.AQ | _(always on)_ | every_run | 0 | **too_new_to_judge** |
| `fleet_aware_decompose` | F12.110 | NKLEIN_FLEET_AWARE_DECOMPOSE | every_run | 0 | **never_enabled** |
| `architect_editor_phase` | §5.AV | NKLEIN_ARCHITECT_EDITOR | every_run | 0 | **never_enabled** |
| `spec_lint` | F12.10 | NKLEIN_SPEC_LINT | every_run | 0 | **never_enabled** |
| `runaway_generation_interrupted` | §5.AA | NKLEIN_RUNAWAY_ABORT | exceptional | 0 | **never_enabled** |
| `test_driven_gate` | F12.37 | NKLEIN_TEST_DRIVEN_MODE | every_run | 0 | **too_new_to_judge** |
| `verification_first_gate` | F12.36 | NKLEIN_VERIFICATION_FIRST | every_run | 0 | **too_new_to_judge** |
| `review_panel_assembly` | §5.AB | NKLEIN_REVIEW_PANEL | every_run | 0 | **too_new_to_judge** |
| `two_phase_tool_pick` | §5.O | NKLEIN_TWO_PHASE_TOOL_PICK | every_run | 0 | **never_enabled** |
| `baseline_probe` | F12.60 | NKLEIN_BASELINE_PROBE | exceptional | 0 | **never_enabled** |
| `repo_verify` | F11.2 | NKLEIN_REPO_VERIFY | exceptional | 0 | **never_enabled** |
| `tool_trust_decay` | F12.24 | NKLEIN_TOOL_TRUST_DECAY | exceptional | 0 | **never_enabled** |
| `typecheck_first` | F12.86 | NKLEIN_TYPECHECK_FIRST | exceptional | 0 | **never_enabled** |
| `quant_floor_breach` | F12.27 | _(always on)_ | exceptional | 0 | **silent_but_exceptional** |
| `language_floor_breach` | F12.83 | _(always on)_ | exceptional | 0 | **silent_but_exceptional** |
| `adaptive_thinking_recommendation` | F12.27 | _(always on)_ | exceptional | 0 | **silent_but_exceptional** |
| `scaffold_profile_recommendation` | F12.14 | _(always on)_ | exceptional | 0 | **silent_but_exceptional** |
| `review_effort_scaling` | F12.35 | _(always on)_ | every_run | 0 | **too_new_to_judge** |
| `mcp_tool_surface_drift` | F12.31 | _(always on)_ | exceptional | 0 | **silent_but_exceptional** |
| `history_blind_corrector_override` | F12.91 | NKLEIN_HISTORY_BLIND_CORRECTOR | exceptional | 0 | **never_enabled** |
| `history_blind_corrector_agreed` | F12.91 | NKLEIN_HISTORY_BLIND_CORRECTOR | every_run | 0 | **never_enabled** |
| `drift_critic_flagged` | F12.92 | NKLEIN_DRIFT_CRITIC | exceptional | 0 | **never_enabled** |
| `drift_critic_on_track` | F12.92 | NKLEIN_DRIFT_CRITIC | every_run | 0 | **never_enabled** |
| `tool_catalog_gate_observation` | F12.18 | NKLEIN_TOOL_GATE_OBSERVE | every_run | 0 | **never_enabled** |

**No enabled-but-silent mechanisms. 1 of 41 are demonstrably firing; the rest are either not enabled or fire only on exceptional conditions.**

Status meanings — note that only ONE of these is actionable:
- `healthy` — demonstrably fires.
- `never_enabled` — its flag was off. **Zero is the CORRECT result, not a smell.**
- `silent_but_exceptional` — fires only on a breach/drift/override, so silence may be evidence of HEALTH.
- `enabled_but_silent` — **actionable.** On, expected every run, recorded nothing.
- `unknown_enablement` — flag history unprovable. Inconclusive, not an accusation.

## 2. Unwired cores

942 of 2357 exported core symbol(s) have NO non-test consumer. 56 of those are referenced ONLY from comments — a naive grep would report them as wired. An orphan is a QUESTION, not a verdict: it may be a core built ahead of its wire, a deliberate public API, or a core whose lesson was the point. This scan is text-level and can miss re-exports or dynamic lookups.

### Modules where EVERY export is orphaned (108)

- `lms-session-stall.ts` (8 export(s))
- `enforced-reasoning-learning.ts` (7 export(s))
- `fleet-review-observation.ts` (7 export(s))
- `memory-freshness-schedule.ts` (7 export(s))
- `cache-prefix-retention.ts` (6 export(s))
- `fast-memory-fit.ts` (6 export(s))
- `model-pool.ts` (6 export(s))
- `skill-import-decision.ts` (6 export(s))
- `judge-calibration.ts` (5 export(s))
- `memory-governance.ts` (5 export(s))
- `reanchor-quality-ab.ts` (5 export(s))
- `spec-deliberation.ts` (5 export(s))
- `cache-aware-prompt-layout.ts` (4 export(s))
- `cache-stable-prefix-order.ts` (4 export(s))
- `codeact-gating.ts` (4 export(s))
- `constraint-tax-strategy.ts` (4 export(s))
- `discriminative-tiebreak.ts` (4 export(s))
- `model-online-lookup.ts` (4 export(s))
- `prompt-evolution-gate.ts` (4 export(s))
- `repair-validation-gates.ts` (4 export(s))
- `richer-card-schema.ts` (4 export(s))
- `skill-execution-gate.ts` (4 export(s))
- `audio-vst-rubric.ts` (3 export(s))
- `cache-health.ts` (3 export(s))
- `cache-warmup-amortization.ts` (3 export(s))
- `candidate-tournament.ts` (3 export(s))
- `confidence-scorer.ts` (3 export(s))
- `deliberation-loop.ts` (3 export(s))
- `field-report-generation.ts` (3 export(s))
- `field-report-grounding.ts` (3 export(s))
- `field-report-transport.ts` (3 export(s))
- `lmstudio-max-tokens-clamp.ts` (3 export(s))
- `localization-provider.ts` (3 export(s))
- `long-memory-live-eval.ts` (3 export(s))
- `mechanism-decision-report.ts` (3 export(s))
- `mutation-adequacy.ts` (3 export(s))
- `skill-pin-drift.ts` (3 export(s))
- `synthesis-evidence-quality-eval.ts` (3 export(s))
- `task-sizing-invariant.ts` (3 export(s))
- `vlm-screenshot-lens.ts` (3 export(s))
- `work-package-conflict-resolution.ts` (3 export(s))
- `work-package-merge-readiness.ts` (3 export(s))
- `action-plan-ir-gbnf.ts` (2 export(s))
- `adaptive-decomposition-decision.ts` (2 export(s))
- `citation-conflict-authority.ts` (2 export(s))
- `clarification-count.ts` (2 export(s))
- `context-position-salience-risk.ts` (2 export(s))
- `context-smart-zone.ts` (2 export(s))
- `durable-lease-renewal.ts` (2 export(s))
- `fleet-host-cap-config.ts` (2 export(s))
- `lmstudio-log-anomalies.ts` (2 export(s))
- `narration-dialect.ts` (2 export(s))
- `persisted-prompt-session-models.ts` (2 export(s))
- `portable-continuation-selector.ts` (2 export(s))
- `reason-then-act.ts` (2 export(s))
- `relative-date-resolver.ts` (2 export(s))
- `retrieved-evidence.ts` (2 export(s))
- `skill-source-trust.ts` (2 export(s))
- `spec-invariant-derivation.ts` (2 export(s))
- `spectrum-fault-localization.ts` (2 export(s))
- `stateful-responses-gate.ts` (2 export(s))
- `swarm-roster-load-plan.ts` (2 export(s))
- `sweep-resource-governance.ts` (2 export(s))
- `test-regression-verdict.ts` (2 export(s))
- `turn-thinking-directive.ts` (2 export(s))
- `visual-verification-gate.ts` (2 export(s))
- `action-plan-executor.ts` (1 export(s))
- `admissible-cited-synthesis.ts` (1 export(s))
- `background-eval-runner-signals.ts` (1 export(s))
- `cache-friendly-route.ts` (1 export(s))
- `citation-conflict-annotation.ts` (1 export(s))
- `citation-conflict-batch.ts` (1 export(s))
- `citation-conflict-detection.ts` (1 export(s))
- `claim-admissibility.ts` (1 export(s))
- `context-budget-knee.ts` (1 export(s))
- `context-occupancy-pressure.ts` (1 export(s))
- `context-pressure-triage.ts` (1 export(s))
- `daw-foundation-rubric.ts` (1 export(s))
- `distractor-pruning.ts` (1 export(s))
- `diversity-reachability.ts` (1 export(s))
- `durable-job-depth-priority.ts` (1 export(s))
- `durable-scheduler-backpressure.ts` (1 export(s))
- `enforced-reasoning-round-stop.ts` (1 export(s))
- `failure-hopelessness-from-errors.ts` (1 export(s))
- `field-report-redaction.ts` (1 export(s))
- `flake-quarantine.ts` (1 export(s))
- `fleet-host-observation.ts` (1 export(s))
- `focus-chain-diff.ts` (1 export(s))
- `hard-stuck-escalation.ts` (1 export(s))
- `kv-prefix-audit.ts` (1 export(s))
- `llmfit-roster.ts` (1 export(s))
- `lmstudio-keep-alive-ttl.ts` (1 export(s))
- `machine-concurrency-gate.ts` (1 export(s))
- `model-residency-planner.ts` (1 export(s))
- `patch-candidate-parser.ts` (1 export(s))
- `patch-generation-prompt.ts` (1 export(s))
- `procedural-skill-lifecycle.ts` (1 export(s))
- `repair-controller-decision.ts` (1 export(s))
- `repair-kernel-ledger.ts` (1 export(s))
- `request-economy-plan.ts` (1 export(s))
- `scoped-override-resolution.ts` (1 export(s))
- `skill-compat.ts` (1 export(s))
- `skill-variation-rung.ts` (1 export(s))
- `structured-output-request-plan.ts` (1 export(s))
- `test-selection-priority.ts` (1 export(s))
- `topic-aware-freshness.ts` (1 export(s))
- `transcript-distractor-pruning.ts` (1 export(s))
- `workflow-board-bridge.ts` (1 export(s))

### Orphan triage — tracked vs untracked (108 fully-orphaned modules)

- **104 TRACKED** — named in `todo.md`/`done.md`, so a wire or decision exists.
- **4 UNTRACKED** — built, tested, unwired, and mentioned in NO backlog item.

The untracked group is the strongest kill-list input (P15.4): it is the only group where the question
"why does this exist?" has no recorded answer anywhere in the project.

- `fleet-host-cap-config.ts`
- `fleet-host-observation.ts`
- `long-memory-live-eval.ts`
- `persisted-prompt-session-models.ts`

### Referenced ONLY from comments

A plain `grep -c` reports these as wired. They are not — every reference is a docblock mention.

- `action-plan-ir.ts` :: `actionPlanStepSchema`
- `adaptive-attempt-loop.ts` :: `classifyTurnOutcome`
- `adaptive-decomposition-decision.ts` :: `decideCardDecomposition`
- `agent-attempt-ledger.ts` :: `SCHEDULER_EVENT_NAMES`
- `agent-ledger-selectors.ts` :: `latestRunState`
- `agent-rulesets.ts` :: `resolveEffectiveAgentRuleset`
- `architect-editor-split.ts` :: `decideArchitectEditorSplit`
- `architect-editor-split.ts` :: `extractImplementationBrief`
- `assumption-safety.ts` :: `decideAssumptionSafety`
- `cache-aware-prompt-layout.ts` :: `prefixesAreCacheEquivalent`
- `cache-aware-prompt-layout.ts` :: `assembleCacheAwarePrompt`
- `cache-health.ts` :: `classifyCacheHealth`
- `cache-prefix-retention.ts` :: `shouldAdmitPrefix`
- `cache-warmth.ts` :: `classifyShellWarmth`
- `chat-api-contract.ts` :: `runtimeChatSessionScopeSchema`
- `citation-conflict-authority.ts` :: `resolveClaimConflictsByAuthorityBatch`
- `citation-conflict-batch.ts` :: `resolveClaimConflictsBatch`
- `citation-conflict-detection.ts` :: `detectClaimConflicts`
- `completion-stop-reason.ts` :: `classifyCompletionOutcome`
- `concurrency-config.ts` :: `normalizeConcurrencyMap`
- `concurrency-config.ts` :: `resolveEffectiveProviderConcurrency`
- `concurrency-config.ts` :: `resolveEffectiveEndpointConcurrency`
- `concurrency-config.ts` :: `resolveEffectiveModelConcurrency`
- `concurrency-config.ts` :: `DEFAULT_HOST_CONCURRENCY_CAP`
- `context-compaction.ts` :: `planCompaction`
- `context-occupancy-pressure.ts` :: `decideContextOccupancy`
- `context-smart-zone.ts` :: `arrangeContextForSmartZone`
- `context-smart-zone.ts` :: `renderSmartZoneContext`
- `distractor-pruning.ts` :: `pruneDistractors`
- `fast-memory-fit.ts` :: `kvCacheBudgetBytes`
- `inference-levers.ts` :: `shouldUseSpeculativeDecoding`
- `klein-self-corpus-provenance.ts` :: `buildKleinCorpusProvenance`
- `knowledge-volatility-ttl.ts` :: `isKnowledgeStale`
- `llmfit-adapter.ts` :: `llmfitPredictedWallTimeMs`
- `lmstudio-max-tokens-clamp.ts` :: `clampMaxTokens`
- `model-eval-aggregation.ts` :: `DIFFICULTY_TIER_SCORE`
- `model-fitness-freshness.ts` :: `selectFitnessCellsToReeval`
- `model-fitness.ts` :: `selectModelForTask`
- `model-load-headroom.ts` :: `refineLoadDecisionWithLlmfit`
- `patch-candidate-parser.ts` :: `parseNPatchCandidates`
- `retrieved-evidence.ts` :: `verifyCitations`
- `retrieved-evidence.ts` :: `retrievedEvidenceSchema`
- `run-attention-signals.ts` :: `assessRunBudgetPressure`
- `run-state-machine.ts` :: `selectPhaseTools`
- `skill-import-decision.ts` :: `decideSkillImport`
- `skill-pin-drift.ts` :: `detectPinDrift`
- `skill-source-trust.ts` :: `classifySkillSourceTrust`
- `task-board-mutations.ts` :: `wouldCreateDependencyCycle`
- `temporal-awareness.ts` :: `resolveTemporalAwareness`
- `temporal-claim-consistency.ts` :: `checkClaimsTemporalConsistency`
- `test-regression-verdict.ts` :: `classifyTestRegression`
- `tool-capability-manifest.ts` :: `KANBAN_TOOL_MANIFESTS`
- `visual-verification-gate.ts` :: `comparePixels`
- `work-package-dispatch.ts` :: `validateWorkPackages`
- `work-package-dispatch.ts` :: `resolveDispatchWaves`
- `work-package-integration-order.ts` :: `planIntegrationOrder`

---

**An orphan is a QUESTION, not a verdict.** It may be a core awaiting its wire, a deliberate public API, or
a core whose lesson was the point — the project's standard is learning value, not consumer count. The scan
is text-level and can miss re-exports and dynamic lookups.
