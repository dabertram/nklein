# Follow-up 6 — Dev-test run findings from complex habit + audio VST autonomy checks

> Authored from the June 20, 2026 dev-test runs on branch
> `feat/kanban-reliability-context-upgrade`.
>
> Scope: this file records findings from the recent autonomous dev-test work:
> the complex habit-product fixture runs, the newly added audio VST / psytrance
> synth fixture, and the live runtime observations made while those projects ran.
> It is intentionally evidence-oriented so the next implementation pass can work
> from concrete failures rather than re-running the same archaeology.

---

## 0. Current state snapshot

- The branch was pushed to `origin/feat/kanban-reliability-context-upgrade`.
- Latest pushed commit at the time of this note: `6dbb0346 Bound autonomous generated task timeouts`.
- The last inspected audio workspace was:
  `/private/var/folders/_k/dk3l4h_j0jg7p5pld9t7y65h0000gn/T/nklein-audio-vst-psytrance-1781964666409-3K1LQT`.
- The !Klein runtime on `127.0.0.1:3484` was no longer running during the final status check.
- The audio observer was also no longer running; its log ended in repeated `workspace.getState failed: fetch failed`.
- The audio workspace's persisted board state had no `in_progress` cards and an empty `sessions.json`.
- The generated audio project currently passes its fixture acceptance command:
  `npm test` -> 17 tests passed, 0 failed.

Audio board status at final persisted-state read:

- Completed: 8
- Review: 2
- Planning: 3
- In progress: 0
- Backlog / Trash: 0

Completed audio cards:

- `dev-audio-vst-psytrance-decompose` — decomposed the seed task.
- `psytrance-vst-synth-task-1` — documented DSP/plugin domain assumptions.
- `psytrance-vst-synth-task-4` — defined bass synthesis controls.
- `psytrance-vst-synth-task-5` — implemented clean bass rendering with soft clipping.
- `psytrance-vst-synth-task-3` — implemented clean kick rendering with frequency sweep.
- `psytrance-vst-synth-task-12` — updated README usage notes/examples.
- `psytrance-vst-synth-task-6` — implemented phase-aligned four-beat sequence timing.
- `psytrance-vst-synth-task-7` — added sequence rendering tests.

Still not completed:

- Review: `psytrance-vst-synth-task-2` — kick synthesis controls interface.
- Review: `psytrance-vst-synth-task-10` — clean effects with guardrails.
- Planning: `psytrance-vst-synth-task-11` — audio quality / phase / effect tests.
- Planning: `psytrance-vst-synth-task-9` — UI-state API with type-safe setters.
- Planning: `psytrance-vst-synth-task-8` — modern UI control metadata/state structure.

---

## 1. Shipped fixes from the recent dev-test reliability pass

These fixes were made because the live dev-test projects exposed real blockers.

- [x] Decomposition-generated cards can now start automatically from Planning instead of getting stuck because
      the start path only handled cards already in `in_progress`.
- [x] Task diagnostics are now scoped by workspace identity/path hash, not just task id. This matters because
      dev-test task ids repeat across generated projects.
- [x] Auto-review and scoped workspace resolution now retry on transient workspace lock contention instead of
      failing on `Lock file is already being held`.
- [x] Decomposition schema parsing is more tolerant:
  - nullable tool fields are accepted;
  - stringified task/expansion arrays are accepted;
  - malformed stringified arrays with an extra trailing brace can be recovered.
- [x] `write_files` handling is more tolerant:
  - stringified `files` arrays are accepted;
  - harmless extra keys in entries are tolerated.
- [x] Empty sandbox result patches can complete auto-review cards instead of leaving clean tasks stranded.
- [x] Sandbox memory defaults were reduced to avoid host swap pressure from over-large containers.
- [x] Host-path normalization was added for sandbox discovery/file tools and raw sandbox shell commands:
  - `list_files`, `read_files`, etc. can recover when the model passes the host project path;
  - raw commands such as `cd <host-temp-project> && npm test` are normalized to the sandbox workspace.
- [x] Repeated exact batch `read_files` requests are blocked to prevent small-model context/tool loops.
- [x] Per-role model performance statistics were added.
- [x] Knowledge/tool-usage statistics were added at project/global level for categories such as file discovery,
      file reading, codebase retrieval, architecture knowledge, external fetch, planning control, and other.
- [x] Dev-test seed cards and decomposition-generated cards now get bounded autonomous timeout defaults unless
      a role explicitly opts into unlimited timeouts. This prevents silent, indefinite stalls when the user's
      global config is `agentTimeoutMode: "unlimited"`.
- [x] A new audio VST / psytrance synth dev-test preset was added and documented.

---

## 2. Complex habit-product dev-test findings

### 2.1 Generated cards and linkage needed live-run hardening

- Decomposition generated a plausible card graph, but generated cards initially could not reliably start from
  Planning.
- This exposed that the DAG could look correct while being operationally dead.
- The fix was to make start paths allow generated implementation cards to move from Planning to `in_progress`
  and run with `startInPlanMode: false`.
- Follow-up: add a regression test that uses a real decomposition result and proves every unblocked generated
  card is startable from Planning without manual lane repair.

### 2.2 Workspace-scoped diagnostics were mandatory

- Habit dev-test projects reused task ids such as `dev-habit-insights-mid`.
- Diagnostics keyed only by task id could mix events across projects.
- Fix shipped: diagnostics scope by workspace identity/path hash.
- Follow-up: audit all other telemetry/session caches for task-id-only keys. Repeated dev-test ids make this
  class of bug easy to miss until multiple generated projects exist at once.

### 2.3 Workspace lock contention is normal during autonomous runs

- Direct monitor queries and auto-review paths hit `Lock file is already being held`.
- This happened during ordinary runtime activity, not just pathological races.
- Fixes shipped for auto-review and scoped resolution retries.
- Follow-up: any long-running observer/harness should treat workspace lock contention as retryable and should
  bound individual state reads so the harness itself does not appear stalled.

### 2.4 Schema strictness was too brittle for small/local models

- Models produced:
  - nullable fields where the tool schema expected strings;
  - JSON arrays serialized as strings;
  - extra object keys in `write_files`;
  - malformed stringified decomposition arrays with a stray trailing `}`.
- These are exactly the kinds of near-valid tool calls small/local models will emit.
- Fixes shipped for the observed cases.
- Follow-up: add a "near-valid tool payload" fuzz suite for the highest-value orchestration tools:
  `decompose_project`, `expand_task`, `write_file(s)`, file discovery, and command execution.

### 2.5 Host-path leakage into sandbox tools is a recurring model behavior

- Even when the agent is inside `/workspaces/<taskId>`, it frequently passes the host temp project path it saw
  in prompts or file outputs.
- This happened for both discovery tools and shell commands.
- Fixes shipped for tool path normalization and raw command normalization.
- Follow-up: keep treating host-path input as expected model behavior. Tool runners should normalize or reject
  with a precise repair instruction; they should not let the model conclude "sandbox unavailable" from a path
  mismatch.

### 2.6 Batch-read guard helped but created a second-order UX issue

- The guard blocked a `list_files` call because the same assistant turn had already started `read_files`.
- The model then reasoned as if it needed to wait for the blocked `list_files` result, even though the result
  was an immediate rejection.
- It recovered later, but the guard message is easy for small models to misinterpret.
- Follow-up:
  - narrow the guard to repeated large/batch reads rather than harmless discovery after a focused read; or
  - rewrite the rejection text as an explicit next-step instruction: "This tool call was rejected; continue
    with the successful result already shown, or ask for a new turn."

---

## 3. Audio VST / psytrance synth dev-test findings

### 3.1 The audio benchmark exposed severe domain-underestimation

- The decomposition treated "audio VST for modern psytrance kick/bass grooves" as a small TypeScript feature
  set.
- It produced only 13 cards for a domain that realistically spans DSP, psychoacoustics, music production
  conventions, phase/frequency relationships, test-signal design, UI/product modeling, and guardrailed effects.
- The user's assessment was accurate: the agents underestimated the problem space by orders of magnitude.
- The benchmark is useful because it makes that underestimation visible.

Follow-up:

- Add a decomposition-quality requirement for domain-broad tasks:
  - explicitly identify unknowns and domain knowledge gaps;
  - perform or request sanctioned knowledge lookup before task graph finalization;
  - justify why the task graph granularity is sufficient;
  - require a second "scope pressure" pass that asks whether the graph is under-decomposed by 10x, 100x, or more.

### 3.2 Knowledge lookup was not used enough

- The audio preset was intended to exercise the knowledge/tool-usage statistics feature.
- The observed decomposition did not meaningfully use domain knowledge lookup before creating the graph.
- The model made shallow assumptions instead of investigating synthesis and psytrance-specific constraints.
- Example concern from an earlier audio run: questionable rhythm assumptions such as kick placement not matching
  the expected four-on-the-floor psytrance baseline.

Follow-up:

- For unfamiliar/domain-heavy tasks, prompt the agent to spend a bounded phase on knowledge acquisition before
  decomposition.
- Track whether a decomposition did or did not use knowledge tools, and surface that in the stats view as a
  quality signal, not just a usage count.
- Consider a "knowledge debt" field on generated cards: what the agent believes it still does not know, and
  what future card should verify.

### 3.3 The generated dependency graph was too weak and partly incoherent

- Final persisted dependency edges were only:
  - `psytrance-vst-synth-task-8 -> psytrance-vst-synth-task-2`
  - `psytrance-vst-synth-task-9 -> psytrance-vst-synth-task-8`
  - `psytrance-vst-synth-task-11 -> psytrance-vst-synth-task-10`
- Only 3 dependencies remained for 13 cards.
- Several apparently dependent tasks completed out of a natural order.
- A review card could coexist with a still-planning card that appeared related by dependency.

Follow-up:

- Add dependency-graph validation after `decompose_project`:
  - reject graphs that are too sparse for the declared complexity;
  - detect likely reversed edges;
  - require tests/acceptance cards to depend on the implementation cards they verify;
  - require UI cards to depend on core domain/control metadata cards;
  - require final docs to depend on the feature/API cards they document.

### 3.4 Passing `npm test` was not equivalent to project completion

- The generated audio workspace passed `npm test` with 17 tests.
- The board still had 5 cards not completed.
- This is a useful distinction: fixture acceptance can be green while autonomous workflow completion is not.

Follow-up:

- Dev-test success criteria should include both:
  - acceptance command passes; and
  - every non-trash card reaches Completed or has a deliberate, classified terminal state.
- The harness should report "code acceptance green, workflow incomplete" as a distinct outcome.

### 3.5 Review cards surfaced two important failure classes

- `psytrance-vst-synth-task-2` reached Review with sandbox result patch capture failed:
  `git apply --cached --binary --whitespace=nowarn ... task.patch failed: corrupt patch at line 53`.
- `psytrance-vst-synth-task-10` reached Review after:
  `NKlein stream inactivity timeout after 360 seconds`.

Follow-up:

- Patch capture needs stronger diagnostics:
  - preserve the failed patch artifact path;
  - attach the first failing hunk and file path to the card;
  - classify corrupt patch capture separately from agent failure.
- Stream inactivity timeout should trigger a structured card note:
  - last model activity;
  - last tool call;
  - whether any workspace changes were captured;
  - whether restart/resume is safe.

### 3.6 Runtime/session lifecycle visibility is insufficient after shutdown

- Final state had `sessions.json` as `{}` even though the board still had Review and Planning cards.
- The runtime had stopped, so live session details were no longer queryable.
- Earlier session summaries had useful warnings and latest activities, but those were not retained in the final
  persisted sessions file.

Follow-up:

- Persist terminal session summaries or task-run summaries separately from live `sessions.json`.
- Cards should retain last-run outcome metadata after runtime shutdown:
  - provider/model;
  - exit/review reason;
  - last activity;
  - token usage;
  - sandbox patch capture status;
  - timeout reason.

### 3.7 The observer was fragile when the runtime stopped

- The 2-hour observer eventually produced repeated `workspace.getState failed: fetch failed`.
- It did not leave a clean final summary that said "runtime unreachable; last persisted board state is X."
- The `launchctl` observer was no longer listed during the final check.

Follow-up:

- Observers should degrade from runtime API polling to direct persisted-state reads when the runtime is down.
- Observer logs should write a final classified outcome:
  - runtime_down;
  - completed;
  - stagnant;
  - acceptance_green_workflow_incomplete;
  - blocked_by_review_cards.
- Long-running observers should not require keeping a Codex PTY alive.

### 3.8 The audio output is useful but not a credible VST implementation

- The generated project has real files:
  - `src/domain.ts`
  - `src/plugin.ts`
  - `src/sequence.ts`
  - `test/sequence.test.js`
  - `README.md`
- The tests pass and the code is a useful fixture result.
- But the implementation remains a tiny portable TypeScript DSP prototype, not a serious audio plugin design.
- That is acceptable for a dev-test fixture, but the benchmark should score it as under-decomposed and shallow.

Follow-up:

- Add a rubric to the audio dev-test scenario:
  - DSP correctness is more than bounded buffers;
  - phase alignment must be measured meaningfully;
  - kick/bass groove quality needs domain-specific invariants;
  - effects must prove guardrails under parameter sweeps;
  - UI state must cover every control and parameter constraint;
  - documentation must distinguish prototype API from real VST host integration.

---

## 4. Harness and operations findings

### 4.1 Fresh-run harnesses must use real UI-equivalent payloads

- Direct `runtime.startTaskSession` calls failed until the harness supplied the same payload the UI sends:
  `prompt`, `taskTitle`, `startInPlanMode`, `baseRef`, `agentId`, and `nkleinSettings`.
- The workspace board payload shape also differs from some internal assumptions: columns carry `cards`, not
  top-level `board.cards` / `taskIds`.

Follow-up:

- Provide an official dev-test harness API that creates a dev-test project, starts the seed card, monitors
  progress, and records final outcome.
- Do not keep using ad-hoc scripts that reimplement UI behavior.

### 4.2 Global unlimited timeouts are dangerous for autonomous QA

- User config had:
  - `agentTimeoutMode: "unlimited"`
  - all timeout values null.
- This allowed stalled turns to sit indefinitely in autonomous dev-test contexts.
- Fix shipped: autonomous seed/generated cards now receive bounded default timeouts unless a role explicitly
  opts into unlimited mode.

Follow-up:

- Make the timeout source visible on the card/session: global config vs role override vs autonomous default.
- Add stats for timeout-triggered review outcomes by model/role/scenario.

### 4.3 Container resource defaults can affect host stability

- The user suspected overly generous container RAM could increase host swap and disk usage.
- We reduced default per-container memory to a more conservative value.
- Disk cleanup recovered:
  - about 28.5 MB from obsolete temp dev-test project directories;
  - about 9.16 GiB from old VS Code chat/session/cache artifacts and cached installers.

Follow-up:

- Add a dev-test cleanup command/report that distinguishes:
  - active current run;
  - obsolete dev-test workspaces;
  - sandbox volumes/containers;
  - editor/cache artifacts outside !Klein ownership.
- Report both reclaimed bytes and intentionally retained active-project bytes.

---

## 5. Quality gates to add before claiming autonomous dev-test success

- [ ] A run is not successful unless every card reaches Completed, or every non-completed card has a classified
      terminal reason that the harness reports.
- [ ] Acceptance-command success and board-completion success must be tracked separately.
- [ ] Decomposition output must be scored for:
  - sufficient card count for scenario complexity;
  - dependency density and direction;
  - acceptance/test coverage placement;
  - explicit unknowns/knowledge gaps;
  - whether knowledge tools were used when the domain is unfamiliar.
- [ ] Runtime shutdown must not erase the evidence needed to understand unfinished cards.
- [ ] Observers must keep working, or at least write a final persisted-state summary, after runtime shutdown.
- [ ] Review cards caused by infrastructure failures must be classified separately from model/task failures.
- [ ] The audio VST fixture should be used specifically to prevent overfitting to the habit-product fixture.

---

## 6. Recommended next implementation pass

1. Build an official `runDevTestProject` harness around the existing tRPC/runtime APIs.
2. Add persisted task-run summaries so final state remains inspectable after runtime shutdown.
3. Add decomposition graph validation for complexity, dependency density, and likely reversed dependencies.
4. Add an explicit knowledge-acquisition phase/rubric for domain-heavy scenarios.
5. Harden sandbox patch-capture diagnostics and artifact retention.
6. Teach observers to fall back to persisted state when the runtime is down.
7. Re-run the audio VST scenario and score it with both acceptance and workflow-completion criteria.

