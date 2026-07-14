# Changelog

## [Upcoming !Klein 0.0.1]

- **Settings now shows which section has unsaved changes, and lets you undo one section at a time.** When you edit a
  setting, a dot appears next to its section in the left-hand nav, and that section's header gains a "Reset section"
  button that reverts just those fields to what's saved — leaving your edits elsewhere untouched. (Rolling out one
  section at a time; General, Notifications, Guardrails & Limits, and Git so far.)

- **A chat now asks before running a host action it isn't already cleared for.** When a chat with host access tries
  something legitimate but not pre-authorized — an unsafe shell command without risk acknowledged, or a sandbox write
  outside its approved folders — it no longer just refuses. A prompt appears showing exactly what it wants to do (the
  action and the precise command or path) with Approve and Deny. Approving lets it run this once; denying, dismissing,
  or simply not answering blocks it — the request fails closed after a minute, so an unattended prompt is always the
  safe choice. (Applies when the capability broker is enabled; the default posture is unchanged.)

- **You can now review the host actions a chat has taken.** A chat with host access shows a "Host action history"
  panel in its header — a read-only, secret-safe log of every gated host action it attempted: what it was, whether
  it was allowed, confirmed, or denied, and whether it actually ran. Filter by decision or to just the actions that
  executed.

- **Each chat now shows a clear badge of exactly what it's allowed to do.** The session header carries a color-coded
  posture chip — "Isolated · read-only", "Sandboxed · confirms host actions", "Host · confirms mutations", or "Host ·
  full risk acknowledged" — derived from that chat's scope, risk acknowledgement, and browsing toggle. Hover it for a
  plain-language summary of what the chat can do, what it will ask you about first, and which control to change to
  raise or lower its access. No more guessing from scattered toggles.

- **A card held back because its result wrote outside its allowed files now shows up in your needs-you inbox as its
  own item.** When automatic delivery holds a card in Review because the work touched a protected or out-of-bounds
  path, it's now flagged distinctly (a "protected write" hold) rather than looking like a generic stop — so it
  counts toward your needs-you badge and triggers a desktop notification, with the fix being "allow or revert this
  write" rather than "approve the delivery."

- **The model telemetry browsers now show one row per model, not one per endpoint.** When the same model is served
  under more than one runtime id (for example the same model on two machines), its fitness, behavior, and
  self-observation history is now grouped under a single stable identity in the stats views — so its success rate and
  confidence reflect all of its evidence together instead of being split into thinner, less-certain slices.

- **You now get a desktop notification the moment a card needs you — not just when one's ready for review.** With
  notifications enabled, !Klein alerts you when a card asks a question, gets escalated, has its delivery held, or is
  blocked and waiting — as soon as it happens and only while you're looking elsewhere (a visible board already shows
  it). The alerts respect each chat's mute and quiet settings: muting a project's chat silences its alerts, and
  quiet mode keeps the hard stops (escalations, held deliveries, blocks) while dropping the softer "needs input"
  ones. Each situation notifies once, and re-notifies if it recurs after being resolved.

- **Stuck cards now offer one-click resume — and let you answer inline when they need input.** When a card exhausts
  automatic recovery and escalates, its "what was tried" panel shows the get-through-the-wall options with a resume
  control on each one you can act on: a one-click button for the direct fixes (approve a blocked action, point it at
  a more capable model, retry after you've fixed the environment), and an inline field for the ones that need
  something from you (clarify the goal, add context, relax a constraint) — type your answer and it's delivered to
  the card as it resumes. Either way the card continues from exactly where it parked (its saved work), rather than
  restarting cold.

- **When a chat message could address more than one card, the agent now tries to figure out which you meant before
  asking.** Previously an ambiguous message (e.g. an `@handle` that matched two same-named cards) always stopped to
  ask you to pick. Now a quick, isolated model turn first attempts to resolve it from the message alone — and only
  if it can't confidently choose does it fall back to asking. It can only ever pick one of the actual candidates or
  abstain; it never invents a target or starts anything on its own.

- **Ask-about-!Klein chats now ground their answers in the project's current source, with freshness shown.** When a
  chat is in the read-only "!Klein self" scope, each question is routed to the most authoritative planning docs
  (done.md for "what exists", todo.md for "what's planned / known issues", and so on), and the agent is told to read
  the current source of those files — with a one-line citation per doc showing how recently it changed and a "may be
  stale" marker when a doc hasn't been touched in a while. Answers cite the live files instead of leaning on
  remembered prose. The "!Klein self" scope is also now strictly read-only: it can never be granted write tools, even
  if writable paths were configured.

- **The model-fitness browser now shows how sure each score is, and lets you filter to what matters.** Every
  model × role × difficulty cell gets a confidence column — a sample-size-aware band (high/medium/low/none) with its
  lower-bound score, so a model that went 1-for-1 no longer looks as trustworthy as one that went 45-for-50. You can
  sort by confidence and filter the table to just the below-bar cells, a specific confidence band, or by freshness
  (cells whose last evaluation is over two weeks old, or never dated, count as stale).

- **You can now dial in how chatty each chat's board updates are, right from the sidebar.** A chat that owns a
  project shows, beside the existing mute button, a verbosity selector (silent / concise / normal / verbose) and a
  quiet toggle. Verbosity sets the cadence of the board→chat updates; quiet mode keeps the hard "needs you" stops
  (blocks and escalations) while suppressing the softer asks. Both settings are remembered per chat. While a chat's
  board updates are fully muted, the two controls disable, since there's nothing to tune.

- **Grinding workers are now caught early, not after they burn their whole run.** The runtime continuously watches
  every running card for the known trouble patterns — repeated attempts with no measurable progress, the same
  failure recurring across different approaches, response loops that recovery couldn't clear, and a run gone
  silent. A troubled-but-alive worker gets one clear mid-run course correction ("change your approach" or "stop
  grinding — finish the smallest correct version and say what's missing"), and every trouble signal is recorded so
  the escalation and learning machinery see it. Thresholds are deliberately generous so slow local models on
  low-power machines are never mistaken for stuck ones.

- **Card guard rails are enforced end to end: while the worker works and before the result merges.** The live write
  gate now understands directory-scoped bounds — a card scoped to `src/orders/**` may create new files inside that
  directory (previously only pre-declared files were allowed), and paths a card declares off-limits are blocked
  outright. At delivery, the result's actually-changed files are checked against the card's bounds: an
  out-of-bounds result gets one automatic retry telling the worker exactly which files to revert, then is held in
  Review for you instead of merging.

- **Card guard rails are now enforced when work is scheduled.** Cards generated from a plan carry their write bounds
  onto the board, and the auto-start scheduler uses the full parallel-write safety classification: two cards that
  would write the same specific file — or where one would write inside paths the other declares off-limits — no
  longer run at the same time (the second waits its turn), while cards that only share a low-signal manifest like
  package.json still run in parallel.

- **Decomposed cards now carry their own guard rails.** Every generated card states which files it may modify (derived
  automatically from the plan when the architect doesn't bound it explicitly), which paths are off limits, and which
  interfaces it must not break — and workers see these bounds in their card brief. The plan also classifies "hot
  files" that several cards want to write: overlaps that are safely ordered by dependencies are noted, and overlaps
  that could run in parallel (a merge conflict waiting to happen) are flagged as warnings on the decomposition.

- **Planning agents can now build the task graph step by step, with each step validated.** New `add_task` and
  `add_dependency` tools let the decomposing agent declare tasks and dependencies one at a time; every operation is
  checked immediately (unknown tasks, duplicates, self-dependencies, and anything that would create a cycle are
  rejected with a precise explanation), so an invalid graph can't accumulate — the agent fixes the one bad step
  instead of redoing the whole plan. Finishing is calling `decompose_project` without a task list: the accumulated
  graph is submitted as-is. The classic one-shot task list keeps working unchanged.

- **The focus chain is now fully operator-controllable, with an audit trail.** A card's focus-chain panel marks the
  step the agent is on with a "current" chip and can show the step's full status history (every recorded
  pending/in-progress/done/skipped transition, from the durable attempt ledger). The chat plan strip is editable too:
  expand it to reorder, skip, reopen, delete, or add steps — the same safety guard the agent itself is subject to
  rejects any edit that would wipe recorded progress, and tells you why. Also fixed along the way: chat per-step
  timing (when a step started/finished) no longer resets when the chain is reloaded from disk.

- **The retired terminal-CLI agents are fully gone from the product surface.** !Klein's native agent has been the only
  launchable agent since the local-only lockdown; now the leftover claude/codex/gemini/opencode/droid/kiro entries are
  removed from onboarding, settings, and the wire contract too. Boards, sessions, and settings saved by very old
  builds still load — any retired agent id is migrated to the native agent automatically — and the last traces of the
  pre-sandbox host-worktree display went with it.

- **Streamed chat replies work again.** A recent change to the streamed-turn continuation feature accidentally broke
  every token-streamed chat turn with an internal error ("Cannot read properties of undefined") — the reply never
  started streaming. Non-streamed chat was unaffected. Fixed, with a regression test that exercises the streaming
  client exactly the way production constructs it.

- **A finished task can no longer silently end with no result and no explanation.** An intermittent failure class let
  a card reach a terminal state with neither a result branch nor an actionable error: capture failures after a
  torn-down workspace were logged as benign "nothing to capture", explicitly stopping a task skipped the salvage
  capture entirely, and shutting the runtime down could race the result assembly that was still writing. All three
  are now fail-closed — a failed capture marks the card failed with a clear warning and diagnostics, stopping a task
  still salvages (or explicitly fail-closes) its sandbox work, prior-round work is rebound into review instead of
  stranding the card, and shutdown waits for in-flight result assembly. Reviews and merges never pick up a stale
  previous-round result while a new round is running, and "Collect evidence" now states exactly what it captured —
  a result branch, an explicit no-change outcome, or a typed failure with the recommended next step — instead of
  quietly substituting the project checkout.

- **Per-domain sandbox egress is now real (experimental, off by default).** The `allowlist` network tier used to
  fail closed to fully-offline because honest per-domain filtering needed infrastructure that didn't exist — so an
  agent that needed one whitelisted host got nothing. There's now a host-side egress proxy: `allowlist` sandboxes
  join a `--internal` Docker network with no route of their own, and the dual-homed proxy is the only way out,
  enforcing the domain allowlist at connect time (fail-closed by topology — proxy down or unhealthy means no
  egress, never full egress), resolving names host-side, blocking DNS exfiltration, and auditing every attempt. It
  stays OFF unless explicitly enabled and, until enabled, behavior is byte-identical to before. It's now enabled and
  its allowlist configured from Settings (Settings → Agents), and the proxy ships as a bundled artifact so no manual
  setup is needed; per-role allowlists and per-task audit attribution are still to come.

- **`nklein dev capacity` now advises when a model's context window is wasting your time.** On a slow or low-power
  machine, re-reading a huge loaded context on every request (the "prefill") can dominate the wall-clock even when
  the actual prompt is small. The capacity report now looks at how much context each loaded model is given versus
  how much it actually uses and how slow its prefill is, and — only when a big window is demonstrably wasted —
  suggests a smaller cap (never below the 32k floor), with the evidence and the compensating steps to keep it
  effective (retrieval, compaction, smaller cards). A window that's genuinely full but slow is flagged to route to
  a stronger machine instead of being cut. Advisory only; nothing is changed automatically.

- **The code-intelligence memory server no longer crashes agents on smaller machines.** The sandbox's
  codebase-memory MCP (a ~2 GB code-graph index that cuts tokens ~99%) was being launched into every task
  container — including the 4 GB default — where, under concurrent build/test load, it exceeded the container's
  memory limit and got OOM-killed mid-work (`MCP error -32000: Connection closed`), silently stripping the agent's
  code localization. !Klein now checks up front whether a container has room for a heavy MCP server alongside the
  worker (its budget + the container's own baseline + one concurrent command) and simply doesn't offer it when it
  won't fit — deterministic, predictable behavior instead of a random mid-run crash. And it no longer does this
  silently: when a server is withheld for memory, the session logs exactly which one, the container size vs. what
  it needed, and the fix — raise the sandbox container memory (Settings → Agents → isolation pool). The lightweight
  servers are unaffected.

- **The "Get started" tour now describes !Klein, not its ancestor.** The onboarding slides still claimed task
  import from Linear and GitHub (inherited copy from the fork's origin — !Klein is local-only and does neither).
  The tour now tells the real story: describe your goal in chat, !Klein decomposes it into dependent cards, local
  models work the board down with second-opinion reviews and acceptance checks before anything ships — all on
  your machine, every agent in an isolated sandbox.

- **The chat's board feed no longer cries wolf on healthy boards.** Every delivered card's session is torn down
  as "interrupted" after its clean hand-off, and an ended session's heartbeat naturally goes quiet — the chat
  digest and activity ticker narrated both as "❌ failed" and "heartbeat lost (the run may be dead)" right after
  "✅ ready for review" (observed live: 15 of 15 healthy cards produced a failure line). Failure notices now fire
  only when a genuinely LIVE session dies, and heartbeat-loss only for sessions that are supposed to be beating.
- **A dropped review can no longer freeze a whole project.** When the shared endpoint was busy with a sibling
  project at the moment a card reached Review, its review silently never ran — and with no session left alive,
  nothing retried it while every dependent card stayed blocked (observed live: a project frozen at 6 verdict-less
  review cards + 9 waiting dependents). The board-liveness watchdog now detects verdict-less review cards on an
  idle board and dispatches their reviews itself, one per tick.
- **The board watchdog can no longer disappear behind a wedged workspace read.** Existing workspace reads no longer
  hold the global project-index lock while running Git inspection, Git probes now have a hard upper bound, and the
  watchdog reads its known board directly on a bounded cadence. Each tick records entry and load-stage telemetry, so
  a timer that never fired, a stale workspace scope, and a state-load timeout are now distinct failures; the next tick
  still runs after an injected hung read, and shutdown clears every watchdog/idle timer instead of forcing process exit.
- **Pre-first-token model stalls now self-heal for real session shapes.** A primary turn optimistically records a
  healthy heartbeat before calling the model; the zero-token detector previously treated that one historical stamp as
  permanent proof of life, so it could never detect a production zombie. Heartbeats now expire like renewable leases:
  after the generous low-power-safe bound, a still-running turn with no token is interrupted, releases its model slot,
  and retries through the normal card recovery path. A spawned-runtime/Docker rail proves the full recovery and also
  proves that a merely slow first token inside the lease is left alone.
- **Transient local-model aborts now retry without replaying output—or ignoring Stop.** Swarm turns retry at the shared
  SDK model-stream boundary, where a failed attempt can be buffered and replaced before any partial text, reasoning,
  usage, or tool activity escapes. Retries are bounded, stop after any tool call, and never fire when the caller's abort
  signal says the user/session cancelled the turn—or when unproven raw text merely says “cancelled.” The wrapper owns
  one initial-plus-two total budget instead of multiplying an inner retry loop. Buffered tokens still renew the liveness
  lease. Direct chat and structured calls use the same provenance rule; live chat streaming retries only before its
  first visible chunk, so a prefix is never printed twice.
- **Rapid project switching now reliably lands on the last project you chose.** Reversing an in-flight switch no longer
  gets mistaken for clicking the already-open project, late board/chat frames from the previous project are ignored,
  and an older WebSocket handshake cannot finish afterward and overwrite the active project's Settings config. Project
  selection is latest-wins and commits its id, path, and config atomically, so board, task chat, and Settings converge
  without a reload even during fast A→B→A→B navigation.
- **The bounce/rework delivery race now has a permanent durable-scheduler regression.** The underlying fixes already
  isolate every overlapping acceptance check in its own sandbox and coalesce same-card review finalization by owning
  workspace; the end-to-end bounce→rework→approve→acceptance→merge scenario now always enables the durable controller,
  preserving the scheduler/review timing that originally exposed the failure.

- **A looping agent now breaks out of its own doom loop** (todo §12, live-observed: a 35B model endlessly re-asking
  whether the task's `*.js` test command was correct instead of working). A new in-session turn-loop guard
  fingerprints each completed assistant turn and catches the same question re-raised (or two proposals bounced
  between); when the contested point is answerable from the card's own `Acceptance check:`/spec context it cancels
  the loop and re-prompts with that authoritative answer (one bounded nudge), otherwise it reroutes the card to a
  lineage-diverse loaded model with the boundary question queued as mailbox guidance — and only as a last resort
  parks the card asking the operator the *specific* question, never a generic "stuck". Regression-locked end to end
  by a new simulator track (`NKLEIN_SIMFLOW_TURNLOOP=1`): the mock worker loops for three turns, the guard answers
  from the acceptance line, and the whole board still drains with zero LLM compute.
- **Four previously env-only switches are now real Settings** — basic-memory agent notes (per-project writable
  memory, off by default), the chat truncation-retry ladder (on by default), reasoning-model token reserves for
  chat (off), and review-panel lenses (off) can all be toggled in Settings instead of requiring `NKLEIN_*`
  environment variables. The env vars still work as overrides for scripts and harnesses, so nothing existing breaks.
- **The board has a "Ready" lane between Planning and In Progress** (todo §5.B, protected feature). Dep-free cards
  that are only waiting for a free slot (concurrency cap, busy endpoint, or a file-overlap lock) now park in their
  own column instead of blending into Planning — the board finally distinguishes *refining*, *waiting for a slot*,
  and *implementing*. Old boards gain the lane automatically on load (zero migration), every surface understands it
  (lean view rolls it into Queued, DAG/overview/drag rules/counts include it), and a card that begins running always
  leaves Ready for its refinement pass — verified live on a simulated project where Ready filled to 15 cards and
  drained one-by-one with zero running-session sightings across 96 probes.
- **A dense-UI polish pass across every zoom level, driven by live simulated boards** — 13 targeted fixes plus a new
  adaptive density feature: on constrained window widths (769–1279px) the whole UI zooms out slightly (8–15%) so
  titles and captions fit instead of truncating; board lanes, the git-history diff, and the chat pane all gained
  minimum-width floors with horizontal scrolling instead of collapsing into unreadable slivers; the activity map
  clamps and declutters its captions per-cluster (and scales halos to phone canvases); the DAG explains a zero-edge
  layout instead of looking broken; system messages stop breaking words mid-character; sidebar rows reveal full
  project names on hover; and the mobile board carousel now includes the Completed/Trash stack as a proper page.
- **Simulated project flows now drain real runtimes end-to-end at every scale tested** (todo §13): the
  hand-authored 41-card clinical set, the largest generated 50-card set, and a failure-injection flaky run all
  complete against a live runtime with zero LLM compute and zero unmatched mock requests. Along the way the
  simulator exposed and fixed a second scheduler bug — repeat auto-starts could double-dispatch an
  already-running card via the endpoint-busy queue (its duplicate session then produced an empty patch and
  wedged review). The record→distill reflection loop is wired end-to-end (capture proxy + distiller CLI) and
  documented in docs/dev/llm-simulator/README.md.
- **A frozen-board dispatch stall is fixed — found by the LLM simulator in minutes** (todo §13/§12). Driving a
  20-card simulated project through a real runtime reproduced a stall real-model runs had only hinted at: the
  deferred-retry trailing timer could be silently swallowed by the terminal-retry sweep debounce, leaving ready
  cards frozen in Planning with an idle fleet. Timer-fired sweeps now bypass the debounce and a swallowed sweep
  re-arms the trailing timer. Scenario mock sets now exist for all lower-20 dev-test projects (generated,
  tier-ramped up to 50 cards, offline-green acceptance), and the project-02 set drains a real runtime 19/19 to
  Completed under a strict harness gate.
- **The simulated fast path is live: a full !Klein flow now runs end-to-end with zero LLM compute** (todo §13).
  `npm run test:simulated-flows` boots a real runtime against the new `packages/llm-simulator` (scenario tracks +
  seeded RNG compiled onto @copilotkit/aimock, with an LM Studio catalog shim) and drives a seeded project from
  decompose through worker edits, acceptance, second-opinion review, and delivery to Completed in seconds. Request
  classification now follows !Klein's real wire shapes (identical system prompts across session classes; the
  class-exclusive `submit_review` tool; per-project decompose needles), and `npm run test:simulator` guards those
  truths with unit tests.
- **The outer-loop phase controller now has a live tool-selection seam** (todo §5.AA). A new chat phase tool plan maps the
  current `RunPhase` through each tool's capability manifest, narrows both executable tools and model-visible schemas, and
  applies the phase's inner-loop tool budget. The runtime resolver exposes this behind an optional phase hook, so normal chat
  remains unchanged until a controller supplies a phase; offered tool names now also reach the existing evidence gate that
  prevents premature "done" replies on explicit multi-tool instructions.
  The pure controller now also has a full phase-flow driver that walks intake→plan→validate→localize→execute/observe/
  evaluate→review→merge→done from injected evidence, captures each phase's tool/budget policy on the transition record,
  and stops safely on terminal, park, stall, or transition cap. Model self-reported completion is now an explicit advisory
  evidence field and remains ignored for global completion transitions unless real acceptance/review evidence is present.
- **Fleet verification now proves the configured role models actually ran** (todo §5.AB). The complex fleet-swarm verifier
  records runtime and ledger model usage and fails unless the configured architect, worker, and reviewer models are observed,
  so a run cannot pass by silently routing worker cards to the default model or hiding a synthetic reviewer session. Cold
  configured models now seed their fallback registry entry with the catalog-derived capability prior, so an
  unloaded-from-ledger worker such as `qwen/qwen2.5-coder-14b` is not treated as a generic weak worker before it has local
  outcome history. Its stall detector now checks `lms ps --json` for quiet `running` sessions instead of treating
  `running` as progress forever, and it no longer lets heartbeat-only session `updatedAt` changes reset the quiet timer.
  The verifier now counts only hook/output activity or session lifecycle changes as progress, aborting promptly when the
  serving model is idle and bounding long `processingPrompt`/`generating` silence with a diagnostic LM Studio snapshot.
  It also applies that LM Studio evidence to live `awaiting_review` review/capture/finalization handoffs, where the
  active model may be a synthetic reviewer rather than the primary worker, and grants a short post-generation grace window
  after observed model activity so review-delivery and bounce-restart state transitions are not killed in the handoff gap.
  The smoke dev-test fixture now documents the JS/TS test-file contract in every scaffolded `specification.md` and runs
  both `.test.js` and `.test.ts` files, so generated typed tests can use a `.test.ts` extension instead of failing as
  TypeScript syntax inside a `.js` test during live swarm review/repair loops.
  It now also preflights `lms ps --json` as required host/queue/machine evidence and aborts before starting a swarm when
  that CLI roster is unavailable or no loaded LLMs are visible; `/api/v0/models` remains residency-only and is not accepted
  for host-spread/no-overload proof. If the CLI roster disappears mid-run while sessions are quiet, the verifier fails on
  the short idle window instead of granting the long active-model wait to unobservable work.
  Dev-test project seed cards now use the scaffolded repository's actual current/default git branch instead of hardcoding
  `main`, fixing verifier startup on machines where plain `git init` creates `master`.
  Review-ladder recovery cards are no longer orphaned after a parked escalation: when the second-opinion runner spawns a
  `redecompose-*` card, runtime-server immediately schedules that new backlog card instead of waiting for a later terminal
  sweep that may never fire.
  A follow-up live verifier run exposed a second weak-model recovery defect: marker-based narrated-tool recovery trusted
  polluted MCP tool names such as `sequential_thinking_sequentialthinking_1`, while the offered SDK tool was
  `sequential-thinking__sequentialthinking`, so the card burned retries on `Unknown tool`. Swarm and chat recovery now
  resolve narrated names against the tools actually offered on that turn, exact-match first and then one unambiguous
  punctuation/suffix alias pass, and drop any narrated call that does not resolve to an offered tool.
  It also distinguishes `awaiting_review` capture/finalization handoffs from operator-attention/error pauses, so a failed
  seed that is waiting for human attention no longer suppresses the dead-stall lane. Persisted prompt-session records under
  `.nklein/data/sessions` now count too, so synthetic `::review` sessions that are absent from workspace summaries still
  satisfy the configured reviewer model observation gate. Second-opinion review turns now also emit explicit durable
  review-session telemetry before the synthetic SDK session is cleaned up, so the verifier proves the reviewer role itself
  ran instead of merely seeing that model elsewhere in the swarm. `NKLEIN_FLEET_REVIEWER=auto|none|empty` is now a true
  mixed pin/auto verifier mode: it leaves the reviewer unpinned and fails unless a non-worker auto-review session is
  observed, instead of counting an unconfigured reviewer as observed by definition. Guarded `model-lab` loads can now target
  an LM Link machine by preferred-device id/name, scope unloads to that machine, restore the previous preferred device, and
  evaluate headroom against `NKLEIN_LOAD_TARGET_RAM_GB` so remote loads are planned against the remote box instead of the
  local M5. `model-lab roster-load <rosterId>` now resolves the user's swarm roster/budgets, maps roster machine ids/classes
  to LM Link devices via `NKLEIN_ROSTER_MACHINE_MAP` when needed, preflights the whole roster, guarded-loads each primary
  assignment on its target machine, restores the previous preferred device after each remote load, and verifies every model
  is resident before reporting the roster ready. The fleet verifier can now take
  `NKLEIN_FLEET_PER_HOST_MAX_CONCURRENCY` (for example `m5max=2,m4mini=1`) and writes those explicit per-host caps into the
  runtime config, so a capable host can be raised without also overloading weaker linked machines.
  The second-opinion runner also now quiesces a stale primary worker session before starting review when its latest activity
  is already a terminal sandbox patch-capture marker, preventing a capacity-waiting `task::review` turn from coexisting
  with a fake `running` worker lane.
- **LM-Link resident models no longer disappear from model selection when REST discovery omits them** (todo §5.AB). LM
  Studio provider discovery, residency checks, and loaded-model descriptors now merge the live `lms ps --json` identities
  with `/api/v1|v0/models`, so linked-host aliases can be selected and routed without triggering a load. The runtime also
  runs `lms` with the real LM Studio home (or `NKLEIN_LMS_HOME`) so verifier/server processes with isolated `HOME` values
  can still read LM Studio's local CLI auth state.
- **Qwen2.5 Coder 7B package aliases now resolve to a specific catalog profile** (todo §5.AB). The model capability
  catalog now treats `qwen2.5.1-coder-7b-instruct` and the `mlx-community/Qwen2.5.1-Coder-7B-Instruct-4bit` path as the
  Qwen2.5 Coder 7B family instead of an unknown model, with the 7B footprint and full-synthesis prior kept separate from
  the broader 14B-oriented Qwen2.5 Coder row.
- **Docker sandbox isolation is now an explicit runtime profile** (todo §5.A). The existing low-resource shared-pool
  behavior is preserved as the `lean_shared` default, legacy numeric pool configs infer `custom`, and a new
  `strict_per_agent` profile forces one agent per container with a bounded default cap. Runtime config now supports both
  global defaults and project overrides, Settings exposes both controls, and direct numeric pool edits switch the profile
  to `custom` so user-tuned limits are not silently overwritten.
- **The lean shared sandbox profile now has live containment coverage** (todo §5.A). The Docker integration suite proves
  that two simultaneous tasks share one container while running as different UIDs, that task workspaces are mode `700`,
  and that a sibling task cannot read or write another task's workspace. It also now proves the profile-count delta:
  two concurrent tasks use one lean container versus two strict per-agent containers.
- **Fleet sandbox deliverable reports now show result-branch contents** (todo §5.A). The fleet verifier prints changed
  files and branch tree samples for each `nklein/tasks/*` result branch, and it explicitly reports whether the host
  checkout is clean because captured work is still waiting for the delivery merge. That removes the ambiguity between
  `sandbox_patch_captured` and files being present in the developer checkout.
- **LM Studio concurrency caps now include per-host settings and a read-only capacity probe** (todo §5.AB). Runtime
  concurrency config supports sparse `perHost` caps keyed by `lms ps --json` machine id (`local` or linked device id),
  with project overrides composing with global defaults. The task scheduler resolves the selected model's host and gates
  against that host cap, while the legacy `NKLEIN_PER_MACHINE_MAX_CONCURRENCY` env remains a fallback. Settings exposes
  provider, model, LM Studio host, and endpoint-pool caps, and `nklein dev capacity` reports loaded hosts/models,
  queue/status, LM Studio's reported `parallel` value, configured caps, and conservative recommendations without sending
  a model request. The reported `parallel` value is diagnostic only, not a safe cap: after m4mini swapped under
  `qwen2.5.1-coder-7b-instruct` at concurrency 4, the capacity report now keeps the recommended cap at 1 unless an
  explicit user or measured cap is configured.
- **LM Studio host caps now cover post-start model turns** (todo §5.AB). Reviewers, plan/merge helpers, review-bounce
  re-drives, and other existing-session SDK sends now pass through a runtime model-turn admission gate that resolves the
  same provider/model/endpoint/host caps as task start, checks fresh `lms ps` busy/queue state, reserves a turn slot across
  loaded workspaces, and releases it when the SDK call finishes. A reviewed re-drive no longer emits its visible user
  message or starts stream timeouts while it is only waiting for model capacity. The host map now understands LM Studio
  runtime aliases, publisher keys, indexed ids, paths, and canonical registry keys, and admitted turns carry their resolved
  host id so later admissions do not collapse linked-machine work onto `local` after an alias miss. Duplicate active turns
  for the same synthetic session, such as repeated `::review` starts, are serialized before they can queue a single-host
  LM Studio model. Admission waits now emit a `model_turn_admission_wait` session activity on the normal warning cadence,
  so live verifiers and the UI can distinguish a turn queued behind capacity from a quiet in-model stall. Unresolved
  model-to-host aliases no longer fall back to `local` for host/per-machine caps; local is used only when `lms ps` actually
  maps the selected model to the local host.
- **Model roles now separate auto-selection from explicit pins** (todo §5.AB). Role models default to auto-selection, so
  skill/task-difficulty routing can choose the best loaded model unless a role is explicitly marked `Pinned` in Settings.
  Explicit pins are honored when feasible; if another model looks better, !Klein surfaces a pinned-model recommendation
  instead of overriding the user's pin. A pin now requires a concrete primary model id, so provider-only role settings stay
  auto-selected, and the settings UI preserves mixed setups such as a pinned Architect with an auto-selected Worker. If a
  pinned role model is no longer loaded/runnable or fails the role gate, task start now fails with
  `pinned_model_unavailable` instead of silently falling through to auto-selection. Pinned reviewers now follow the same
  rule: a proven-missing reviewer pin blocks review/delivery instead of waiving to auto-pick. Auto-picked escalation
  workers and plan critics now identify themselves as such in telemetry instead of reusing the reviewer label, so live
  sweeps do not imply that a pinned reviewer was ignored. The Settings assignment control now stays on Auto until a role
  has a concrete primary model and clears the pin immediately when that model is removed, preventing provider-only
  "pins" that would be normalized away later. A concrete task/card model override is also honored as the narrowest pin
  for that start, including plan-mode starts; if it fails class/feasibility checks, !Klein blocks with
  `pinned_model_unavailable` instead of quietly launching the auto-selected role model. Runtime regressions now cover a
  mixed configuration where an explicit Architect pin is scoped to plan-mode while an unpinned Worker still launches via
  auto-selection.
- **Reviewed sandbox re-drives now rebuild the full Docker tool surface** (todo §5.AB/§5.AR). When review finalization
  parks a card and frees its Docker workspace, !Klein closes task-scoped sandbox MCP transports before deleting the cwd.
  If that card is bounced or escalated, the next turn restores the result branch and restarts through the sandbox rebuild
  path, so fresh sandbox file tools and curated MCP transports are wired instead of host-backed tools pointing at
  `/workspaces/<taskId>`. The fleet verifier's tRPC calls now also have bounded per-request timeouts, so a wedged backend
  poll reports a stall instead of waiting indefinitely while models are idle. Sandbox acceptance checks now remap stale
  leading `/workspaces/<old-task>` `cd` prefixes into the fresh acceptance sandbox, classify unrecoverable sandbox path
  setup failures separately, and stop auto-repair after the normal attempts plus one escalation attempt instead of
  re-driving an idle card forever. Same-task review bounce re-drives now also serialize sandbox prepare/dispose
  operations and clone from the stable `/workspaces` parent, so finalization cannot remove `/workspaces/<task>` under a
  redrive clone and leave Docker reporting `getcwd()`/checkout failures. The live fleet verifier defaults its per-machine
  LM Studio cap to `1` and exposes `NKLEIN_FLEET_PER_MACHINE_MAX_CONCURRENCY` for evidence-backed higher caps, matching
  conservative host-cap recommendations on low-resource systems.
- **Unified chat can now accept mid-turn steering without cancelling the active stream** (todo §5.M). The runtime exposes
  `chat.steerTurn`, persists accepted steering text as a normal user transcript row, and injects it into the next
  tool-loop/final streamed model call before closing the steering window. The sidebar composer now stays editable while a
  turn is running and shows `Stop` plus `Steer`; accepted steers render optimistically until the transcript refetches. A
  live LM Studio check (`scripts/verify-chat-steer.mts`) validated the full `chat.streamMessage` + `chat.steerTurn` path
  with one already-loaded model, no sweep or model loading.
- **Memory scope broadening now has a concrete LongMemEval-style signal producer** (todo §5.M/§5.V). The new pure
  `long-memory-eval` core fixture injects multi-session project facts, scores recall@k plus abstention on missing
  evidence, and exposes `decideMemoryScopeBroadening` so `accessAllOptIn` can only be allowed after a passing benchmark.
  A new `npm run verify:long-memory` harness validates that signal against real model-backed recall without wiring runtime
  scope broadening: it has the model select memory ids, answer only from selected memories, score grounded answers
  deterministically, and require first-session-only/noisy controls to fail. Live validation passed sequentially on the
  loaded Qwen3.6-35B-A3B and Devstral Small 2 models; the first run also caught and fixed an under-specified verifier JSON
  schema that could legally emit `{}` for abstention.
- **Settings now exposes the learned per-model behavior profile** (todo §5.AA). The existing Model Performance dialog
  includes a "Learned model behavior" table backed by `runtime.getModelBehaviorProfiles`, showing samples, success rate,
  average retries, dominant failure mode, preferred tool-call format, responsive prompt phrasing, complexity ceiling, and
  context quality-knee data from the local `ModelBehaviorProfile` store.
- **Task retries now carry durable "do not repeat" memory into the next attempt** (todo §5.AF/§5.AA). When a task is
  started or rebuilt after prior failed attempts, !Klein reconstructs the workflow's failure-capsule note from the local
  Agent Attempt Ledger and injects it into the system prompt, scoped to that task only. Empty or unreadable ledgers remain
  no-op, so fresh starts keep the same prompt bytes.
- **Settings can now check and cache llmfit's public model catalog on demand** (todo §5.AB/§5.AL). The model telemetry
  panel has explicit "Check catalog" and "Update catalog" actions. Check fetches llmfit's current GitHub catalog metadata
  only when clicked, compares the remote blob revision to the local cache revision, and reports update availability plus
  row count; update downloads that catalog into the local runtime cache. The same panel now has a persisted
  `off`/`notify`/`auto` update mode (default `notify`): `off` skips the GitHub fetch, `notify` suggests, and `auto`
  refreshes the cache after an explicit check action. The default source is the current upstream path
  (`llmfit-core/data/hf_models.json` via GitHub Contents API), unit tests inject fetch/no network, and the cache now feeds
  a non-authoritative catalog supplement for unknown models. The shipped empirical tool-use catalog still wins over
  llmfit's coarse `tool_use` metadata.
- **Starting a card with an unloaded local model now tells you what is actually loaded** (todo §5.AB). The runtime returns a
  structured `model_not_loaded` block with the requested model and LM Studio's loaded model set, and the board stores it as
  a local-model-required card block. The card UI preserves the loaded-model list so you can load the requested model in LM
  Studio or switch the task to one of the resident models without !Klein silently loading anything.
- **The model telemetry panel now shows fleet suggestions from the loaded LM Studio set** (todo §5.AL). The existing
  fleet-advice core is now part of the runtime model-registry response and appears in Settings → model telemetry and the
  task chat telemetry drawer. When the loaded LM Studio fleet is a base-family monoculture, lacks a strong
  judge/architect reasoner, or has no agentic model loaded, the UI tells you what kind of model family to add. The probe
  is local-only, read-only, bounded, and disabled in unit tests; the llmfit/GitHub catalog update remains a separate
  user-triggered egress path.
- **Task/swarm tool outputs now carry provenance taint before later actions** (todo §5.L). The SDK session runtime now
  wraps both autonomous task `extraTools` and sandbox tool executors with the same capability-broker gate used by chat.
  Repo reads/searches are labeled `repo_instruction`, web retrieval is labeled `web`, bundled MCP tool outputs are
  labeled `mcp`, and all three are scanned for secret-shaped text so `secret_like` propagates into the session taint
  window. Sandbox command output remains unlabeled to avoid treating trusted build/test logs as instructions.
- **Fetched chat web content now gets scanned for secret-shaped text before it can influence later actions** (todo §5.L).
  The chat tool executor now supports content-derived taint labels in addition to static source labels, and both
  `browse_url` and `web_search` scan their rendered output with the shared secret-pattern catalog. A fetched page or
  search result that looks like it contains a credential now adds `secret_like` to the turn's taint window, so the
  prompt-injection broker treats it as untrusted before any later host/protected sink.
- **Chat web access now has its own network-attempt audit log** (todo §5.L). `browse_url` and `web_search` were already
  `egress_read` actions, denied in isolated chat and confirmation-gated in host-capable scopes. Each decision now also
  writes a dedicated `chat-audit/egress-attempts.jsonl` record with the tool, URL/search target, normalized URL host,
  policy decision, confirmation flag, and whether the network action actually executed. The generic chat host-action
  audit schema now accepts `egress_read` too, so egress decisions remain readable in both audit trails.
- **Chat-only sessions can now write only through explicitly approved Docker-mounted paths** (todo §5.M). The isolated
  chat sandbox now accepts a per-session `sandboxWritablePaths` allowlist, normalizes it to workspace-confined
  directories, starts a separate chat Docker pool for each approved mount signature, and offers `write_file` only when
  the call path is inside one of those read-write bind mounts. The §5.M confirmation gate checks the same predicate
  before execution, and the tool still re-checks inside the sandbox before writing both the sandbox clone and the
  approved host mount. A live Docker integration test proves an approved `src/` mount writes `src/generated.txt` while
  an unapproved `README.md` write is refused.
- **Read-only chat scopes now get real Docker-backed workspace reads, never host-backed impostors** (todo §5.M). The
  `chat_only` / `klein_self` execution mode is documented as isolated read-only, but the resolver could still offer
  host-backed `read_file` / `list_dir` tools under the `sandbox_read` action label. It now only offers those tools in
  isolated mode through an explicit Docker sandbox provider; when the sandbox is unavailable it fails closed with no
  workspace filesystem tools. The runtime uses a separate `chat` sandbox pool namespace with network disabled, confines
  symlink-realpaths inside the workspace, and the path is covered by a live Docker integration test. Host-capable project
  scopes keep their existing behavior.
- **The repair-kernel localization backing now uses the real sandboxed code graph MCP** (todo §5.B). !Klein can now create a disposable codebase-memory `LocalizationProvider` from the runtime service: it registers the baked `codebase-memory-mcp` server over the same `docker exec -i` MCP path used for sandbox tools, cold-indexes the task repo, scopes `search_graph` to the discovered project, and cleans up the MCP manager on failure or dispose. The index lifecycle is deliberately cold per provider/card-run for correctness; persisted warm indexes can be added later as a performance optimization.
- **The sandboxed code graph MCP is now verified against its real response shape** (todo §5.B/§5.AR). The `codebase-memory-mcp` integration already ran inside the Docker sandbox; the verification harness now goes further by indexing a tiny repo under `--network none`, calling the real MCP `search_graph` tool, and passing its SDK response envelope through !Klein's localization adapter. That adapter now accepts both direct JSON and standard MCP `content[].text` responses, including the live `file_path` field, so the repair-kernel localization backing has a real schema guard instead of only fake-test assumptions.
- **You can teach !Klein about a new model without waiting for a release** (todo §5.AL). The model-capability catalog — which tells !Klein whether a loaded model can actually drive tools, reason well, or should be gated out of agentic work — is now data-driven. Drop a `model-catalog-overlay.json` in your runtime home and its entries are consulted *before* the built-in catalog, so you can add a brand-new fine-tune or override a shipped verdict without a code change or rebuild. Entries are validated leniently (one malformed row is skipped with a logged reason, never blanking the whole file), and the format is documented in `docs/model-catalog-overlay.md`. The local-model landscape moves faster than releases; this keeps !Klein's judgments current between them.
- **`nklein dev fleet-advice` tells you what to add to your loaded model set** (todo §5.AL). A new read-only diagnostic looks at the models you have loaded and flags the gaps that weaken a swarm: a *decision-layer monoculture* (every loaded model shares one base family, so reviews and escalations can't get an uncorrelated second opinion — it names a different family to add), *no reasoning depth* (nothing well-suited to the architect/judge roles), or *no agentic model loaded at all*. Family is judged by **base lineage, not the display name** — a Qwen fine-tune is Qwen — so a name-diverse-but-same-base fleet is correctly flagged rather than mistaken for diverse.
- **Second-opinion reviews now go to the deepest diverse model, not an arbitrary one** (todo §5.AB). When !Klein auto-picks a reviewer, it now scores the candidates by their catalog reviewer-fit (a reasoning model far outranks a chat model) and picks the deepest one whose base family differs from the worker's — instead of the previous flat scoring that let cache-warmth or arbitrary order decide which model judged. A warm-but-shallow model can no longer displace a genuinely deeper judge (the cache-warmth preference is now bounded by capability). Same routing when only one family is loaded; better second opinions when you have a diverse fleet.
- **A stuck card's escalation now steers you toward a *different* model family** (todo §5.AB). When a card exhausts the automatic recovery ladder and !Klein asks you to make a more capable model available, it now nudges you toward a model from a *different base family* than the one that failed — same-family models share blind spots (~60% correlated failures), so an uncorrelated family is likelier to break through where the stuck one couldn't. It names the family to avoid when the failed model's lineage is known, otherwise gives a generic hint. (The automatic escalation already prefers a diverse model; this brings the same reasoning to the human-facing suggestion.)
- **Online research, the curated MCP servers, and the injection broker are now toggles in Settings — no more hand-editing config** (todo §5.AC/§5.AR/§5.M). Three capabilities that previously lived only in a config file or an environment flag are now switches in Settings → General: **online web research** (turn on egress + paste a compatible search backend URL, with a ready-to-run optional `docker/searxng/` backend included), the **curated sandbox MCP servers** (codebase-memory / sequential-thinking / basic-memory; on by default), and the **prompt-injection capability broker** (off by default). All keep their fail-closed defaults; the online-research path was validated end-to-end with real local models driving the search tool against a live backend.
- **The optional SearXNG helper backend no longer behaves like a baseline Docker service** (todo §5.AC). The ready-to-run `docker/searxng/` compose file is now explicitly manual/optional and no longer uses a restart policy, so Docker Desktop restarts do not resurrect a `nklein-searxng` container just because online research was tested once. Settings now asks for a generic search backend URL and presents SearXNG as one compatible option, not the default product path. The product rule is now recorded: default desktop/runtime setup has no search container; users can keep retrieval off, point at an external SearXNG-compatible endpoint, or later use a managed local backend with explicit start/stop.
- **A restricted agent role can now be denied web research and MCP tools by its capability ruleset** (todo §5.L). The per-role capability rulesets already governed the sandbox network; they now also gate the agent's optional *tools*: a role whose ruleset denies web research won't be offered the online `research` tool even when egress + a backend are configured, and a role whose MCP access is set to "off" gets no curated MCP servers even when the global switch is on. Both gates are ANDed on top of the global switches and re-applied live when you change the ruleset, so tightening a role's access takes effect without a restart. The default (fully-open) preset is unchanged.
- **!Klein now learns which models do well at which kind of card, across sessions** (todo §5.AA/§5.AB). Every finished task now quietly records its outcome into two on-disk learning stores: a per-model **behavior profile** (rolling success rate, the basis of the adaptive retry budget) and a **fitness table** keyed by model × role × difficulty (success rate, timing, failure modes) that the scheduler can rank to route a card to the model with the best track record for that kind of work. Both are local-only telemetry, accrue automatically, and don't change behavior on their own yet — they build the evidence the automatic role→model selection reads.

- **New opt-in prompt-injection defense: a web page you let the agent read can't make it run a host command** (todo §5.L). Chat has always gated host actions behind confirmation, but a malicious web page the agent fetched could still try to talk it into running something. With the new `capabilityBrokerEnabled` setting turned on, !Klein tracks when a turn has pulled in untrusted content (a fetched web page) and then refuses — fail-closed — any host-level action (running a command, more host access) for the rest of that turn, since injected instructions shouldn't be able to drive real host effects. Off by default (nothing changes unless you enable it); reading files, board actions, and everything sandboxed stay unaffected. The change was adversarially reviewed by three independent checkers (byte-identical when off, no bypass of the host path, no wrongly-blocked calls). Note the deliberately strict v1 scope: it guards host/network/elevated actions, not in-workspace edits, and once a page is read that turn can't run further host commands until the next turn.
- **Online research now returns a written, cited answer — not just a pile of page excerpts** (todo §5.AC). When the opt-in retrieval loop finishes gathering evidence, it now asks your local model to synthesize it into a short answer with numbered `[1]`/`[2]` citations and a sources list, instead of handing back raw fetched text for the agent to wade through. It's fail-soft: if the model is unavailable or its output isn't usable, the loop falls back to the gathered evidence exactly as before, so turning this on never makes a result worse. Validated end-to-end against a loaded local model. (Still gated behind egress — no change to when the loop runs, only to what it returns.)
- **Web-search results are now ranked on whether they actually match the query, not just recency** (todo §5.AC). When the opt-in online retrieval loop searches the web, it previously ordered the hits it read only by how fresh and how trustworthy the source was — so a stale-but-on-topic page could lose to a fresh page that barely mentioned the question. Each hit is now also scored for how many of the query's terms it contains, and that relevance is folded into the ranking alongside recency and source-trust, so the agent reads the results that best match what it asked. (The whole retrieval loop stays off unless you enable egress; this only changes how its results are ordered once it runs.)
- **A chat answer cut off mid-thought can now recover by itself (opt-in)** (todo §5.AA). A local reasoning model sometimes spends its whole output budget "thinking" and gets cut off (`finish:length`) before finishing — you'd see a half-sentence answer, a tool that never got called, or a context summary that dropped detail. Behind the `NKLEIN_CHAT_ADAPTIVE_TRUNCATION` flag, !Klein now notices that truncation and re-asks with a compounding-larger token budget (bounded — it climbs toward a fixed ceiling and stops, so it can never spin), across both the tool-using path and the plain-answer/summary path. Off by default (behavior is byte-identical), and streamed replies are intentionally left as-is so you never see the same answer typed out twice. Built with an adversarially-verified change to the hot path (three independent reviewers confirmed the default stays identical and the retry always terminates).
- **Setup now sizes the Docker sandbox against your actual Docker VM — and tells you when it's too small** (todo §5.AF). Every agent shares one Docker container, and the thing that can run it out of memory is how many heavy commands (builds, installs, the acceptance run) execute inside it at once — not how many agents there are. So there's now a **concurrent-command cap** (a new "sandbox max concurrent exec" setting; set it to 0 to disable the guard) that bounds those simultaneous spikes so the shared container can't be OOM-killed under a heavy local-model fleet. The initial-setup wizard probes your Docker VM's real memory (via `docker info`) and recommends the container size + command cap against *that* — because on macOS/Windows the sandbox lives inside Docker's VM, whose default (often ~8 GiB) is the true ceiling regardless of how much RAM your machine has. If that VM is too small for a useful sandbox, setup now says so and tells you how high to raise it in Docker Desktop, instead of silently sizing against total system RAM. The tuned one-container defaults (4 GiB / 4 CPU / 2 concurrent commands) work out of the box.
- **A sandbox container that dies mid-run no longer strands every following card** (fix, todo §5.AF). The agent sandbox pool caches a running container and reuses it for later cards; if that container died out-of-band — an out-of-memory kill under a heavy local-model fleet, a Docker restart, or a manual removal — the pool kept handing out the now-dead container, so every subsequent card failed with "No such container" and the run stalled with no recovery. The pool now verifies a cached container is actually alive before reusing it and transparently recreates a genuinely-dead one, while never disturbing a still-live container shared by other in-flight cards (a liveness probe that can't reach Docker is treated as inconclusive and keeps the container). Found while validating the durable scheduler on real models under a memory-tight Docker VM.
- **A card parked or escalated for you now shows up where you'd look for it** (todo §5.AG/§5.AW). When the review loop gives up on a stuck card and parks it, or a card is escalated to you for a decision, that state is now surfaced from the board itself: the card reads **risky** in the board-health rollup and appears in the risk/approval inbox (a new "escalated to operator" group, visible in `nklein task health`), and the board→chat feedback raises it as an **ASK** in your chat session (review what was tried · retry · reassign) — even in quiet mode. Previously a parked/escalated card was only visible by hunting the board. This works purely from board state (no live session needed), so it survives a restart.
- **You can mute a project chat's board updates** (todo §5.AT). A chat that owns a project shows a **"Mute board updates" toggle** — flip it and the board→chat feedback (card outcomes, "needs you" ASKs) stops posting into that chat, useful when you're heads-down and don't want the running commentary. The preference is per-chat, persists across restarts, and takes effect immediately. The toggle appears only on a chat that owns a project (a chat with no board has nothing to mute).
- **Fixed the chat sidebar quietly spamming the runtime with requests** (fix, todo §5.M). The chat data hook fetched its session list and the open transcript through a query helper whose fetch effect keys on the query function's identity — and it was passing a fresh function on every render, so the effect re-fired every render, re-fetching in a tight loop whenever the chat sidebar was open (every other caller already memoized theirs). Both queries are now memoized, so each fetches when its inputs actually change (the transcript still reloads when you switch sessions). No visible behavior change beyond far less background churn; the query helper now documents the stable-function requirement so it can't recur.
- **Your project chat now shows a live stream overview** (todo §5.AU). A chat that owns a project displays a compact panel of its streams (epics) — each with a health badge (on track / at risk / blocked / done), progress (done/total), and how many of its cards are running now, plus a count of any cards not in a stream. It refreshes every few seconds so it tracks live progress, and it stays hidden when the board has no streams. **Click a stream to address the chat to it** — that inserts its `@stream:…` handle into the composer, so your next message goes to that whole stream. This is the "group altitude" view; the deeper drill-down (stream → decomposition graph → card → thread) is still to come.
- **When it's unclear which card you meant, the chat asks — with buttons** (todo §5.AU). If a message could address more than one target (e.g. two cards with the same name, or an ambiguous reply), the chat now shows a **"Which did you mean?" picker** with a button per candidate instead of guessing or making the model ask. Click one and its `@handle` drops into the composer so your re-send goes exactly where you meant. It's deterministic (no model turn), and you can dismiss it.
- **Messages you address to a card now go straight to the card** (todo §5.AU). When a chat message targets a specific card — via an `@card:…` handle or because the chat is focused on one — it's now **relayed directly to that card** and confirmed (delivered live to the running agent, or queued to the card's mailbox if it isn't running), instead of being answered in the chat by the model. Questions about a card are still answered from board state, and a targeted message never starts a card (starting stays a separate, gated action). Messages to the goal (no card addressed) are unchanged — the model answers as before.
- **Broadcast guidance to a whole stream from chat** (todo §5.AU). A new `send_to_stream` tool sends one message to every card in a stream (epic) at once — delivered live to any of its cards that are running, and queued to the durable mailbox of the rest (read when each card starts). Like `send_to_card`, it never starts a card; starting stays a separate, dependency-gated action. Use `get_streams` to find the stream id.
- **Ask your project chat for a streams overview** (todo §5.AU). A new `get_streams` tool reports the project's streams (epics/groups of related cards) at a glance — each stream's title, health, progress (done/total), and how many of its cards are running now, plus any cards not in a stream. It's the "group altitude" view to drill down from, complementing `get_board` (the card list) and `get_board_status` (the whole-board triage). Safe read-only query.
- **Ask your project chat "how's the board doing?" and get a one-line triage** (todo §5.AT). The chat agent has a new `get_board_status` tool that reports a compact health rollup of the current project's board — "Board: 2 need you · 1 stuck · 3 on track · 5 done." — so you (or the agent) can get an at-a-glance status without scrolling the columns. It reads the same board-health classification the board header and `nklein task health` use, and it's a safe read-only query (no host or shell access). Use `get_board` when you want the actual card list.
- **When a card stops to ask you a question, your chat now tells you** (todo §5.AT/§5.S). If an agent pauses a card to ask for input (via its ask-a-question tool), that "waiting on you" state is now surfaced as an **ASK** in the owning project chat — "card X is asking you something · respond" — and it breaks through quiet mode, so a blocked card doesn't sit unnoticed on the board. It reads the state straight from the card's own summary (the dedicated user-attention marker), doesn't fire for ordinary tool activity, and adds nothing to a card that isn't asking anything.
- **The per-project / global "skill dynamics" setting now actually takes effect** (fix, todo §5.AE). The setting that controls how dynamic vs. strict !Klein's per-task skill/prompt assignment is (fully dynamic … fully static) was persisted and shown in Settings but silently ignored — every skill-resolution call site defaulted to "fully dynamic" regardless of what you picked. Your chosen level now flows into live skill resolution on the per-card start path and the decomposition routing preview, so picking "fully static" (or a static-skills level) genuinely pins the skill set instead of doing nothing. No change at the default ("fully dynamic"), which is what most boards run.
- **Weak local models that pass a mistyped tool argument now get it fixed instead of erroring** (todo §5.O). Small models sometimes emit a tool call with a JSON-schema-valid-ish but wrongly-typed argument — e.g. `"3"` where a number is expected. The chat agent's tool executor now coerces such arguments against the tool's own schema before running the tool (so `"3"` becomes `3`), and only when an argument genuinely can't be repaired does it decline to run and ask the model to re-send that field — instead of feeding raw args through and failing. Already-valid arguments and tools without strict schemas are unaffected.
- **A decomposition with a dependency CYCLE is now detected and recorded** (todo §5.AV). The live task-graph validation checked references but had no cycle detection, so an architect graph where A depends on B and B depends on A could slip through. !Klein now validates the subtask dependency graph at the decompose gate — flagging cycles and oversized cards — and records the finding (a redecompose signal) via its self-observation telemetry. This is record-only for now (it doesn't yet bounce the architect), building the evidence to act on later.
- **Three built-in intelligence levers are now wired into live paths (opt-in / no behavior change by default)** (todo §5.AC/§5.AG/§5.AD). Several of !Klein's adaptive cores existed but weren't running yet; three now do. (1) **Topic-aware retrieval freshness** — when retrieval is enabled and you opt in, the freshness ranker now tunes its "how old is too old" thresholds to how fast the topic actually moves (a market price goes stale in days; a math definition effectively never does), instead of one fixed window. (2) **The board→chat feedback now notices stalled and budget-pressured tasks** — the chat's task-attention signals are now derived from each session's own telemetry (heartbeat age, activity age, context-budget usage), so a card whose run went silent, stopped progressing, or is nearing its context ceiling reads as needing attention — driving the existing quiet-mode chat feedback rather than adding any new surface. (3) **Reasoning models can reserve output budget for their thinking in chat** — behind the `NKLEIN_REASONING_BUDGET` flag, a reasoning model's chat turn sizes its output budget to leave room for hidden reasoning tokens instead of the fixed default that could truncate its answer. All three are off/byte-identical by default; each was shipped with the full suite green (6741 tests) and adversarially reviewed (which caught and fixed a silent no-op in the board→chat signal wiring).
- **The per-project overrides card is now complete — skill dynamics and code embeddings can be set per project** (todo §5.W). Settings → Project "Per-project overrides" already let you override the concurrent-task cap, agent, model roles, agent rulesets, and concurrency caps; it now also carries the last two per-project dials. **Skill dynamics** lets a single project pin how dynamic vs. strict its per-task skill/prompt assignment is (fully dynamic … fully static), overriding the global default. **Code embeddings** lets a project use a different embedding provider/model/endpoint for its semantic index than the global default — the same reusable endpoint fields as the global setting, so an OpenAI-compatible endpoint's URL and model are preserved as you switch providers. Both use the familiar "Override for this project" / "Revert to global" toggle (the row shows the inherited global value until you override), and both persist per project without touching global or other-project config.
- **A sandbox-blocked card leads with "Fix the environment" in its escalation panel** (todo §5.AG). When a hard-stuck card's start-blocker is a sandbox/environment problem, the "What was tried" panel's get-through-the-wall suggestions now promote **Fix the environment** to the top of the list (the most-likely unblock), instead of always leading with the generic "clarify the goal". The full suggestion set still shows — this only reorders so the probable fix is first.
- **Opt-in retrieval is complete: agents can now read the pages they find** (todo §5.AC). Building on the gated `web_search` tool, retrieval-enabled sessions now also get `browse_url` — so an agent can search, pick a result, and read it. Same fail-closed posture (off unless you enable egress), plus a hard SSRF floor that always applies here regardless of any other setting: a sandboxed agent can never reach your machine's own network, private addresses, or cloud metadata through it — internal addresses are rejected before the page is ever fetched, and again if a page redirects to one. Both tools run host-side; the agent's Docker sandbox stays network-isolated.
- **Roles no longer require a pinned model — auto-selection is the default, pins are optional** (todo §5.AB/W2.5). You can configure preferred models for swarm roles (architect/worker/reviewer), but you no longer have to: !Klein auto-selects the best-fit loaded model per card unless a role is explicitly marked pinned. Unpinned role models are candidates, not hard requirements. Explicit pins are hard requirements: they are honored when loaded/runnable, and if the pinned model is missing or class-ineligible the start/review fails closed instead of silently falling through to auto-selection or loading a model for you. Diversity stays authoritative for review/critique roles; cache-warmth only breaks ties within what diversity allows.
- **Merges are sequenced to minimize conflicts** (todo §5.AK). When several independent cards finish at once (more common now that same-file parallelism is allowed), !Klein orders their merges by declared file scope so overlapping ones land adjacently and predictably, feeding cleaner sequences to the conflict-resolution agent. Dependency order still comes first; cards with no declared scope keep today's ordering exactly.
- **Opt-in online retrieval: agents can now search the web — strictly gated, off by default** (todo §5.AC). With the operator's explicit greenlight, !Klein can give work sessions a `web_search` tool backed by a SearXNG-compatible endpoint you configure. The posture is fail-closed everywhere: the feature is OFF unless `retrievalEgressEnabled` is literally `true` AND a backend URL is set; requests are pinned to the configured origin (redirects are treated as misconfiguration, never followed); reviewer/critic/acceptance sessions never receive the tool; flipping the setting off takes effect on the very next call, even for sessions already running; and the Docker sandbox's network isolation is untouched — retrieval HTTP runs host-side in the trusted runtime and results enter the session as tool results.
- **Big plans now get a second opinion from a different model family before work starts** (todo §5.AW). When an architect produces a HIGH-STAKES decomposition (four or more cards, or heavy coupling) whose structural quality isn't clean, !Klein now runs one bounded critique round on a lineage-diverse model *before* the cascade builds on it: the critic reads the spec and task graph (and can inspect the repository), then either signs off or sends concrete feedback back to the architect for exactly one revision. Deliberation is deliberately rare — small or clean plans never pay for it, there's a per-run budget, it only happens when a genuinely different model family is loaded (a same-family "debate" is correlated noise — the waiver is recorded, never silent), and a critique can only ever *add* one revision round: every failure path proceeds rather than blocks.
- **Stalled runs and test scenarios are detected in seconds, not minutes** (fix). The fleet verification harness now aborts in ~90 seconds when every agent session is idle or dead (previously it waited out the full 7-minute no-progress window even when nothing could possibly make progress — a model still generating is unaffected), and the deterministic swarm tests fail immediately when the outcome is already decided (a parked card, or a dead-quiescent board) instead of polling out their multi-minute deadline.
- **A card parked for your attention no longer burns compute or blocks other cards** (fix, todo §5.AW). When the review loop gives up on a stuck card and parks it for a human, the worker's session used to keep running — re-emitting turns nobody asked for (wasted tokens) and holding its model-endpoint slot, which could starve every other card routed to the same model for the rest of the run. Parking now quiesces the session: the in-flight turn is aborted, the endpoint slot frees immediately, and the session stays resumable so your follow-up instruction picks up right where it left off.
- **A card sent back by review can actually do the re-work now** (fix, todo §5.AW). After a card's work is captured for review, its sandbox workspace is cleaned up (the captured result branch holds the work) — but a review bounce or escalation re-drove the same agent session against that now-deleted workspace, so every file it tried to read or write failed and the card inevitably parked with "the repository is missing files". The re-drive now restores the workspace first — checked out at the card's result branch, so all previously delivered work is present for the follow-up round.
- **Review re-drives now detect stale sandbox placements before trusting them** (fix, todo §5.AW/§5.AF). A Docker
  restart/OOM/manual container removal could leave !Klein with an in-memory task placement while the actual
  `/workspaces/<task>` directory was gone. That made bounced or escalated cards skip restoration and then fail with
  misleading `spawn /bin/bash ENOENT`, `scandir`, or Docker cwd errors. Re-drives now probe the concrete Docker cwd,
  release stale placements, and restore from the captured result branch before the next turn.
- **A card start queued behind a busy model endpoint can no longer sleep forever** (fix, todo §5.AF). When two queue-drain triggers raced (e.g. a retry timer firing just as a completed card force-drained the queue), the second trigger cancelled the first one's retry timer and then skipped itself — leaving the queued start with no scheduled wakeup at all. On a busy board this showed up as a card stuck on "queued behind a busy endpoint" indefinitely while the fleet sat idle. Drain requests that arrive while a drain is already running are now remembered and re-run immediately afterwards, so a queued start always keeps a live wakeup. (Found deterministically by the new swarm test harness.)
- **A reviewer that answers "no notes" no longer gets its verdict thrown away** (fix, todo §5.AA). The `submit_review` tool's boundary schema rejected calls where the model passed `feedback: null` — which models do routinely on an approval — so the reviewer's approve verdict was rejected before execution, the model looped re-emitting the same call until the mistake guard abandoned the session, and the review counted as "skipped" (holding the card under the fail-closed gate). The boundary now accepts explicit nulls exactly like the inner schema always did.
- **A project reached under two path spellings no longer breaks review and acceptance in the sandbox** (fix, todo §5.0.5). On macOS the temp directory has two spellings for the same folder (`/var/…` is a symlink to `/private/var/…`), and the sandbox keyed its read-only project mounts by the *raw path string* — so a worker could run fine while the follow-up reviewer and acceptance check, arriving under the other spelling, found no project mounted and failed with "repository does not exist". Since delivery fails closed, the card was then held in Review and everything depending on it froze. Paths are now canonicalized before keying, containers track which projects they were *actually started with* (a task is never placed in a container that can't reach its project; an idle stale container is restarted with the fresh mounts), and three hardening fixes ride along: the acceptance check runs in its **own** sandbox session instead of destructively reusing the live worker's workspace, acceptance now tests the **delivered result branch** rather than the pre-work base tree, and review/acceptance waits for a sandbox slot are bounded (they degrade to a held-in-Review card instead of freezing the run).
- **Delivery now FAILS CLOSED — a card only auto-merges on real evidence** (todo §5.0.5 W0.1). Previously the auto-delivery gate treated every reviewable card as if "review approved + tests passed" were true — so a skipped or errored review counted as approval, acceptance checks never actually gated the merge, and an errored or empty-result card could auto-complete as if cleanly delivered (and release its dependent cards). Now: "approved" means the reviewer actually delivered a sign-off, and "tests passed" means a FRESH acceptance run at the delivery seam reported present-and-passed — the worker's own claims never count. Missing or unavailable evidence holds the card in Review with the reason logged, and an unreviewed empty-result card no longer auto-completes. Note the deliberate consequence: **disabling second-opinion review now means manual-merge mode** — automation only ships with evidence.
- **The reviewer is no longer the model that wrote the code** (todo §5.AB). With no reviewer configured, the second-opinion review silently fell back to the *worker's own model reviewing its own work* — a correlated "second opinion" worth little (same-family models tend to agree on the same mistakes). !Klein now auto-picks a **different model family** from your loaded set as the reviewer (e.g. a qwen worker gets a gpt-oss reviewer), falling back to the old behavior only when nothing diverse is loaded — and then it *says so* instead of staying silent. The reviewer also now receives the **acceptance-check result** (ran before the review, with the failure output when it failed) so its verdict is evidence-backed rather than an opinion on a diff.
- **Small local models get a right-sized brain instead of a big model's overhead** (todo §5.AQ/§5.AD/§5.AA). Three adaptive levers now compose on the swarm path for small models: (1) a model whose *measured* output quality collapses below its advertised context window is now budgeted to its **learned quality-effective window** (from !Klein's own run telemetry) instead of the advertised number; (2) models with a small effective window get a **lean system-prompt** — the rarely-used optional rule packs and deep large-file protocol (~40% of the rules block) are dropped while the discipline, plan-tracking, and budget rules stay; (3) models with a verified thinking soft-switch skip their expensive reasoning preamble on **trivial cards** (hard cards keep reasoning). Net: less window wasted on overhead, fewer truncation failures, faster turns on the smallest models.
- **A truncation-prone reasoning model can now recover instead of dying (opt-in)** (todo §5.AA). A reasoning model that burns its whole output budget "thinking" ends the turn with nothing — and at deterministic settings, simply re-running fails identically. With `NKLEIN_ADAPTIVE_RETRY=1`, !Klein now detects that stall signature (a stalled turn + no delivered work), **re-sends the task with a raised per-turn output budget** (doubling, ceiling-clamped to the context window), and records each attempt so the recovery rate is measurable. Off by default until the new efficiency scoreboard proves the win.
- **Model routing now learns from evidence with much less distortion** (todo §5.AB). Three corrections to the evidence stream that picks models: routing now uses **per-role** success rates (a model that's a great worker but poor architect no longer gets its architect score inflated by worker wins), a model whose *runtime behavior* shows chronic stalling is strongly de-prioritized even if its catalog entry looks fine, and delivery evidence now records whether a run actually **captured a result** (previously an errored run scored the same as a delivered one, biasing routing toward models that fail cleanly).
- **A new swarm efficiency scoreboard shows where compute is wasted** (todo §5.AW). `nklein dev ledger` now includes a per-model rollup of attempts, successes, wasted attempts (with wasted wall-clock minutes), delivered tasks, retry burden, and **re-truncation pairs** (the tell-tale sign of a model repeatedly dying the same death) — plus a total waste ratio. This is the tuner for the recovery and routing changes above.
- **A decomposition with a dependency cycle no longer dead-locks the whole board** (fix, todo §5.AV). An architect model can emit a task graph where every card depends on something (including outright cycles) — previously that materialized a board with **no startable card**, so the auto-start cascade never began and the run silently froze. !Klein now deterministically breaks the minimal cycle-forming edges at apply time so there is always a valid entry point, and reports which edges were dropped. (The deeper fix — making invalid graphs near-impossible to emit in the first place — is the new §5.AV research track.)

- **The agent sandbox image builds again** (fix, todo §5.AR). A prior refactor moved the sandbox tool-runner source file but didn't update the sandbox image build script, so `npm run sandbox:build` (and the full `npm run build`, which calls it) failed at the bundling step. The path is corrected; the image builds cleanly.
- **Curated MCP servers can now run *inside* the agent sandbox, offered only to models they actually help** (todo §5.AR). !Klein can now host a small, curated set of Model-Context-Protocol tool servers **inside the strict-isolation Docker sandbox** — reached via `docker exec` so the server runs in the container, never as a host process, and with its binary baked into the image so nothing is fetched at runtime (the container stays offline). The first is **Sequential Thinking** (a structured step-by-step reasoning tool). Crucially, each server is **gated to the models it fits**: Sequential Thinking is offered to capable, non-reasoning, tool-reliable models but withheld from models that already reason natively (where it's redundant and invites over-thinking loops) and from weak tool-callers (where it can spiral) — this is based on extensive research into how these tools are misused. It's **on by default**, controlled by a `sandboxMcpServersEnabled` setting (global opt-out; a per-project override is next). (Codebase Memory is the next curated server; Pieces was evaluated and rejected — it needs a proprietary host desktop app the sandbox can't reach and duplicates !Klein's own memory.)
- **!Klein now learns whether a model is actually suitable from how it behaves at runtime — not just a curated catalog** (todo §5.AL). The capability catalog gives a model a *pre-flight* verdict (is this family trained for tool use?), but that says nothing about how a given model behaves on *your* machine over real runs. !Klein now also derives an **evidence-based runtime verdict** per model from its persisted telemetry — chiefly how often it *stalls* (ends a turn with no tool call and no text), plus malformed-tool-arg / verification-failed / abandoned signals — and **combines it with the catalog verdict**: enough clean runs confirm suitability, an uncatalogued model gets a provisional verdict to confirm, and runtime evidence that's materially *worse* than the catalog claims is surfaced as a contradiction to reconcile (always taking the more conservative of the two). It's deliberately conservative (it won't pronounce a verdict below a few runs) and **never silently rewrites the catalog** — it surfaces, you confirm. Inspect it headless with the new **`nklein dev model-verdict [modelId]`**, which prints the per-model `catalog × runtime ⇒ recommended` table (or `--json`).
- **Weak local models that "narrate" a tool call instead of making it now get the call executed anyway** (todo §5.AA/§5.O). Small models often *describe* a tool call in prose or pseudo-code rather than emitting a structured call — so nothing actually runs (the board stays empty, the file never gets written). !Klein already recovered several such narration formats; this adds **Google Gemma's `tool_code = create_card(...)` Python dialect** (including list-valued arguments), and adds a last-resort **constrained-decoding rung**: when a model is asked to use a tool it named but emits no call, !Klein re-asks with a schema that *forces* a parseable `{tool, arguments}` call and dispatches it. In live multi-tool-chain testing this flipped two models (a 14B coder and a 3.8B reasoning model) from doing nothing to actually creating the board card and running the command. The rung is deliberately conservative — it only fires when the instruction names a tool the model skipped (never fabricating a call on a plain answer), and it steers a stalled chain toward the next not-yet-completed step rather than re-doing a finished one.
- **A pinned chat model that isn't loaded now fails with a clear message instead of silently loading it** (todo §5.AB). !Klein never loads models for you — that's your call, since loading a large model can saturate RAM/VRAM. Chat already auto-discovered only *currently-loaded* models, but if you **pinned** a specific one (`nklein chat --model <id>`, or an explicit model override), that pin bypassed the check and the first inference would make LM Studio auto-load it. A pinned chat model is now residency-checked against the loaded set: when it isn't resident, chat refuses with a clear "load it first" error that names what *is* loaded. It's lenient by design — an unreachable or non-LM-Studio endpoint (where the loaded set is unknown) never wedges chat.
- **Task starts that were queued behind a busy local endpoint now survive a runtime restart** (todo §5.AF). When you start a card but the model's endpoint is saturated (a common case with local providers like LM Studio that serialize requests), !Klein queues the start and retries it with backoff. Previously that queue lived only in memory, so restarting the runtime silently dropped every waiting start — the cards just never ran. The queue is now persisted to a single durable snapshot under the runtime home and **replayed on boot**: each pending start is restored with its original schedule (so a delayed retry stays held until its real due time, not fired immediately) and re-armed, so queued work resumes after a restart instead of vanishing. The snapshot is rewritten on every queue change and read back before the runtime serves its first request, so nothing is lost in the gap.
- **The swarm's parallelism is now tunable per model provider and per model** (todo §5.W). Beyond the board-wide concurrent-task cap, you can now limit how many sessions run at once **per provider** (e.g. lmstudio / ollama / a custom local endpoint) and **per model** — each as a global default with an optional per-project override (project override ?? global default, AND-ed with the per-model registry limit). This lets you, say, allow 4 parallel sessions on a fast provider but only 1 on a model whose endpoint serializes requests. The caps are resolved at task start and enforced by the endpoint scheduler, persist across restarts, and are editable in-app: the **global default** from a new **"Per-provider / per-model concurrency"** card in Settings, and a **per-project override** from a "Concurrency caps" row in the Settings → Project "Per-project overrides" card (click "Override for this project" to seed an editable copy from the global maps; "Revert to global" to inherit again). For both, add a provider or canonical model id and a cap, or remove a row for no limit. (A null/absent cap leaves today's behavior unchanged.)
- **Cards now show "what was tried before escalating"** (todo §5.AG). When a card has been retried across models, its detail view has a new collapsible **"What was tried"** panel that lists the attempt chain — each rung's model, the approach it used (endpoint/prompt/tool-simplification levers), and the outcome (color-coded: green success, red timeout/loop, orange other) — plus a `N attempts · M models` summary. So an escalated card is an actionable report instead of a silent dead end, rather than something you have to reconstruct from logs. Also available headless via `nklein dev escalation --task-id <id>` and the `runtime.getTaskEscalation` API, all reading the same Agent Attempt Ledger.
- **The "What was tried" panel now tells you whether a card is genuinely stuck — and what to do about it** (todo §5.AB). Below the attempt chain, the panel now shows a **progress verdict** — *progressing* (green), *transient* (orange — still failing but recoverable, e.g. output-format slips a retry usually fixes), or *hard-stuck* (red — a real capability limit: looping or the same failure across multiple approaches/models). When a card is **hard-stuck** — meaning the automatic recovery (every approach across every loaded model) is exhausted — it lists a set of **"get through the wall" suggestions**, because often a simple decision from you is enough: clarify an ambiguity, provide missing context, adjust a constraint, approve a blocked action, fix the environment, re-scope the task, or — only one of several options — make a more capable model available (optionally to analyze what was tried and write detailed guidance). The verdict is computed from the same report the panel already shows, so there's no extra wait.
- **A card whose agent finished the work but keeps repeating "Done!" now wraps up promptly** (todo §5.AA). Some local models complete a task (write the file, run the check) and then, instead of stopping, loop re-emitting the *same* final message turn after turn. Previously the card sat running until a slow catch-all budget (20 no-progress checkpoints, or the wall-time limit) eventually parked it — so the already-finished work was needlessly delayed from review. !Klein now detects this specific "finished but repeating itself" pattern — the same final message re-emitted 3× with no new changes — and parks the card for review right away, so its result is available without the long wait. It's deliberately narrow (it requires both an identical message *and* no new commit), so a genuinely-progressing card is never affected.
- **A slow model that hit a transient abort is no longer misjudged as a failure** (todo §5.AA). Local models sometimes end a turn with a no-output *abort* — typically a slow model whose request hit an SDK/endpoint-level timeout or iteration boundary — even though the very same task completes cleanly when given another go. Previously that was lumped in with genuine failures, so it dragged down the model's reliability profile and could push a card toward the red "hard-stuck" verdict (and a bigger-model suggestion) it didn't deserve. These transient aborts are now classified as their own *aborted* outcome: they're recorded distinctly in the attempt ledger and the "What was tried" panel, they never count toward the hard-stuck verdict on their own (they're treated as a recoverable *transient*), and the retry policy's plan for them is to simply re-run the same model first. (The automatic re-run itself rides on the broader retry-engine wiring still in progress; today the generous time budget is the mitigation.)
- **Board health at a glance — a new header rollup in the UI and a `nklein task health` CLI command** (todo §5.AG). The board header now shows a compact rollup of the board's cards classified as **healthy / stuck / risky / done** (plus a count of cards that need your input), so you can see a board's state without scanning every column. The same model is available headless as `nklein task health`, which prints the rollup — and a **risk/approval inbox** listing exactly what is blocking autonomy (unsafe-action acknowledgements, clarifying questions, held deliveries, blocked-on-setup cards) — as JSON, so it scripts cleanly. Both the UI header and the CLI derive from one shared, tested model, so they always agree. Each board **column** also shows a compact per-lane attention badge (how many of that lane's cards are risky or stuck), so you can see *where* the trouble is at a glance. (The risky + inbox counts surface once the gate/clarify/ack subsystems thread their per-task state in; today board state — including a card's own start-blocked reason — drives healthy/stuck/done and the risky sandbox-unavailable case.)
- **Agents can be told the real current date — no more "today is in the future" hallucinations** (todo §5.AC/§5.AE). Local models reason from a training-cutoff prior, so they routinely get the present wrong (e.g. treating a dated release or paper as still years away). When enabled, !Klein injects an authoritative `<current_datetime>` block — the real date/time from the trusted system clock — framed as ground truth that overrides the model's stale training-cutoff date assumptions, and telling the model to judge the freshness of anything it recalls or retrieves against the real "now". The feature is **off by default** (opt in with the `NKLEIN_KNOWS_TODAY` environment flag; a Settings toggle is coming), and even when on it's injected **only when the task or message is actually time/freshness-relevant** (a date/version/"latest"/"recent"/release signal, or a retrieval role) — a plain coding task never pays for it. It's wired across the board/swarm agents, decomposition, review, and the chat agent (interactive and autonomous), which re-anchors it every relevant turn. The date block is **appended at the end of the context** (not the front), so turning it on never disturbs the cacheable prompt prefix that keeps local inference fast. (Under strict Docker isolation the clock is supplied host-side — the sandbox never provides "now".)
- **The chat scope selector now makes host access explicit** (todo §5.M). A chat session's "scope" controls what the agent can touch, and three of the four scopes actually run commands on your **host machine** (filesystem + shell), gated by the session's "I accept the risk" acknowledgement — but previously only the most-powerful one was flagged, so "Current" and "All" looked sandboxed when they are not. The two project-scoped options now read **"Current (host)"** and **"All (host)"** (alongside **"⚠️ Host"**), and the scope tooltip spells out that these run on your host (not in a Docker sandbox) and are gated by the risk acknowledgement. No behavior change — just clearer, safer labelling of an existing control.
- **The right-sidebar chat agent can now work autonomously toward a goal** (todo §5.0.1). Beyond replying to messages, a chat session can be handed a high-level goal and left to drive itself: it plans with a focus chain, then works turn after turn using its gated tools (read/board/command/browser, per the session's scope) until the goal is done, it needs your input, or a safety budget trips. Start it from the new **goal field + "Auto" button** above the chat composer; a compact status line shows live progress (working · N/M steps) and the final outcome (goal complete · turns, needs-your-input, or a budget/no-progress stop). The run is bounded by the same swarm guardrails as autonomous task cards (max turns, wall-time, and a no-progress stall guard), and its turns stream into the transcript as it works. Two new control tools let the agent pause for a genuine question (`request_user_input`) or declare the goal done (`declare_goal_complete`).
- **The Settings dialog's cluttered "General" section is split into a lean General + a new "Agents" group** (todo §5.W). The agent-execution settings that were buried in General now live together under a dedicated **Agents** nav entry: Docker sandbox isolation + status, the sandbox-isolation pool (containers / agents-per-container / memory / CPU), the lost-heartbeat policy, decomposition auto-apply, second-opinion review, the local swarm guardrails, advanced policy visibility, and the per-role agent rulesets. **General** now holds just Developer Mode and the Advanced diagnostics. This is the first step of a broader settings regroup-by-concern; the other sections (Tasks, !Klein, Git Prompts, Notifications, Appearance, Project) are unchanged for now.
- **Decomposing a project no longer fails when a small model omits the `title` field** (fix). Live-testing the decompose pipeline with a local 8B model revealed it would correctly read the spec and call `decompose_project` with a valid `slug` and tasks — but omit `title`, a required field — and the tool would reject the whole call, forcing the model into an error/retry loop that often spiraled. Now a missing `title` is **recovered from the `slug`** (the task graph already used the slug as its title fallback), so the decomposition proceeds. This follows the project's "parse-and-recover, don't re-prompt" principle for weak-model output, and matches the boundary schema's stated intent of tolerating an omitted title.
- **The board UI stays responsive when several agents run in parallel** (fix). A running agent streams a high-frequency feed of activity frames (reasoning deltas, tool calls) over the runtime WebSocket, and the web-ui applied each frame as its own state update — so with multiple cards running at once, the React tree re-rendered hundreds of times per second and the board went sluggish, almost unresponsive. The runtime state stream now **coalesces incoming frames into a single batched update roughly every 100 ms** (project switching stays immediate), so the UI updates at most ~10×/second no matter how many agents are streaming — no activity is dropped, only the render storm is throttled. (Surfaced by running several dev-test projects in parallel: a single project alone emitted ~14.7k frames.)

- **Git repository lookups no longer block the runtime under heavy load** (fix, todo §5.AI). Resolving a workspace's git root — done on every workspace read and write, including every board update an agent makes — used a *synchronous* git subprocess that blocked Node's event loop the entire time git ran. Under heavy parallel agent load (where agents flood the machine with their own git and `docker exec` subprocesses), each lookup could stall the **whole runtime** for seconds, and a CPU profile of the hang showed the runtime sitting *idle but blocked* inside that child process. The hot-path lookup now runs **asynchronously**, so a git call never freezes the event loop. This is the deeper root cause behind the project-list freeze fixed below; the change is targeted (the function's signature is unchanged, so nothing downstream had to change, and there's no caching and thus no staleness risk).
- **The board no longer freezes for tens of seconds when several agents run in parallel** (fix, todo §5.AI). Under heavy parallel agent load the runtime's project-list endpoint — which feeds the sidebar's per-column counts and the live activity badges — could hang for **40–60 seconds**, freezing the UI (the server-side half of the "sluggish with 2 projects" report). Root cause, pinpointed with a CPU profile: the runtime recomputed per-project **health diagnostics** (git/filesystem scans) *synchronously on the hot path* — on every project-list build and every live-state broadcast — and those scans **contend with the agents' frequent workspace writes**, so under parallel load they ballooned from milliseconds to tens of seconds. Health issues change rarely (they reflect project structure), so they're now **cached and refreshed in the background**; the project list serves the cached value and never blocks on the scan. Measured under a 2-agent load: the project-list response dropped from **41–60 s to ~0.2 s** (~270×). (A `--cpu-prof` showed the runtime ~100% *idle* during the hang — it was a blocking async wait, not CPU saturation — which corrected an earlier wrong hypothesis about offloading work to worker threads.)
- **The project sidebar now shows live agent activity per project, so you can watch parallel work without switching boards** (todo §5.AI). Previously the only per-project signal in the sidebar was static task counts (how many cards sit in each column) — to see whether agents were actually *working*, you had to switch into each board one at a time. Each project row now carries a live activity badge: a **pulsing green "N running"** when agents are executing on a model right now, or a **steady gold "N queued"** when agents are waiting for sandbox/model capacity (which also surfaces the per-model concurrency bottleneck at a glance). A running badge appends the queued count (e.g. `2 running +1`). The badge updates live as sessions change state — it rides the same per-project broadcast that already streams the task-count badges — so the whole system's activity is visible from wherever you are. When agents are queuing (the visible symptom of a serial endpoint), the badge's tooltip also explains the cause and fix — local model endpoints like LM Studio often process requests serially, so true parallel LLM work needs the endpoint's own concurrency raised (plus !Klein's per-model concurrency).

- **The runtime-served app is now protected by a Content-Security-Policy header** (security, todo §5.Y #12). The CSP locks scripts to `'self'` only — the key XSS containment win — while allowing the inline styles React and Tailwind require, the same-origin WebSocket connection (`ws:`/`wss:`), `data:` URIs for the SVG favicon and embedded fonts, and `blob:` image URLs. `object-src 'none'` and `frame-ancestors 'none'` close out plugin and framing vectors. To make `script-src 'self'` viable without a nonce, the service-worker registration script (previously an inline `<script>` block in `index.html`) was moved into `main.tsx`, so the built HTML contains no inline scripts at all. Verified by loading the built app **with the CSP header actually active** (not just a header-less preview), confirming a clean render with zero CSP violations.

- **Error telemetry no longer ships a hardcoded reporting endpoint** (fix). The browser and Node Sentry integrations contained hardcoded DSNs (inherited from the upstream fork), so !Klein silently sent error reports and session replays to a third-party Sentry account that is not !Klein's. The DSN is now read from the environment — `VITE_SENTRY_DSN` for the web app, `NKLEIN_SENTRY_DSN`/`SENTRY_DSN` for the runtime — and when unset (the default) Sentry stays completely inert: no init, no outbound connection, no telemetry leaves the machine. (This matches how PostHog was already gated, and keeps the new CSP's `connect-src` tight by default.)

- **The task-start onboarding carousel no longer streams inherited demo videos from an external host** (fix). Those clips were also a fork inheritance and loaded from external signed URLs (GitHub user-attachments → `*.s3.amazonaws.com`) that the new CSP intentionally blocks. The affected slides now render cleanly as title + description until !Klein ships its own self-hosted onboarding media.

- **The desktop shell now verifies the runtime via a cryptographic nonce before attaching the preload bridge** (security, todo §5.Y #10). Previously the desktop only checked whether `localhost:<port>` served a page with the `!Klein` title, which any local process could spoof. Now, when the desktop spawns its own runtime it generates a random nonce, passes it via `NKLEIN_DESKTOP_NONCE`, and the runtime echoes it on `GET /api/desktop-health`. The desktop verifies the echo matches before exposing `window.desktop` — a mismatch or missing response causes the attach to be refused. In packaged builds, attaching to a *pre-existing* runtime (one the desktop did not spawn) is also refused unless it passes the nonce check; dev builds fall back to the title-liveness check for pre-existing runtimes so the `nklein` dev server workflow is unchanged.

- **In remote (`--host`) mode, the chat `browse_url` tool now refuses navigation to internal/private addresses** (security, todo §5.Y #5). Previously the browser tool only validated that the URL scheme was `http://` or `https://` — no check on the destination — so a chat session with browser access could fetch loopback (`127.0.0.1`), RFC1918 (10/8, 172.16/12, 192.168/16), link-local (169.254/16, including the cloud-metadata endpoint `169.254.169.254`), CGNAT (100.64/10), and IPv6 equivalents, exposing internal services over SSRF. Now in remote mode: the hostname is resolved via DNS before navigation and the resulting IP is checked against those blocked ranges; literal IP addresses are caught directly without DNS; and after any redirects, the final URL's host is re-checked so redirect-to-internal is blocked too. **Local/loopback mode is unchanged** — internal addresses are allowed so the "agent verifies the local dev server it just started" use case works. A per-session opt-in override is a possible follow-up.

- **In remote (`--host`) mode, `runtime.runCommand` and `runtime.openFile` now refuse with a clear error** (security, todo §5.Y #2 + #9). Previously both endpoints were callable by any authenticated remote browser — `runCommand` would execute an arbitrary shell command on the server host (with `shell:true` + the full host environment), and `openFile` would ask the host OS to open any file, directory, URL, or protocol handler. Neither action is meaningful for a remote client (they would run on the server, not the user's machine). Both procedures now immediately return FORBIDDEN with the message "Host-local action unavailable in remote mode — runs on the server host, not your machine." **Local/loopback mode is completely unchanged** — editor-open and artifact-open continue to work as before. A richer typed-intent redesign (replace raw shell/open with `openWorkspace({targetId})` + an allowlist) is the noted follow-up.

- **In remote (`--host`) mode, project browsing and creation are now confined to allowed directories** (security, todo §5.Y #8). Previously, the folder picker and `addProject` API used the filesystem root (`/`) as their base, letting an authenticated remote user enumerate the entire host directory tree and `git init` projects anywhere. Now, in remote mode, `listDirectoryContents` and `addProject` are confined to an **allowed-roots set** — the user's home directory and the configured workspace base dir (Settings → "Workspace base directory" / `NKLEIN_DEV_WORKSPACE_DIR`). Any path that resolves outside every allowed root is rejected with a clear error. The folder picker's starting root is also narrowed to the home directory instead of `/`. **Local/loopback mode is completely unchanged** — full access is preserved when `--host` is not used.

- **Remote (`--host`) mode now requires HTTPS by default, and disabling its passcode takes an explicit dangerous flag** (security, todo §5.Y #7). Previously, binding !Klein to a non-loopback address (`--host <ip>`, which makes it reachable from other machines) silently fell back to **plain HTTP** when no TLS cert was given — so the access passcode, the session cookie, and all traffic crossed the network in **cleartext** — and `--no-passcode` would expose the entire runtime API, *including host actions*, with no authentication. Now a non-loopback bind **refuses to start** over plain HTTP, with a clear error pointing to `--cert`/`--key`; if you genuinely sit behind a trusted TLS-terminating reverse proxy you can opt out with the new `--insecure-remote-http` flag (which prints a prominent cleartext warning). Separately, `--no-passcode` on a non-loopback bind now **also** requires the new `--dangerously-disable-remote-auth` flag and prints a prominent "API exposed unauthenticated" warning. **Local/loopback runs (the default `nklein`) are completely unchanged** — no TLS requirement, and `--no-passcode` there behaves exactly as before. When TLS is on, responses now also send a `Strict-Transport-Security` header.

- **You can now browse and start any of the 47 registry dev-test projects from the UI** (todo §5.X). The Dev Test Scenarios panel in developer mode now includes a collapsible **Registry** section with a search box and all projects grouped by tier. Each row shows the project title, its domain tags, and a **Start** button that creates the project and starts its seed card — the same flow as the four legacy preset buttons, which remain unchanged for back-compat.

- **A corrupt config file no longer silently loses your settings** (fix). When `config.json` existed but contained invalid JSON (e.g. from a partial write or manual edit), the config loader treated it the same as a missing file — returning defaults, then overwriting the file on the next save, permanently destroying the user's preferences. Now the two cases are distinguished: a missing file still returns defaults silently (normal first-run), but a file that exists and cannot be parsed is diagnosed with a clear message, and the original bytes are preserved in a timestamped `.corrupt-<timestamp>.bak` sibling so nothing is lost.

- **A model's context window is re-detected when it changes** (fix). When a model was reloaded/reconfigured with a different context window (e.g. in LM Studio), !Klein kept showing the old size: the model registry's effective window is `userOverride ?? observed ?? advertised`, and a previously **auto-observed** value (measured against the *old* window) masked the new **advertised** size — so the change went undetected. Now a changed advertised window clears the stale auto-observation (a user override stays, since it's intentional), so the new size takes effect immediately.

- **`modelRoles` can now be overridden per-project** (backend, todo §5.W Phase 1). Projects can set a `modelRolesOverride` in their project config to customize which model handles each role (`worker`, `architect`, `reviewer`, …) without changing the global default. The effective value (`effectiveModelRoles = override ?? global`) is what all routing and role-assignment consumers use — task start, decomposition plan application, acceptance repair escalation, second-opinion review, and dev-test board seeding. Telemetry role-classification stays on the global `modelRoles`. UI controls are a separate follow-up.

- **You can now expand a plan task into replacement tasks from the card's detail panel** (todo §5.W). Planning-lane cards now show a collapsible **"Expand plan task"** section. Fill in a replacement task list (title, prompt, and acceptance command for each entry — at least two required) and click **"Apply expansion"** to split the target plan task in the saved plan DAG via the new `runtime.expandNKleinPlanTask` tRPC mutation. The server infers which plan and which task ID to replace from the board card's ID (or accepts them explicitly), then writes the updated task graph and appends a revision entry. This is the UI path for what the `nklein task expand-plan-task` CLI command has done all along. Agent-proposed expansions (path 2a — where the model writes proposed replacements as a discoverable artifact and the panel simply shows them for approval) can layer on later once that artifact type exists.

- **You can now report a plan gap directly from a card's detail panel** (todo §5.W). Planning and review cards now show a **"Report a plan gap"** section with a kind selector (missing decision, contradictory requirement, missing dependency, scope too large, integration needed, other), a description field, and an optional evidence field. Submitting calls the new `recordNKleinPlanGap` tRPC mutation, which records a telemetry observation, appends a revision to the plan artifact if this task belongs to a known plan, and for the card-creating kinds (missing decision, contradictory requirement, scope too large, integration needed) automatically adds a companion Planning card to the board — the same logic the `nklein task plan-gap` CLI command has used all along, now surfaced in the UI.

- **You can now manage a card's dependencies without drag-and-drop** (todo §5.W). A new **"Manage dependencies"** button (link icon) appears on hover for every non-trash card — on the main board and in the detail-panel sidebar. Clicking it opens a dialog: pick any other card from a dropdown to add a link, or remove an existing link with one click. Direction is resolved automatically by the same board logic that already handles drag-to-link, and any invalid link shows the usual rejection toast.
- **Project workspaces that !Klein creates can no longer land inside *any* git repository** (safety hardening). When !Klein scaffolds a workspace (e.g. a dev-test fixture project), it `git init`s and commits into it — and if that workspace was created inside an existing git work tree, those commits could land on the dev repo's branch (a real incident replaced the working tree with a fixture and even flipped `core.bare`). Created workspaces are confined to a safe base **outside** any repo: a user-configured path (`NKLEIN_DEV_WORKSPACE_DIR` / the Settings field) or a home-directory default (`~/.nklein/dev-workspaces`). The guard is now **git-aware**: a candidate is rejected not only if it sits at/below the install's parent folder, but if it sits inside **any git work tree at all** (checked by walking up for a `.git`). This is location-independent — it catches the !Klein repo and every `.claude/worktrees/*` checkout no matter where the code runs from, which the old "below the install's parent" check missed when running from inside a worktree. An unsafe requested/configured path is refused and redirected (reason surfaced), and the scaffold has a hard backstop that refuses to `git init` inside an existing work tree.
- **The local Python core (`core-py`) now starts automatically** (todo §5.H). The Python sidecar — which gives small/quantized local models grammar/JSON-schema **constrained decoding** and local embeddings — is on by default, but until now nothing launched it, so it silently fell back to the in-process path unless you ran it by hand. The runtime now auto-starts it on boot (when enabled and not already running) and stops it on shutdown. It's **non-fatal**: if `core-py`/`uv` isn't available, or the sidecar doesn't come up, the runtime logs a note and works exactly as before (instant in-process fallback) — and starting it never blocks boot. Set `NKLEIN_CORE_PY=0` to opt out.
- **Every started card now goes through a Planning / Refinement pass before it implements anything** (todo §5.B). Starting a task no longer drops it straight into In Progress — work cards and decompose cards alike first enter the **Planning** lane, where the agent re-validates the card against the *current* state of the project (what's been merged or changed since it was planned) so it never works an out-of-date plan. It picks the depth itself: a quick confirmation when nothing moved, an adjusted approach when the direction shifted, or a full `decompose_project` re-split when the card is badly outdated or too big. When the plan still holds (or after updating it) the agent calls the new **`begin_implementation`** tool to move the card from Planning to In Progress and then build it. An explicit tool — rather than guessing the transition — is the robust choice for small local models, and the single shared entry lane is honoured by every start path (start, queued-start drain, and auto-start of dependency-linked cards), while resuming a card already in In Progress or Review is never pulled backward. And because a small/weak model may skip that explicit step and just start editing, a work card that begins **mutating the repo** (writing files or running a build/test command) without first calling `begin_implementation` is **auto-promoted** to In Progress on its first such action — so the lane reflects reality even when the model never drives the transition itself (the same parse-and-recover principle !Klein uses for narrated tool calls; idempotent and one-shot, and a board hiccup never blocks the agent's actual work).
- **Project Settings is now one click away, and a few runtime settings are better organised** (todo §5.W). The active project in the sidebar now shows a **gear** that opens its Project Settings directly (the action also stays in the project `⋯` menu) — previously the dialog existed but was easy to miss. In runtime Settings, the parallelism cap (**Max concurrent tasks**) gets its own "Swarm Parallelism" card under Tasks, and the agent write-guard (**Max writable file lines**) plus the destructive **card-replay** toggle move into a clearly-labelled "Advanced" card (replay is no longer buried in Developer Mode) — so these controls are grouped by concern instead of scattered with raw field names.
- **You can now set the base directory where !Klein creates new workspaces, in Settings** (todo §5.W). The safety rule that keeps created workspaces (dev-test projects, scaffolds) out of the !Klein install folder was previously configurable only via the `NKLEIN_DEV_WORKSPACE_DIR` environment variable; a new **"Workspace base directory"** field under Settings → Tasks now lets you set it from the UI (leave it blank for the `~/.nklein/dev-workspaces` default). The value is honoured by every workspace-creation path — the in-app "create dev-test project", the runtime smoke-eval, and the `nklein dev` CLI — and an unsafe path is still redirected automatically.
- **The chat sidebar's contents now reflow as you drag its width, and each chat in the list is labelled with real metadata** (todo §5.M). Previously the session list was a fixed width and the inner panes (header inputs, transcript, message bubbles, composer) didn't shrink with the rail — long content overflowed when you narrowed the sidebar. Now the session list scales proportionally within sensible bounds and every level can shrink, so nothing spills. And instead of every chat reading the same literal "New chat", each row shows when it **started**, how many **messages** it has (for the open session), and its **last activity** (e.g. "Started Jun 25 14:32 · 4 msgs · Last Jun 25 15:01"). (A generated title and a token count are still to come — the token total needs per-session usage tracking the chat schema doesn't carry yet.)
- **The `nklein chat --workspace` agent can now see the project's kanban board** (todo §5.M, board awareness). A new read-only **`get_board`** tool returns a compact, path-free summary of every column and the cards in it (id + title), so the agent can reason about the existing tasks before it discusses or works on them — the read half of "use the project/card/task structure." It's a safe `sandbox_read` action (always allowed by the execution-mode gate, like the file read tools) and never surfaces the project's on-disk path. (Running commands, board mutations, and the web-UI agent's tool loop are the next steps in the capability-coverage build.)
- **The `nklein chat` agent can now run shell commands** (todo §5.M G2). With `--workspace --allow-commands`, the agent gets a **`run_command`** tool — it can build, run tests, or execute the program and read the result (exit code + stdout + stderr), so it can actually *verify things work at runtime* instead of only reading and writing files. Output is capped and each command has a wall-clock timeout. It honors the §5.M host-access invariant: a command is **never** run silently — `--allow-commands` elevates the session to the host-capable mode where every command is **confirm-prompted and audit-logged** (and it's denied outright in the default isolated-read-only mode). Verified end-to-end against a live local model (the agent ran a command and read its output).
- **The web-UI right-sidebar chat agent can now read your project and see the board** (todo §5.M G3a). Until now the right-sidebar chat did a plain completion with **no tools** — only the `nklein chat` CLI agent could use any — so the agent you actually talk to couldn't open a file or look at the kanban board. When a project is active, the sidebar chat now runs through the same tool-using agent loop with the **read-only** tools `read_file` / `list_dir` / `get_board`, so it can read source and reason about existing cards before it answers. These are all safe `sandbox_read` actions (always allowed, no confirmation), and paths stay workspace-relative so no host path is ever exposed. With no active project the chat stays on the plain path exactly as before. Streaming is **hybrid**: a turn that uses no tools still streams the reply token-by-token. The agent is now **scope-driven**: every session also gets a **focus chain** (`update_focus_chain` — a self-maintained checklist re-anchored into each turn so a small model stays on-plan), and a non-read-only scope can **create board cards** (`create_card`, a gated control-plane action) — so the agent can plan its work and add tasks autonomously, not just read. The session scope is the control, and you pick it from a **scope selector in the session header — `Chat only · Current · All · ⚠️ Host`**: **chat-only** is the read-only floor (no mutations), current / all-projects act on the project(s), and host grants host access (shown with a ⚠️ and gated server-side; a global "allow host" setting + typed confirmation are still to come). In a can-act scope the agent can also **run shell commands** (`run_command`): a command the allowlist **safe/unsafe classifier** rules **safe** (build, tests, inspection) runs automatically, while an **unsafe** one is **denied** for now — until you grant a risk acknowledgement (the general-ack toggle, which then passes responsibility for unsafe commands to you, is the remaining step).
- **The chat now draws the plan graph a decomposition proposed** (todo §5.B). When the agent calls `decompose_project`, its tool message renders the proposed task graph as a small visual **DAG** — one node per card (title + id), edges for every `dependsOn`, laid out in dependency layers (roots on top, flowing down) — and it's expanded by default so you see it without clicking. It renders the graph **even when the decomposition failed validation** (with a red "failed validation" header), so you can finally *see* what the agent proposed and where the missing/odd dependency edges are instead of reading raw JSON. No new dependencies (a tolerant parse + a layered SVG, defensive against cycles, self-edges, and dependency ids that aren't cards).

- **The web-UI chat session now has a "Allow unsafe commands" risk toggle** (todo §5.M G3b). When a session scope is `Current`, `All`, or `Host`, a small toggle appears in the session header. Turning it **on** requires an explicit `AlertDialog` confirmation (title "Allow unsafe commands?", a description of what it grants, and a red "Allow unsafe commands" action) — only confirming calls `updateSession` with `riskAcknowledged: true`. Turning it **off** is immediate with no dialog. The toggle is hidden for `Chat only` scope (no commands are runnable there anyway).
- **The chat agent can now browse the web, behind a per-session toggle** (todo §5.M G6). When you enable the new 🌐 **"Enable browser"** toggle in the session header (shown for `Current` / `All` / `Host` scopes, next to the unsafe-commands toggle), the agent gets a **`browse_url`** tool — a headless **Chromium** (Playwright) that opens an http/https page and returns its title + readable text, so the agent can read documentation, look something up, or verify a web page actually works. Browsing is a **host action**, so it's off by default and orthogonal to scope: it's denied in `Chat only` (the read-only floor), and in a can-act scope each navigation is audit-logged — the toggle is your consent. Errors never surface a stack trace or host path. The CLI has parity via `nklein chat --workspace <dir> --browser` (each navigation is confirm-prompted). Verified end-to-end against a live local model: the agent opened a real page in a real headless browser and reported its content.

- **Model roles and agent rulesets can now be overridden per project in Settings** (todo §5.W Phase 1b UI). The Settings → Project "Per-project overrides" card now has two additional rows: **Model roles** (shows how many roles are customised globally, or "defaults"; clicking "Override for this project" seeds the editor from the effective global value and shows the same multi-role editor used in the global NKlein section) and **Agent rulesets** (shows the current global capability/delivery preset summary; seeded from the effective global). Both use the same override-row pattern as the existing concurrency/agent rows. Save sends `modelRolesOverride` and `agentRulesetsOverride` (non-null when overridden, `null` to inherit) to the runtime, which already persists and enforces them end-to-end.

- **Per-project overrides for agent and concurrency are now editable in Settings** (todo §5.W Phase 1 UI). The Settings → Project section now has a "Per-project overrides" card with two controls: **Max concurrent tasks** (number input, mirrors the global field's style) and **Agent** (native select from the available agents). Each control shows its current state — "Inherits global: `<value>`" with an "Override for this project" button when not overridden, or the editing control plus a "Revert to global" button when overridden. The card is disabled (shows a note) when no project is selected. Saving sends `maxConcurrentTasksOverride` and `selectedAgentIdOverride` (value or `null`) to the runtime, which already persists and enforces them end-to-end.

- **The active agent can now be overridden per project** (todo §5.W Phase 1, second field). The global "selected agent" stays the default; a project that should run on a different agent can set `selectedAgentIdOverride`. When set, `effectiveSelectedAgentId` resolves to the override; otherwise it inherits the global. Core runtime consumers (agent command resolution, model-registry discovery) now use `effectiveSelectedAgentId` so a project override is honoured end-to-end. API contract exposes both fields.

- **Agent rulesets can now be overridden per project** (todo §5.W Phase 1, third field). The global `agentRulesets` stays the default; a project can set `agentRulesetsOverride` (persisted to its own project config file). When set, `effectiveAgentRulesets` resolves to the override; otherwise it inherits the global. The two runtime consumers in `runtime-server.ts` (delivery-tier resolution and sandbox network policy) now use `effectiveAgentRulesets`. The override normalises to `null` when it deep-equals the default (keeps the project config clean). UI editor is a separate follow-up.

- **Max concurrent tasks can now be overridden per project** (todo §5.W Phase 1, first field). The global "max concurrent tasks" cap stays the default; projects that need a different limit — e.g. a heavy multi-agent repo that should run fewer parallel tasks, or a small utility project that can run more — can now set their own `maxConcurrentTasksOverride`. When a project override is set the runtime enforces `effectiveMaxConcurrentTasks = projectOverride`, otherwise it falls back to the global value. API contract exposes both `maxConcurrentTasksOverride` (nullable, project-scoped) and `effectiveMaxConcurrentTasks` (always resolved).

- **A started card no longer keeps showing agent activity while it sits in Backlog** (real follow-up to the earlier start-lane fix). Starting a task is supposed to move its card out of Backlog into its working lane (Planning / In Progress), but the reconcile only ran *synchronously when start returned* — and a freshly-started task (e.g. a dev-test decompose seed whose Docker sandbox is still provisioning) is usually still **queued/starting** at that moment, so the move was a no-op and the card stayed in Backlog while the agent ran. The lane reconcile now also fires the instant the task's session **transitions to `running`** (in the runtime state hub), and broadcasts the board so the UI updates — so a card never shows live agent work behind it in Backlog. The reconcile is now one shared, idempotent helper used by both the start path and the running-transition path.

- **The code-intelligence panel no longer spams a "Could not load code intelligence status: Failed to fetch" error toast.** The sidebar's code-intelligence status is a best-effort background panel, but a transient runtime-fetch failure (the runtime briefly unreachable at startup or during a blip) raised a red danger toast — and because the panel's error callback was a fresh closure on every parent render, its fetch effect re-ran (and re-toasted) on **every render**, so the toast spammed. The panel now: fetches only on mount + when the project changes (a stable effect, no per-render refetch); treats a failure as a quiet inline **"Status unavailable"** line with **no toast**; and self-heals a transient blip with a few backed-off retries (2s/4s/8s) that are capped, so a runtime that is genuinely down never produces a retry storm.

- **DeepSeek models' tool calls are now recovered when narrated as text.** !Klein already recovers a tool call a weak/quantized local model "narrates" as text instead of emitting structurally (Hermes/Qwen `<tool_call>`, Mistral `[TOOL_CALLS]`, Llama `<|python_tag|>`, Functionary `<function=…>`, etc.), but **DeepSeek-V3/R1's native format wasn't covered** — it uses special tokens and puts the tool name *outside* the JSON (`<｜tool▁call▁begin｜>function<｜tool▁sep｜>NAME ```json {…} ``` <｜tool▁call▁end｜>`), so a DeepSeek model that narrated a call would stall the turn. That format is now parsed (the special-token form and the ASCII-normalized `<|tool_call_begin|>` variant some GGUF quantizations emit, single or multiple calls, fenced or unfenced args, truncated end token), so DeepSeek models drive the agent loop like the other families.

- **A decomposition that keeps failing graph validation now parks for review instead of looping.** The repeated-identical-tool-call guard only catches a model that resubmits the *exact same* input; a small model instead re-submits a slightly-varied task graph that keeps failing the same coherence check, slipping past it and looping until the task stalls. The repeated-failure-target guard (which already parks after 4 failed attempts at the same plan-artifact path) now also covers `decompose_project` — fingerprinted by the tool, so 4 consecutive graph-validation failures park the task (with a message pointing to the proposed plan graph + the validation errors now visible in the chat) rather than spinning forever.

- **Decomposition no longer loops forever on an implementation card whose prompt mentions tests.** The plan-graph quality check enforces that a *test* card must depend on the implementation it verifies — but it was classifying cards as "test"/"docs" from the whole prompt body, so an **implementation** card like *"Implement TempoMap class with PPQ-based timing … ensure compatibility with timebase.test.js"* (touching `src/timebase.ts`) was flagged as a test card with an impossible-to-satisfy "must depend on an implementation card" violation. The decomposer kept re-submitting against that contradiction until it stalled. Classification now keys off the card's **title and the files it touches** (its identity), not the cross-cutting "keep tests passing" / "golden tests" instructions in the prompt body — so implementation cards stay implementation cards while genuine test cards (titled about testing, or touching only `*.test.*`/`*.spec.*`/`tests/` files) are still required to depend on what they verify.

- **Trash now sits below Completed** instead of taking a full sixth board column — it's stacked under Completed in the same slot at about a fifth of the height, freeing horizontal room for the active lanes.

- **Starting a task now moves its card out of Backlog** (into Planning or In Progress) on the server, so the board always reflects that the agent is working — a card no longer sits in **Backlog** while its agent runs. Previously only sending follow-up input (or resuming) reconciled the lane, so a task started without the web-ui's own optimistic move (e.g. a dev-test seed started programmatically) stayed in Backlog with live agent activity behind it.

- New **`nklein chat`** command — a first, board-independent way to talk to a unified chat agent on a loaded local model (todo §5.M). It discovers the loaded model from your local endpoint (LM Studio / Ollama; `--model`/`--base-url` to override), keeps a persisted session you can continue with `--session`, accepts a standing `--goal` kept in focus across turns, and recalls relevant long-term memories into each reply — all local, fail-closed against cloud. This is the simple-completion entry point; the tool-using multi-turn agent, streaming, and a chat UI build on top of it.

- **Chat is now in the app** (todo §5.M), as a **resizeable right sidebar** (a VS-Code-coding-agent-style rail): board-independent chat with a loaded local model — a session list (create / select / delete), the conversation, and a composer. Collapses to a thin bar (and back) and drags wider via its left edge; the width + collapsed state persist. The assistant's reply **streams in token-by-token**, and each session has an editable header (title, role, scope, and a standing goal kept in focus across turns). Every session keeps its own persisted transcript and recalls relevant long-term memory into replies — all local, fail-closed against cloud.

- **`nklein chat --workspace <dir>`** makes the chat agent tool-using (todo §5.M). With a workspace, the model is offered read-only file tools (`read_file` / `list_dir`) and answers from the actual project files instead of guessing — the agent calls a tool, !Klein runs it, feeds the result back, and repeats until it answers (both single-message and the interactive REPL, which shows which tools each turn used). Adding `--allow-write` also offers a `write_file` tool, but every write is **confirm-prompted** (a `y/N` you must approve) before it runs — so a mutating action never happens silently. Every tool call (run or refused) goes through the per-action policy gate and is recorded to the host-action audit log; the tools are confined to the workspace (absolute paths and `..` escapes are refused) and the agent only ever sees workspace-relative paths.

- An **empty board now explains itself** instead of showing six blank columns (todo §5.A). When a project is loaded but has no cards, a banner under the swarm header invites you to **create your first task** with a one-click CTA — and if Docker agent isolation is unavailable, it shows an **"Isolation unavailable"** marker (with the daemon/image failure reason) so it's clear why tasks couldn't start anyway.

- The board header now surfaces a **merge-status chip** for the dependency-ordered auto-merge (todo §5.G). When the swarm finishes a card it merges the ready task worktrees back in dependency order; each pass is now recorded durably (per workspace) and the swarm header shows the latest outcome — green **"Merged N"** on success or red **"Merge conflicts N"** when recent passes hit a conflict — with a hover tooltip listing the recent passes (timestamp, merged/skipped counts, or the conflict reason and path count). It refreshes when you switch projects and as running tasks complete. Previously merge results were only visible in CLI/integration output.

- Settings now shows a **Python core (core-py) health line** under the !Klein model panel (todo §5.H): whether the local ML sidecar is enabled, running/not-reachable (a live `GET /health` probe), and its endpoint — with a hint to set `NKLEIN_CORE_PY=1` when it's disabled. Previously the `probeKleinCorePyHealth` helper existed but was never surfaced.

- The swarm can now run **multiple agents in parallel on one model** when you tell it the model's capacity (todo §5.T). Each model in the Model Performance registry (Settings → !Klein, and the agent chat model panel) gets a **"Parallel requests" field** to set its per-model concurrent-request capacity (e.g. to match LM Studio's per-model concurrent-requests setting); the endpoint scheduler, which previously serialized one task at a time per shared local endpoint, now allows up to that many concurrent sessions before holding the next start (with a "shared endpoint is at its N concurrent-request capacity" note). The default stays 1, so behavior is unchanged until a capacity is set.

- The **local swarm guardrails** (autonomous turns per task, autonomous wall-time, repeated no-diff checkpoints, repeated identical tool calls) are now **editable from Settings** instead of fixed constants (todo §5.T). The "Local swarm guardrails" section turns the four per-task limits into number inputs (wall-time in hours) with a **Reset to defaults** button; the limits persist in the runtime config (`swarmGuardrails`) and are honored by the autonomous-run watchdog at every turn checkpoint. They fall back to the same defaults as before (12 turns / 2 hours / 4 no-diff repeats / 3 tool-call repeats), and each value is clamped to a sane range (turns 1–1000, wall-time 1 minute–7 days, no-diff 1–100, tool-calls 2–100) so a typo can't disable a guardrail — an out-of-range entry shows an inline hint and is clamped on save.

- Restored the codebase-orientation **repo map** for Docker-isolated tasks (todo §5.A). The runtime injects a compact "repo map" (a PageRank-ranked, workspace-relative symbol outline) into the agent's context so it can navigate the project without blindly reading files — but under strict isolation it had gone silently empty: it was being built from the agent's sandbox working directory (`/workspaces/<taskId>`), which doesn't exist on the host, so every isolated task ran with no orientation. The map is now built host-side from the project root (a trusted-runtime read that emits only workspace-relative paths, no host leak) while the agent's own perceived working directory stays the sandbox path. Verified live (the orientation rail is injected again, with zero host-path leakage).

- A Docker-isolated agent is no longer told the **host** filesystem path as its working directory (todo §5.A HARDEN; the primary "agents must never see host details" leak). The agent's system prompt carries an `<env>` block whose "Working Directory" line is rendered from the cwd we pass — and while the agent-core `config.cwd` had been switched to the in-container sandbox path (`/workspaces/<taskId>`), the system prompt was still built from the host mount path. So a sandboxed planning/worker agent read its own system prompt, saw e.g. `Working Directory: /private/var/folders/…/T/nklein-…`, and then issued `read_files`/`list_files` against those host absolute paths. Both surfaces now derive the working directory from one shared helper (`resolveNKleinAgentPerceivedCwd`) so they can never drift again: a real task always perceives its sandbox workdir; only non-sandboxed home/chat sessions keep the host cwd. Verified end-to-end with a new live harness (`scripts/verify-decompose-isolation.mts`) that runs a real decompose against LM Studio in a Docker sandbox and asserts nothing the agent emits contains the host path, plus a regression test that builds the real SDK system prompt and asserts it carries the sandbox workdir, never the host mount.

- A sandboxed planning agent no longer sees the host filesystem path in its `decompose_project` result (todo §5.A HARDEN, "agents must never see host details"). The tool's result is agent-facing, but it returned **absolute host paths** for the generated plan artifacts (`specPath`/`planPath`/`questionsPath`/`decisionsPath`/`revisionsPath`/`summaryPath`/`taskGraphPath`, e.g. `/private/var/folders/…/T/nklein-…/.nklein/nklein/plans/<slug>/spec.md`), embedded the host workspace path in a `--project-path <abs>` CLI hint, and could surface a host path inside an apply-error message. These now show the **workspace-relative** path (`.nklein/nklein/plans/<slug>/spec.md`), drop the `--project-path` argument, and redact the host mount path out of any interpolated error message. Host-side consumers (the runtime API / CLI / evidence bundles) still read the real absolute paths directly from the plan-artifact writer, unchanged. Locked by a regression test.

- Made the large-file reading workflow much easier for small models to drive: instead of composing opaque `read:`/`stitch:` cursors, the model now just triggers `read_large_file` with a path and calls it again with `cursor: "next"` (or no cursor) to advance through each chunk and stitching area. !Klein tracks the position and each result reports index/total progress ("Covered N of M lines", "Verified N of M stitching areas"). The previous explicit cursors still work for back-compat.

- Decomposition no longer stalls when a weak local model raises a clarifying question it can't resolve. Previously an `open` question with options but no default was rejected with "add an `assumption`", and small models often just re-sent the identical `decompose_project` call, looping until the task paused. !Klein now auto-supplies a sensible default from the question's recommended (or first) option so the plan proceeds; the question stays open for later clarification.

- Tasks and second-opinion reviews no longer intermittently fail with "Lock file is already being held" when several cards run in parallel. The on-disk lock (`proper-lockfile`) is a cross-process lock; using it to coordinate the many concurrent callers inside one runtime process (the swarm persisting board state) meant they raced it and, when a holder held longer than the retry window, threw `ELOCKED` — which surfaced as queued task-starts failing and second-opinion reviews being skipped. `LockedFileSystem` now serializes same-process callers through an in-process, re-entrant per-lockfile mutex first, so the file lock is only ever contended across processes. (Re-entrant: a nested lock on the same path from one call stack now proceeds instead of self-blocking.)

- Silenced the noisy per-call "System messages in the prompt … can be a security risk" log line. It comes from the external `ai` package (Vercel AI SDK) and was printed on every model call; !Klein passes system messages by design, so the runtime now logs the rationale once at startup and disables the SDK's per-call warning via its official switch.

- Model Performance now shows an exact, per-model rollup (todo §5.Q backend precision aggregate). The "By Model (global)" table is computed straight from the raw run observations on the server — keyed by **provider + normalized model id + canonical endpoint** — so its success rate **and** average run time are exact (no longer a roll-up of pre-averaged rows), and loopback endpoint spellings (`localhost` / `127.0.0.1` / `0.0.0.0` / `::1`) dedup into one row the same way the model registry keys them. The three identity normalizers (`normalizeProviderId` / `normalizeModelId` / `normalizeEndpoint`) are now a single shared `src/core/model-identity.ts` module used by the registry, the endpoint scheduler, and telemetry, so all three agree; the per-endpoint swarm serialization also picks up the loopback canonicalization (a model addressed as `localhost` in one card and `127.0.0.1` in another now correctly serializes against itself). The web-ui falls back to the previous client-side roll-up when talking to an older server.

- Deleted two `src/terminal/` modules orphaned by the agent-launcher removal (todo §5.A, increment 3 C7d follow-up): `session-state-machine.ts` (the agent `reduceSessionTransition` state machine — its only caller was the deleted `applySessionEvent`) and `output-utils.ts` (`stripAnsi` — only used by the deleted Codex prompt detectors). Zero references remained anywhere. `src/terminal/` is down to the live shell + config surface (8 files). Root tsc + biome + full fast suite (1300) green.

- Deleted the terminal-CLI **agent launcher** + its helper modules (todo §5.A, increment 3 C7d step 3b). `TerminalSessionManager.startTaskSession` (the PTY launch for Claude/Codex/Gemini/OpenCode/etc.) and everything only it used are gone: the workspace-trust auto-confirm, Codex deferred-startup/prompt detection, agent output-transition adapters, agent egress-restriction env, and the agent auto-restart machinery (`shouldAutoRestart`/`scheduleAutoRestart` + the `restartRequest`/`suppressAutoRestartOnExit`/`autoRestartTimestamps`/`pendingAutoRestart` entry fields). `ActiveProcessState` is trimmed to what the shell needs (`session`/`cols`/`rows`/`terminalProtocolFilter`). Deleted the 7 now-orphaned helper files — `agent-session-adapters`, `claude-workspace-trust`, `codex-workspace-trust`, `codex-hook-config`, `opencode-paths`, `hook-runtime-context`, `task-image-prompt` — plus 5 obsolete test files. `session-manager.ts` drops 940 → 427 lines. **Every remaining change to the shell path is a behavioral no-op** (it only removed agent-only branches that shell sessions never triggered): `startShellSession` and the shared lifecycle (`attach`/`writeInput`/`resize`/`stopTaskSession`/`recoverStaleSession`/pause-resume/`getRestoreSnapshot`/`hydrateFromRecord`) are intact and stay live for shell-on-task. Kept `agent-registry` (`detectInstalledCommands`/`buildRuntimeConfigResponse`, used by runtime-config + runtime-api) and `command-discovery` (`isBinaryAvailableOnPath`, used by `server/browser`). Root tsc + biome + full fast suite (1300) green.

- Removed the dead terminal task stop/input fallbacks + dead hook-driven manager methods (todo §5.A, increment 3 C7d step 3a). With the terminal `startTaskSession` path gone (step 2), `runtimeApi.stopTaskSession`/`sendTaskSessionInput` no longer fall back to `terminalManager` when there's no NKlein session (terminal/CLI agents are disabled under the local-only lockdown, so a missing NKlein session simply means the task isn't running). Deleted four `TerminalSessionManager` methods that had **zero remaining callers** — `transitionToReview`, `applyHookActivity`, `transitionToRunning`, `applyTurnCheckpoint` — they were driven only by the now-removed hook-ingest tRPC (step 1) and terminal turn-checkpoint path (step 2). The shared shell lifecycle (`startShellSession`, `attach`/`writeInput`/`resize`/`stopTaskSession`/`recoverStaleSession`/pause-resume, `getRestoreSnapshot`, `hydrateFromRecord`) is untouched and stays live for shell-on-task. Removed the two obsolete manager tests (hook-activity, turn-checkpoint). Root tsc + biome + full fast suite (1333) green.

- Removed the dead terminal-CLI-agent **`startTaskSession`** path from the runtime API (todo §5.A, increment 3 C7d step 2). The task-start handler branched on `effectiveAgentId` — an NKlein path (`nkleinTaskSessionService.startTaskSession`) and a legacy terminal path (`terminalManager.startTaskSession` + a host turn-checkpoint via `captureTaskTurnCheckpoint`/`applyTurnCheckpoint`) — selected by a `previousTerminalAgentId` (`terminalManager.getSummary`) / `body.agentId` / `selectedAgentId` resolution plus a persisted-NKlein-session probe (`rebindPersistedTaskSession`). Under the local-only lockdown terminal/CLI agents are disabled, so every task runs on NKlein: removed the terminal branch, the agent-id resolution, and the probe (`resumeFromTrash` is self-hydrated inside `startTaskSession` via `readPersistedTaskSession`, so no probe is needed); the active-task **concurrency** count now reads NKlein session summaries only (terminal agents no longer produce sessions). `terminalManager` is no longer touched by task-start — it remains live for **shell-on-task** (`startShellSession`) and the still-present stop/input fallbacks (removed next with the agent-path files). `resolveAgentCommand`/`captureTaskTurnCheckpoint` imports auto-pruned. Removed 6 obsolete terminal-path tests (host turn-checkpoint, terminal concurrency, persisted-session probe x2, CLI image-forwarding, non-NKlein OAuth-skip — all now covered by NKlein-path tests) and converted the chat-clear test to the NKlein path (asserting `resumeFromTrash` is forwarded). Root tsc + biome + full fast suite (1335) green.

- Removed the dead terminal-CLI-agent **hook-ingest** path (todo §5.A, increment 3 C7d step 1). The `nklein hooks` CLI (`ingest`/`notify`/`gemini-hook`/`codex-hook`) + `commands/hook-events/*` + the `hooks.ingest` tRPC procedure (`hooks-api.ts`) existed only so external terminal CLIs (Claude/Codex/Gemini/Kiro) could POST status back into the runtime — terminal/CLI agents are disabled under the local-only lockdown, and native NKlein agents report through their SDK session, so nothing called it. Deleted the CLI + its registration, the tRPC procedure + `createHooksApi` wiring, `parseHookIngestRequest`, and the `runtimeHookIngestRequest/Response` schemas (kept `RuntimeHookEvent`, still used by the legacy agent-session adapters pending C7d). Removed the now-obsolete hook tests. Root tsc + biome + full fast suite green.

- Removed the dead web-ui task-workspace-**info** store (todo §5.A, increment 3 C7e). The per-task host-worktree path/branch store (`taskWorkspaceInfoByTaskId` + `getTaskWorkspaceInfo`/`setTaskWorkspaceInfo`/`clearTaskWorkspaceInfo`/`useTaskWorkspaceInfoValue`/`toTaskWorkspaceInfo` in `workspace-metadata-store`) has been empty since the metadata monitor went home-git-only (C6a), so its readers always fell through. Removed it and its consumers — `App.tsx` navbar path/subtitle/hint (now use the review snapshot ?? project path; the "task workspace not prepared/cleaned up" hint is gone, irrelevant without host worktrees), `top-bar` git-status (uses the snapshot), the now-dead `selectedTaskBaseRef` prop threading, and `use-board-interactions` `clearTaskWorkspaceInfo` calls. The separate `taskWorkspaceSnapshot` (review/git summary) is kept. Zero behavior change for native NKlein tasks. web-ui tsc + biome + full vitest (683) green; live Playwright smoke renders the board with 0 console errors.

- Deleted the host-worktree **creation** machinery (todo §5.A, increment 3 C7c). With every consumer rewired (C1–C7b), `task-worktree.ts` is slimmed to its legacy **cleanup** surface — `deleteTaskWorktree` / `removeTaskWorktreeSetupLock` / `deleteTaskPatchFilesForRepo` (+ patch capture, used when deleting a legacy worktree with `preserveChanges`) — and the now-dead create/sync/symlink-mirror functions (`ensureTaskWorktreeIfDoesntExist`, `resolveTaskCwd`, `getTaskWorkspaceInfo`, `getTaskWorkspacePathInfo`, `mirrorIgnoredPath`, ignored-path/submodule/exclude helpers) are gone. Deleted `task-worktree-turbopack.ts` and the now-dead `runtimeWorktreeEnsureRequest/ResponseSchema` + `parseWorktreeEnsureRequest`. `task-worktree-sync.ts` is kept (still used by `nklein-trusted-auto-merge`). Removed the retired-behavior tests (worktree mirroring/turbopack/creation-lifecycle integration; the stream test's per-task-worktree-metadata blocks) and trimmed the unit test to the cleanup surface. Root + web-ui tsc + biome + full fast suite (1378) green.

- Removed the `ensureWorktree` and `getTaskContext` tRPC procedures (todo §5.A, increment 3 C7b). With the web-ui (C6b) and CLI (C7a) no longer calling them, the two worktree procedures + their `createWorkspaceApi` handlers + the `parseWorktreeEnsureRequest` usage are gone from the runtime boundary. `deleteWorktree` is retained (it backs `cleanupTaskWorkspace` on replay/trash and cleans up any legacy on-disk worktrees from pre-§5.A builds — a no-op for native NKlein tasks). This leaves `ensureTaskWorktreeIfDoesntExist`/`getTaskWorkspaceInfo` as dead exports (deleted next with the rest of the worktree creation machinery). Root + web-ui tsc + biome + full fast suite (1392) green.

- Retired the host-worktree plumbing from the `nklein task` CLI (todo §5.A, increment 3 C7a). `task start` prepared a host worktree via a `shouldPrepareLegacyHostTaskWorkspace`-gated `ensureWorktree` tRPC call (dead for native NKlein), and `task verify` (`runVerifyTaskAcceptanceCommand`) had a `resolveTaskCwd` + `runAcceptanceGate` host-acceptance branch that was never wired in production (the live path is the sandbox `verifyTaskAcceptance` tRPC). Removed the gated `start` block, the host-acceptance branch, the `shouldPrepareLegacyHostTaskWorkspace` helper, and the `resolveTaskCwd`/`runNKleinAcceptanceGate`/`usesLegacyHostTaskWorkspace` imports — acceptance always runs in the task's Docker sandbox, and `--workspace-root` (which referenced a host checkout) now errors clearly. With this the CLI no longer calls `workspace.ensureWorktree` or `resolveTaskCwd` (only the result-branch `task merge` and the `verifyTaskAcceptance` flag remain), clearing the gate for removing those tRPC mutations. Tests rewired to the sandbox verifier. Root tsc + biome + full fast suite (1392) green.

- Removed the web-ui's dead host-worktree prep scaffolding (todo §5.A, increment 3 C6b). The board kicked off tasks through a `shouldPrepareLegacyHostTaskWorkspace`-gated `ensureTaskWorkspace` (→ `ensureWorktree` tRPC) across four flows (start / resume-from-trash / replay / decompose), plus a `fetchTaskWorkspaceInfo` (→ `getTaskContext` tRPC) — but that predicate mirrors `usesLegacyHostTaskWorkspace`, **always false for native NKlein** (and terminal/CLI agents are disabled under the local-only lockdown), so the worktree prep never ran. Removed `ensureTaskWorkspace`/`fetchTaskWorkspaceInfo` (and the gated blocks, the `shouldPrepareLegacyHostTaskWorkspace` helper, and the obsolete saved-patch-warning test) from `use-board-interactions`/`use-task-sessions`/`App.tsx`; native NKlein tasks just start in their Docker sandbox. The web-ui no longer calls the `ensureWorktree`/`getTaskContext` tRPC at all (their backend removal is the next step). web-ui tsc + biome + full vitest (683) green; live Playwright smoke renders the board with 0 console errors.

- The workspace metadata monitor is now home-git-only (todo §5.A, increment 3 C6a). It polled a per-task host-workspace git summary for every *legacy-agent* card (via `getTaskWorkspacePathInfo` against a host worktree) — but native NKlein tasks were already never tracked (`collectTrackedTasks` skipped any non-legacy agent), and terminal/CLI agents are disabled under the local-only lockdown, so that path only ever ran for agents that can no longer exist. Removed the per-task tracking entirely (and the `getTaskWorkspacePathInfo`/`usesLegacyHostTaskWorkspace` imports + the `board` input the monitor no longer needs): the monitor polls only the project's home git summary, and `RuntimeWorkspaceMetadata.taskWorkspaces` is now always `[]` (kept in the contract for web-ui back-compat — it was already empty for every NKlein workspace). Root tsc + biome + full fast suite green.

- Removed the last host-worktree resolution from the runtime API (todo §5.A, increment 3 C5). `resolveExistingTaskCwdOrEnsure` resolved a task's host worktree, **creating one on miss** (`ensure: true`) — so `collectTaskEvidence` on a task with no result branch would silently materialize a host worktree. Both call sites now use the project repo path: task evidence is gathered there (a completed task's delta is its result branch; an in-progress task's work lives in its sandbox), and the legacy terminal `startTaskSession` (terminal/CLI agents are disabled under the local-only lockdown) runs at the project root. Deleted the helper and the `task-worktree` import from `runtime-api`. Root tsc + biome + full fast suite green.

- The workspace git-changes/summary handlers no longer touch host worktrees (todo §5.A, increment 3 C2). `loadChanges`, `loadGitSummary`, and `discardGitChanges` each resolved an optional task scope through `resolveTaskCwd` (a host worktree). With worktrees retired: `loadChanges` returns the task's result-branch diff (base → `nklein/tasks/<task>`) when present and an **empty** diff otherwise (an in-progress task's work lives in its sandbox; the host tree is untouched) — the legacy per-turn host-checkpoint diff (`selectLastTurnSummary` + the terminal/nklein checkpoint merge) is removed, since for a sandbox task the host working tree never reflects mid-run state; `loadGitSummary`/`discardGitChanges` operate on the project repo (a task has no per-task host tree to summarize or reset). This drops `resolveTaskCwd` entirely from `workspace-api` (the `ensureWorktree`/`deleteWorktree`/`loadTaskContext` surface is handled separately). Tests rewired to the result-branch behavior. Root tsc + biome + full fast suite green.

- The auto-complete delivery merge is now **result-branch-only** (todo §5.A, increment 3 C4). `mergeTaskWorktreesInDependencyOrder` — the dependency-ordered merge invoked on every task auto-complete — was already result-branch-first, with a host-worktree (`resolveTaskCwd` → `git rev-parse HEAD`) fallback for tasks without a result branch. With worktrees retired, that fallback can never produce a host-visible commit, so it's removed: a task with **no `nklein/tasks/<task>` result branch** is now cleanly **skipped** (nothing host-visible to merge) instead of reaching into a nonexistent worktree. Dropped the `resolveTaskCwd` injection and the `task-worktree` import from the merge module (it keeps its name; it remains the live delivery-merge path). Tests rewired off the worktree fallback (+ a new "absent result branch → skipped" case). Root tsc + biome + full fast suite green.

- Acceptance auto-repair is now **sandbox-only** (todo §5.A, increment 3 C3). The auto-repair check that re-runs a task's acceptance command before marking it ready had two paths: a worktree-backed host gate (`resolveTaskCwd` + `runAcceptanceGate`) and the Docker-sandbox verifier (`service.verifyTaskAcceptanceInSandbox`). The host gate was **never used in production** — the runtime hub only ever passes the scoped session service — so it was dead/test-only weight coupling auto-repair to the retiring worktree subsystem. Removed it: acceptance always verifies against the task's sandbox working copy, dropping the `resolveTaskCwd`/`runAcceptanceGate` injection points and the `task-worktree` import. The "acceptance unavailable" skip reason is renamed from `worktree_unavailable` → `acceptance_unavailable` (no external consumer reads it). Tests rewired to the sandbox verifier (+ a new "no verifier → skipped" case). Root tsc + biome + full fast suite (1393) green.

- Task **git-history (log / refs / commit diff)** now works for native NKlein tasks (todo §5.A, increment 3 C1). These three review handlers resolved the task scope through `resolveTaskCwd({ ensure: false })`, which **throws for a worktree-free nklein task** ("Task workspace not found") — so opening a task's git-history threw instead of showing anything. They're now result-branch-aware: a task's inspectable history is its `nklein/tasks/<task>` result commit, whose objects live in the **project repo's shared object DB**, so the log targets that commit and refs/diff resolve straight from the project repo path — no host worktree. (The main `loadChanges` diff and `collectTaskEvidence` were already result-branch-first; this brings log/refs/diff in line as the worktree subsystem is retired.) Root tsc + biome + full fast suite (1392) green.

- Shell-on-task no longer creates a host worktree (todo §5.A, increment 3 step 1): a task with an active Docker sandbox shells into its container via `docker exec` (as before), and a task without an active sandbox — or a non-task shell — now opens at the **project root** instead of an ensured host worktree. This drops the `resolveTaskCwd({ ensure: true })` fallback from the shell path, the first step of retiring the host-worktree subsystem. The increment-2 shell gate is verified live: node-pty driving `docker exec -it` into the sandbox image yields a working login shell (mechanism, args, and PTY integration confirmed).

- The code-intelligence panel now has a **"Configure embedding model"** link (todo §5.I-1#3) that opens the **Project Settings** dialog — where the per-project code-embedding override lives — so the embedding model is configurable right from where its status is shown, without a separate in-panel picker (one source of truth, per decision). Sits under the embedding provider/config status and opens Project Settings for the current project.

- Finished moving per-project settings out of global Settings (todo §5.I#3, increment B): the per-project code-embedding override is fully removed from the global runtime-settings dialog (its state, dirty-check, config-load effect, save-time validation, save inclusion, and the override UI section). Global Settings → **Code embeddings** now shows only the global **defaults**; the per-project override lives solely in the **Project Settings** dialog (the ⋯ menu). The shared embedding form was also extracted into its own `code-embedding-fields.tsx` module (imported by both dialogs) rather than exported from the 4000-line settings dialog. No behavior change to the global defaults or the override itself. web-ui tsc + dialog/panel tests green.

- Per-project settings now have a dedicated home (todo §5.I#3): a new **Project Settings** dialog, opened from each project's "⋯" menu in the sidebar, hosts the per-project **code-embedding override** (toggle + provider + endpoint/model, reusing the shared embedding form). It saves as a scoped partial merge — `save({ codeEmbeddingOverride })` — which `updateRuntimeConfig` applies field-by-field, so a project override never touches global or other-project config. (Increment A: the dialog + entry point; removing the now-duplicate override from the global Settings dialog is the immediate follow-up.)

- The §5.B decomposition-knowledge signal now has a **UI** (completing §5.B): the Model & Knowledge stats dialog gained a **"Decomposition Knowledge"** section — headline metrics (decompositions, how many consulted knowledge tools first, the knowledge-first rate) plus a per scope × role × model × project breakdown — surfacing whether the architect actually used codebase-retrieval / code-index / architecture-knowledge tools *before* decomposing, not just a usage count. The global totals are an exported, unit-tested `summarizeDecompositionKnowledge` (sums only the overall-scope aggregates so version/project re-rollups aren't double-counted; recomputes the rate). web-ui tsc + dialog tests green.

- Shell-on-task now opens **inside the task's Docker sandbox container** when one is running (todo §5.A, increment 2b): the `startShellSession` runtime handler resolves the task's sandbox shell target (via the memoized per-workspace `NKleinTaskSessionService.getTaskShellTarget` → `AgentSandboxManager`) and, when present, spawns the terminal PTY as `docker exec -it -u <taskUid> -w /workspaces/<taskId> <container>` (login bash→sh) — so a user shell on a running task lands in the same hardened, `--network none` working copy as the agent, not a separate host worktree. When the task has no active sandbox it falls back to the legacy host-worktree shell (retained until the §5.A increment-3 retirement). The docker-vs-host decision is a pure, unit-tested `buildTaskShellSpawnSpec`; the docker-exec-into-workspace path was **live-verified against the running sandbox container** (lands in the cloned repo as the task user; `/usr/bin/bash -l` starts cleanly). The full browser-terminal e2e is folded into the §5.A increment-4 verification pass.

- Added the sandbox seam for **shell-on-task via `docker exec`** (todo §5.A, increment 2a — foundation): `AgentSandboxManager.getTaskShellTarget(taskId)` returns a prepared task's container name + task user + workdir (or null), and a pure `buildAgentSandboxInteractiveShellArgs` assembles the interactive `docker exec -it -u <uid> -w <workdir> <container> <shell>` argv — mirroring the existing non-interactive task-user exec, defaulting to a login bash→sh shell that works across base images. This is the prerequisite for dropping host worktrees from the shell-on-task flow: a user shell will `docker exec` into the task's hardened sandbox container (as isolated as the agent) instead of a host checkout. Unit-tested. The PTY wiring (terminal session → spawn `docker` with these args, replacing `resolveTaskCwd({ ensure: true })`) and its live "shell lands in the container" gate are increment 2b.

- The native NKlein agent is now the **sole launch-supported agent** (todo §5.A, increment 1b): `RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS` is shrunk to `["nklein"]`, so the task-agent picker and the runtime-settings agent list (both driven by `getRuntimeLaunchSupportedAgentCatalog()`) now offer only NKlein, and terminal/CLI agents (Claude/Codex/Droid/Kiro/…) are no longer launchable. This matches the existing local-only lockdown — `normalizeAgentId` already clamps every non-nklein id to nklein, so the shrink only removes the now-dead cloud selection path (its behavior is unchanged under the lockdown). Catalog entries remain for the legacy terminal integration a later §5.A increment deletes. Root tsc + full fast suite + web-ui tsc + picker/settings/native-agent tests all green.

- A pure local-only setup no longer shows a spurious **"No agent configured"** (todo §5.A, increment 1a). Task-agent readiness (`isTaskAgentSetupSatisfied`) was cloud-oriented — it only counted the native NKlein agent "ready" when an API key / OAuth token was configured, otherwise falling back to *another installed CLI agent*. A local-only user (e.g. LM Studio, no API key, no other CLI installed) was therefore told no agent was configured despite a working local model. Readiness is now **local-aware**: a new `isNKleinLocalModelConfigured` treats a selected local provider (lmstudio/ollama, or a custom provider carrying a model id / local endpoint) as configured — the runtime auto-discovers the loaded model and falls back to the catalog base URL at launch (§6.10) — while the existing cloud-auth path still counts. This drops the CLI fallback for the NKlein branch (the first step of the §5.A nklein-only / worktree-retirement direction). web-ui tsc + unit-tested.

- Added four **parallel-fan-out dev-test project presets** (todo §5.O) so multi-agent parallelism can be exercised and hardened under real concurrency (swarm executor, sandbox pool, result-branch merges, the §5.K review / §5.L delivery flow): `wide_fanout` (many independent formatter cards + two join points), `deep_chain` (a strictly linear pipeline, almost no parallelism), `mixed_dag` (a diamond — shared root → two parallel branches → a join), and `many_small` (20+ tiny independent helper cards + a barrel). Each is a `--preset` for `nklein dev test-project`, reuses the small TS CLI template, and steers the decomposition toward its DAG shape via the seed prompt (kept user-level — no internal tool tokens). Unit-tested (preset resolution → distinct scenarios, shape-steering phrases, scaffold). The matrix-sweep automation that *drives* these stays deferred per §5.O until the user supplies the quant / K-V-cache configs and its shape is agreed.

- Decomposition quality now records whether the architect **actually consulted knowledge tools before decomposing** — not just a usage count (todo §5.B). The knowledge-tool-usage observation log already timestamps every tool call per planning session (`taskId`) and marks where a decomposition landed (`decomposition_applied`); a new pure correlator (`src/telemetry/knowledge-tool-decomposition-signal.ts`) turns that into a per-decomposition signal: did any **codebase-retrieval / code-index / architecture-knowledge** tool run *before* the decomposition. It anchors on the applied event (which comes last), so a rejected-then-retried decomposition still credits the knowledge work done in between; it reports the distinct knowledge categories consulted; and it rolls up per scope × role × provider × model as "X of Y decompositions consulted knowledge first (rate)". Surfaced in the knowledge-tool-usage stats API response (`decompositionKnowledgeSignals` + `decompositionKnowledgeAggregates`, additive/back-compatible via schema defaults). Unit-tested (correlation, aggregation, retry-credit, after-decompose exclusion, custom category set) plus a read-path integration test. (The Settings stats column that renders it is the remaining web-ui piece; the audio-VST scoring rubric is the user's to draft.)

- The built-in code-embedding GGUF (todo §5.I-1) now **frees its RAM when indexing goes idle** and **integrity-checks its download**. (1) A host-side idle-unload scheduler (`nklein-embedding-idle-unload.ts`) is re-armed on every embed and, after the idle window (default 2 min) with no further activity, calls the Python core's `POST /v1/embed/unload` to drop the resident model. It's keyed by `(sidecarUrl, gguf_path)` rather than tied to a provider instance — providers are created per request, but the core caches the loaded model across them, so that resident model is what holds RAM at rest. Active indexing bursts keep re-arming the timer so it never unloads mid-flight; the timer is `unref`-ed so a pending unload never keeps the process alive; injectable timer/fetch make it deterministically unit-tested. (2) The default manifest now carries the **verified `sha256`** of `nomic-embed-text-v1.5.Q4_K_M.gguf` (confirmed by a full download + hash; matches HuggingFace's LFS `X-Linked-ETag`), so the existing integrity check actually runs and a corrupt/tampered download is rejected and re-provisioned instead of served. Leaves only the in-panel model-override picker from the §5.I-1 residual list.

- The **Model Performance** stats view no longer lists the same model many times (todo §5.Q). The data was already clean (one canonical registry entry per model, no id variance); the duplication was the display — every aggregate was split by scope × role × project × version and rendered flat, so one model that ran as architect *and* worker filled many rows. The dialog now leads with a **By Model (global)** table — one consolidated row per model (summed runs/outcomes, exact recomputed success rate) — with the detailed scope/role/project/version rows kept below as **Breakdowns**. The global rollup sums only the overall-scope rows so runs aren't double-counted; unit-tested.

- Decomposition no longer forces the model to **fabricate answers to its own clarifying questions**. `validatePlanQuestions` used to hard-reject any `open` question, so a model that correctly raised a question with a sensible `assumption` (a working default) had to flip it to `assumed-default` just to get past validation — burning turns on weak models (observed live: qwen3-8b looped `{}` → open-question reject → self-assumed) and discarding the genuine clarification. Now an `open` question is accepted as long as it carries a working default (`assumption` or `answer`); it stays **open for later clarification** (the architect/reviewer auto-clarify loop or the user, todo §5.S) while the plan proceeds against the assumption. Only an open question with no working default at all is rejected, with a directive not to invent a hard answer. The decomposition prompt now prefers `open` + `assumption` over a fabricated answer. Unit-tested (open+assumption accepted; open-with-nothing rejected).

- More **hover/focus tooltips** (todo §5.I#5): extended universal-tooltip coverage to the card-detail controls (reject pending artifact, collapse expanded diff, toggle split diff), the **swarm cockpit** (max-concurrency cap, pause/resume the swarm, code-intelligence chip), **git-history "Discard all changes"**, and the **terminal "Close"** — each now shows a name + one-line description from the `ELEMENT_TOOLTIPS` registry. This covers the high-value icon-only controls across the board, card, and cockpit surfaces (beyond the already-covered top bar / board columns / cards).

- Settings → Tasks now has a **Max review rounds** input (todo §5.K): the second-opinion review round cap (`reviewMaxRounds`, default 20) is now editable from the UI — a number input next to the review toggle, disabled when review is off, threaded through the settings dialog's state/dirty-check/save like the other settings. Completes §5.K.

- Agents now **re-anchor their focus chain** every turn (todo §5.N): the chain an agent authors via `update_focus_chain` is captured per live session and re-projected into each model request by the `beforeModel` hook, so a small model stays on its own plan across turns and after context compaction (which otherwise drops the chain — it only lived as the tool call/result). The rail strips any prior focus-chain rail before prepending the current one, so it never stacks or goes stale, and it's a fail-safe no-op when there's no chain. Logic lives in a standalone, unit-tested `nklein-focus-chain-rail.ts` (`reanchorFocusChainMessages`).

- Timeout outcomes can now be broken down **by agent role and by dev-test scenario** (todo §5.C): the durable run-summary record carries a coarse `role` (`reviewer` for the synthetic `<taskId>::review` session, `architect` for decomposition turns, else `worker`, inferred at the terminal capture) and a `scenario` (parsed from the `devtest-<scenario>-<ts>` task id), and `summarizeTimeoutOutcomes` groups timeout-triggered runs by provider × model × timeout-source × role × scenario — so "which role/model/timeout-source/scenario combinations keep timing out, and what happens when they do" is answerable from the durable log (the by-scenario view feeds the §5.O robustness sweeps). Additive + backward-compatible (older records default to the `unknown` role / `null` scenario group); unit-tested.

- The second-opinion reviewer now sees the worker's **focus chain** (todo §5.N): when a card carries a self-authored focus chain, the reviewer's seed prompt includes it under "Worker's focus chain (its self-authored plan)" and is told to judge whether the work actually followed and completed its own plan — unfinished/skipped steps that matter to the objective, or a chain whose done steps don't match the diff, warrant `request_changes`. Wired from the live review runner through `card.focusChain`; pure and unit-tested.

- !Klein now **recovers tool calls that a weak model emits as text instead of a structured call** — the project principle is to be robust against small-model output errors rather than to teach the model. Small/quantized local models routinely "narrate" the Hermes/Qwen-style `<tool_call>{"name": …, "arguments": …}</tool_call>` block into their content or reasoning channel rather than the structured tool-calling path; the SDK then sees a plain text turn, finds no tool to run, and the turn stalls (observed live twice mid-decomposition: a 35B model wrote a `read_large_file` continuation, then a `list_files` call, as `<tool_call>` text and stopped). A new pure parser (`src/nklein-agent/nklein-narrated-tool-call.ts`) extracts narrated `<tool_call>`/`<function_call>` blocks (tolerant of the `<|tool_call|>` variant, a missing closing tag, double-encoded string arguments, and sloppy JSON via the shared `repairJsonValue`), and an `afterModel` hook parses any such call out of the assistant message and **appends a real tool-call part so the agent loop executes it** — exactly as if the model had emitted it natively (the hook runs before the loop extracts tool calls). Conservative to avoid false positives: it only fires when the turn produced no real tool call and an explicit wrapper carrying a tool `name` is present; recoveries are logged via self-observation telemetry. This supersedes re-prompting for this failure mode. Unit-tested against the exact evidence-bundle payloads.

- Delivery-autonomy gate (todo §5.L) now governs auto-delivery: when a reviewed card is about to be auto-merged, the runtime resolves the **delivery tier** (`decideDeliveryAction`) against the safety gates and only auto-merges when the tier allows it and the gates pass — **self-merge is allowed** at the open tiers (per decision), but a diff that touches **protected safety paths always holds** the card in Review instead of merging. The default tier (`fully_open`) still auto-merges as before; lower tiers (or a protected-path change) leave the card in Review for manual/PR handling, with the reason logged. (Auto-commit/PR actions, a measured regression delta, and per-project/per-card tier overrides are follow-ups; tests + review are treated as passed at this point since acceptance runs upstream and the second-opinion review already gated this step.)

- Delivery-autonomy now supports a **per-card override** (todo §5.L, "adapt … per project and per card"): the auto-delivery gate resolves the effective delivery tier with scope precedence **card > project > (role override > global preset)** via a new pure `resolveEffectiveDeliveryTier`, and the board card schema carries an optional `deliveryTierOverride` (additive/CRDT-safe). A card with an override is gated at that tier regardless of the global setting; cards without one are unaffected. (Per-project storage + the Settings/card UI to set it, and auto-commit/PR at the lower tiers, are the next increments.)

- Began per-agent **focus chains** (todo §5.N): the data core for an agent-authored, ordered task checklist (the steps it drafts at the start of a task and works through, à la Cline). A pure module (`src/core/focus-chain.ts`) normalizes an agent-emitted chain (trim/clamp step text, drop empties, coerce unknown status, cap at 30 steps), summarizes status counts + completion, and renders a markdown checklist for re-anchoring the model on its plan; the card schema carries an optional `focusChain` (steps + status + updatedAt). Added the `update_focus_chain` tool (`src/nklein-agent/nklein-focus-chain-tool.ts`): the agent calls it to draft its plan and re-sends the full list with each step's status as it progresses (the reliable shape for small models), mirroring how `decompose_project`/`submit_review` give a structured artifact instead of prose. Unit-tested. **Now wired into board agents:** the efficiency rules tell every agent to draft a focus chain at task start and keep it updated, the session runtime attaches `update_focus_chain` whenever the runtime wires a persistence handler, and the state hub persists each update onto the card's `focusChain` (+ broadcasts), so it survives turns and restarts. The card detail view renders the chain as a live **todo-list** panel (✓ done / ▸ in-progress / ○ pending / – skipped, with an x/total count). The chat-agent surface (§5.M) follows.

- Per-role model pools (todo §5.L / #4): a role's model config can now carry an `additionalModels` pool, so a single role (e.g. Worker) can be backed by several local models. At task-start every pool member becomes a candidate tagged with that role, and the existing free-first routing fans concurrent tasks out across the free, capability-feasible members instead of queueing them on one model. Reuses the existing `modelRoles` config plumbing (loads/preserves/round-trips), so single-model roles are unchanged; the primary model keeps its strict context-policy gate while an over-budget pool member is simply skipped. Settings → !Klein → Model roles now has an "Additional models" pool toggle per role (chips of the provider's other loaded models) so you can build the pool from the UI.

- The Python core sidecar (`core-py`) is now **default-on** (opt-out via `NKLEIN_CORE_PY=0`) instead of opt-in. Structured-generation and embedding callers already fall back instantly to the in-process path on any error, and an absent localhost sidecar is an immediate connection refusal (not a timeout), so when the core isn't running behavior is unchanged — but when it *is* running it's now used automatically with zero config (incl. the in-process GGUF code-embeddings). Added `probeKleinCorePyHealth` (a short-timeout `GET /health` probe that never throws) for surfacing core status. (Follow-up: a startup health-gate to harden the reachable-but-hung edge, and the Settings status line.)

- Swarm fan-out across free models (todo §5.L / #4): when a task starts and its preferred model is already busy running another task, the runtime now routes it to a free, capability- and context-feasible alternative instead of queueing — so parallel tasks spread across the available local models. Single-model setups and the configured per-role preference (e.g. the architect model for plan-mode) are unchanged whenever the preferred model is free; the fan-out only triggers under contention. Built on the unit-tested `selectRoleModel` core (free-first, difficulty/context-gated).

- Settings → Tasks now has an **Agent Capabilities & Autonomy** section: pick the capability tier (sandbox network/tools) and the delivery-autonomy tier (how far commit→PR→merge proceeds), each with a plain-language description of the selected tier. Saves through the runtime config and is read back on reload. Both default to **fully open**; the section notes that Docker isolation and the local-models-only lockdown never relax at any tier. (Per-role overrides — already supported by the config/core — are a follow-up; this exposes the global presets.)

- When a weak local model repeatedly calls `decompose_project` with **empty arguments** (it plans the whole decomposition in its reasoning channel but never emits it as the tool's JSON arguments, so nothing decomposes), the repeated-tool-call guard now parks with a **diagnostic** message naming the real cause and remedy — switch the Architect/planning role to a more capable model, or reduce scope — instead of the generic "same input" notice. (Observed live with a 26B local model that reasoned a full plan, then emitted `{}` three times.)

- Began universal hover/focus tooltips so any control is self-explanatory: a new single-source-of-truth copy registry (`element-tooltips.ts`) + an `ElementTooltip` helper render a control's **name** plus a one-line **description** from a typed id (a missing entry is a compile error), and carry their own tooltip provider so they drop in anywhere. First batch wired the top-bar icon buttons (Settings, Debug, Back to board, sidebar toggle); the rest of the UI follows.

- Fixed decomposition silently producing nothing when a small local model emits a malformed `decompose_project` call. The tool's input schema was strict at the SDK boundary (`required` fields, no extra keys) — *at every depth*, including each task and question — so the SDK rejected a slightly-off call *before* !Klein's handler ran, answering with a multi-KB raw Zod validation dump that a small model can't recover from, that burns its context budget, and that bypasses !Klein's own JSON-repair. Observed live across several runs: a model called the tool with a typo'd task key (`acceptenceCommand`), or omitted `title`, or degraded into repeated empty `{}` calls — and decomposed nothing. The whole boundary schema tree is now relaxed (every `required` stripped, every object opened, while the map-valued `expansions` schema and all property descriptions are preserved) so *every* call reaches the handler, which validates in-process and throws a short, directive message instead — naming the missing fields and nudging a small first payload ("3–6 tasks, keep spec/plan brief, don't resend empty"). Empty `{}`, blank-string fields, and typo'd task keys are now recoverable (a typo'd acceptance command falls back to `defaultAcceptanceCommand`). (Distinct from the existing re-prompt for turns that end with *no* tool call — here the model did call the tool, with bad arguments.)

- Fixed a runtime crash where the whole process would die mid-task with `ECOMPROMISED` (`utime '.../workspaces/index.json.lock'`). `proper-lockfile` refreshes a held lock's mtime on a timer; when the event loop is blocked long enough (heavy local-model startup, SDK host boot) the lock goes stale, another holder reclaims it, and the library's *default* `onCompromised` rethrows from inside that timer — an uncaught exception that took down the runtime. Locks now install a non-throwing default handler that records the anomaly via self-observation instead of crashing (writes here are atomic temp-file+rename, so a momentarily lost lock means at worst a lost update, never a corrupt file), and lock release is now resilient so a compromised-lock `ERELEASED` rejection can't escape, mask the operation's result, or leave sibling locks unreleased.

- Began the second-opinion reviewer workflow (every worker card gets a real review pass from the reviewer role, like a human dev team): the pure decision core decides approve→deliver, request-changes→bounce-back-to-worker, or park, with a generous round cap plus **stall** (no worker change since the last round) and **identical-loop** (same feedback on unchanged work) detection so a weak model can't ping-pong forever; and a `submit_review` tool gives the reviewer a structured verdict (`approve`/`request_changes` + summary/feedback/insight) instead of prose to parse. Added the pure orchestration core that sits between that decision and the live runtime: stable work/feedback fingerprinting, the reviewer-role seed prompt (objective + acceptance summary + prior change request + the diff under review + **the worker's own reasoning** and **the card's board/plan context** — its plan objective, the cards it depends on, the cards that depend on it, and its sibling cards — so the reviewer judges the *approach* and the card's *fit in the whole plan*, not just the bytes changed; ending in a single required `submit_review` call), the worker bounce-back prompt that carries the feedback as the next turn, the approval sign-off, and `resolveReviewTransition` (verdict + round + history → deliver / bounce-to-worker / park, plus the review-history record to persist). All unit-tested. Persisted state + settings are in place too: a global **Second-opinion review** setting (default **on**) with a configurable **round cap** (default 20) round-trips through the runtime config, and the board card schema now carries an optional `review` object (status, round, per-round history with verdict + work/feedback fingerprints, last summary/feedback/insight, sign-off, parked reason) — additive and CRDT-compatible (whole-object last-writer-wins), so older boards load unchanged. The review orchestrator (`runNKleinSecondOpinionReview`) ties it together with injected I/O (mirroring the acceptance auto-repair pattern): gate the card → extract the worker diff → run a reviewer session for a verdict → map it to a transition → persist the review round and call the matching side effect (deliver / bounce-to-worker / park). Unit-tested with mocked dependencies. Settings → Tasks now has a **Second-opinion review of completed cards** toggle (default on) wired to the `secondOpinionReviewEnabled` config. The card detail view now shows a **Second-opinion review** panel (status + round + the reviewer's summary, requested changes, sign-off, or parked reason) whenever a card carries review state. The live wiring is now in place: `getTaskResultBranchDiff` provides the worker's diff, the session runtime attaches the `submit_review` tool for a reviewer turn (only when given a verdict handler), the task-session service's `runSecondOpinionReviewSession` runs an isolated reviewer turn under a synthetic `<taskId>::review` session (prepared from the result branch, reviewer model, bounded by a timeout, always torn down), and the review runs **in the delivery-gating seam** — `finalizeHeadlessAutoReviewTask`, right after a card moves to Review and before any auto-merge/complete — so the verdict actually gates delivery: approve → proceed to deliver; request-changes → the card is already back in In Progress with the worker re-driven, so delivery is skipped; park → it stays in Review. **Gated on the setting and fully fail-safe**: any review error (or a skip when disabled) falls through to the prior auto-complete behavior, so the review can never block delivery on its own failure. The gate runs after `resolveReviewSandboxResult` settles (the result-branch capture is async), so when there is a diff the reviewer has it — and it runs for a **no-change result too**: an empty patch (no files touched) is reviewed rather than silently auto-completed, because a no-op usually signals bad planning or a mis-processed task; the reviewer is told there were no changes and asked to judge whether that's genuinely valid or warrants `request_changes`. The flow is unit-tested with mocked I/O and was exercised against a live local model + Docker: the runtime boots clean on it, a worker task runs in the sandbox and its result is captured + auto-delivered, and the review gate executes in the correct seam (verified via a new outcome log + reviewer-session-failure telemetry). Small reviewer models often end a turn without emitting `submit_review`, so the reviewer session now **re-prompts** (mirroring the decomposition nudge): if a turn ends with no verdict, it tells the reviewer to call `submit_review` now and tries again, bounded by a small nudge budget and the overall time budget; only after that does it fall back to `no_verdict` (which still fail-safe-delivers). The whole reviewer session — first turn + nudges — is bounded by one overall deadline and always torn down.

- Fixed the !Klein default-model selector spinner spinning forever when the live model list (e.g. LM Studio `/v1/models`) is slow or unreachable: the provider-models fetch is now bounded by a 15s timeout, so loading always resolves or errors instead of hanging. Removed the redundant/obsolete refresh button next to the default model selector (it duplicated — and could hang like — the working **Refresh** in the *Model context windows* panel, which already reloads every model dropdown). Relabeled the selector to **Default model** with a hint that it applies to all work unless a role (Architect / Worker / Reviewer) overrides it, and where to refresh the lists.

- Fixed decomposition tasks silently stalling when a reasoning model (e.g. deepseek-r1) spends its whole turn in the reasoning channel and ends without emitting a `decompose_project` tool call. The turn previously went to `awaiting_review` with nothing decomposed and no error (the self-review hook bails on empty output). !Klein now re-prompts such a turn to emit the tool call now (bounded by the same nudge budget as the chat-only nudge, and only on a clean stop with no tool call and no pending user question), and the decomposition prompt tells the model explicitly that reasoning alone is not an answer and a tool call is mandatory.

- Fixed a second decomposition stall in the same family: a turn that stops **mid `read_large_file` workflow** never recovered. Observed live with a 35B local model decomposing an 83 KB spec — it read the first chunk, then *narrated* the next `read_large_file` continuation as a `<tool_call>{…}</tool_call>` **text block in its reasoning channel** instead of emitting a real tool call, so no tool ran, the turn ended at line 788 of 1277, and `decompose_project` was never called. The existing stall re-prompt didn't fire because the clean-stop summary (`agent_end`) preserves the last tool name, so "a tool ran this turn" (`read_large_file`) wrongly exempted it — and because the model never made another call, the large-file workflow's own `beforeModel` continuation guidance (which re-injects the exact cursor and restricts tools to `read_large_file`) never re-fired. The stall recovery is now a pure decision core (`src/core/decomposition-stall.ts`, unit-tested) that classifies the two shapes — reasoning-only (re-prompt to emit `decompose_project`) vs. mid-read (`read_large_file` was the last tool → re-prompt to make a *real* tool call and finish reading through EOF with the `nextCursor`, then decompose, explicitly noting a tool call written as text does not execute) — sharing the same bounded nudge budget. Once the model makes a real `read_large_file` call again, the existing workflow guidance takes back over.

- Acceptance-command failures are now classified into a small taxonomy (command-not-found, missing-script, missing-dependency, type-error, lint-error, compile/syntax-error, test-failures, timeout, or unknown) with a human label and a next-step hint, instead of just an exit code and raw output. The acceptance gate stamps the category and hint on its result, they round-trip through the runtime contract (the wire `failureCategory` is the typed enum, derived from a single source-of-truth category list shared with the classifier), and the card detail view's **Verify acceptance** result now renders the classified label plus the next-step hint on failure (e.g. *"Missing dependency — A required module/package is not installed…"*) so you see *why* a check failed at a glance, not just that it did.

- The project Code-intelligence panel now shows the built-in embedding model's status: which provider is effective, whether the GGUF is downloaded (and its size) or will download on first index, and a clear note when it is running as the lexical fallback because the Python core is disabled.

- Added the built-in, zero-config code-embedding model (`local_gguf`, now the default): a quantized GGUF (nomic-embed-text-v1.5) is auto-downloaded on first use to the runtime home (streamed to disk with progress + integrity/version checks, the one sanctioned host-side fetch), then embedded in-process by the Python core — no LM Studio/Ollama required. The model loads lazily on first embed and frees on idle. If the Python core is disabled or the model/sidecar is unavailable, embeddings degrade cleanly to the existing `local_lexical` provider, so a fresh install behaves exactly as before until the core is enabled and indexing never hard-fails.

- Python core can now embed via an in-process quantized GGUF model (`llama-cpp-python`, `embedding=True`): `/v1/embed` accepts a host-provided `gguf_path` (+ a CPU-thread cap so it never competes with the main LLM), caches the loaded model across index batches, and a new `/v1/embed/unload` frees it when idle. Any load/embed failure degrades to the dependency-free lexical embedding so indexing never hard-fails. This is the in-process, no-external-runtime backend for the upcoming zero-config code-embedding default (nomic-embed-text-v1.5); the host-side GGUF download + provider wiring follow.

- Instruct local models to keep responses and reasoning short, and to act with tools instead of writing long prose. Added a prominent "Response Length And Reasoning Discipline" section to the per-task efficiency rules (applied to every task) and a brevity directive to the decomposition planning prompt. Oversized outputs/reasoning waste the context budget and can crash a local model host under memory pressure — reasoning models like deepseek-r1 are especially prone to emitting very long chains of thought — so this both reduces crashes and saves budget.

- When a local model host (LM Studio/Ollama) crashes or unloads its model mid-run — a real failure mode under memory pressure, e.g. a reasoning model at a large context window on limited hardware — !Klein now recognizes the resulting dropped-connection / model-not-loaded errors, parks the task fast (after a single transient retry instead of the generic three) instead of retry-storming a model that is gone, and shows an actionable card warning: reload the model in your local host, or pick a smaller / non-reasoning model or a smaller context window, then resume.

- The committed portable board CRDT (`<repo>/.nklein/nklein/workspace/board-crdt.json`) now migrates forward on read: a forward-migration registry upgrades older committed files (e.g. one fetched from a machine still on a prior schema) up to the current version, and a file written by a *newer* schema this build cannot safely downgrade is refused rather than silently coerced or partially read. Previously any `schemaVersion` other than the current one was dropped to `null`, which would have lost cross-machine board state on the first schema bump. A future bump is now a one-line migration entry plus a version constant change.
- Wired the dev-test harness to a running runtime: `nklein dev test-project --preset <mid_task|complex_dag|audio_vst|daw_foundation>` starts the scenario's seed card via the runtime tRPC API and monitors the board to a single classified outcome, reading live state and falling back to the last persisted board when the runtime is unreachable. Added `nklein dev cleanup-report`, which scans for scaffolded dev-test workspaces (by their marker file, sized via `du`) and `nklein`-prefixed Docker sandbox volumes, retains the active run, and reports reclaimable vs retained bytes. The state-reader fallback and cleanup active/retained classification are unit-tested.
- Terminal run summaries now record where a timeout that ended a run came from: each bounded stream/tool/conversation timeout carries provenance (`role_override` vs `global_config` vs `autonomous_default`), resolved from the same launch-config precedence that picks the timeout value, and the source of the timeout that actually fired is persisted on the run summary (previously always `null`). Added a `summarizeTimeoutOutcomes` aggregator that groups timeout-triggered runs by model and timeout source with their terminal outcomes, so "which model/timeout-source combinations keep timing out, and what happens when they do" is answerable from the durable run log.
- Hardened near-valid tool-payload handling for small local models: `expand_task` now recovers a JSON-stringified replacement graph (with the same trailing-brace/whitespace repair `decompose_project` already applies to `tasks`/`expansions`) instead of failing schema validation, and added a broadened fuzz suite covering `expand_task`, `write_file`/`write_files`, and the discovery tools (`list_files`/`find_files`/`get_file_size`) — exercising stringified nested JSON, the `file_path` alias, boolean/number-as-string options, out-of-range clamping, and harmless extra keys, while still failing clearly on genuinely unusable input.
- Locked the workspace-scoping of the model-performance and knowledge-tool-usage telemetry caches with regression tests: the same repeated dev-test task id used across two projects now provably stays as two distinct observations (no task-id-only key collision), keeping per-project stats correct.
- Fixed plan-mode dev-test cards that displayed "Architect working" while still carrying Worker model settings; plan-mode starts now re-resolve to the configured Architect role, and local scheduling uses per-model endpoint slots (`endpoint#model`) so two available local role models can run different cards concurrently unless explicitly grouped to the same shared endpoint.
- Made plan-mode !Klein starts prefer the configured Architect role model and added board-card role chips so cards show whether Architect or Worker will run them, including active/queued status.
- Fixed planning/decomposition system guidance so local models are no longer told to call `/kanban-decompose` as a tool; the runtime still loads the overridable decomposition workflow internally, but agents now get explicit `decompose_project` tool-first instructions, including for large implementation-card graph prompts.
- Linked the DAW foundation dev-test fixture into the left-sidebar Dev Test Scenarios card as a `daw_foundation` preset, backed by the dedicated DAW template and full foundation-release specification.
- Fixed the same local model showing up twice in the model registry/picker — once selected with blank/"unknown" stats and once with the real telemetry. Loopback endpoint spellings (`localhost` vs `127.0.0.1`/`0.0.0.0`/`::1`, and trailing slashes) are now canonicalized in the model-registry key, so a model configured as `127.0.0.1` but observed as `localhost` is a single entry; existing persisted duplicates merge on load, keeping the entry that carries the observations.
- Integrated the NKlein SDK directly into the repo instead of treating it as an installed package. Removed the `@nklein/{core,agents,llms,shared}` `file:` dependencies and now resolve the `@nklein/*` specifiers (used by our code and the SDK's own internal cross-imports) through in-repo path aliases — `tsconfig` paths (tsc + tsx), a shared `vitest`/`esbuild` alias module (`scripts/nklein-sdk-alias.mjs`) — pointing at `vendor/nklein-sdk/*/dist`. The SDK's own runtime dependencies were hoisted to the root manifest. The SDK is now plain repo-owned code we can edit freely, not an external package. Verified: typecheck, the full runtime suite, both esbuild bundles, and `tsx` dev resolution all pass with no `@nklein` package in `node_modules`.
- Stopped a background crash loop: the SDK session host now runs with the in-process `local` backend instead of `auto`. `auto` selected the shared "hub" daemon whose cron/automation entrypoint is broken in the pinned SDK build (the bundled daemon entry throws `ReferenceError` on load — an upstream defect, independent of !Klein), so it crash-looped in `~/.nklein/data/logs/hub-daemon.log`. !Klein is a single local-only app and does not use the hub's scheduled-agent features, so the local backend is both the fix and the correct mode.
- Fixed Planning-column cards never starting from their buttons: the Start (play) button shown on Planning cards was wired only for Backlog, so clicking it did nothing; it now launches the task. Starting a card that is already in its active column (a plan-mode card started in place in Planning) no longer drops the kickoff through a degenerate same-column move. And **Approve for execution** now actually launches the task when nothing is running yet, instead of only flipping the card out of plan mode and leaving it parked as "Execution approved".
- Fixed approved act-mode planning cards never running: a card sitting in **Planning** with `startInPlanMode: false` (a seeded or decomposition-generated implementation card, which has no Start button) is only startable by dragging it into **In Progress**, but that drag moved the card without launching an agent session, so the task silently never ran. The `planning → in_progress` drag now kicks off the session for such cards, while plan-mode cards and cards that already own a live session keep their existing approve/continue flow.

- Separated hidden !Klein planning/decomposition guidance from visible task prompts: dev-test seed cards now show product-focused user requests, runtime decomposition guardrails are delivered as system guidance, and chat transcripts collapse those system prompts behind an explicit “Show system prompt” control.
- Standardized user-facing app branding on `!Klein` across settings, card/chat copy, onboarding, CLI help, and surfaced runtime errors, and tightened the brand regression guard so visible `NKlein` text cannot be reintroduced accidentally.
- Added an OpenHands-inspired "watch the agent's hands" view: a per-card **Watch** tab that shows, in one place, the agent's live state/model/elapsed/current-tool, an accumulated **activity timeline** (every tool/step it takes, streamed from the data the runtime already broadcasts), and the **files it is changing this run** — plus a jump to its interactive terminal. Built on a new client-side activity-timeline accumulator (unit-tested) with no backend changes.
- Vendored the SDK packages !Klein depends on under `vendor/nklein-sdk` as local `@nklein/*` packages and removed the external SDK package boundary, so the runtime now builds against repo-owned NKlein SDK packages.
- Fixed LM Studio model selection after the NKlein rename: live model discovery now falls back to the catalog localhost base URL when no model base URL is saved, the settings dialog no longer defaults live-only LM Studio providers to stale SDK defaults like `openai/gpt-oss-20b`, and it auto-selects the first currently loaded LM Studio model when the saved draft is empty or unloaded.
- Reworked Add Project so repeated clicks open one controlled dialog instead of stacking native folder pickers, added an Existing Folder flow with a guarded Browse action and editable project name, and added a New Folder flow that derives a filesystem-safe folder name from the project name while allowing manual override.
- Stopped auto-registering the runtime's launch checkout as the initial project, so running !Klein from its own source no longer pre-fills `kanban`; adding the running source folder now goes through the explicit self-project confirmation gate.
- Hardened local-only model/provider visibility across the web UI: stale `cloudProviderSupportEnabled` config can no longer reveal cloud providers, per-card override model loading ignores hidden cloud defaults, and model-role overrides only preserve providers that pass the same visible-local provider policy.
- Added the audio VST / psytrance dev-test preset to the left sidebar Dev Test Scenarios card, including the same create-and-start flow as the other seeded decomposition scenarios.
- Tightened explicit decomposition planning starts, including the audio VST dev-test seed, so local models call `decompose_project` immediately after one focused context pass, recover from duplicate-read guardrails without looping, and record domain knowledge gaps inside the generated plan instead of streaming long chat reports. If a small model still starts a chat-only decomposition report or stalls after announcing `decompose_project`, !Klein now uses bounded corrective restarts with stricter tool-call-only instructions instead of waiting for the full stream timeout.
- Raised the repeated-call parking threshold for !Klein's richer `read_files` and `run_commands` NKlein tools while keeping stricter native tool loop guards, so autonomous dev-test cards are not parked for legitimate repeated verification or multi-file context reads.
- Reconciled board lanes after recovery input restarts a NKlein task from Review/Backlog/Planning, so resumed cards move back to their active lane instead of remaining as stale review blockers.
- Treated SDK `aborted` turn endings after completed mutating/acceptance tools as reviewable NKlein completions, preventing successful sandbox work from being left as an interrupted/lost active card when no final prose is emitted.

- Python core Phase 4 — decomposition quality: ported the dependency-coherence validator and best-of-N graph selection (self-consistency) to the Python core (`/v1/decompose/select`), so weak local models can sample several plans and keep the most coherent one — directly targeting the decomposition under-scoping that the audio-VST dev-test run exposed. Unit-tested.

- Python core Phase 3 — native agent core: a ReAct tool-calling loop (`/v1/agent/run`) that runs entirely in the Python core on the local model with constrained-JSON action selection, workspace-scoped tools (`read_file`/`write_file`/`edit_file`/`list_files` with path containment), and the aider-style fuzzy search/replace editor ported from the TS implementation (exact → whitespace → leading-blank → `...` elision → fuzzy ≥0.8). Loop guards: repeated-action stall, unknown-tool feedback, max-turn budget. Unit-tested.

- Python core Phase 2 — ML services: `/v1/compress` (LLMLingua-2-style token-importance compression; dependency-free heuristic default, real LLMLingua-2 as an opt-in `ml` extra), `/v1/embed` (deterministic lexical embedding default, sentence-transformers opt-in), and `/v1/repomap` (PageRank-ranked symbol map). All local-only and unit-tested (FastAPI TestClient); the `llama-cpp-python` own-GGUF generation backend is verified installed.

- Started the polyglot migration: added a local-only Python core sidecar (`core-py/`, FastAPI) that will own !Klein's ML + native-agent capabilities, beginning with **constrained generation** (`/v1/generate`, `/v1/generate_structured`) that the NKlein SDK can't provide — full sampling (`min_p`/`top_k`/`repeat_penalty`) plus grammar / JSON-schema decoding, via either its own `llama-cpp-python` backend or by proxying a local OpenAI server. The TS runtime calls it through a new `KleinCoreClient` that is a drop-in for the existing local client and **falls back automatically** when the sidecar is disabled/unreachable; it is opt-in via `NKLEIN_CORE_PY` (default off), so behavior is unchanged until enabled. The React UI/Electron and the NKlein runtime are untouched.

- Began !Klein's own native agent core (`src/agent-core/`): a constrained tool-calling (ReAct) loop that runs on the !Klein-owned local model client instead of the NKlein SDK, with stall/loop and max-turn guards and a `LocalLlmClient` action decider that selects the next tool via JSON-schema-constrained decoding (reliable for small/quantized models). The NKlein SDK remains one supported runtime; it is no longer the only one.
- Added `THIRD_PARTY_NOTICES.md` documenting the decision to adopt implementations from the wider local-agent ecosystem (aider, Roo Code, Continue — Apache-2.0; OpenHands — MIT) by re-implementing them in our own codebase with attribution, and explicitly excluding AGPL-3.0 code (Open Interpreter) to keep !Klein Apache-2.0.

- Added a per-model/per-role sampling policy (`resolveLocalSamplingOptions`) for the local model path: deterministic low temperature for coding, near-greedy for structured output, slightly higher for planning, with tighter temperature + repetition penalty and `min_p` for small/quantized model families to prevent loops and incoherent output.
- Added a shared, well-tested tool-argument JSON repair (`repairJsonValue`) that recovers near-valid JSON from small models (code fences, surrounding prose, trailing commas, unquoted keys, single quotes, truncated brackets) and unified the previously duplicated parsers in `decompose_project`, `write_files`, and `edit_file` behind it.
- Added best-of-N decomposition selection (self-consistency): sample several candidate task graphs and pick the best by the existing sizing + dependency-coherence validators, so weak local models produce better plans without a stronger model.
- Added LLMLingua-2-style selective prompt compression: an opt-in token-importance compressor that keeps the highest-information tokens to fit small context windows, with a zero-dependency heuristic scorer as the batteries-included default (best for limited hardware) and a runtime model download/update manager for an optional ONNX scorer that users can opt into. Wired as a `selective` mode in the context compressor with the existing caveman/minify path as the opt-out fallback.
- Added a !Klein-owned local model client (`LocalLlmClient`) for local OpenAI-compatible servers (LM Studio / Ollama / llama.cpp) that is not limited by the NKlein SDK's request layer: it sends full sampling controls (`temperature`, `top_p`, `top_k`, `min_p`, `repeat_penalty`, `stop`, `max_tokens`) and grammar / JSON-schema **constrained decoding** (`response_format` + llama.cpp `grammar`), which keep small/quantized models reliable. It is local-only (fail-closed via the cloud-lockdown policy) and offers a `generateStructured` helper that returns schema-valid JSON with prose/code-fence recovery and a single corrective retry. This is the foundation for using a direct local path (instead of only NKlein) for structured operations.
- Added an `edit_file` tool that applies token-efficient search/replace edits with a lenient fuzzy-match fallback ladder (exact → whitespace-flexible re-indentation → leading-blank tolerance → `...` elision → closest fuzzy match ≥80% similarity), modeled on aider's edit-block coder. This lets small/quantized local models edit large files reliably without whole-file rewrites and without looping on near-miss exact matches; failures return a corrective hint with the closest-match similarity. It reuses the existing protected-path, secret-scan, file-scope, and per-file-line write guards and is registered in the Docker sandbox tool runner.

- Added decomposition dependency-coherence validation: `decompose_project` now rejects task graphs where a test/acceptance card does not depend on the implementation it verifies or a documentation card does not depend on the work it documents, and surfaces softer graph-quality warnings (sparse graphs, isolated cards, likely-reversed test edges, UI cards ignoring domain/control cards) in the tool result and self-observation telemetry.
- Added a `knowledgeDebt` field to decomposition task cards plus a knowledge-acquisition and "scope pressure" pass in the `kanban-decompose` workflow, so domain-heavy work (audio/DSP, crypto, hardware, ML) records what each card still does not know and is checked for being under-decomposed by 10x/100x instead of treated as a small CRUD feature.
- Classified sandbox result-patch capture failures: a corrupt/garbled captured diff is now distinguished from a patch that does not apply, the failing file and hunk are extracted, the failing patch is preserved under the runtime home `patch-failures/` directory, and all of this is attached to the review card and self-observation telemetry instead of a bare "corrupt patch at line N".
- Added a structured note to NKlein stream/tool inactivity timeouts recording the last model activity, last tool, whether workspace changes were captured, and whether resuming is safe, so a stall-induced review is diagnosable.
- Added durable terminal task-run summaries: when a task ends in review/failed/interrupted, !Klein now records a run summary (provider/model, endpoint, review reason, last activity, token usage, exit code, timing) to a runtime-home `task-runs/` log that survives runtime shutdown (unlike the live `sessions.json`), and exposes recent run summaries through the task diagnostics API so unfinished cards stay inspectable after the runtime stops.
- Narrowed the same-turn file-read guard so only additional content reads (`read_files`/`read_large_file`) are serialized within an assistant turn; harmless discovery (`list_files`/`find_files`/`get_file_size`) and edits/commands after a read are allowed, and the rejection text now tells the model to continue with the result already shown instead of "waiting".
- Made `decompose_project` tolerate a `null` `summary` from small local models, matching the other already-nullable fields.
- Added a near-valid tool-payload fuzz suite for `decompose_project` and a regression test proving generated cards land in Planning with start preconditions met.
- Added a portable, cross-machine board CRDT (per-field last-writer-wins with tombstones for cards/placement and presence registers for the DAG) plus a committed `<repo>/.nklein/nklein/workspace/board-crdt.json` store with export/import; imports drop the source machine's model assignments so roles/fit re-resolve against the importing machine's local models, keeping the local-only invariant. The durable board is exported to the CRDT on every state save and recovered from it (with local re-resolution) on a fresh machine when no runtime cache or board mirror exists.
- Added an official dev-test harness (`runDevTestProject` + `buildDevTestSeedStartPayload`) that sends the exact UI-equivalent seed-card start payload and runs a bounded monitor loop which degrades when the runtime becomes unreachable and ends with a single classified run outcome, replacing ad-hoc fresh-run scripts.
- Added a dev-test cleanup report summarizer that classifies obsolete dev-test workspaces, sandbox volumes, and editor/cache artifacts, never reclaims the active run, and reports reclaimable vs retained bytes per category.
- Added a dev-test run-outcome classifier that tracks acceptance-command success and board completion separately, so a run where `npm test` passes but cards remain unfinished is reported as `acceptance_green_workflow_incomplete` rather than "green"; also classifies `blocked_by_review_cards`, `stagnant`, `runtime_down`, and `failed`, with a helper to derive counts from a persisted board for observers running after runtime shutdown.
- Added local model performance statistics for NKlein task runs, aggregating observed outcomes, timing, token usage, context pressure, model, role, project, and !Klein version with a detailed Settings view next to model roles.
- Added knowledge-tool usage statistics for NKlein retrieval, code-index, file discovery/read, planning-control, architecture-knowledge, and external-fetch tool events, with project/global aggregates in the Settings statistics view.
- Added a domain-knowledge-heavy audio VST/psytrance dev-test preset with a dedicated DSP fixture for kick/bass synthesis, phase-aligned sequencing, UI state, and clean-effect guardrails.
- Made `decompose_project` tolerate stringified task arrays and expansion maps from small local models at both the advertised tool schema and execution parser layers while still validating the parsed graph with the normal strict decomposition contract.
- Made `decompose_project` recover JSON-stringified task arrays with stray trailing closing braces, matching a malformed local-model tool call observed in the complex dev-test seed card.
- Matched `decompose_project`'s advertised nullable fields to its runtime parser, so answered questions and optional task hints that use `null` are not rejected before execution.
- Made `write_files` tolerate JSON-stringified batch file arrays from small local models at both the advertised tool schema and execution parser layers.
- Made `write_files` tolerate harmless extra keys on batch file entries, such as range fields copied from read tools, while still validating the actual `path` and `content` fields before writing.
- Blocked exact repeated batch `read_files` requests across NKlein turns, so agents that reread the same file group are steered to use existing context, narrow the requested range, edit, or run acceptance instead of looping.
- Normalized host project paths embedded inside sandboxed bash command strings, preventing agents from misdiagnosing the sandbox as unavailable after running `cd <host temp project> && ...` inside `/workspaces/<task>`.
- Added bounded autonomous timeout defaults to dev-test seed cards and decomposition-generated cards unless a role explicitly opts into unlimited timeouts, so stalled local-model turns surface during autonomous QA instead of hanging indefinitely.
- Lowered the default Docker agent sandbox memory cap from 4096 MB to 2048 MB per container to reduce Docker VM swap pressure on constrained developer machines; saved runtime settings can still raise it.
- Completed successful auto-review cards that finish with an explicit empty sandbox patch, so analysis/no-change generated cards unblock their dependent Planning cards instead of getting stuck in Review.
- Normalized host workspace absolute paths inside sandboxed `list_files`, `find_files`, and `get_file_size`, matching the existing `read_files` recovery path and preventing repeated discovery-tool loops on temp project paths.
- Tightened the complex dev-test decomposition seed so broad test and README cards depend on the implementation leaves they validate or describe, avoiding early test-card scope drift.
- Preserved workspace lock contention during scoped runtime requests so transient state writes retry instead of being misreported as an unknown workspace.
- Treated sandbox result-patch staging failures from already-invalid/non-Git teardown workspaces as benign cleanup, avoiding misleading capture warnings when an interrupted task had no result to preserve.
- Enforced generated-card write scopes in NKlein tool approval so cards with `filesLikelyTouched` can only edit their declared files.
- Forced successful decomposition source cards back to Completed after stopping their NKlein session, closing a race where a late SDK completion event could leave the source card in Review.
- Skipped headless auto-review finalization for cards already in Completed, preventing late NKlein summaries from moving completed decomposition source cards back to Review.
- Skipped headless auto-review finalization for planning-mode cards, leaving decomposition source completion to the dedicated decomposition callback instead of trying to merge a nonexistent task result branch.
- Reduced NKlein's consecutive and repeated tool/schema mistake limits so malformed tool-call loops park quickly instead of burning several autonomous turns.
- Normalized decomposition tasks that set `testFirst: true` without an `acceptanceTestPrompt` back to normal execution, so otherwise valid DAGs are not rejected for an optional test-first hint.
- Added a Windows `start.bat` development launcher that checks Node.js 22+, npm, Git, and Docker Desktop reachability, installs missing repo/web/desktop dependencies, and starts the existing full dev runtime for Windows testing.
- Restored autonomous decomposition under strict Docker isolation: the trusted control-plane `decompose_project` / `expand_task` tools (which mutate only !Klein plan artifacts and the board, never the user's working tree) now stay available host-side during sandboxed planning, so a single high-level prompt can again become a Planning-lane DAG of dependent cards. Planning prompts advertise the decomposition workflow again, and the host workspace root is always forwarded to the session runtime so board/plan mutations resolve to the owning workspace rather than the container workdir.
- Fixed decomposition-generated Planning cards so the original decomposition source card is moved to Completed after successful auto-apply, root cards are requested for automatic start through the runtime queue while dependents remain linked behind prerequisites, default project acceptance commands override brittle per-card shell probes, and routine workspace-resolution polling no longer floods local self-observation telemetry.
- Tightened dev-test decomposition seeds so each scenario gets a distinct task id and prompts explicitly require workspace-relative reads, the real `specification.md` as the source of truth, and valid `acceptanceTestPrompt` values for test-first leaves.
- Stopped the sandboxed NKlein repo-map rail from exposing host-only absolute workspace paths to agents, reducing invalid read/list-file retries inside Docker workspaces.
- Normalized exact host-project path prefixes and workspace-root absolute paths at the sandbox tool-runner boundary, so NKlein file tools recover when a model supplies `/src/...` or the trusted runtime's project path for files that exist inside the Docker workspace clone.
- Added a leaf-scope guard to decomposition-generated card prompts so agents treat the shared spec as context and avoid implementing dependent downstream cards early.
- Fixed normal NKlein task exits (`reviewReason: "exit"`) so they enter the same acceptance/ready handling as hook/attention/error review states instead of leaving generated cards stuck In Progress with captured result branches.
- Added an explicit `minimumTaskCount` guard to `decompose_project` and wired the complex dev-test seed to require 10 leaves, preventing local models from accepting 9-card DAGs as satisfying "at least ten" work.
- Embedded the complex dev-test capability list in the seed prompt so decomposition stays anchored to the intended product spec even when a local model misrecalls a previous `specification.md` read.
- Completed decomposition source sessions automatically after successful auto-apply and kept queued generated root cards in Planning until their NKlein session actually starts, preventing source-card artifact-inspection loops from blocking the generated DAG.
- Tightened the complex dev-test seed with a 12-leaf outline and immediate-tool-call instructions so local models stop spending the first 10 minutes narrating a decomposition plan instead of applying the generated DAG.
- Added an execution-pace guard to generated leaf prompts so implementation cards read focused context once, then edit and run acceptance instead of looping through unchanged files or chat-only plans.
- Blocked duplicate single-file `read_files` requests across NKlein turns until a mutating tool runs, while still allowing focused line-range rereads when context focus has compacted older full-file bodies away and avoiding false coverage after failed batch reads.
- Treated NKlein aborted/done events that include a final agent message as reviewable completions when the user did not cancel the turn, so finished sandbox work is captured instead of leaving generated cards interrupted.
- Fixed follow-up input for sandboxed NKlein sessions to resolve runtime setup from the host project path instead of `/workspaces/<task>`, preventing queued steering messages from breaking the prepared Docker workspace.
- Reconciled NKlein tasks that are already awaiting review when the runtime-state hub attaches, so captured sandbox result branches still enter acceptance/ready handling after a restart or delayed hub subscription.
- Added runtime-side headless auto-review for commit-mode NKlein cards: captured task result branches are moved through Review, merged into the base workspace, completed, and newly unblocked dependent cards are auto-started without requiring a browser client. Task-result auto-merge now ignores project-local `.nklein/nklein` runtime mirrors when checking whether the base workspace is clean.
- Renamed task evidence actions to `Create evidence` and made the board-card control visibly labeled, clarifying that the action creates an evidence bundle and copies the agent-ready prompt; the self-improvement project button remains a separate flow that can consume an evidence bundle path.
- Started the project-portability implementation: workspace state writes now mirror board state, session summaries, revision metadata, and workspace identity into `<project>/.nklein/nklein/workspace/`, and project loads can recover from that workspace-local mirror if the runtime-home workspace cache is missing.
- Hardened decomposition planning against sandbox artifact-inspection loops: successful auto-apply now tells agents to stop the planning card instead of reading control-plane artifact paths, and repeated failed inspections of the same plan artifact path across different tools park the task with a guardrail warning.
- Fixed the complex dev-test follow-through path observed in a 30-minute live run: seeded decomposition cards now pass the fixture acceptance command as `defaultAcceptanceCommand`, workspace diagnostics are scoped by project even when task ids repeat, workspace state loads include live NKlein summaries, and generated implementation cards can be started from the Planning lane into execution.
- Added the strict-isolation safety guards to the protected test suite (no-host-execution guard, Docker sandbox lockdown/fail-closed/uid-isolation, and the fail-closed task-start preflight), so weakening agent isolation now requires explicit human approval.
- Documented `usesLegacyHostTaskWorkspace` as the single host-worktree boundary predicate and locked the retirement invariant with a test: the default NKlein/sandbox agent (and unset agent ids) never create a host task worktree, so under local-only no reachable task start creates one.
- Reconciled the AGENTS.md worktree guidance to the container-workspace + result-branch model, marking the host worktree subsystem as legacy (reached only by disabled terminal/CLI agents and user shell terminals) and recording the precise prerequisites for fully deleting it.
- Added a scripted strict-isolation verification runbook (`scripts/verify-strict-isolation.mts`) that drives a real NKlein task against a local LM Studio/Ollama endpoint in an isolated HOME and asserts the isolation invariants (a sandbox container appears, no host worktree is created, the container tears down cleanly, and start fails closed when the sandbox image is missing). Verified end-to-end against real Docker + LM Studio.
- Treated sandbox result-patch capture failures as benign when the workspace was already disposed concurrently or disappeared during staging, avoiding misleading runtime-error warnings while preserving real capture failures.
- Parked cloud-dependent advisor, web-research, and native NKlein team surfaces under local-only mode: Settings no longer renders advisor actions, env flags no longer expose host web research or SDK team delegation, and the modules remain documented as compile-only parked helpers.

- Renamed the fork's user-facing product to `!Klein` and the command-line entry point/package command to `nklein`, while preserving repository/internal compatibility names where they still matter.
- Replaced the remaining app-brand "NKlein" labels in the UI with `!Klein` (sidebar wordmark, UI error screen, runtime-disconnected screen, and offline fallback now say `!Klein` / `nklein`), while keeping genuine NKlein engine/provider/account references intact.
- Kept the current robot app mark for `!Klein 0.0.1`, renamed the sidebar icon component to `NKleinMark`, and removed the leftover `NKleinIcon` UI component name.
- Continued the rename migration across desktop metadata, protocol handling, runtime env vars, workspace headers, session cookies, runtime-home paths, and terminal/status surfaces, with one-release compatibility fallbacks for legacy `KANBAN_*` env vars plus legacy workspace header/cookie acceptance.
- Swept remaining user-facing `Kanban` wording from launch scripts, runtime messages, desktop shims, model/tool prompts, and UI tests, and allowed the new `x-nklein-workspace-id` CORS header alongside the legacy header.
- Kept the sidebar `!Klein Agent` in local-only mode from auto-launching terminal/cloud CLI agents such as Claude, defaulted settings back to local NKlein, hid cloud agent rows behind a static local-only settings line, and limited onboarding to the local NKlein agent when cloud support is disabled.
- Taught the desktop runtime health probe to recognize both the current `!Klein` browser title and the legacy `Kanban` title during the rename transition, so packaged shells can still attach to already-running older runtimes.
- Tightened the Electron shell with regression coverage for isolated/sandboxed renderer preferences, packaged devtools disabling, deny-by-default popup handling, and a CSP on the disconnected recovery page; desktop window/menu fallback titles now use `nKlein`.
- Added a small brand-regression guard that scans UI/CLI user-visible strings and fails if a new accidental app-brand `NKlein`/`Kanban` string slips back in outside the explicit engine/legacy allowlist.
- Hid cloud-only NKlein account/sign-in affordances in the local-only UI, filtered cloud providers out of task/setup/settings pickers, gated Featurebase/cloud feedback behind the shared runtime cloud-support flag, and removed the `Cloud` timeout-profile option when cloud providers are disabled.
- Added an `Open data dir` shortcut to Developer Tools, verified the gated dev-test sidebar tools are present in the web UI, and cleaned up stale follow-up checklist statuses so the docs match the shipped debug/developer surfaces.
- Added automatic migration from legacy `~/.nklein/kanban` runtime data into `~/.nklein/nklein`, plus browser localStorage key migration from `kanban.*` to `nklein.*`, so existing installs keep their plans, telemetry, dev runs, config, code index, and UI preferences.
- Added a task-detail `Create evidence` action backed by a typed runtime evidence bundle endpoint, capturing card prompt, base ref/commit, worktree path, transcript, bounded diff evidence, and runtime config before copying a ready-to-paste external-agent prompt.
- Added a separate protected-test runner (`npm run test:protected`) with a curated manifest and co-located rationale docs, plus write-guard blocks for protected-suite paths and config files.
- Added topic-based guidance routing for decomposition-generated cards, injecting the matching `/nklein-security`, `/nklein-ui`, or `/nklein-ts` skill command from a maintained topic map.
- Added structured protected-test edit denial payloads with `intent`, `diff`, `reason`, and `expectedEffects`, so blocked agents can ask for exact human review through the existing follow-up question channel.
- Added one-use protected-test edit approvals in the NKlein chat panel, scoped to the exact structured request and audited to local telemetry before the matching retry is allowed.
- Added a create-task prompt template menu with quick starts for bug fixes, small features, tests, security review, and decomposition.
- Added create-task context imports from local files, GitHub issues, and GitHub PR diffs, appending bounded context blocks directly into the task prompt via the local `gh` CLI for GitHub sources.
- Added a task-detail evidence drawer after evidence collection, showing the bundle path, generated evidence files, transcript paths, and copied external-agent prompt block.
- Expanded the task-detail evidence drawer into a consolidated evidence/diff viewer with tabs for summary, bounded diff evidence, and the external-agent prompt.
- Added a gated Developer Tools self-improvement flow that loads the currently running dev checkout, accepts optional notes/evidence, and seeds a protected-guarded NKlein Backlog task.
- Pinned self-improvement tasks seeded from an evidence bundle to the recorded evidence `baseCommit`, so follow-up work starts from the version that produced the evidence instead of drifting to the current branch head.
- Expanded the sidebar Project Health card into a compact diagnostics dashboard that lists every health issue for affected projects, including pending artifacts and lost-session artifact warnings.
- Added Git clone ref selection for project add, letting cloned projects check out a branch, tag, or commit in detached mode after clone.
- Added an additive command palette on `Cmd/Ctrl+K` for core board actions including new task, add project, settings, git history, backlog start, and Developer Tools.
- Added a local-model setup action to the empty project state so first-run users can open onboarding before adding their first repository.
- Reduced stale local model telemetry noise by sharing the loaded-model filter across Settings and task chat, labeling registry rows as past telemetry, adding per-row removal plus Clear stale models actions, and showing the selected loaded model's live context window in both places.
- Renamed the persistent debug toggle to a global Developer Mode setting, moved it into General settings, made saved values override debug env vars, and gated sidebar dev-test scenarios, command-palette Developer Tools, debug tools, data-dir, and reset surfaces behind that setting.
- Added the first Docker agent-sandbox boundary: a pinned sandbox image build, in-container SDK tool runner, Docker-backed NKlein default tool executors, sandboxed acceptance verification, and NKlein starts that no longer create host task worktrees.
- Added persisted Docker agent-sandbox pool settings for container count, agents per container, memory, CPU, and idle timeout, with General settings controls and runtime manager wiring for new placements.
- Added Shared and Dedicated sandbox pool presets in General settings as shortcuts over the existing numeric pool controls.
- Added Docker agent-sandbox preflight status to Settings and made NKlein task starts fail closed with the sandbox remediation message when Docker or the sandbox image is unavailable.
- Fixed Docker agent-sandbox queue draining so freed slots are reserved before async startup waits, preventing queued tasks from overfilling a container or blocking later idle teardown.
- Added a typed queued task-session state for sandbox-capacity waits, including card-visible "Queued — waiting for sandbox capacity" activity and active-task accounting.
- Applied live sandbox pool setting changes to the active manager so lowering max containers retires only idle excess containers and lets occupied excess containers finish before cleanup.
- Routed !Klein's custom NKlein workspace tools through the Docker sandbox tool-runner for sandboxed NKlein tasks, covering repo map/search, file discovery, large-file reads, and write-file tools.
- Prevented env-enabled web research from registering on sandboxed NKlein tasks, preserving the no-host-network strict isolation boundary.
- Omitted host-side decomposition tools from sandboxed NKlein sessions and adjusted strict-isolation planning prompts so agents do not call unavailable host mutation workflows.
- Added Docker-gated agent-sandbox lifecycle integration coverage and fixed the real-image issues it exposed: workspace volume permissions, first-workspace bootstrap workdir, CJS tool-runner bundling, task-owned cleanup under `--cap-drop ALL`, binary patch capture, and Docker stderr in sandbox execution errors.
- Added Docker-gated sandbox pool queue coverage for the real one-container/two-agent wait/release path.
- Required NKlein task-session service construction to pass an `AgentSandboxManager`, with only an explicit test-only unisolated mode for in-process unit harnesses.
- Captured completed sandbox task changes as binary patches into deterministic `nklein/tasks/<task>` result branches via a temporary Git index, keeping the user's checkout clean while review diff, evidence, and merge flows prefer the branch over legacy host task worktrees.
- Added discard cleanup for sandbox task result branches, threading `preserveChanges=false` through permanent task delete, Clear Trash, project removal, dev cleanup, and Replay while leaving ordinary move-to-trash cleanup on the preserving path; restoring from Trash now resumes from the preserved result branch when present.
- Routed runtime task acceptance verification through the scoped NKlein task-session service, reusing the configured sandbox pool and pause controller instead of constructing an endpoint-local Docker sandbox manager.
- Reconciled sandbox/result-branch wording across prompts, CLI help/errors, merge observations, evidence summaries, auto-review notices, project-health diagnostics, and cleanup confirmations so visible surfaces describe task workspaces and task results instead of host task worktrees.
- Reused the scoped runtime sandbox pool for acceptance auto-repair and the default `nklein task verify` path, removing the remaining ad hoc acceptance-verification `AgentSandboxManager` instances outside runtime-server ownership.
- Stopped web and CLI NKlein/default task starts from pre-creating host task worktrees before sandbox launch, while retaining the legacy host-worktree preparation path for explicitly non-NKlein task agents.
- Scoped shutdown host-worktree cleanup to explicit legacy task agents and de-duped managed/indexed workspaces by canonical path, so NKlein/default sandbox tasks are interrupted without entering saved host-patch cleanup.
- Scoped host task-workspace metadata polling to explicit legacy task agents, so active NKlein/default cards no longer publish fake missing host-workspace paths while terminal-agent worktrees still report Git status.
- Decoupled task commit/PR prompt dispatch from host task-workspace metadata, using each review card's base ref for `{{base_ref}}` so sandbox-native NKlein/default tasks can request git actions without a host worktree path.
- Stopped trashed default/NKlein sandbox cards from reconstructing synthetic `~/.nklein/worktrees/...` paths, while preserving that fallback for explicit legacy host-workspace agents.
- Kept Commit/Open PR controls visible for sandbox result-branch review tasks by recognizing captured result patches even when no host task-workspace snapshot exists.
- Updated auto-review commit/PR scheduling to use sandbox result-patch dirty/clean signals when host workspace metadata is unavailable, and neutralized its durable notices away from host-workspace wording.
- Fixed sandbox task result capture after local agent commits by diffing the staged index against the task base ref, and rewrote default Commit/Open PR prompts to stay inside the isolated workspace/result-branch flow instead of mutating host worktrees.
- Made acceptance-gate host execution explicit opt-in, so agent acceptance checks use the sandbox path instead of silently falling back to host shell execution.
- Added a no-host-execution guard test for sandboxed SDK default tools and sandbox acceptance checks.
- Reaped stale Docker agent-sandbox containers and generated workspace volumes on runtime startup, so crash leftovers are removed before new sandbox work begins.
- Persisted Docker agent-sandbox start failures on task cards, keeping the remediation visible after the failed start toast.
- Disabled stdio MCP servers under strict agent isolation, returning a warning instead of spawning local MCP subprocesses.
- Gave the NKlein context-usage bar its own full-width chat-panel row and widened the active-card mini context bar so context telemetry no longer competes with model/activity controls.
- Added subtle per-message NKlein chat timestamps with persisted collapse/expand controls and duration hover details.
- Moved board pause stop-signal files from `.nklein/kanban` to `.nklein/nklein`, while reading and clearing the legacy path during the rename transition.
- Made board pause park native NKlein tasks at the next turn checkpoint with a distinct `paused` session state, aborting the SDK before another turn and automatically continuing paused tasks when the board is resumed.
- Made board/card pause park and abort active native NKlein tasks immediately, and added a pre-dispatch pause gate so queued/restart paths cannot make additional LLM requests while paused.
- Added per-card Pause/Resume controls backed by durable `.nklein/nklein/paused-tasks.json` state, runtime API mutations, immediate board/session updates, and restart-aware NKlein pause-controller hydration.
- Made Docker-backed SDK tool executors and sandbox acceptance checks honor board/card pause before running side effects, with task stop/abort rejecting queued pause waits.
- Marked structured `run_commands` failures with the same collapsed chat failure indicator as top-level tool errors, and added next-step guidance for structured command failures.
- Added next-step guidance to Docker sandbox tool failures, including failed `bash` executions and tool-runner failures, while avoiding duplicate guidance when an error already contains it.
- Added a specsheet follow-up to ship a purpose-built in-sandbox operator for real command execution inside the Docker image.
- Added an opt-in finished-card Replay control, disabled by default in global settings, that confirms before stopping the old session, clearing the prior task workspace/session state, and starting again from the original card prompt.

- Made project registration explicit on startup, added self-source confirmation for loading !Klein as a project, and blocked implicit task-worktree project registration.
- Added durable decomposition artifact manifests, provenance on generated Planning cards, and idempotent graph application so retrying a plan does not duplicate cards or links.
- Added a decomposition auto-apply setting plus pending artifact Apply/Reject actions on source card details for manual plan review and recovery.
- Added a lost-heartbeat policy setting for NKlein sessions, defaulting to Park + actions with a recovery warning while preserving the latest transcript/activity for resume or interruption handling.
- Added a Mark interrupted recovery action for lost NKlein sessions on task details.
- Added task-detail Verify and Merge actions for acceptance-check and review cards, backed by typed runtime endpoints that run checks in task worktrees and report merge conflicts inline.
- Added durable auto-review notices on cards, so failed/no-op auto-commit and auto-PR attempts explain the recovery path instead of only surfacing transient UI feedback.
- Preserved full per-task NKlein context/timeout overrides when changing detail-panel model settings, and clarified context/timeout labels in settings surfaces.
- Added an Advisor send flow in settings that sends generated prompts to a selected local NKlein model and shows response output with sent/received timestamps.
- Added runtime-configured code intelligence embeddings with global defaults, project overrides, OpenAI-compatible local endpoint support, automatic LM Studio endpoint/model discovery, embedding-model-first sorting, and project sidebar status that shows the effective provider/model.
- Added `/models` discovery and endpoint tests for custom OpenAI-compatible providers and code-intelligence embedding endpoints, including one-click model loading in the setup/settings UI plus LM Studio and Ollama helper examples to reduce local endpoint guesswork.
- Added project health detection for accidental task-worktree projects, with sidebar inspect/remove/migrate choices and explicit plan-artifact migration back to the detected parent project.
- Added project health diagnostics for pending generated plan artifacts that have not yet been applied or rejected.
- Added project health diagnostics for lost NKlein sessions that still have pending generated artifacts needing review.
- Recorded task-scoped telemetry when turn checkpoint capture fails, keeping task start best-effort while making recovery-impacting checkpoint loss visible.
- Recorded task-scoped telemetry when generated plan artifacts cannot be auto-applied, keeping artifacts pending while making the recovery failure diagnosable.
- Recorded task-scoped recovery telemetry when NKlein session reload/rebind paths fail, so restart/resume problems surface as actionable recovery diagnostics instead of only generic start failures.
- Added sanitized plan-artifact lifecycle telemetry for create/apply/reject transitions, logging only artifact metadata and counts rather than plan prompts or contents.
- Added lost-session recovery transition telemetry for persisted-session rebound and explicit interrupted recovery actions, making those recovery choices visible in diagnostics.
- Logged workspace resolver decisions for explicit workspace ids, explicit project paths, detected parent task-worktree ownership, existing index hits, and rejected task-worktree auto-registration.
- Rebased single-card board move conflicts in the web client against the latest workspace state before retrying save, preserving simple user drag actions instead of always forcing a full refetch.
- Added a persistent inline board notice for unsafe save conflicts, so users get retry/reapply guidance after sync instead of relying on a transient toast alone.
- Preserved the last local board edit across unsafe save conflicts by syncing the latest board state first and offering an explicit restore-my-edit recovery path instead of forcing the user to redo the change.
- Added deterministic replay for single board operations during save-conflict recovery, so one-card edits and single dependency changes can be reapplied against the latest revision instead of always falling back to manual recovery.
- Hardened self-observation telemetry redaction for prompt-like metadata keys, so specs, plans, summaries, and prompt bodies are dropped before local telemetry is written.
- Kept best-effort task-worktree cleanup failures out of the main UI toaster path, so non-blocking cleanup noise stays diagnostic-only unless recovery actually depends on it.
- Routed NKlein decomposition artifacts and generated cards to the parent workspace even when the NKlein task runs inside its task worktree, with a 10-card regression matching the stalled complex dev-test failure mode.
- Preserved runtime-owned task session state during UI board saves, so stale browser snapshots cannot move a running/review/lost session backward.
- Made browser board saves session-free; the runtime now attaches current session state server-side and low-level board-only saves preserve existing sessions.
- Tightened the public workspace save contract to board-only persistence, so browser saves no longer accept task-session payloads and the runtime/session layer remains the sole owner of session summaries.
- Moved settings-side dogfood/smoke-eval controls and sidebar dev-test project tools behind debug-mode Developer Tools gating so normal settings stay focused on user-facing runtime configuration.
- Hardened dev-test cleanup with a durable !Klein marker, confirmation prompts, scoped stale patch removal, marked-project-only deletion, and partial-failure reporting.
- Enforced local-only NKlein model usage: cloud provider selections are ignored or hard-stopped, cloud providers and recommendations are hidden from the picker, routing drops cloud candidates, and cloud-blocked cards are parked with a clear local-model message.
- Added a !Klein-owned effective context ceiling for NKlein starts/restarts and proactive pre-send overflow telemetry, so oversized prompts are compacted or blocked before provider dispatch.
- Removed the 200k effective-context clamp for local NKlein models, preserving million-token advertised windows end-to-end while keeping overflow guards, native compaction, and budget bars on the same resolved window.
- Improved oversized single-prompt failures with a specific recovery message, cold-start timeout floors for models without speed samples, and a regression guard that blocks persisted cloud launch metadata during overflow restarts.
- Passed MCSR/user effective context windows through runtime routing into native NKlein starts and chat budget displays, preventing provider-advertised windows from overruling !Klein's effective guard.
- Persisted sanitized NKlein launch metadata with SDK sessions and reused it during resume/overflow recovery, preventing recoverable compaction restarts from failing with missing session config.
- Treated legacy cloud timeout profiles as local-model timeouts and clamped positive NKlein timeouts to at least 60 seconds, so slow local model sessions cannot inherit stale one-second request, stream, tool, agent, or conversation limits.
- Raised positive local NKlein timeouts from MCSR speed observations at task start, using measured wall-time-per-1k prompt tokens, prefill/decode rates, TTFT, and wall-time samples while preserving unlimited mode.
- Added an effectively unlimited timeout mode as the fix for the HTTP "body timeout error" (undici `UND_ERR_BODY_TIMEOUT`) that otherwise aborts long-running local model streams: selecting it disables !Klein's request, stream, tool, agent, and conversation timeouts so a slow local model can finish a long turn without its response body being timed out mid-stream.
- Parked NKlein tasks after repeated identical start/send failures, suppressing duplicate failure telemetry and system messages once a task is clearly stuck.
- Hardened NKlein acceptance checks to use a non-login shell with an explicit PATH fallback and a larger output buffer, avoiding shell-init hangs and false failures from large passing output.
- Tightened acceptance auto-repair prompts so failing assertions and TypeScript/compiler errors are extracted as explicit next-turn constraints before the bounded raw output.
- Centralized passcode session cookie construction and added coverage for strict `HttpOnly`/`SameSite=Strict` flags plus TLS-only `Secure` cookies while keeping the runtime bound to `127.0.0.1` by default.
- Added obvious-secret scanning to NKlein agent write approvals and direct write-file tools, blocking private keys, provider tokens, GitHub tokens, AWS access keys, and long credential assignments before files are written.
- Added an opt-in best-effort local-only egress environment for task-agent PTYs via `NKLEIN_AGENT_EGRESS_RESTRICTION=best_effort_local_only`, blackholing proxy-aware outbound traffic while preserving loopback access for local runtimes.
- Added a backend-fed NKlein context budget breakdown and segmented chat-panel bar using the effective context window, with fallback to the existing estimate when breakdown data is unavailable.
- Normalized NKlein context budget bar segment widths so they sum to the visible budget width and cannot overflow narrow panels.
- Added routing regression coverage for preferred feasible local models and candidate-specific 32k/80k context-window assignment.
- Split retained `read_files` / `read_large_file` results into the context budget bar's included-file segment instead of hiding that content inside other history.
- Applied decomposed NKlein task graphs into the Planning lane, normalized persisted boards to include Planning, and let dependency-unblocked Planning cards flow into execution.
- Seeded the !Klein decomposition prompt as an overridable NKlein workflow and resolved `/kanban-decompose` through the user instruction service instead of hardcoding the prompt into runtime starts.
- Added recursive `decompose_project.expansions`, so oversized decomposition leaves can be replaced in one validated tool call with bounded-depth splitting and dependency rewriting to terminal replacement tasks.
- Made `decompose_project` explicit when connected local model fit has not been validated yet, and kept slug-colliding decomposed task IDs disambiguated with regression coverage.
- Added clarification-question support to decomposition plans: the workflow asks for questions/assumptions, `decompose_project` rejects unresolved open questions, and `questions.md` is written and exposed with plan artifacts.
- Added lightweight clarifying-question answer chips to the NKlein chat panel, with answers sent through the existing planning chat turn and free-text composer still available.
- Added `summary.md` to decomposition plan artifacts and exposed `summaryPath`, giving the later Planning DAG review a plain-language summary to display.
- Tightened the NKlein context budget display to use effective model-window wording, retain the segmented health-colored bar, and label fallback estimates as fallback working budgets instead of available model context.
- Improved NKlein context budget breakdowns by retaining the SDK system prompt per task and estimating enabled !Klein tool-schema overhead instead of leaving tool tokens at zero.
- Enforced the project task concurrency cap across UI starts, dependency auto-starts, and backend runtime starts, while preserving the fast Codex restore path by counting only already-loaded NKlein services.
- Unified local endpoint serialization with the local-only provider policy, so custom local OpenAI-compatible endpoints are serialized by URL while distinct local endpoints can run in parallel.
- Broadened NKlein model tool-routing rules so weak local model families, including custom local OpenAI-compatible providers, receive a trimmed SDK default toolset while stronger models keep the full tool surface and NKlein's typed sequential execution default.
- Added workspace-scoped NKlein file discovery, file-size, retrieval, large-file, and batched write tools, with context-budget-aware read guidance and per-file write limits.
- Added a local-gated NKlein web research tool for current HTTPS sources on an allow-list, intended for docs, model, MCP, and changelog research without enabling arbitrary browsing.
- Added NKlein team delegation and team-progress projection so multi-agent SDK activity can be tracked and summarized inside !Klein.
- Personalized repo-map ranking around current task/chat text, explicit repo-map queries, and seed paths, so small local models see symbols relevant to the active card instead of only globally central code.
- Merged repo-map symbol matches into `search_code` alongside lexical line hits and semantic code-index chunks, giving small local models hybrid retrieval that orients around relevant symbols even when the query only matches file paths or declarations.
- Seeded overridable `!Klein` guidance skills for security, UI, and TypeScript into each workspace's NKlein skills config and enabled the SDK skills extension so small local models can load terse topic guidance on demand.
- Added compact codebase-specific examples to the seeded guidance skills so matched skill prompts include concrete !Klein patterns for small local models.
- Added task-card `Create evidence` and dev-test "Copy evidence" actions so evidence bundles can be collected and copied without opening the detail panel or dropping to the CLI.
- Made decomposition role assignment write the NKlein router-selected role settings onto created Planning cards, including route-up cases and default-model selections.
- Added structured `endpoint_busy` NKlein start responses with MCSR-derived retry estimates for same-local-endpoint contention.
- Added queued local-endpoint admission for dependency auto-starts, so same-endpoint NKlein tasks are deduplicated, paced by MCSR wait estimates, and retried when the busy local endpoint frees.
- Persisted `filesLikelyTouched` on decomposition-created cards and used it to skip overlapping task starts across UI single starts, start-all, dependency auto-starts, and CLI `task start`.
- Added `decisions.md` plan artifacts and compact shared spec/decision injection for decomposition-created cards, so dependent NKlein tasks inherit the same plan contracts.
- Added `nklein task merge` to merge reviewed/completed task worktree heads into a clean base worktree in dependency order, abort conflicts, and create a Planning integration card with conflicted paths.
- Wired `nklein task done` to auto-merge reviewed task worktrees before cleanup/dependent auto-start, preserving worktrees and creating integration cards when merges block or conflict.
- Added a workspace swarm stop signal with `nklein task swarm-stop` / `swarm-resume`; project task starts now return a typed `swarm_stopped` response while paused.
- Recorded typed self-observation telemetry when native NKlein reaches the consecutive mistake guardrail and stopped the task through the SDK callback, making repeated tool/API failure stalls diagnosable.
- Added a NKlein autonomous turn-budget guardrail that aborts over-budget task sessions, parks the card for review, and records `budget_wall` telemetry with checkpoint evidence.
- Added a !Klein repeated-tool stall watchdog for NKlein tasks, parking sessions after 5 repeated non-attention tool starts with the same input and surfacing the limit in settings.
- Bounded NKlein tool transcript inputs, outputs, and errors, including stack-noise filtering plus next-step hints for failed tools so small local models keep more usable context.
- Added a board-level Local swarm strip with running/waiting/blocked counts and a Pause/Resume control wired to typed runtime swarm-stop endpoints.
- Added Local swarm nudges for single-endpoint serialization and model-load-aware start-all ordering that prefers cards targeting an already-running local model.
- Added an inline Local swarm concurrency slider that saves `maxConcurrentTasks` from the board header.
- Added local shared-endpoint ids to NKlein session summaries and surfaced per-endpoint running utilization in the board Local swarm strip.
- Enriched running task cards with compact swarm telemetry: token counts, approximate output tok/s, elapsed time, turn count, current activity/tool, and a mini context-budget bar.
- Added Advanced policy visibility in settings for routing policy, context-budget inputs, acceptance command source, and local telemetry diagnostics paths/limits.
- Added a board-level code-intelligence chip to surface repo-map/index readiness from the existing typed runtime status endpoint.
- Added a no-LLM task Diagnostics panel backed by local self-observation JSONL telemetry and a typed runtime `getTaskDiagnostics` endpoint.
- Added a card-detail Activity surface that summarizes planning/routing, context budget, current tool activity, and acceptance state from existing session data.
- Promoted acceptance and merge into Activity pipeline steps backed by local diagnostics, and recorded task-scoped worktree merge telemetry for merged, skipped, blocked, and conflicted merge outcomes.
- Stamped decomposition-created cards with backend model-fit evidence from the NKlein routing guard and surfaced that evidence as a Planning DAG fit badge.
- Expanded the Planning DAG review panel to show the full connected dependency component around the selected card, including indirect linked plan cards.
- Added revised-plan flags to the Planning DAG panel for integration, decision, contradiction, split, and decomposition-blocked adaptation cards.
- Added an explicit Planning DAG approval action that marks plan-mode Planning cards execution-ready without clearing revision metadata.
- Added `revisions.md` plan artifacts and exposed `revisionsPath` through decomposition tool, CLI, and dogfood API outputs for future adaptive re-planning audit trails.
- Added `nklein task plan-gap` and a typed `plan_gap` self-observation signal so execution agents can report missing decisions, contradictions, dependencies, oversized scope, or unplanned integration work.
- Let `nklein task plan-gap --kind integration_needed` create a Planning integration card with evidence while returning the created card in the command response.
- Broadened acceptance failure plan-gap classification with domain patterns for unresolved decisions, contradictions, missing packages/files/commands/config/schema, and scope/resource exhaustion.
- Recorded a concrete `integration_card_added` plan revision when automatic integration-card adaptation runs with `--plan-slug`.
- Added bounded plan-gap adaptation cards for scope and decision gaps: oversized cards are blocked for decomposition, decision/contradiction gaps pause into Planning, and repeated adaptations reuse the existing Planning card.
- Recorded concrete `decision_card_added` and `scope_split_card_added` revisions when adaptive plan-gap cards are created for a known decomposition plan.
- Added `nklein task expand-plan-task` to apply approved recursive replacement tasks to saved plan DAGs, re-link dependencies through entry/terminal replacements, and append `recursive_task_replaced` revisions.
- Fixed NKlein team-progress summaries so `task_end` events with string-shaped errors are reported as failures instead of completions.
- Named and documented NKlein context-budget policy constants for reserve caps, unknown-window fallbacks, pressure curves, and file chunk sizing without changing budget behavior.
- Documented the NKlein repo-map heuristic and refreshed cached repo maps after successful workspace-mutating tools, so code-orientation context no longer stays stale after edits.
- Upgraded NKlein repo maps with TypeScript AST symbol extraction, PageRank-style reference/import ranking, stable prompt-prefix ordering, and tests for refreshed, first-position repo-map rails.
- Debounced NKlein model-registry persistence so observations update the in-memory MCSR immediately while locked disk writes are coalesced, with fractional EWMA speed stats preserved across reloads.
- Switched NKlein model-registry event extraction to the SDK session-event types, recording observations from typed usage events plus !Klein-measured request duration instead of guessed `run-finished` payloads.
- Recorded explicit local NKlein launch context windows into the model registry immediately and added advertised/observed/user-override context-window precedence for MCSR entries.
- Added first-run NKlein onboarding controls for setting a local model context-window override and seeding model roles with the selected reasoning effort.
- Hardened `nklein dev smoke-eval` to score only local NKlein providers and include the selected local model plus guard, overflow, and timeout telemetry counts in the evidence bundle.
- Added a local dev smoke fixture, NKlein eval harness, and evidence bundle writer so local-model runs can capture prompts, telemetry, diffs, and score artifacts for regression review.
- Let `nklein task plan-gap --plan-slug <slug>` append concrete gap entries to a plan's `revisions.md` audit trail while still recording the structured self-observation signal.
- Recorded automatic `plan_gap` telemetry when acceptance verification finds a missing acceptance contract or exhausts repair/escalation attempts.
- Added an expandable NKlein model telemetry panel backed by the MCSR, showing local-only model endpoint, context-window, throughput, latency, capability, samples, and missing-window prompts.
- Included configured local NKlein provider/model selections and model-role roster entries in MCSR responses even before they have telemetry samples.
- Improved fallback NKlein model labels on task cards so raw provider-qualified GPT/Claude IDs render as readable model names when the provider catalog is not loaded.
- Replaced cloud NKlein examples in task CLI help with local-model examples and added a production-source boundary scan for cloud-provider literals.
- Added a NKlein code-intelligence status panel in settings, exposing repo-map availability and code-index cache coverage, staleness, embedding metadata, cache path, and search readiness.
- Made MCSR capability scores age-aware by decaying old eval/pass-rate evidence toward the static prior instead of letting stale observations dominate forever.
- Improved startup onboarding for local NKlein setup: it reopens when NKlein lacks a configured local model, shows detected Ollama/LM Studio endpoints and loaded models, and seeds architect/worker/reviewer roles from the selected local model on first save.
- Let `nklein task plan-gap` infer the owning decomposition plan from decomposition-created task IDs, so inferred integration-card adaptations append to `revisions.md` without requiring `--plan-slug`.
- Classified exhausted acceptance failures that clearly indicate missing dependencies, contradictory requirements, or oversized scope as structured `plan_gap` events instead of always recording a generic review gap.
- Added a guided first-run local endpoint start panel with Ollama and LM Studio download links plus install, server-start, model-load, and verification commands.
- Added a NKlein autonomous wall-time guardrail that aborts over-budget task sessions, parks the card for review, and records `budget_wall` telemetry with checkpoint evidence.
- Added a repeated no-diff checkpoint watchdog for NKlein tasks, parking sessions that keep checkpointing the same commit without producing new diff progress.
- Added ownership-aware task worktree sync and !Klein-created repository markers, preserving agent edits on overlapping paths and safely cleaning repository metadata only for repos !Klein owns.
- Hardened project removal/re-add flows so task worktrees and saved task patches are cleaned up consistently and stale task content cannot be restored accidentally.
- Added a Planning card DAG review panel in task detail, showing linked prerequisite/dependent cards with status, complexity, likely files, and model/agent hints.
- Added a Local swarm guardrails section to settings, surfacing the current concurrency cap plus enforced NKlein turn, wall-time, no-diff, and mistake guardrails.
- Added local-only per-model NKlein context-window overrides, with a typed runtime save/clear API plus controls in both the Model Telemetry panel and NKlein settings.
- Added live code-index progress reporting for local code search, surfacing scan/embed/cache-write phases plus file/chunk and cache hit/miss counters in NKlein settings.
- Enriched the card Activity surface with explicit card-selected/runtime-selected routing details and a separate retrieval/indexing step for file and code-search tools.
- Recorded initial `recursive_split` plan revisions when `decompose_project.expansions` rewrites oversized tasks before saving the plan graph.
- Added a shared 12-card swarm batch budget for start-all and dependent auto-start launches, surfaced alongside the other Local swarm guardrails in settings.

## [Cline Kanban 0.1.68]

- Codex hooks are now pre-trusted, eliminating permission prompts when !Klein manages Codex sessions
- Fixed signal handling to properly re-raise signals and ignore SIGQUIT for cleaner process cleanup
- Updated NKlein SDK from 0.0.36 to 0.0.38, which includes: new OpenAI ChatGPT Subscription and v0 providers, Ollama no longer requires an API key, file-based and event-driven automation, auto-compaction for provider requests, per-turn usage metrics on assistant messages, normalized provider usage costs, web fetch enabled by default in act mode, various message handling and abort fixes

## [Cline Kanban 0.1.67]

- "New version available" notification with one-click update from the web UI
- Renamed the "Trash" column to "Done" and added CLI command aliases
- Allow entering a custom model ID when no matching models are found in the model selector
- Use Codex hooks for task state transitions
- Fixed stale worktree setup locks not being cleaned up on shutdown
- Fixed task ID generation to avoid timestamp-derived fallback IDs
- Added scaffolding for an Electron desktop app (not yet available)

## [Cline Kanban 0.1.66]

- Added a refresh button for LiteLLM and custom provider model lists, so you can re-fetch available models without leaving settings
- Enforced origin and host validation on the !Klein websocket service to prevent unauthorized connections

## [Cline Kanban 0.1.65]

- Model catalog now auto-refreshes on startup so newly available models appear immediately
- Fixed task cards resizing and causing layout shifts on the board
- Fixed initial NKlein message not being sent after starting a new session
- Added runtime child process manager for the desktop app

## [Cline Kanban 0.1.64]

- Multi-line diff comments: Shift+click to select a range of lines, click the line number to open the comment box, and comments now include file path, line number, and column context
- File tree panel in diff views can now be toggled open or closed
- Task title editing now requires clicking the pencil icon that appears on card hover, preventing accidental edits when clicking the card

## [Cline Kanban 0.1.63]

- Fixed task detail view being lost on page refresh
- Fixed API key getting reset when modifying NKlein agent settings
- Fixed !Klein agent starting in thinking state instead of idle

## [Cline Kanban 0.1.62]

- Fixed NKlein chats on the home screen not resuming correctly from persisted history, causing conversation context to be lost
- Fixed NKlein thinking indicator hiding prematurely during active requests
- Reasoning blocks now animate their collapse after finishing streaming
- Fixed model selector not scrolling to the selected model when opened, and improved visual clarity of the selected model and reasoning effort states

## [Cline Kanban 0.1.61]

- Added device code authorization for signing into NKlein on remote systems
- Revamped theme system with new theme picker and improved color palettes
- Fixed duplicate MCP tool registration when using SDK 0.0.34
- Fixed MCP settings not showing up during NKlein setup

## [Cline Kanban 0.1.60]

- Choose a different agent per task, or change the model and provider for NKlein tasks, when creating tasks from the board
- Adds remote file browser for adding projects when running !Klein on a remote server, with git clone support for adding projects by repository URL
- HTTPS and passcode authentication support for secure remote access
- Adds Kiro CLI agent support
- Pick from 10 new color themes to personalize your board
- NKlein account organization switching and credit balance display in settings
- Set and edit task titles
- Incremental expand in the diff viewer -- click to show 20 more lines in collapsed context blocks
- Mobile-responsive layout for the web UI, including adaptive navigation, task detail views, and chat panels
- Friendly labels for task commands (like file edits and shell commands) in the sidebar chat
- NKlein credit usage notifications with a link to manage your plan
- Fixed startup onboarding reappearing after being dismissed
- Fixed browser back button not returning from task detail view to the board
- Fixed chat state not reinitializing properly when resuming a trashed task
- Fixed `/clear` not fully resetting chat for restored sessions
- Fixed diff mode toggle not reflecting its active state
- Fixed detached notification process orphans on shutdown
- Disabled unnecessary startup update checks for Codex agent
- Faster trash restore for Codex tasks by skipping unnecessary session probes
- Redesigned settings dialog with sidebar navigation, scroll-spy highlighting, and card-style sections
- Updated NKlein SDK from 0.0.28 to 0.0.33, which includes: checkpoint support (configurable, disabled by default), correct model list for NKlein provider via OpenRouter, compaction at 95%, steer messages fix, and team agent identity in event payloads

## [Cline Kanban 0.1.59]

- Added a beta hint card to the project sidebar with quick access to send feedback or report issues
- Added "Read the docs" button in the settings dialog linking to documentation
- Adjusted prompting for the commit button to better handle stale git lock files and multiple stashes at once

## [Cline Kanban 0.1.58]

- More panels are now resizable (agent chat, git history, and more) and your layout preferences persist across sessions
- Adds full Factory Droid CLI agent support
- Add, edit, and delete custom OpenAI Compatible providers from the settings dialog
- Fixed trashed task cards being openable from the board
- Fixed git history cache not clearing when closing the view
- Terminal cursor defaults now match VS Code behavior
- Feedback widget no longer triggers authentication until you actually click it
- Updated NKlein SDK from 0.0.24 to 0.0.28, which includes: OpenAI-compatible provider support via AI SDK, custom provider CRUD in core, better handling of overloaded and insufficient-credits errors, fixed tool schema format for OpenAI-compatible providers, accurate input token reporting

## [Cline Kanban 0.1.57]

- Added `nklein --update` command so you can check for and install updates manually
- Fixed Windows agents (like Codex) being incorrectly launched through cmd.exe when they're native executables
- Reduced latency when switching between projects
- Restored the feedback widget with proper JWT authentication
- Fixed telemetry service configuration for NKlein agents
- Updated NKlein SDK from 0.0.23 to 0.0.24, which includes reasoning details support and improved JSON Schema handling for tool definitions

## [Cline Kanban 0.1.56]

- Automatic context overflow recovery: when the conversation history exceeds the model's context window, !Klein now compacts old messages and retries instead of failing
- Credit limit errors (insufficient balance / 402) are now surfaced immediately without unnecessary retries or confusing system messages
- Added report issue and feature request links to the settings dialog
- Added NKlein icon to browser notifications
- Updated NKlein SDK from 0.0.22 to 0.0.23, which includes: LiteLLM private model support, provider-specific setting configs, loop detection as a built-in agent policy, provider ID normalization for model resolution, OAuth token refresh fix for spawned agents

## [Cline Kanban 0.1.55]

- Fixed non-ASCII file paths (e.g. Japanese, Chinese, Korean characters) rendering as garbled octal escape sequences in the diff view

## [Cline Kanban 0.1.54]

- Task agent chat panel resizing now persists when navigating between tasks

## [Cline Kanban 0.1.53]

- Added `/clear` slash command to reset the NKlein agent chat session
- Added hints for environment variables in NKlein provider setup
- Aligned NKlein provider and model fallbacks with SDK defaults for more reliable configuration
- Fixed Codex plan mode not working
- Fixed slash command file watchers to reuse a single watcher per workspace instead of creating duplicates
- Show loading skeleton in onboarding carousel while videos load
- Added VS Code Insiders as a file open target

## [Cline Kanban 0.1.52]

- Added support for custom OpenAI-compatible providers, so you can connect any OpenAI-compatible API as a NKlein model provider
- Added PWA support -- the web UI can now be installed as a standalone desktop app from Chrome, with window controls overlay and an offline fallback page that auto-reconnects when the server comes back
- Sticky file headers in the diff viewer now pin under the toolbar while scrolling through large diffs
- Show a cleanup spinner during Ctrl+C shutdown instead of silently hanging
- Fixed Codex status monitoring to reliably track the latest tool call
- Fixed terminal color detection for TUI apps like Codex CLI that query both foreground and background colors at startup
- Fixed activity preview text getting truncated in hooks
- Fixed project column sizing not persisting across sessions
- Fixed home sidebar session IDs not matching the current format

## [Cline Kanban 0.1.51]

- Task terminals now support multiple simultaneous viewers, so opening the same task in several browser tabs no longer causes disconnections
- Terminal TUI state is now preserved across reconnects, so you no longer lose your terminal view when the connection drops and re-establishes
- Fixed Codex CLI content disappearing or rendering incorrectly -- PTY sessions are now fully server-side, so you can refresh the page, switch between tasks, and unmount terminals without losing any output
- Fixed home sidebar terminal sessions not reconnecting after navigation
- Switched to esbuild for faster builds
- Claude agent hyperlinks now render correctly in !Klein terminals
- Fixed screen flickering and unnecessary polling when viewing trashed tasks
- Fixed restoring tasks from trash using the wrong agent
- Fixed stale git worktree registrations that could cause worktree operations to fail

## [Cline Kanban 0.1.50]

- Updated NKlein SDK from 0.0.21 to 0.0.22, which includes: fixed hook worker process launching to use a more robust internal launch mechanism

## [Cline Kanban 0.1.49]

- Updated NKlein SDK from 0.0.16 to 0.0.21, which includes: organization fetching support, SDK declaration maps for better type resolution, OpenAI Compatible provider migration and cleanup of the legacy provider, agent telemetry events with agent ID and metadata, bash tool and home directory fixes on Windows, and exposed LoggerTelemetryAdapter in the node package

## [Cline Kanban 0.1.48]

- Fixed sidebar agent attempting to edit files and write code instead of staying focused on !Klein board management

## [Cline Kanban 0.1.47]

- Fixed browser open failing on Linux systems where `xdg-open` is not available

## [Cline Kanban 0.1.46]

- Added reasoning level dropdown to NKlein provider settings and the model selector in the chat composer
- Images can now be attached when creating tasks for Claude Code and Codec CLI agents -- images are saved as temporary files and their paths are passed into the prompt since TUIs don't support inline images
- Added shortcuts for diff view actions and a "Start and Open" shortcut as an alternative to starting a task (shout out to Shey for the idea!)
- Fixed issues with the sidebar NKlein chat session not reloading after adding MCP servers
- The project column can now be collapsed all the way to the edge for a minimal view (shout out to Shey for this idea!)
- Fixed issues with some Next.js project configurations in worktrees
- Fixed diff viewer showing false changes for end-of-file-only differences
- Fixed a crash in older browsers when generating UUIDs for board state
- Fixed a crash on Windows when resizing the terminal after the PTY process has exited

## [Cline Kanban 0.1.45]

- Fixed kanban access validation to only apply restrictions to enterprise customers, so non-enterprise users are no longer incorrectly blocked

## [Cline Kanban 0.1.44]

- Fixed remote configuration not being applied correctly

## [Cline Kanban 0.1.43]

- !Klein access can now be gated via NKlein remote config
- Fixed "C" (create task) keyboard shortcut crashing when no projects exist
- Fixed macOS directory picker treating cancel as an error instead of a normal cancellation
- Improved agent selection copy during onboarding
- File paths in the settings dialog now display with `~` instead of the full home directory
- Fixed incorrect "kanban" branding in the disconnected screen (now says "NKlein")
- Fixed cancel button showing wrong label in detail view panels
- Temporarily disabled Featurebase feedback widget

## [Cline Kanban 0.1.42]

- Fixed auto-update failing on Windows by using the correct `.cmd` extensions for package manager commands (npm, pnpm, yarn)

## [Cline Kanban 0.1.41]

- NKlein agent sessions now automatically recover after a runtime teardown, so work isn't lost if the runtime restarts
- Per-task plan/act mode now persists when switching between tasks
- Chat messages sent while the agent is actively working are now queued and delivered when the turn completes, instead of being dropped
- Fixed repeated MCP OAuth callbacks causing errors when the browser fires the redirect more than once
- Fixed corrupt patch captures when trashing tasks in worktrees
- Session IDs are now sanitized for Windows-safe file paths
- Agent mistake tolerance increased from 3 to 6 consecutive errors, giving the agent more room to recover from transient failures
- Fixed the navbar agent setup hint showing incorrect state
- Use the `open` package for cross-platform URL opening instead of custom logic
- Updated NKlein SDK to 0.0.15 with file-based store fallbacks, remote config support, improved chat failure handling with message state rollback, and a new `maxConsecutiveMistakes` option to prevent agents from getting stuck in failure loops

## [Cline Kanban 0.1.40]

- Sidebar agent now stays focused on board management and redirects coding requests to task creation, so dedicated agents handle implementation work in their own worktrees
- Fixed feedback widget initialization for NKlein-authenticated users

## [Cline Kanban 0.1.39]

- Fixed the feedback widget not opening reliably when clicking "Share Feedback"
- Capitalized button labels for consistency ("Add Project", "Share Feedback")

## [Cline Kanban 0.1.38]

- First-run onboarding for script shortcuts -- new users are guided through creating their first shortcut directly from the top bar
- Settings file URLs can now be opened
- Fixed terminal bottom pane content clearing when running script shortcuts

## [Cline Kanban 0.1.37]

- Slash commands and file mentions in the client chat input field
- Share Feedback button in the bottom left, powered by Featurebase and enriched with NKlein account data like email so we can see who reports are coming from, with a Linear integration for automatic issue creation
- MCP OAuth callbacks consolidated onto the main runtime server with real-time auth status updates
- Linear MCP shortcut for one-click install setup
- Updated startup onboarding carousel with a screen about using camera and the agent to add tasks
- Conversation history always visible in detailed task view
- Fixed an issue where adding MCPs wouldn't be available in existing NKlein chats -- adding MCPs now resets NKlein chats to use them
- Fixed an issue where the client chat would get into a "task chat session is not running" error state. You can now send a message to continue the conversation when NKlein fails a tool call
- Fixed an issue where binary diffs would not show up in diff views
- Diff renderer groups removals before additions for easier reading
- Fixed default model selection when OAuth login leaves it blank
- Updated NKlein SDK with fixes for ask question tool being disabled in yolo mode, cost calculation, and tool description and truncation logic improvements

## [Cline Kanban 0.1.36]

- Added Sentry error reporting to help identify and fix crashes faster
- Fixed terminal sessions sometimes failing to reconnect, which caused the terminal emulator to scroll to the top during card transitions before scrolling back down
- Fixed onboarding to default to NKlein as the AI provider and automatically set the provider's default model, preventing errors when switching providers without updating the model
- Fixed Ctrl+C to wait for NKlein to finish shutting down before fully exiting, preventing false double-interrupt exits
- Upgraded NKlein SDK from 0.0.7 to 0.0.11 with numerous fixes and improvements:
  - Fixed prompt caching being broken for Anthropic models, meaning users were paying full price every turn. Cost calculation was also fixed (it was double-counting cache reads and ignoring cache writes)
  - Fixed cancelling a request causing all subsequent requests in the session to immediately fail, due to a reused AbortController
  - Fixed Gemini tool use failing for most non-trivial tool schemas. JSON Schema properties not in Gemini's allowed set (like `default`, `pattern`, `minLength`) caused Gemini to reject entire requests
  - Fixed tools with no required parameters (like "list all") being silently dropped
  - Fixed CLI hanging indefinitely in CI/Docker environments when stdin was detected as "not a TTY" but wasn't providing input
  - Fixed Vercel AI Gateway being completely broken (base URL was `.app` instead of `.sh`, so all requests 404'd)
  - Fixed internal metadata fields leaking into API requests sent to providers, wasting tokens
  - Fixed multi-agent team tools failing when the orchestrator sent null for optional filter parameters. Also added concurrent run prevention and better error visibility for teammate failures
  - Fixed MCP tool names with special characters or exceeding 128 chars causing provider schema validation errors (now sanitized with a hash suffix)
  - Fixed OpenRouter and other gateway error messages showing opaque nested JSON blobs instead of the actual error
  - Fixed `--json` mode output being impure (plain text warnings leaked into stdout, breaking JSONL parsing)
  - Fixed SQLite crashing with a disk I/O error on first run instead of auto-creating the data directory
  - Fixed "Sonic boom is not ready yet" error on CLI exit
  - Removed hardcoded 8,192 max output tokens per turn cap, so models are no longer artificially limited
  - Added OpenAI-compatible prompt caching support
  - Added OpenAI-compatible providers now surface truncated responses (`finish_reason: "length"`) so callers can detect them
  - Headless mode no longer requires a persisted API key -- env vars like `ANTHROPIC_API_KEY` now work
  - Headless mode output cleaned up: model info, welcome line, and summary gated behind `--verbose`
  - Config directory is now overridable via `--config` flag or `NKLEIN_DIR` env var for isolated config across multiple SDK instances
  - `readFile` executor now supports optional `start_line`/`end_line` parameters, enabling models to read specific portions of large files

## [Cline Kanban 0.1.35]

- Added runtime debug tools accessible from the top bar for troubleshooting configuration and agent state
- Settings now automatically retry loading when the initial attempt fails, improving reliability on slower connections

## [Cline Kanban 0.1.34]

- Model pickers now show recommended NKlein models for quick selection
- Failed tasks show a red error icon and failure reason on the board card instead of a spinner
- When adding a project on a headless/remote runtime where no directory picker is available, you can now enter the project path manually
- Fixed workspace not refreshing correctly on startup by waiting for the runtime snapshot before syncing
- Fixed !Klein agent creating tasks for worktree paths instead of the main project

## [Cline Kanban 0.1.33]

- Fixed task worktree setup for Turbopack projects no longer attempting slow background copies of node_modules; affected subproject dependencies are now correctly skipped instead of symlinked

## [Cline Kanban 0.1.32]

- Fix concurrent task mutations (e.g. adding multiple tasks at the same time) failing due to write conflicts -- task mutations now use a workspace lock to safely handle simultaneous operations
- Fix a bug where stopping a task that was restored from a previous session would fail because the session wasn't properly reconnected on startup
- Fix a bug where restarting the app would show raw metadata in user messages for old NKlein sessions that were reloaded
- Fix worktrees for projects using Turbopack, where symlinked node_modules would cause build failures -- worktrees now fall back to copying node_modules for Turbopack projects
- Fix SDK command parsing that could cause agent system prompts to be malformed
- Fix Cmd+V image paste in the chat composer not working due to the paste handler running asynchronously, causing the browser to swallow the event
- Fix proper-lockfile crashing due to accidentally passing undefined as the onCompromised handler
- Require confirmation before git init when adding projects
- Fix task card agent preview flickering to empty state
- Cancel inline task edit on Escape key press
- Move task worktrees to ~/.nklein/worktrees
- Update onboarding intro video and frame width
- Change the start-all-tasks shortcut to Cmd+B

## [Cline Kanban 0.1.31]

- Add ability to resume NKlein tasks that were trashed
- Support image attachments for NKlein agent chat
- Fix the commit and make PR button in the NKlein agent chat panel
- Fix issue where creating multiple tasks at the same time with git submodules would run into a git config locking issue
- Fix script shortcuts to interrupt previously long-running commands, so you no longer need to Ctrl+C before hitting the shortcut again
- Fix issue where running incorrect kanban commands would auto-open the browser
- Preserve runnable kanban command in sidebar prompt
- Avoid premature Codex review state transitions
- Fix diff "Add" button incorrectly sending NKlein chat messages
- Various UX improvements (checkbox labels, NKlein thinking shimmer animation)

## [Cline Kanban 0.1.30]

- Add MCP server management and OAuth authentication for NKlein providers
- Add "Start All Tasks" keyboard shortcut (Alt + Shift + S)
- Show assistant response previews in task card activity instead of generic "Agent active" text
- Track full chat history per task, enabling richer conversation display and reliable message streaming
- Display API key expiry as a human-readable date instead of a raw number
- Support launching !Klein without a selected project (global-only mode)
- Automatically restart agent terminals when the underlying process exits unexpectedly
- Fix prewarm cleanup accidentally disposing the detail panel terminal for active tasks
- Fix task card expand animation jumping by waiting for measured height before animating
- Fix NKlein thinking indicator flicker in the chat panel

## [Cline Kanban 0.1.29]

- Fix onboarding and settings screens not working when no projects exist
- Update NKlein SDK with auth migration for existing CLI users and fixes for OpenAI-compatible APIs

## [Cline Kanban 0.1.28]

- Onboarding dialog for first-time users with guided walkthroughs for auto-commit, linking, and diff comments
- Dependency links now show arrowheads so you can see direction at a glance, and the agent provides guidance about link direction when creating them
- NKlein chat input field now includes a model selector, plan/act mode toggle, and a cancel button to stop generations midstream
- Resizable project sidebar (drag to resize, persists across sessions)
- Show the full command in expanded run_commands tool calls
- Review actions (Commit, Open PR) only appear when there are actual file changes
- NKlein chat preserves your scroll position when reading older messages
- Failed tool calls display proper error messages instead of deadlocking the session
- "Thinking" indicator shows while tool calls are loading
- ANSI escape codes from CLI output are stripped instead of showing raw characters
- Inline code in NKlein chat wraps correctly instead of overflowing
- Tasks with uncompleted dependencies can no longer be started
- Better error reporting when NKlein fails to start (clear messages instead of silent hangs)
- Gracefully handles missing provider settings instead of crashing
- Removed OpenAI, Gemini, and Droid agents to reduce surface area at launch (coming back in follow-up releases)

## [Cline Kanban 0.1.27]

- Upgraded NKlein SDK to stable v0.0.4, replacing nightly builds for more reliable native NKlein sessions

## [Cline Kanban 0.1.26]

- Trashing a task now saves a git patch of any uncommitted work, and restoring it from trash automatically reapplies those changes so nothing gets lost
- "Create more" toggle in the new task dialog lets you create multiple tasks in a row without reopening the dialog each time
- New keyboard shortcuts: Cmd/Ctrl+G toggles the git history view, Cmd/Ctrl+Shift+S opens settings, and Esc closes git history from the home screen
- Shortcut commands now safely interrupt any running terminal process before executing, so commands no longer get jumbled with whatever was previously running
- Agent file-read activity now shows the full list of files being accessed instead of truncating with "(+N more)"
- Expanding the diff view now automatically closes the terminal panel to avoid overlapping views
- Task worktree cleanup no longer gets stuck when patch capture fails
- Fixed the "Thinking..." indicator incorrectly appearing while the agent is actively streaming a response
- Native NKlein sessions now correctly capture their latest changes when entering review
- Removed the redundant "Projects" label below the sidebar segment tabs
- Consistent spacing and alignment across all alert dialogs
- Fixed terminal background color in the detail view to match the rest of the overlay

## [Cline Kanban 0.1.25]

- Added a chat view to the home sidebar for project-scoped agent conversations. What used to be the project column is now a sidebar that can switch between projects and chat.
- The agent can now trash and delete tasks on your behalf using new task management commands
- When no CLI agent is detected, a guided setup flow walks you through getting started
- Replaced the !Klein skill system with `--append-system-prompt` -- since the board now has a dedicated agent, we just append context to its prompt instead of maintaining a separate skill
- Native NKlein SDK chat runtime with cancelable turns
- `--host` flag to bind the server to a custom IP address
- Submodules are now initialized automatically in new task worktrees
- Fix Escape key unexpectedly closing the detail view
- Increased shortcut label and footer font sizes
- Capped agent preview lines in task cards

## [Cline Kanban 0.1.24]

- Fixed multiline prompt arguments being broken on Windows cmd.exe

## [Cline Kanban 0.1.23]

- Fix Windows terminal launches incorrectly escaping arguments with spaces, parentheses, and other special characters

## [Cline Kanban 0.1.22]

- Fix Windows terminal launch failing for bare executables (e.g. `nklein`) due to unnecessary quoting

## [Cline Kanban 0.1.21]

- Fix Windows agent commands failing to launch
- Fix update detection for Windows npm-cache npx transient installs
- Reduce false-positive triggering of the kanban skill
- Show worktree errors in toasts

## [Cline Kanban 0.1.20]

- Fix branch picker showing remote tracking refs instead of just local branches, and enable trackpad scrolling in the picker
- Fix task card activity not updating when Opencode completes hook actions
- Fix NKlein tasks getting stuck instead of returning to in-progress when asking follow-up questions during review

## [Cline Kanban 0.1.19]

- Fixed a race condition where navigating to a task's detail view could trigger an unintended auto-start
- Fixed shutdown cleanup to reliably stop all running tasks across projects

## [Cline Kanban 0.1.18]

- Fix layout stability when moving cards between columns programmatically
- Improve checkbox contrast on dialog footers
- Reduce dialog header/footer side padding to match vertical padding
- Fix description briefly flashing on card mount

## [Cline Kanban 0.1.17]

- Fix keyboard shortcuts (Cmd+Enter) not working when focus is on dialog inputs

## [Cline Kanban 0.1.16]

- Fixed agent startup reliability and command detection
- Fixed path handling on Windows and Linux for cross-platform support

## [Cline Kanban 0.1.15]

- Fix diff view syntax highlighting colors in git history
- Improve graceful shutdown handling for CLI processes
- Fix worktree symlink mirroring for ignored paths to avoid blocking operations
- Fix process cleanup on Windows when tasks time out
- Support Windows AppData path discovery for Opencode integration
- Make "Open in Editor" workspace actions work correctly across platforms
- Add directory picker support on Windows
- Fix transcript path detection in hooks
- Handle Linux directory picker fallbacks and errors gracefully

## [Cline Kanban 0.1.14]

- Fixed a crash on Linux systems where no browser opener (xdg-open, etc.) was available

## [Cline Kanban 0.1.13]

- New task creation dialog with list detection for quickly creating multiple tasks at once
- Git history now shows remote refs and branch divergence so you know if you need to pull
- Expandable task card descriptions -- click to reveal the full description inline
- Notifications now show the latest agent message
- Improved split diff rendering by consolidating same hunk changes
- Fixed issue where cards in the kanban column updating content would cause scroll jumps

## [Cline Kanban 0.1.12]

- Redesigned the web UI with a refined dark theme, custom UI primitives, and polished controls for a more professional look and feel
- Added split diff view so you can click the expand button above any diff to see changes side by side
- Added last turn changes, which takes a Git snapshot each time you send a message to your agent so you can see exactly what changed since your last message
- Added an all changes view to see every modification in a task's worktree at a glance
- Resizable agent terminal emulator so you can drag to make it bigger or smaller
- Inline task creation controls with keyboard shortcut hints
- Fix diff panel persisting stale content when switching views
- Fix last-turn diff transitions flickering during scope changes
- Only keep terminal connections alive for tasks actively on the board, and clean them up when the runtime disconnects
- Fix WebSocket proxy so terminal connections work correctly during local development
- Fix the dogfood launcher not waiting for the child process to exit, which could leave orphaned processes on shutdown

## [Cline Kanban 0.1.11]

- Add !Klein skill for creating and managing tasks directly from your agent
- Remove !Klein MCP server in favor of skill-based task automation

## [Cline Kanban 0.1.10]

- Add "Start task" button to create task card -- press `c` to create, type your task, then Cmd+Shift+Enter to start it right away
- Add "Cancel auto-review" actions to task cards
- Add "Start All" button to backlog column header to start all backlog tasks at once
- Add Cmd+Enter shortcut for sending diff comments
- Show keyboard shortcut hints on the create task button
- Simplified shortcut icon picker
- Show authentication warning callout in Linear MCP setup dialog
- Show loading state on trash button while deleting
- Resume paused droid tasks when read/grep hooks fire
- Fix stale diff persisting when switching between task details
- Fix stale script shortcuts lingering after switching projects
- Fix git history flicker during scope switches
- Fix terminal rendering for Droid CLI in split terminals
- Fix linked task start animations
- Detect when GitHub/Linear/!Klein MCPs are already installed to skip unnecessary setup dialogs
- Fix resuming trashed tasks after terminal refactors
- Fix Droid CLI review state transitions around AskUser tool calls
- Default new users to NKlein CLI when installed
- Highlight active branch button in blue
- Fix settings dialog appearing disabled during config refresh
- Center selected detail card in sidebar

## [Cline Kanban 0.1.9]

- Fix worktree paths with symlinks in ignored directories being incorrectly treated as active

## [Cline Kanban 0.1.8]

- Terminal now properly renders full-screen TUI applications like OpenCode
- Fixed terminal content disappearing and scroll back being lost when opening a task. Terminals are now created proactively for each agent instead of connecting mid-session, which preserves full scroll back and content rendering. This is especially important for rendering TUI apps like Codex and Droid correctly.
- Improved terminal rendering quality, inspired by VS Code's xterm and node-pty implementation. Noticeably higher FPS, smoother scrolling, and a more native look and feel for terminal emulators.

## [Cline Kanban 0.1.7]

- When a task prompt mentions creating tasks (e.g. "break down into tasks", "create 3 tickets", "split into cards"), !Klein now shows a setup dialog offering to install the !Klein MCP before the task starts
- Similar setup dialogs appear for Linear and GitHub CLI when task prompts reference those services
- MCP server instructions now guide agents to detect the ephemeral worktree path and pass the main worktree as projectPath, so "add tasks in kanban" tasks correctly create tasks in the main workspace instead of the ephemeral task worktree

## [Cline Kanban 0.1.6]

- Show live hook activity (tool calls, file edits, command runs) on task cards as agents work
- Auto-confirm Codex workspace trust prompts so tasks start without manual intervention
- Show working copy changes in the detail panel's git history
- Fix terminal pane state bleeding across tasks when switching between them
- Fix duplicate paste events in agent terminals
- Stop detail terminals when trashing tasks to free resources
- Automatically pick up new versions when launching with `npx nklein`
- Fix git metadata not updating reliably when switching projects
- Stabilize workspace metadata stream startup

## [Cline Kanban 0.1.5]

- Added Droid CLI agent support alongside Claude and Codex
- Dogfood launcher for quickly opening !Klein on its own repo with runtime port selection
- Terminal rebuilt around xterm and node-pty for better performance and reliability
- Filter terminal device attribute auto-responses from being sent to agents as input
- Fix workspace metadata causing unnecessary rerenders, with retry recovery
- Fix task worktrees being recreated when the base ref updates if they already exist
- Fix self-ignored directories being symlinked in task worktrees
- Fix bypass permissions toggle resetting unexpectedly
- Fix git refs not clearing when switching detail scope

## [Cline Kanban 0.1.4]

- Each task gets its own CLI agent working in a git worktree, so they can work in parallel on the same codebase without stepping on each other
- When an agent finishes, review diffs and leave comments before deciding what to merge
- Commit or open a PR directly from the board, and the agent writes the commit message or PR description for you
- Link tasks together to create dependency chains, where one task finishing kicks off the next, letting you complete large projects end to end
- "Automatically commit" and "automatically open PR" toggles give agents more autonomy to complete work on their own
- MCP integration lets agents add and start tasks on the board themselves, decomposing large work into parallelizable linked tasks
- Built-in git visualizer shows your branches and commit history so you can track the work your agents are doing
