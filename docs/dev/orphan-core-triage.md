# Orphaned core triage (2026-07-20)

> Generated input: `nklein dev mechanism-doc`. This document adds the part a scan cannot supply — **purpose,
> origin, and a keep/drop judgement**.

## ⚠️ First: the headline number was wrong, and the correction matters

The initial scan reported **79 "untracked" orphans**. That was produced by testing whether the module's
**filename** appears in `todo.md`/`done.md`. It does not, for most of them — because these cores are tracked by
their **`§5.x` section label** (or an `F12.x` item id) carried in their docblock, which is exactly the alias
scheme `todo.md` documents ("Legacy `§5.*` labels are retained … so old commits, comments, and references remain
searchable").

Re-triaged against the labels actually used:

| bucket | count |
|---|---:|
| Fully-orphaned modules (every export unused) | **119** |
| — tracked by filename in the backlog | 40 |
| — tracked by `§5.x` / `F12.x` label in the docblock | **67** |
| — **genuinely untracked (no label anywhere)** | **7** |

**The real drop-candidate list is 7 modules, not 79.** A filename match is the wrong test for a codebase whose
own convention is section labels; reporting 79 would have proposed deleting 67 cores that are tracked work.

## Origin profile (all 74 filename-untracked)

- **Every one has tests.** None are untested experiments.
- **All originate 2026-06 or 2026-07** (11 in June, 63 in July) — recent build-out, not historical debt.
- They cluster by originating commit into the `§5.*` research/build sweeps (§5.AA adaptive-attempt, §5.AQ
  cache-aware prompts, §5.AD/§5.AC context zones, §5.AL online lookup, §5.O small-model tool interfaces, …).

That profile is consistent with the charter's own account: cores built ahead of their wires during a fast
research phase, not code abandoned years ago.

## The 7 genuine orphans — purpose, origin, and verdict

| module | purpose | origin | verdict |
|---|---|---|---|
| `rounds-budget.ts` | Learned ROUNDS BUDGET: when to stop iterating an enforced-reasoning loop (self-consistency / debate) once marginal gain plateaus | 2026-07-05 `feat(reasoning-loop)` | **✅ DE-ORPHANED 2026-07-20** via `dev rounds-budget` (production wire — per-round early-stop in the model-gated execution loop — remains) |
| `diagnostic-oracles.ts` | Hidden-split + repeat-run verdict cores that upgrade the dev-test rail from pass/fail gates to *diagnoses* | 2026-07-08 `feat(oracles)` | **✅ DE-ORPHANED 2026-07-20** via `dev diagnose` |
| `swarm-roster-load-plan.ts` | Resolves user roster names/ids to real LM-Link devices before `model-lab` performs a load | 2026-07-09 `feat(fleet)` | **UN-ORPHAN** |
| `fleet-host-cap-config.ts` | Per-host verifier caps from LM-Link device state | 2026-07-09 `test(fleet)` | keep, low priority |
| `fleet-host-observation.ts` | Which models were seen on which machine | 2026-07-09 `fix(dev)` | keep, low priority |
| `persisted-prompt-session-models.ts` | Counts persisted reviewer sessions per model | 2026-07-09 `fix(fleet)` | keep, low priority |
| `long-memory-live-eval.ts` | Live long-memory recall evaluation prompts/extraction | 2026-07-09 `test(memory)` | keep, low priority |

### Why UN-ORPHAN rather than drop, for the top three

- **`rounds-budget.ts`** — directly serves P20.5's metric discipline and F12.35's effort scaling: both decide how
  much iteration a card earns. A "when to stop" core is the missing half of "how deep to go", and the reasoning-loop
  research it came from is the same body of work Phase 18 now rests on.
- **`diagnostic-oracles.ts`** — **hidden-split verdicts are exactly P20.2's visible/held-out gap measurement**,
  which is the single highest-leverage item in the evaluation-integrity phase. This core predates that item and
  implements part of it. Wiring it is cheaper than building P20.2 from scratch.
- **`swarm-roster-load-plan.ts`** — resolves roster names before a load, which is precisely the seam
  P17.1a (mlx-serve as a second runtime adapter) will need when a fleet spans two runtimes with different device
  naming.

### Why the remaining four are "keep, low priority" rather than "drop"

All four are small, tested fleet/telemetry helpers born from `fix(...)`/`test(...)` commits — i.e. they were
extracted to make a specific investigation possible. They cost almost nothing to keep, and the charter's standard
is learning value rather than consumer count. **None is proposed for deletion**, because none is large, risky, or
misleading; an unused 40-line pure helper with tests is not the maintenance burden the critique was about.

## Standing recommendation

**Nothing here warrants deletion today.** The genuine orphan count (7) is small, three of them are worth wiring
(**two of the three now have consumers — `dev diagnose` de-orphaned `diagnostic-oracles.ts` and `dev
rounds-budget` de-orphaned `rounds-budget.ts` on 2026-07-20**; `rounds-budget`'s production per-round early-stop
still needs the model-gated execution loop, and `swarm-roster-load-plan.ts` remains, awaiting the
second-runtime-adapter wire its docblock names), and the other four are cheap. The 119-module figure is a real signal about *build-ahead-of-wire* pace — which the
charter already accepts and Phase 15 already tracks — not a pile of dead code.

Re-run `nklein dev mechanism-doc` for the current scan; re-run this triage when the untracked count grows.
