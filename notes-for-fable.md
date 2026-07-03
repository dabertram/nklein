# Notes for Fable — double-check the 2026-07-03 chat/board session

**Purpose:** a fast Fable session (2026-07-03) landed a large batch of chat↔board wiring. The user asked for a
deliberate second-pass verification **once Fable is available again (~2026-07-04)**, ideally **Opus 4.8 + Fable in
tandem**, before this work is treated as trusted. This is a *verification* pass, not a rewrite: correctness, edge
cases, invariants, and — most important — that the wiring actually reaches the model/board **at runtime**, not just
in the unit tests. Adversarial, workflow-style review is appropriate (ultracode).

The canonical tracking item is **todo.md §5.BF** (this file mirrors it as a standalone handoff). Related open build
items (NOT part of this review): §5.AU rung-5 LLM disambiguator, the needs_clarify candidate-picker, live-UI read
(§5.AU 5b/8), and the tool-name aliasing plan in **todo.md §5.BD**.

---

## Already done — a PRELIMINARY Opus verification pass ran (don't re-litigate these)

An adversarial workflow (6 review hunters, one per commit; each finding killed unless it survived 2-of-3 skeptics)
already ran on Opus and found + **fixed 3 confirmed defects**. Commits `9434dd29` (fixes) and the follow-up ordering
harden. Treat these as **closed**; a second model may still see something new, but start elsewhere:

1. **[MEDIUM — real data-loss] the `send_to_card` relay could permanently lose mailbox guidance on a failed start.**
   `consumeCardMailbox` durably committed the consume BEFORE `startTaskSession`; a realistic start failure (Docker
   down, bad baseRef, stale workspace, disk full) threw and the notes were gone. Fixed: read non-destructively
   (`listPendingCardMailbox`), consume only AFTER a successful start via the new timestamp-bounded
   `markCardMailboxConsumedUpTo` (bounding at the newest note READ keeps a note that arrives mid-start pending, not
   consumed-unseen), and the consume now runs before the best-effort lane reconcile so nothing downstream can skip it.
2. **[LOW] §5.BD rejection counter attributed multi-tool-rejection turns to the first tool only** (`/\[(\w+)\]/`
   non-global). Fixed: new pure `extractRejectedToolNames` anchored on segment boundaries; one observation per tool.
3. **[LOW] activity ticks stopped driving sticky-follow at the 60-item cap** (`contentVersion` used array length,
   which pins at 60). Fixed: use the newest tick's monotonic timestamp.

A 4th candidate did not survive verification.

---

## Scope — every commit from the session (`816c2fa7..HEAD` on `feat/kanban-reliability-context-upgrade`)

- **`816c2fa7` — run42 autopsy trio (§5.AN).** #41 the `tool_input_rejection` counter now fires in the event-adapter
  ERROR branch (`isPreExecutionToolRejection`) — verify it can't DOUBLE-count when a rejection is also a tool-finished
  event. #42 `edit_file` tolerance v2: numeric-string `insert_line` coercion + `{path,new_text}` = whole-file replace
  — **verify the whole-file-replace path still enforces protected-path / containment / per-file line-limit / secret
  guards** (the commit claims it does; this is the highest-value thing to re-confirm here — a bypass = silent file
  clobber). The 100%-reuse telemetry (`identical === previous`).
- **`28d5c4ca` — git-hook env scrub in decomposition tests (§4A).** Confirm `createGitProcessEnv()` at every git
  spawn; sanity-check no OTHER test spawns raw-env `git init`/`commit` in a tmpdir (same hijack class — `git commit -a`
  hooks export a temp `GIT_INDEX_FILE`).
- **`c741edbb` — §5.BB chat phase 2 (web-ui).** `board-activity-ticker.ts` pure diff: first-snapshot-seeds-silently,
  60-cap, and the "session first appears failed" tick (can it replay pre-existing failures as new activity?).
  `composer-mention.ts`: `getActiveMention` email/whitespace guards, ranking, `applyMention` caret math. In
  `chat-sidebar.tsx` (glue, no DOM test): Enter must submit ONLY when the mention popover is closed; ↑/↓/Tab/Esc; the
  timeline interleave sort tie-break.
- **`05eb5a13` — §5.AU front-door.** In `chat-service.sendMessage`: a GOAL-routed turn must add ZERO to the prompt
  (byte-stable §5.AQ). Note-strength by rung (directive vs soft-focus vs ask-don't-guess). Explicit handle persists
  focus. In `runtime-api.ts` `resolveMessageTargetIndex`: the derived `stream-<slug>` id must MATCH the client
  composer's inserted `@stream:<id>` AND persisted `board.streams` ids; persisted-vs-derived precedence.
- **`9a9f27b2` — §5.AU "talking to X" chip.** Clients must NOT be able to SET focus over the wire (only server-side
  @handle); `clearFocus` is clear-only. `describeFocus` degrades gracefully when the focused card/stream is trashed.
- **`6b076676` — §5.AU item 6 `send_to_card` relay (review HARDEST).** `classifyCardMessageIntent`: is "go with
  option B" guidance not steer? is the question-opener regex greedy at word boundaries? Any input that misroutes to a
  start-bearing steer on a READY card? `resolveCardExecutionState`/`listUnmetDependencyTaskIds` mapping (review lane?).
  **Mailbox consumption at `handleStartTaskSession`:** verify EVERY start path funnels through it (UI, autoStart,
  queued-drain, RE-DRIVE via `sendTaskSessionInput`) — does a re-drive/bounce re-consume (double) or never consume?
  (The failed-start-loses-notes case is fixed per above; re-verify the re-drive path specifically.)

---

## How to run it

- The relay touches `start-task-session.ts` (the start prompt now carries the mailbox addendum) — a
  review/delivery-adjacent path that `test:fast` doesn't fully exercise. **Run the deterministic integration harnesses
  (swarm-deterministic{,-pass,-bounce}) ONE AT A TIME** (parallel runs cross-contend).
- Confirm the relay's prompt-addendum didn't shift start-prompt token estimation / difficulty enough to move model
  selection.
- Fold any findings into fixes, re-gate (tsc both projects + biome + `test:fast`), then mark §5.BF settled.
