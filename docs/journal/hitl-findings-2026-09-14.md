# HITL findings treated 2026-09-14 — the "treat when found" pass

David's rule of 2026-09-14 (todo.md §4A): a finding is fixed, proven and closed the moment it is found. This is the
pass that applied it to the seven items left open by the 40-project dev-test batch (37–76, 40/40 replay-verified),
plus two found on the way. Every score below carries its model provenance: the batch was driven with **Claude
Sonnet in every seat (architect/worker/reviewer via the HITL rig)**, replays run with the aimock simulator
(`sim/qwen-fast-coder`, zero LLM compute).

| Finding | Root cause | Fix (commit) | Proof |
|---|---|---|---|
| P2.FIXTUREINTEGRITY — budgets/goals editable | `frozenPaths` omitted the spec file | 10 fixtures digest `performance/budgets.json` / `refactor/goals.json`; `frozen.json` regenerated (`f91c06f6f`) | 10/10 `npm test` green, same pass counts; loosening a budget now fails `changed:`; sets 72 and 62 replay PASS |
| P1.STARTHANG2 (a) — hung start latched the runtime | the preparation as a whole had no deadline | `prepareWorkspace` deadline 15 min, epoch-guarded late dispose, `sandbox_provisioning_deadline_exceeded` with pool state (`754870837`) | 3 tests: hung clone fails at 40 ms with the observation; retry fails too instead of hanging; timely prepare untouched |
| P1.STARTHANG2 (ii/iii) — "orphan proxy", "vanished sandbox" | idle retirement at occupancy 0; proxy kept for reuse by design | none needed — brief corrected with the ledger (`sandbox_container_retired` 22:45:38 / 23:08:26 for ws-9f2194a2c4bd; 2026-09-11 for ws-d368de3674e9) | two shifts polled ~2 h on a finished batch; `proxies > sandboxes` retired as a signature |
| P1.ZOMBIEBOARD — abandoned boards kept being driven | trash ≠ stop (`resumeFromTrash`); `projects.remove` blinds the watchdog | `runtime.retireTaskSession` (ledger first, then abort-stop); rail + abandon script use it | 4 handler tests incl. ordering and fail-closed |
| P1.UNSATGATE — gate unsatisfiable on spec-only cards | `testability` defaulted to testable with no look at the bounds | `writeScopeCanReachTestFile`; decompose-time inference; gate steps aside audited; `isLikelyTestFile` needs a code extension | predicate + gate + board-apply tests; 197 gate/review/runtime-api tests green |
| P1.REPLAYUNDRAINED (last cause) — replays blocked at complexity 50 | router scored the sim model like a live one | sim candidates satisfy any difficulty | router tests: sim assigned at 80 with score 10; live model still gated |
| web-ui flake — `interventionHumanSeconds: 0.1` | exact-0 assertion on wall time | six tests pin `Date.now` (`fb877f3ad`) | file green under load |
| responder brief drift | "orphan proxy needs host cleanup" | section rewritten with the evidence | — |
| P1.NOWRITETOOL — 22 write-tool-less turns | requests 2083–2095 were the RE-DECOMPOSE card (`startInPlanMode: true`), misread as the work card; plan mode has no write tools by design | brief states the card's nature on line two (`9d88e22d2`) | queue payloads + board record; no runtime change needed |
| P1.SETTLEDNUDGE — "planning-card reopens" | fresh attempts on a decompose card that ended `awaiting_review` without applying (responder did the work instead of decomposing); retirement fix confirmed firing on the completed card at 06:07:11 | none needed beyond `b5d6d3bd4`; custodian `::review` residual stays open | ledger timeline for dev-52 |
| P1.PARKEDINREVIEW — park left the card held in Review | a park is a deliberate human hand-off; the rig has no human | rail wedge watchdog (20 min → re-queue once), shipped 2026-09-10 | design decision recorded; auto-resume deliberately not built |

## Second pass — the liveness family, root-caused from one fact

Continuing top-down through the open P1s after the first pass, five more items resolved to **one** root cause plus
its neighbours. The fact: `lastTokenAt` — the runtime's "the model has served this session at least once" witness —
was stamped only on prose and reasoning, never on a tool call. A turn that goes straight to a tool call, which is
the shape an agent turn is supposed to have, therefore read as *permanently* pre-first-token. Every HITL session in
the drain carries `lastTokenAt: null` beside a healthy heartbeat and real tool activity.

| Item | What the evidence said | Fix |
|---|---|---|
| P1.PHANTOMRUNNING | the silent-running sweep DISCLAIMED those sessions (its gate defers to the wedge sweep), and the wedge sweep only owns never-served ones — nobody owned the card. 1,452 watchdog ticks passed over project 41's 3h40m gap | both tool-call sites stamp the witness; a tool RESULT stays unstamped |
| P0.POOLLOSS false positive | the mirror image: the wedge sweep CLAIMED them, and its 12-second probe called the HITL agent seat (~1.5 min/turn) `listed_but_dead` **14 times** → routing excluded it → **17 cards paused** `pinned_model_unavailable` | a served token from another session on the same (model, endpoint) withholds the mark and skips the probe; the pin auto-heal resets the failure climb it invalidated |
| P1.REPLAYNOCHILD | all three stacked blocks gone: 52 and 53 replay PASS with zero `needs_decomposition`, zero pin heals, zero pauses | closed by the router fix (`1f6a6386d`) |
| P1.DECOMPOSEABORTS | hypothesis REFUTED. Not context-length/timeout: the stop stacks name `onSessionUnusableHandler` for 17/25, 11/16, 11/13 of the worst cards' stops — sandbox disposals recorded as `aborted`. 66 → 7 → 2 across the dispose fix | already fixed by `d4858efc5`; residual was the custodian |
| P1.SETTLEDNUDGE (custodian half) / P1.REVIEWSANDBOX (`::review` half) | every sweep used the literal `main-branch-custodian` while the single-flight guard is per workspace — three stops in the SAME second (09-11 13:40:58), and later sweeps resuming settled sessions | `mainCustodianTaskId({workspacePath, headCommit})` |

Two refutations worth keeping: the `No such container` drain-queue race is dead (**0 of 19** refusals name a
recorded retirement; all 16 retirements at occupancy 0, empty queue) and its population is `plan::…::acceptance-N`,
not `::review`; and widening the sweeps' predicate to "token OR output" was wrong — `lastOutputAt` is stamped by
~30 lifecycle sites that are not model content, and the P0.3 integration test caught it. Fixing the fact beat
reinterpreting the proxy. Three removal paths that deleted containers silently now name themselves (`via`), and a
caller that JOINS an in-flight preparation now gets the provisioning deadline it was missing — a hole in this
morning's own fix, found by re-reading P1.STARTHANG's warning.

## Third pass — what the reviewer is told

Same family as the liveness pass, one layer out: the runtime knew a fact and did not pass it on.

- **P1.PASSEDBUTUNLANDED, closed (both halves).** The blocked write is now evidence — the `## No file changes`
  branch names which write tool was rejected, on which path, with the recorded reason, and warns that an
  acceptance check run AFTER a rejected write can pass vacuously (project 47). And the acceptance line is
  qualified by the delivery: PASSED + `empty_patch` says the check passed inside the worker's SANDBOX while the
  branch under review holds none of the work (project 42). The item had specified both fixes and deferred them
  "mid-batch"; the batch is over.
- **P1.REVIEWBUDGET, shipped.** `expectedTurns × observed turn latency + reserve`, from the registry's wall-time
  EWMA, with the configured budget as a FLOOR — it can only lengthen. Too much budget costs idle minutes on a
  stalled review; too little costs the verdict and re-runs everything (38 cut exploration turns). Operator and
  per-session budgets still win outright.
- **DEVTEST30 closed.** Both halves were done (40 projects built and four-state proven; 40 of 40 replay-verified);
  only the header checkbox was outstanding. Re-checked today: every set under `packages/llm-simulator/scenarios`
  for 37–76 carries `replayVerified: true`.

Open P1s went 11 → 5 across the day. What remains needs something this session cannot manufacture: a fresh live
occurrence (STARTHANG2 (i)'s hung await, STARTHANG, REVIEWSANDBOX's now-instrumented remover), a design decision
already taken (PARKEDINREVIEW: a park is a human hand-off), or an operator action (IMGREBUILD's image rebuild).

## Fourth pass — two more root causes and the evidence campaigns

- **Sandbox path collision (project 50's R-03, EACCES on every tool).** The workspace directory truncated the task
  id to 80 chars while the owner uid hashed the full id; three cards of one plan collided onto one 0700 tree.
  Proven against the recorded boards (21 ids past the bound). Path made injective; a foreign-owned workspace is
  now refused by name instead of handed over.
- **"Focused code span" is a decompose-time snapshot.** It never reflects the card's own writes; two sessions read
  it as proof their writes vanished and looped identical `write_files`. It now says it is a snapshot. The
  "two concurrent sessions" report was one session with a turn overwritten by a stolen claim (request 2036/2040).
- **P21.6b's leaf: the per-task diff predictor** — 371 joined pairs from the batch; cell median beats the pooled
  median 23 vs 38 lines (leave-one-out); the review half of the sizing gate can now actually fire.
- **P15.3's first real-model verdict** — `tool_catalog_gate_observation: do_not_enforce` on 2,118 evaluable
  outcomes (84% success on the objected cards), after lifting a 500-record read cap that had truncated it.
  Provenance: Sonnet in every seat — the wrong population for a small-model toolset gate, so no default flipped.
- Three premises corrected on evidence: project 47's "data loss" was a rejected edit plus a vacuous green test;
  the "orphan proxy" was the idle-retired sandbox (twice confirmed); ticket 4's claim default was already fixed.

Still open, evidence-only (not fixable without a fresh occurrence): P1.STARTHANG2 (i)'s actual hung await — the
failing runtime's log was overwritten by the restart; the deadline observation now captures the pool state when it
recurs — and the custodian `main-branch-custodian::review` re-prompt under P1.SETTLEDNUDGE (two later shifts saw 0
loops; start at whoever calls `sendTaskSessionInput` for a `::review` task with a recorded verdict).

Lessons re-learned today, recorded in §4A / memory: the hook checks the working tree (no src edits while a commit's
hook runs); zsh reports `tail`'s exit code after a pipe (`${pipestatus[1]}`); `git stash push --staged` + `pop`
restores changes UNstaged and the commit lands empty.

## Afternoon: P23.5 (2) — the empty-call wall gets a model-side lever (`9f421d05f`)

The campaign's purest failure (three empty `write_file` calls with the payload in the prompt, clean stops) was
invisible to the swarm ladder: "a tool call happened" counted as success, the SDK salvaged `{}`, the tool refused,
and the same empty call came back. Now the ladder judges the arguments the SDK would dispatch
(`core/tool-call-argument-triage`); an unusable call is a `malformed` turn and the `constrained_schema` rung
(`nklein-agent/constrained-tool-call-model`) forces that tool over the direct client — native
`tool_choice:required`, then a per-tool `json_schema` — with a re-ask naming the missing fields. Lossless repairs
(coercions, dropped unknown fields) land in the buffered events with no retry; a mixed batch keeps its good calls.
Kill switch `NKLEIN_CONSTRAINED_TOOL_CALL=off`; observation `swarm_constrained_tool_call`.

Two things the tests caught before the wire did: the ladder's next-rung availability was computed from the
NARROWED attempt request (one tool ⇒ no prompt-variation plan ⇒ parked), so it is judged against the baseline now;
and a `src/core` module must not import `@cline/shared` (biome boundary) — the core mirrors the delta shape
structurally.
