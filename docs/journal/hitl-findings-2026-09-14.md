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

Still open, evidence-only (not fixable without a fresh occurrence): P1.STARTHANG2 (i)'s actual hung await — the
failing runtime's log was overwritten by the restart; the deadline observation now captures the pool state when it
recurs. P1.SETTLEDNUDGE (reopen path for planning cards), P1.PARKEDINREVIEW, P1.NOWRITETOOL remain in todo.md with
their evidence.

Lessons re-learned today, recorded in §4A / memory: the hook checks the working tree (no src edits while a commit's
hook runs); zsh reports `tail`'s exit code after a pipe (`${pipestatus[1]}`); `git stash push --staged` + `pop`
restores changes UNstaged and the commit lands empty.
