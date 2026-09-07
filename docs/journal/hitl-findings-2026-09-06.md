# Claude-in-the-loop drive of dschinn — !Klein shortcomings log (2026-09-06)

Mode: !Klein runs a fresh dschinn drain (`~/.nklein/factory-drains/hitl-drain`, runtime :3503) against a manual
OpenAI-compatible model (`claude-hitl`, `bin/hitl-model-server.py` :8095). Every completion is answered by Claude
through a file queue, so each stall, detour, or confusion is attributable to the harness, not to a quantized
local model. One model turn at a time. Findings are numbered; each carries a verdict (harness bug / prompt gap /
design limit / fine) and, where shipped, the commit.

## Findings

1. **The A2A ingress cannot seed a plan card.** Seeding the project prompt creates an ACT work card; to get an
   architect session the rig has to pause the card, flip `startInPlanMode` through `workspace.saveState`, stop the
   seed session, wait a flat 20 s for a late "interrupted" stamp, then start again in plan mode and verify the
   summary says architect (`scripts/flashnext-drain.mts` 2026-08-30). Verdict: harness gap. The ingress (and
   `startTaskSession`) should accept `startInPlanMode` on creation so a project prompt becomes a plan card in one
   call, and the settle window points at a stop/start race that should be closed by the state machine, not by sleep.

2. **A plan-mode start silently returns the live worker.** Reproduced at 23:50:30: `runtime.startTaskSession`
   with `startInPlanMode: true` answered `ok: true` with `role: "worker", mode: "act"` because the seed-time
   auto-start's worker was still alive. The caller asked for an architect and got a worker labelled success.
   Verdict: harness bug. A start whose requested mode differs from the running session's mode must either stop
   and replace it or refuse with an explicit error code, never short-circuit into the wrong session.

3. **The harness lints its own prompt as over its cap and ships it anyway.** Telemetry at 23:50:15:
   "Prompt pre-flight lint for claude-hitl: 76 instruction unit(s) (cap 60 — OVER by 16), 31 bare prohibition(s)".
   Verdict: prompt gap. Either the cap is wrong or the prompt is; measuring and then ignoring the measurement is
   the worst of both. (Assessment of the prompt itself follows once I have read it as the model.)

4. **A permanent provider error is retried at full speed, with an acceptance run each time.** The SDK could not
   construct the provider ("Unknown or disabled provider \"hitl\""), which is a configuration fact that cannot change
   between attempts. The runtime nonetheless spun 13 attempts in two minutes (23:50 to 23:52): each one cloned the
   sandbox, failed the model turn instantly, ran the acceptance gate `npm test` on an untouched tree, disposed the
   sandbox, recorded a "zombie terminal attempt", and re-drove ("Swarm retry same_model_retry", "frozen board
   self-heal"). The lane also diverged ("cancelled … but the board says planning"). Verdict: harness bug, same family
   as the bounced-redrive livelock of 2026-09-06 morning. A start that dies before the first model turn on a
   provider-construction error should hold the card with the error named, not re-drive; and no acceptance gate
   should ever run for a session that never produced a turn.

5. **Custom OpenAI-compatible providers cannot be driven at all in this build.** `addSdkCustomProvider` registers
   the provider (Settings shows it, `listSdkProviderCatalog` lists it, `resolveNKleinLaunchConfig` resolves it), but
   the per-request model gateway (`vendor … handler-factory.ts` → `createGateway`) is built from the BUILT-IN
   provider registrations only, so the first model turn dies with "Unknown or disabled provider \"hitl\"". Verified
   out of process (resolves) versus in process (fails) and after a live `updateNKleinProvider` (still fails). The
   2026-08-04 mlx-serve probe drove a full card through exactly this path, so it regressed with a later SDK bump
   and nothing caught it. Verdict: harness bug + missing test. A custom provider that Settings accepts must be
   startable; a test that boots a custom provider against a stub endpoint and completes one model turn would have
   held the line. Workaround for this drive: the built-in `openai-compatible` provider with a loopback base URL.

6. **Resume after a restart rebinds a lost session with its sandbox path as a host path.** After the runtime
   restart, `resumeTask` logged "Lost session rebound for review" and then "NKlein SDK send failed: ENOENT: no such
   file or directory, mkdir '/workspaces'" — the persisted summary's `workspacePath` is the container-internal
   `/workspaces/<task>`, and the rebind used it on the host. The attempt died before any model turn and was filed as
   another zombie. Verdict: harness bug. A rebound session must re-place the task in a sandbox (or refuse with a
   named reason), never treat a sandbox path as a host directory.

7. **The user turn is rewritten every step.** After the first `update_focus_chain`, the runtime appends the focus
   chain ("[!Klein focus chain: your own plan … keep working through it]") to the USER message, and grows it on
   every later turn (3,815 → 4,255 → 5,187 chars). Verdict: design flaw. It puts harness bookkeeping in the user's
   mouth, invalidates the prompt prefix cache for the whole conversation head on every turn (the runtime even
   measures "prompt prefix reuse" elsewhere), and a model cannot tell the user's words from the runtime's. The
   chain belongs in a trailing system/tool message, not spliced into the request.

8. **Reading the spec the prompt demands costs 13 round trips.** `get_file_size` said `specification.md` (192 KB,
   1,415 lines, ~46k tokens) "fits the normal read_files path"; the prompt says "Read all of specification.md
   before planning" and forbids `read_large_file` for it. The ranged `read_files` then withheld the body as
   `result://read_files/1` with a head/tail preview, and `resolve_result` returns 16,000 characters per call no
   matter what `maxChars` asks for, so the full body takes 13 sequential turns, each re-sending the growing
   transcript on top of an 18 KB system prompt. On a 20 tok/s local model that is the "over-exploration" everyone
   blamed on the models. Verdict: harness bug. The size tool, the read tool and the resolver disagree about one
   file; a read the prompt requires must arrive in one turn (or the size tool must route to the paged workflow).

9. **Three instruction sources disagree about the submit call.** The system prompt says to call `decompose_project`
   "passing slug, spec, plan, title, summary, questions, and defaultAcceptanceCommand"; every `add_task` result says
   "call decompose_project with NO arguments — slug, spec, and plan fill in automatically (pass them only to
   override)"; the tool schema declares all of them optional. Verdict: prompt gap. One contract, stated once.

10. **The card contract contradicts the spec it is applied to, and its own test-first rule.** The prompt caps a card
    at three likely files; S01 of the spec legitimately touches five (package.json, tsconfig, vitest config, the
    index, the smoke test). The sizing contract then rejected S01 because, trimmed to three, its file list had no
    test file while `testFirst` was true, and rejected S44/S49 for the same reason although their tests are named
    in the card body. Verdict: harness design flaw. `filesLikelyTouched` doubles as a write scope, so trimming to
    the cap silently forbids the card's own test; either the cap must exclude test files or the write scope must be
    a separate, honest field. Good part: the error named all three cards at once with an exact repair recipe.

11. **`add_task` accepted fields its schema does not declare, silently.** `complexity`, `suggestedRole`,
    `filesLikelyTouched`, `acceptanceCommand`, `testFirst`, `testability`, `acceptanceTestPrompt` are demanded by the
    prompt but absent from the tool's JSON schema (only id, title, prompt, dependsOn). They were accepted (the
    sizing contract used them), so the schema under-describes the tool; a schema-faithful model would omit them and
    fail the sizing contract on every card. Verdict: schema gap.

12. **The coverage gate grades keyword echo of the whole spec, including non-requirements.** After the sizing
    contract passed, `decompose_project` failed "specification-coverage validation" because no card echoed:
    "A short authoritative charter" (a line from the spec's own future-split note), "DschinnForge",
    "Black-Lights Foundry", "Daemon Foundry" (entries of a brainstormed naming list), the NVIDIA NemoClaw research
    citation ("Echo 4 more of these verbatim: nvidia, nemo, claw, material, frame, always-on, local, agent"), and the
    boundary sentences. The user prompt and the spec both order a 51-card spine FIRST with everything else deferred,
    so the gate contradicts the sequencing it is supposed to serve, and its remedy is literal keyword stuffing.
    Verdict: harness design flaw, and the root cause of the "decompose convergence" stalls the local models showed
    (this is exactly the loop a 27B model cannot escape). The gate must distinguish requirement bullets from
    narrative, names, citations and meta-notes, and must respect a declared slice scope; echoing words is not
    coverage. The honest way out here was a charter documentation card plus boundary wording on the gate cards.

13. **Repair resubmits drop the first submission's metadata.** The first `decompose_project` carried
    `slug: "dschinn-spine"`, a title, summary, plan and questions; the repair loop prescribes `decompose_project`
    with no arguments, which auto-derived the slug from the first card's title, so every board card is now named
    `s01-repo-tooling-skeleton-s17` and so on, and the summary/questions of the first call are presumably gone.
    Verdict: harness gap (minor). The accumulated graph should keep the last provided metadata across repairs.

    Worked well, for the record: the incremental `add_task`/`add_dependency` protocol accepted 51 cards with inline
    edges in one response; every validation error named all offending cards at once with an exact repair recipe;
    after four repair rounds (sizing, coverage, dependency coherence) the graph applied with 52 cards and 115
    edges, root S01. Total architect cost: 21 model turns, 13 of them spent paging the spec body (finding #8).

14. **A fresh worker is told files exist that nobody has created.** The S01 worker's very first user turn opens
    with "[!Klein context focus brief] Known existing paths observed in this session: /index.ts, /smoke.test.ts,
    /kernel/system-clock.ts … do not invent replacement filenames … Older file chunk bodies were summarized out …
    Do not restart a file from line 1". The workspace holds three fixture files; those paths come from the spec
    text the ARCHITECT read, carried into a brand-new session whose job is to create them. Verdict: harness bug.
    The focus brief must be built from the worker's own sandbox listing, never from another session's prose.

15. **!Klein's own UI skill is injected into a foreign project.** The same turn carries the `nklein-ui` guidance
    ("Web UI code lives in web-ui/src/components/", Tailwind tokens, Lucide icons, `@/kanban/utils/react-use`) for
    a card that scaffolds package.json and a smoke test in a TypeScript library with no UI. Verdict: harness bug.
    Skill fragments written for !Klein's own repository leak into every workspace; injection must be gated on the
    workspace (and on the card's files), or a weak model will import `src/components/ui/` into dschinn.

16. **The three-file cap became the write scope, so S01 may not create its own tsconfig or vitest config.** The
    card contract says "Write scope (files you may modify): package.json, test/smoke.test.ts, src/index.ts" — the
    three survivors of the cap (#10). The spec's recipe requires tsconfig.json and vitest.config.ts as well, and
    `npm run typecheck` in the acceptance line cannot pass without a tsconfig. Verdict: harness design flaw (same
    root as #10): `filesLikelyTouched` is a planning hint and must not be promoted to an enforcement boundary; a
    write scope needs its own field with globs. (Whether the scope is enforced is tested in the next turns.)

17. **Every worker turn carries the first 2 KB of a 192 KB spec, cut mid-sentence.** The card message inlines
    "Shared spec: # 36 - Dark Factory Dschinn … [truncated]" — the head of specification.md up to the assessment
    table, ending in "governs realit". It is neither the card's slice nor a summary, and it repeats in every
    worker prompt. Verdict: prompt gap. Inline the card's referenced section (the prompt already carries the exact
    block) or nothing; a truncated head is noise that a small model will try to act on.

18. **Write-scope enforcement is all-or-nothing per batch, and later tool calls run anyway.** `write_files` with
    five files was refused entirely ("tsconfig.json is outside this card's write scope") — the three in-scope files
    were not written either — and the `run_commands` in the same response then executed `npm install && npm test`
    against an empty workspace, returning three screens of ENOENT. Verdict: harness bug on two counts: a scope
    violation should reject only the offending file (or the response should be rejected before any tool runs),
    and dependent commands must not run after a blocked write in the same turn. Confirms #16: S01 cannot ship the
    tsconfig or vitest config the spec requires; the worker has to deliver a partial card and say so.

19. **A correct, complete, green delivery is re-driven as a stall because it ended in prose, not a tool call.**
    S01 was delivered: `write_files` wrote the three in-scope files, `npm install` + `npm test` ran green (1 test),
    `predict_output` recorded, and the turn finished with a plain-language summary. The swarm recovery model
    (`adaptive-swarm-recovery-model.ts` -> `prompt-variation-model.ts`) then classified the finished turn as
    `no_tool_call` and re-drove it with the tool set cut to a single tool, `edit_file`, because `edit_file` is the
    first tool name mentioned in the card text ("prefer the edit_file tool with a small search/replace block").
    So the card's own advice about which tool to prefer became a mandatory completion anchor, and a legitimate
    final answer that used `write_files` instead is read as a failure. The redrive itself then "stopped without
    calling edit_file" and logged another attempt. Verdict: harness bug, and a direct cause of the real factory's
    "empty final redrive" / zombie-attempt churn and much of its wasted model time. A turn that delivered files and
    a green acceptance run is DONE; completion must be judged on the work (files written, acceptance green), never
    on whether a tool name lifted from the instruction prose was the last call. Confirmed by construction: the
    redrive stops the moment the worker makes any `edit_file` call — exactly the wrong incentive.

## Summary

Nineteen distinct shortcomings from one architect decomposition (52 cards applied over 21 turns) and one worker
card (S01, delivered green). They cluster into five root causes, each of which explains behaviour blamed on the
local models on the real v31 factory:

- **Instruction prose is treated as machine contract.** The coverage gate grades keyword echo of names, citations
  and meta-notes (#12); the retry anchor is the first tool name mentioned in the card text (#19); the focus chain
  is spliced into the user turn (#7). These are the engine of the decompose-convergence stalls and the empty-final
  redrive churn.
- **Plan/size/coverage/scope contracts disagree with each other and with the spec.** Three-file cap vs. a
  five-file card (#10); the cap becomes the write scope so a card cannot create its own tsconfig (#16, #18);
  all-or-nothing batch writes with dependent commands still running after a block (#18).
- **Sessions leak state across boundaries.** A fresh worker told files exist that no one created (#14); !Klein's
  own UI skill injected into a foreign repo (#15); a truncated 2 KB spec head in every worker prompt (#17); repair
  resubmits dropping the first submission's metadata (#13).
- **Permanent errors are retried at speed.** The custom-provider "Unknown or disabled provider" loop with an
  acceptance run each time (#4, #5); the rebind-as-host-path zombie (#6) — same family as the morning bounced-redrive
  livelock.
- **Reads and starts cost far more round trips than the work.** 13 turns to read one spec the prompt demands (#8);
  the plan-mode start returning the wrong session (#1, #2); the 60-instruction-over-cap prompt shipped anyway (#3).

What worked: the incremental add_task/add_dependency protocol, error messages that named every offender with an
exact repair recipe, and the governed sandbox itself (writes scoped, egress gated, acceptance re-run from evidence).
The spine is sound; the harness around a weak model is where the time goes.

## Addenda (drive continued 2026-09-07)

20. **"Compaction" that grows the prompt.** On resume the runtime logged "Pre-send context guard compacted history
    before provider dispatch (~6,946 → ~7,079 projected tokens)": the compaction pass made the request larger, and
    the prose final answer that preceded the pause is absent from the resumed transcript (only tool-call turns
    survive), so the model is asked to "Continue from the paused checkpoint" with its own conclusion erased.
    Verdict: harness bug (minor): a compaction must never increase the projected size, and a final answer is part
    of the checkpoint.

21. **The acceptance gate runs the spec's prose line as the shell command.** `extractNKleinAcceptanceCommand`
    scans the whole task prompt with `/^Acceptance (?:check|command):\s*(.+?)\s*$/im` and takes the FIRST match. The
    harness inlines the shared spec into every card prompt, and specification.md's sixth line is "Acceptance
    command: npm test — **BUT SEE "`npm test` IS NOT AN INDEPENDENT ORACLE" BELOW …", so the executed command was
    that sentence: `/bin/sh: 1: Syntax error: Unterminated quoted string`, exit 2, "The acceptance command failed
    for an unrecognized reason". The card's structured `acceptanceCommand: "npm test"` and the contract's own
    "Acceptance check: npm test" line (which comes later in the prompt) were ignored. Every dschinn card fails
    acceptance this way; the worker is then told "Fix only the issue revealed by the acceptance failure" and the
    reviewer is told the check FAILED. Verdict: harness bug, project-wide. Use the card field; when scanning prose,
    scan only the contract section, never inlined spec text.

22. **Pausing a card destroys its uncommitted work; resuming restores the base ref and says "continue".** After
    the pause the runtime logged "Sandbox workspace disposed"; on resume, "Restored the disposed sandbox workspace
    … (checked out the base ref)". The three files S01 had written (and `npm test` had verified) were gone, the
    result branch had "no file changes", and the model was prompted "Continue from the paused checkpoint" with a
    transcript that still shows the successful writes. Verdict: harness bug, and the likely origin of the real
    factory's "worker made no changes" parks. A pause (or any dispose/restore between turns) must capture the
    working tree as a patch and re-apply it on restore, or the transcript must be told the tree was reset.

## Addenda (drive continued 2026-09-07, part 2)

23. **THE acceptance-command bug — found AND fixed on the drive (commit shipped).** `extractNKleinAcceptanceCommand`
    scanned the whole card prompt with `/^Acceptance (check|command): (.+?)$/im` and took the first match; the
    runtime inlines the 192 KB spec into every card prompt and specification.md line 6 is
    `Acceptance command: npm test — **BUT SEE "npm test" IS NOT AN INDEPENDENT ORACLE" BELOW ...**`, so the gate ran
    that prose: `/bin/sh: 1: Syntax error: Unterminated quoted string`, exit 2. EVERY dschinn worker/reviewer card
    failed acceptance this way — on this drain AND the v31 factory. Fix: `src/core/acceptance-command.ts`
    (`sanitizeAcceptanceCommand`) trims the prose tail (em/en-dash clause, `**`, backtick aside) while keeping shell
    syntax (`--`, `|`, `&&`); applied at all three extractors. CONFIRMED live: after the fix, S01's acceptance ran a
    clean `npm test` and passed for the first time ("acceptance-verify done", no shell error). This is the single
    highest-value output of the drive — a one-commit fix that unblocks the whole benchmark.

24. **A trivial scaffold card cannot be completed even by a perfect hand-driven model.** With `npm test` finally
    passing, S01 still fails on the runtime's derived `npm run typecheck` because it needs tsconfig.json — a file the
    card's 3-file write scope forbids though the S01 recipe lists it (#16). Widening the card's `filesLikelyTouched`
    on the board did NOT reach the running session (the write scope is snapshotted at session start), so the worker's
    tsconfig write was still blocked. Stopping the session to force a fresh scope then lost the uncommitted delivery
    and failed to capture ("Could not capture sandbox task result patch: Could not stage sandbox workspace changes"),
    and the prose-final redrive (#19) kept re-issuing the same turn throughout. Verdict: the compounding of
    write-scope-snapshot (#16), empty-final redrive (#19), and stop/dispose-loses-work + capture-failure (#22) makes
    a five-file scaffold un-completable by a flawless operator. This is the drive's central finding about the
    autonomy ceiling: on dschinn today the harness, not the model, is the binding constraint. The fixes are known
    and small (use the card's structured acceptance command and write scope; refresh scope on card edit; judge
    completion on captured work, not the last tool call; capture the tree as a patch across pause/dispose).

## Conclusion of the hand-drive (2026-09-07)

25. **S01 is un-completable at its declared scope, and the two generalizable defects are now fixed.** With both
    fixes live, S01 settled to review without a redrive loop (#19 fixed) and its `npm test` acceptance ran clean
    (#21 fixed). It still cannot complete because the derived `npm run typecheck` needs tsconfig.json, which the
    3-file write scope forbade (#16); widening the card's writeScope let the worker deliver five files, but across
    the review/repair cycles the delivered tsconfig did not reach the acceptance-verified tree (`tsc --noEmit`
    printed its usage help = no tsconfig on the branch). Some of that inconsistency was induced by the heavy manual
    operator churn (stop/resume, lane moves, three drain restarts), so #22 is not cleanly reproduced here — but the
    ROOT block is #16: a scaffolding card whose recipe lists five files cannot pass with a three-file write scope.

    **Shipped this drive (both confirmed live, helping the v31 factory too):**
    - `sanitizeAcceptanceCommand` (P0.ACCEPTCMD) — the acceptance gate no longer runs the inlined spec's prose line;
      dschinn cards pass `npm test` acceptance for the first time.
    - `sessionDeliveredFileChanges` guard in `planSwarmPromptVariation` (P0.EMPTYFINALREDRIVE) — a worker that wrote
      files is not re-driven for ending in prose; the S01 redrive loop is gone.

    **Recommended next (not shipped): the write-scope model (#16).** The decomposer should seed a card's `writeScope`
    from every file its recipe names (not a hard 3-file cap), or the write scope should not be capped below the
    card's stated files. Until then, scaffolding-style cards that legitimately touch 4–5 files cannot complete.

## Addenda (drive continued 2026-09-07, part 3 — S02 onward)

26. **The 30 s `run_commands` cap makes a cold `npm install` impossible in the worker sandbox, and a killed install
    poisons the next one.** S02's `npm install` (five dev deps, warm registry via the egress proxy) was killed at the
    30 s cap twice; a detached `nohup npm install &` then finished, but `vitest` died with `Bus error` — the killed
    install had left a truncated native binary (esbuild) that npm's reconcile treated as present. Recovery needs
    `rm -rf node_modules && npm install` detached. Verdict: harness gap on two counts: (a) the toolchain setup that
    the ACCEPTANCE sandbox already runs (full install, 5-minute budget) should also prime the WORKER sandbox, so the
    model never spends turns installing; (b) a command killed by the cap mid-install should be reported as such
    ("dependency install interrupted — node_modules may be corrupt") rather than as a generic timeout. Both are
    invisible to a local model, which will loop on "vitest: not found" / "Bus error".
    Addendum (S04): the "detached install" workaround does NOT hold either — a `nohup npm install &` is killed
    when the command's process group ends, and `/tmp` is a CONTAINER-WIDE tmpfs, so `/tmp/npm-install.log` from the
    previous task made the new task read a stale "added 48 packages" line. Root cause of the cold installs: the
    package caches are PER-TASK (my own P0.SANDBOXDISK moved them to `/workspaces/.nklein-cache/<uid>-<task>`), so
    every card's first `npm install` re-downloads everything through the egress proxy and overruns the 30 s cap.
    The clean fix is the acceptance gate's own `runSandboxToolchainSetup` (full install, 5-minute budget) run at
    WORKER placement too, so the tree the model sees is already installed.
    SHIPPED (P0.WORKERPRIME): `primeSandboxToolchain` runs the acceptance gate's own toolchain plan (full install,
    4-minute budget) right after the worker sandbox is prepared, so the tree the model sees is already installed.

27. **A runtime restart drops queued dependents back to `planning` without re-queuing them.** After S01 completed,
    the start queue held S02/S03/S04; the drain restart (needed to recover its Docker network, itself destroyed by
    the OTHER drain's restart script) re-parked the two not-yet-started cards into `planning` and the queue kept
    one line. Nothing restarted them until the operator moved them to `ready` by hand. Verdict: harness bug: the
    durable start queue must survive a restart (re-enqueue every `ready`/queued card on boot), the same way the
    "Durable resume … reopened N failed jobs" path already re-opens failed ones.

28. **Session concurrency 1 per endpoint serialises the reviewer behind the worker.** With one endpoint slot, S02's
    review session spun in "Model-turn admission evaluating" every 3 s for the whole time S04's worker ran on the
    same endpoint, and nothing said why. Verdict: prompt/telemetry gap — an admission wait should log ONE line
    naming the blocker ("waiting for endpoint slot held by <task>") and the reviewer should be schedulable ahead of
    a fresh worker start (a review closes a card; a worker opens one).

29. **A green card waiting in Review for an endpoint slot is re-driven as a fresh WORKER, discarding its delivery.**
    S02 and S04 sat in `review` for ~15 min while their reviewer sessions spun in admission (#28). At 02:19:01 the
    board-liveness watchdog started new worker attempts on both ("Attempt started … with claude-hitl") and moved
    them `review → planning`; their captured result branches (green, acceptance PASSED) were simply abandoned.
    Verdict: harness bug — a card with a captured result and a pending review is never "stranded"; the redrive
    must target the REVIEW (or wait), not restart implementation.

30. **Lockfile churn: every in-sandbox `npm install` rewrote package-lock.json into the result branch.** The
    capture takes the whole tree (not just the write scope), so S02's review diff opened with a 1,355-line
    package-lock.json ("FATIGUE WARNING") ahead of the three real files, and every card ships a different lockfile
    that will collide at delivery. Verdict: harness bug: captures should exclude generated lockfiles outside the
    write scope; with P0.WORKERPRIME (`npm ci` when a lockfile exists) workers no longer need to install at all,
    which removes the churn at the source.

31. **Dependency edges do not follow interface imports.** S13's verbatim interface takes S03's `Prng`, but the card's
    `dependsOn` lists only S07, so S13 started while S03 was still in review and its sandbox had no
    `src/kernel/prng.ts`; a literal implementation fails typecheck on the import. The worker had to type the id
    source structurally to deliver. Verdict: decomposition gap — the sizing/coverage gates check keywords and
    file counts but never that a card's declared interface types resolve to files owned by its dependencies; a
    cheap check ("every `import` in the interface block names a file some dependsOn card owns") would catch this.

**Throughput note (02:40):** with P0.WORKERPRIME live and the auto-driver handling the mechanical turns, a card
now costs 3 model turns (deliver → predict → final) plus one reviewer turn; S02 re-delivery, S08 and S13 each
went start→review in under 5 minutes. The hand-written part is the code itself.

32. **The main-branch custodian is a third side door to an idled host — and it runs outside the drain's model
    provider.** At 02:40 the HITL drain ran a three-request `main-branch-custodian::review` session that never
    reached the drive's model server: `NKLEIN_MAIN_CUSTODIAN=1` + the custodian's hard-coded preferred model
    (`qwen3.8-flash-next`) resolved through LM Studio directly (the runtime probes `localhost:1234` for loaded
    models), so m5max served a review nobody had routed there. Its finding was good (S01's `@/*` tsconfig alias
    resolves nowhere at runtime), but the routing is the bug: a drain whose roles are all on one provider must not
    silently borrow another provider's model for an auxiliary session. Fixed for this rig by the allowlist +
    `NKLEIN_CUSTODIAN_MODEL=""`; the product fix is for `resolveCustodianModel` to derive its default from the
    configured reviewer role instead of a model name.

33. **Transient `E502 Bad Gateway` from the egress proxy fails acceptance outright.** S03 and S13 acceptance runs
    died in `npm ci` on a single 502 for one tarball while four sandboxes installed concurrently; the fail-fast
    install env has zero retries. SHIPPED (P0.INSTALLRETRY): one retry after 2 s for E502/E503/E504/ECONNRESET
    class failures; offline signatures still fail fast. The proxy-side cause (why a CONNECT tunnel 502s under
    ~4 parallel installs) is still open.

34. **Custodian follow-up cards are born un-deliverable.** The custodian's `request_changes` created a follow-up
    card with no `Acceptance check:` line and no test expectation; the worker's minimal fix (drop the alias) was
    then bounced by the test-driven delivery gate ("touched no test file") AND held for "NO acceptance command
    exists on this card". The worker had to invent a guard test and the operator had to append `Acceptance check:
    npm test` to the card by hand. Verdict: harness gap: cards the runtime creates itself must inherit the plan's
    default acceptance command and testability, exactly like decomposition children do.

35. **Model failover dispatches the STABLE fitness key as the model id.** v31: "model-side error on
    dirk-qwen3.8-27b — failing over to dirk-qwen3.8-27b", then eight requests sent as `dirk-qwen3.8-27b@q6_k`
    (the registry key) → LM Studio 400 "Invalid model identifier … JIT loading is disabled". `selectNextUntriedModel`
    maps the candidate through `stableFitnessModelKey` and the controller passes that key as the launch
    `modelId`. Verdict: harness bug — the decision must carry the candidate's runtime id for dispatch and the
    stable key only for bookkeeping.

36. **Runtime-created cards carry `baseRef: "HEAD"` and then cannot be merged.** The custodian follow-up card's
    approved delivery was blocked with "Base workspace must be checked out on "HEAD" before merging" — the check
    compares the current branch NAME with the literal `HEAD`. SHIPPED: `HEAD` is accepted as "whatever is checked
    out" at both the staging and the merge check.

37. **Runtime restarts leave orphaned model requests in the relay, and they starve the fleet.** The rig's tee-proxy
    (rig-level, not product) kept seven upstream requests alive after several factory restarts — each thread blocked
    in `resp.read()` until LM Studio finished a generation nobody would read — so both remote hosts' single slots
    served ghosts while live reviews queued behind them ("Model request … opening" and nothing else for 10 min).
    Fixed in the relay (a client-EOF watchdog aborts upstream within 2 s). The product-side lesson: the runtime's
    own stop/abort must reach the model gateway on restart (AbortSignal → upstream close), and any relay must
    propagate client disconnects.

38. **Operator lane moves leave durable jobs the controller will not dispatch.** After S03 was delivered by hand,
    its dependents S05/S15/S22 sat `ready` while the watchdog logged "3 candidate(s) … not revivable by the
    controller (job not failed, or attempt budget exhausted) — the controller's own discovery must dispatch them,
    or they park for the operator". The explicit start API works but demands `prompt` and `baseRef` the card
    already carries. Verdict: harness gap — a `ready` card with a live dependency graph must always be dispatchable
    (re-absorb the job), and `startTaskSession` should default prompt/baseRef from the card.

**Progress note (03:40):** 33 of 51 spine cards delivered and completed by the hand-driven model through the
unmodified pipeline (worker → acceptance → reviewer → delivery → completed), most at 3 model turns per card with
the auto-driver handling the mechanical turns. Remaining friction is all in the harness: `ready` cards the
controller will not dispatch (#38 — the driver now "kicks" them through the start API after each session ends),
one endpoint slot per shared endpoint (`sharedEndpointId` in the registry — perHost/perEndpoint/perProvider caps
do not lift it), and the occasional acceptance failure caused by a card's declared dependencies missing a file its
acceptance clause names (#31: S19→S11, S11→S19, S13→S03).

## Drive complete (2026-09-07 04:20): the whole first vertical slice, S01–S51 plus the charter, through the pipeline

All 51 spine cards and the S00 charter are in `completed`; the integrated `main` (106 commits) was cloned fresh
on the host: **52 test files / 139 tests green, typecheck clean**. Every card went through the unmodified
worker → acceptance → reviewer → delivery path with the hand-driven model; the harness fixes shipped during the
drive (acceptance-command sanitizer, delivered-turn redrive guard, worker toolchain priming, transient install
retry, HEAD base ref, host allowlist, failover runtime id) are what made the tail run at ~3 model turns per card.

Operator deliveries (merged by hand onto main, then marked completed): S01 (the initial scope/capture tangle),
S03 (held after an E502 install failure), S24 (repair loop that never captured its fix), S49 (parked by the
test-driven gate). Everything else was delivered by the runtime itself.

39. **The test-driven gate parks cards whose whole point is to touch no test.** S49 (the index barrel) was parked
    with "touched no test file" and a redecompose clone was spawned, exactly like the custodian follow-up (#34).
    A card with `testability: not_testable` — or a change confined to re-exports/docs — must pass that gate; the
    decomposer should mark barrel/doc cards not_testable at creation.

40. **Completed cards re-spawn planning sessions from a lane shadow.** After S49 was moved to `completed`, the
    board kept a planning-lane copy ("sits in planning but the kernel never heard of it") and the watchdog
    started plan-mode sessions for it every sweep, each nagging "your previous turn ended without calling a tool".
    The driver now answers those with a no-op; the product fix is for the CRDT/board reconcile to drop a card
    from every non-terminal lane the moment it lands in `completed`.

**Throughput:** 54 cards in about 4.5 hours wall-clock including every harness investigation and fix; the last
20 cards took under 70 minutes.

## v31 factory follow-up (2026-09-07, 09:50–10:40): why the real-model factory stalled overnight

The hand-drive finished at 04:20; the v31 factory (legion5pro Q6 + m4mini Q2_K_XL, m5max idle for nklein) ran the
same dschinn plan with real local models and stalled by morning: 8 cards in Review, 86 in Planning, one card
re-reviewed 2,466 times. Every cause below is now a mechanism in the product (commits f390b42cb, da1d5584a,
ff5e2ec-series on `feat/nklein-upcoming`); the operator steps taken to unwedge the board are listed at the end.

41. **A parked review was re-run on every re-emitted summary.** s09a1 was parked ("identical loop") and then
    re-admitted 2,465 times: each `awaiting_review` summary (and the finalizer's own queued rerun) re-ran acceptance
    reuse, the test-driven gate and the park — cancelling turns, probing escalation workers and re-writing a 2.6 MB
    board every ~4 s all night. Shipped **P0.PARKEDLOOP**: the runner holds a card whose persisted review is parked
    on the same work fingerprint (durable across restarts), and the finalizer holds while the worker turn generation
    has not moved since the park; an un-park or a new turn re-admits it. History is capped at persist
    (P1.REVIEWHISTORYCAP); the round counter no longer derives from the history length.

42. **`npm install` output was reviewed as the delivery.** Three result branches (s05a, s09a, s09a1) contained only a
    1,530-line `package-lock.json` generated on a repo whose main has none — the test-driven gate bounced it, merges
    of any two conflicted on it. Shipped **P0.LOCKFILECAPTURE**: `captureWorkspacePatch` restores (or unstages, when
    the base never had it) every staged lockfile whose owning manifest — same directory or any directory below it
    — is untouched in the same change set; `NKLEIN_CAPTURE_KEEP_GENERATED_LOCKFILES=1` keeps the churn.

43. **A weak reviewer approved the sandbox leaking into the repository.** While the sandbox had no registry access
    (the egress 403 of 2026-09-06), s03-prng-tree "fixed" the tests with a `vitest_node_modules` symlink into
    `/opt/nklein`, a `_run_test.js` runner, package scripts bound to that symlink and to `/usr/local/bin/tsc`, an
    npm error log and a `/repos/<hash>` repository url — approved, merged, and inherited by every later card: the
    plan integration gate exited 127 off the sandbox and main's typecheck went red. Shipped **P0.SANDBOXLEAK**: a
    deterministic pre-review gate bounces symlinks into the image, sandbox-internal paths, committed install logs
    and manifest scripts bound to absolute binaries, with a brief naming every leak. The polluted main was repaired
    by hand (operator commit a1d2763 in the drain repo: scripts back to `vitest run`/`tsc --noEmit`, junk files
    removed, a lockfile committed, two type errors and a wrong property-test floor fixed, an empty test file and a
    debug copy of a test deleted) — host-verified green, then s13's real work merged on top (81 tests).

44. **Inherited red acceptance was blamed on the worker after every restart.** The pre-existing waiver needs a
    base-tree sample, but the baseline probe was opt-in per start and in-memory, so on a red main every card got
    "fix the acceptance failure" bounces and then "worker made no changes" parks (s13, s05, s44a: 6–22 rounds).
    Shipped **P0.LAZYBASELINE**: a red acceptance with no baseline on record samples the base tree once, in the
    review runner, and shares the verdict with the delivery-stage waiver.

45. **The loaded-host allowlist excluded the allowed host when the card talks through a proxy.** Every v31 card uses
    the tee proxy on :8081; the start path's residency listing (`lms ps` applies only when the endpoint IS the local
    daemon) was therefore empty, and the fail-closed host map excluded m4mini's worker as "local" on every start —
    all work funnelled onto legion's single slot while m4mini idled. Fixed: the allowlist map reads `lms ps`
    regardless of the card's endpoint, and an empty cached snapshot is retried uncached once.

46. **A trashed card's session held the only slot on a host.** Moving a redecompose card to trash through a
    whole-state save left its architect session running on legion; s14 and the custodian then waited on each other
    for an hour and every explicit start was refused ("another !Klein task on this host must finish first").
    Shipped **P0.TRASHSTOP**: the board-liveness watchdog stops any active session whose card sits only in trash.

47. **Operator recipe for a wedged real-model board** (what the mechanisms above did not yet cover): explicit
    starts of operator-moved cards must pass `queueOnEndpointBusy: true` or they are refused outright on a busy
    host; operator lane moves make durable jobs "not revivable" (#38) and a restart re-parks `ready` cards into
    Planning (#27) — so move the card, restart, and let the controller lease it, or start it explicitly with the
    queue flag. The reviewer's "no verdict in 3 sessions" parks all trace back to LM-Link flaps ("Invalid model
    identifier dirk-qwen3.8-27b" while legion5pro was off the link); the pool-loss classifier and the
    model-unavailable recovery already own that failure.

48. **The watchdog killed a worker whose model was busy processing that very prompt.** legion5pro needs 15+
    minutes to prefill a 40k-token worker prompt; the zero-token wedge bound is 15 minutes, and the classifier
    already said "BUSY (processingPrompt) per lms ps — slow, not dead" — but only to withhold the pool-loss mark;
    the interrupt fired anyway, the card was re-driven, and the next attempt was killed the same way (s05a, 10:52).
    Shipped **P0.BUSYWEDGE**: while `lms ps` reports the model processing/generating the session waits (one log
    line, one observation), hard-capped at 3× the wedge bound; an idle or vanished model keeps the interrupt.
    Same minute: `git rev-parse --show-toplevel` failed transiently under host load (the pre-commit test run on
    the same machine) and the finalizer reported "No git repository detected" — a spawn failure read as a missing
    repo; the capture was held and re-tried by the next summary edge, so no loss, but the message lies.

**Board after the repair (10:40):** s13 completed by the runtime's crash-recovery path the moment its merged commit
was found on main; s09a (an obsolete "make npm work offline" workaround card and its three children) trashed and
completed as void so s09b/s09c flow; redecompose-s03-prng-tree completed (its plan gate failure was the toolchain
leak); s05a and s44a re-driven from the repaired main; s15/s22/s44b/s05 left in Review for the lazy-baseline-aware
review. Both remote hosts are processing; flash-next stays idle.

## Slice 2 (S52–S96) — the sim-driven factory, 2026-09-07 12:00–14:36

David's directive at 11:50: avoid the local LLMs entirely and synthesize every model response through the HITL rig.
The v31 server was stopped (models left loaded, idle), the HITL runtime re-pinned so no role can reach LM Studio, and
slice 2 — 45 cards I planned as the architect — was driven with pre-verified deliveries. 45/45 completed in 2 h 39 min
(≈17 cards/h, zero GPU); dschinn-hitl main ends at 97 test files / 222 tests green, `tsc --noEmit` clean.

49. **The delivery gate judges the result commit's OWN tree, so a stale capture can never pass.** s63/s77 started
    before S57 (the `HookedPack` seam both packs import — an edge my plan did not declare) merged; their captured
    trees lack `degraded-brain.ts`, so `npm run typecheck` on the delivered tree fails forever although
    `main...result` is clean. vitest still passed (the test files import only what exists), the reviewer approved,
    the gate failed on the merged tree — three times. Shipped **P1.STALEBASE**: `refreshTaskResultOntoBase`
    replays the result's first-parent patch onto the current base head before the review (single parent = base
    head, first-parent diff = the card's own change), drops the reused acceptance evidence and moves the evidence
    pin; a patch that no longer applies is a conflict left to the merge machinery.

50. **A failed delivery gate wrote no merge-history record, so the hold was permanent.** The approved-but-unmerged
    redelivery only considers cards whose newest merge record failed; a gate failure (no merge attempted) left
    nothing, and after the one re-drive the card sat in Review with `acceptancePassed: false` for good. Shipped
    **P0.GATEHOLD**: the gate failure is recorded as a failed delivery attempt (`recordDeliveryGateFailure`) in
    both the re-drive and the hold branch, so the existing gap/cap/liveness rules re-gate it. Hand-seeding two
    records (aged 11 min) proved the path live — and showed the loop shape without the record: the redelivery
    fired every tick until the branch was fixed.

51. **Merging main INTO a stale result branch is the wrong repair shape.** The work-package boundary check diffs
    `commit^..commit`; a merge commit's first parent is the old result, so every file main gained since read as an
    `out_of_scope_write` and the card was held again. The right shape is a linear re-capture on the current base
    (what P1.STALEBASE does): checkout main, take the card's files from the branch, commit, move the task + evidence
    refs.

52. **Sandbox `npm ci` flaked all afternoon.** S94's prime, s63's second gate, S72's acceptance ("the BASE tree
    already failed"), S95's prime — every one "dependency installation failed inside the sandbox: npm ci". The
    uplink is a phone hotspot; `fetch-retries` is 0 by design (fast offline detection), the transient signatures
    cover 502/503/504/ECONNRESET but not timeouts, every placement re-downloads through its own cache, and the
    prime's 400-char output tail ends in npm's EventEmitter warning, not the error. Open **P1.NPMSEED**: a warm
    per-workspace npm cache seed (content-addressed, integrity-checked by npm) copied into each placement so
    installs are offline-fast and the flake class disappears; plus the `npm error` lines in the observation.

53. **A reviewer cut at the verdict reserve spawns a fresh session per nudge.** After the exploration turn is cut
    and the session stopped, each nudge `sendTaskSessionInput` restarted the reviewer from scratch (three
    `startTaskSession dschinn-slice2-s72::review` within 50 ms; S94 twice) — three model requests for one review,
    and under endpoint contention the reviewer's deadline is consumed by ADMISSION WAITING before its first token,
    so "no verdict in 3 sessions" parks a card whose reviewer never got to speak (S72 parked; un-parked via the
    API). Open **P1.REVIEWNUDGE**: the deadline clock must start at admission, and a nudge after a cut must resume
    ONE session (or the reserve cut must not stop the session it is about to nudge).

54. **Auto-driver lessons (rig, not product):** one unanswerable request blocked every later one (the loop exited
    on the first miss) — skip and continue; a red `typecheck-exit` was papered over by the final prose (this is how
    s63/s77 got approved) — refuse; explicit starts must pass `queueOnEndpointBusy: true`; the runtime's re-drive
    text is "the acceptance check still FAILS"; a prime failure needs a background install + poll because
    `run_commands` caps at 30 s; an install flake that fails the base tree too is the environment, not the work.

55. **Dependency edges are the plan's weakest artifact.** My slice-2 plan declared 62 edges and missed the S57
    seam for four packs; the replay generator now derives edges from the deliveries' imports (574 derived, 566
    transitive pruned, 185 kept) — the same derivation could validate a live plan against its deliveries.

56. **The Dschinn replay set exists.** `scripts/generate-dschinn-scenario-set.mts` folds the two HITL
    decompositions (answers 17/19/20/21 + 343/345) and all 97 deliveries (S00/S01/S03/S04/S07 reconstructed from
    git) into `packages/llm-simulator/scenarios/36_dark_factory_dschinn_universal_agent/perfect-run.json` (197
    tracks, 490 fixtures). Caveat: the harness keeps sandboxes offline and Dschinn's acceptance needs vitest, so
    until P1.NPMSEED the in-sandbox acceptance is red on base and work alike and deliveries ride the reviewer's
    verdict under the pre-existing-breakage waiver; the drained repo is proven on the host afterwards.

57. **The simulator transport delivers only the FIRST tool call of a multi-call turn.** aimock's OpenAI stream
    builder emits `delta.tool_calls[{index: tcIdx}]` per call, yet the runtime persisted and executed exactly one
    of the replay's 53-call planning turn (`[tool_call …update_focus_chain]`, nothing else) — the same batch the HITL
    model server returned as a non-streaming `tool_calls` array and the runtime ran in full. Every checked-in set
    is single-call-per-turn, so the path was never exercised. Open **P2.SIMMULTICALL** (repro: any track turn with
    two `calls`; compare the persisted `[tool_call …]` markers). The replay set uses the planner's batch form
    instead (`add_task({ tasks: [...] })`, one call per slice) so the transcript stays small.

58. **A planning session that overflows its context restarts with a brief that quotes card prompts — and worker
    needles leak.** With one add_task per turn the seed transcript passed the simulated model's 65k window after
    ~65 cards; the restart brief's "Recent transcript previews" carried `Implement spine card S63 — …` verbatim, so
    the S63 worker track (class-scoped needle) out-ranked the any-class decompose track and answered the planner
    with `write_files` ("This is a planning card, not a work card"). Two consequences: the harness gained
    `NKLEIN_SIMFLOW_CONTEXT_TOKENS` (the simulated window is a scenario parameter, not a constant), and wire truth
    6 extends to restart briefs — a worker needle must not be quotable from the planner's own transcript, which the
    batch form guarantees by never restarting.

59. **P1.NPMSEED shipped.** The install flake class (#52) is a download problem, so the mechanism removes the
    download from the hot path: a per-workspace npm cache seed copied into every fresh placement before its first
    install and grown from every successful one. The cap-dropped sandbox shaped the design — in-container root has
    no CAP_DAC_OVERRIDE and cannot read a task's `700` cache, so the harvest is two execs (task user exposes, root
    merges) and the trust boundary is root's filter: content blobs plus tarball-keyed index entries only, never
    packuments, no-clobber, size-capped. Seeding copies (no shared inodes) so tasks never touch each other. A trusted
    host `_cacache` can be imported at boot; the simulated-flow harness passes it through (`NKLEIN_SIMFLOW_NPM_SEED`),
    which is what lets the offline Dschinn replay run the real vitest acceptance instead of riding the waiver. The
    replay scaffold (S01) now carries the drive's lockfile so placements run `npm ci` against pinned integrity.

60. **P1.REVIEWNUDGE shipped.** The three concurrent S72 reviewers (#53) were queued admissions, not a runner
    loop: the bracket's clock started at the queued start, the reserve cut fired before admission, and every nudge
    to the never-started session restarted a fresh one. The budget now starts when the session is admitted to its
    endpoint (`onAdmitted` → `clockStartsOn`; the wait extends the deadline, capped at one timeout), and a start cut
    while still queued is not nudged. Under one-endpoint contention a reviewer now waits its turn and then gets its
    full budget — the shape every single-model rig needs.

61. **Replay runs 3–4: the harness is not the drive.** Three environment truths the HITL rig never met: (a) the
    dev-test fixture (`ts-starter`) is a node:test scaffold, not an empty repo — S01 now removes its starter test and
    runner before writing, or vitest executes them; (b) the runtime enforces `filesLikelyTouched` as the WRITE
    scope — S01's `tsconfig.json` was blocked, the empty patch became a no-op completion and main stayed at the
    fixture, so the generator derives every card's scope from its delivery; (c) the acceptance gate's cached offline
    verdict (10 min after one EAI_AGAIN) skipped the install of every seeded placement — a network fact must not veto
    an install the seed can satisfy offline. Also seen: the watchdog re-delivered s54 every 30 s because the re-run
    failed before it could write a merge-history record — the redelivery decision now honours the in-process time
    of the last attempt as well. Each is a product fix (85541a67b), not a replay-only patch.
