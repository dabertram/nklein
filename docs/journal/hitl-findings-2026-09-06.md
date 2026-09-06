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
