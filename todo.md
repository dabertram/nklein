# !Klein — current work queue

> **Standing goal:** make !Klein a feature-complete, local-autonomous, multi-LLM kanban swarm, then prove it,
> harden it, polish it, and prepare it for release. Work this file **top-down** until the backlog reaches zero.
>
> **Single source of truth:** this file contains every remaining task and the engineering knowledge needed to do it.
> [done.md](done.md) contains shipped work and compact historical evidence. Other Markdown files may document current
> behavior, operations, legal provenance, test fixtures, or research, but they must not maintain a second backlog.
>
> **Reconciled:** 2026-07-13 against `feat/nklein-upcoming`, after fetching `origin` and `upstream`, checking every
> tracked Markdown file, and reconciling the recent implementation delta. The branch matched its upstream immediately
> before the current stop-the-line increments (`0` ahead, `0` behind).

## How to use this queue

- Start at the first unchecked package. Skip only when its inline prerequisite is not complete.
- One checkbox is one implementation-sized work package. Completed substrate is mentioned in the package, but does
  not make the remaining package partial: the checkbox closes only when its stated acceptance is met.
- Feature implementation and its focused tests stay together. Broad sweeps, hardening, visual polish, release work,
  research, optional ideas, and hardware/user-gated checks are deliberately later.
- When a package finishes, move it to [done.md](done.md) in the same commit; do not leave `[x]` history here.
- Add new work at the correct dependency position, not merely at the end. Do not create another planning Markdown file.

Status: `[ ]` ready · `[>]` waits on a named package · `[?]` needs the user/external hardware · `[-]` intentionally
deferred or optional. Count only non-quoted checkbox rows. Legacy `§5.*` labels are retained in topic headings and in
the alias map so old commits, comments, and references remain searchable.

## 1. Prime directives

1. **Local models only.** `CLOUD_ENABLED = false`. Cloud escalation remains a future, explicitly user-enabled phase;
   no current package may make a paid/cloud model reachable.
2. **Strict Docker agent isolation is mandatory and fail-closed.** Agent filesystem/shell work runs in the sandbox;
   trusted board/plan state mutation is the host-side control plane.
3. **32k minimum context.** Never send an oversized prompt; compact or stop.
4. **Keep the vendored SDK boundary clean.** Product features live through supported sockets; `npm run lint` enforces
   import boundaries. The final architecture is TypeScript; a wholesale Python backend port is permanently dropped.
5. **Protected tests are human-gated.** Do not edit `test/protected/**`, `vitest.protected.config.ts`, or
   `test/protected/protected-tests.json` without an explicit `{intent,diff,reason,expectedEffects}` approval.
6. Follow `AGENTS.md` / `CLAUDE.md`: no `any`, no inline/dynamic imports, SDK types where available, `react-use` in
   web-ui, Tailwind over inline styles, small single-purpose files, and current user-facing `CHANGELOG.md` entries.
7. Work autonomously, commit green coherent increments, and do not stop for prioritization or context-budget shape.
8. Do not autonomously download/delete models. Recommend exact actions; the user controls model inventory.

## 2. Product and value filter

!Klein turns a high-level goal into a dependency-linked DAG of right-sized cards, routes them to suitable local models,
runs them safely in parallel, reviews and merges their work, and gives the operator a clear view of healthy, stuck,
risky, and completed work. It must remain useful with one model and exploit role/model diversity when more are present.

Keep a package only when it materially improves at least one of: task completion, correctness/safety, local-model
capability, operator clarity, performance/resource use, maintainability needed by a feature, or release readiness.
Challenge-found defects become concrete packages at the right position; speculative churn does not.

## 3. Working loop and completion gates

1. Read this file, `git status`, and recent commits; inspect the implementation before trusting the task wording.
2. Take the first ready package. If large, split it into independently green leaves here before coding.
3. Implement production behavior and focused regression coverage. Use the LLM simulator first for agent/model flows;
   use real models only where the simulator cannot establish the claim.
4. Verify proportionally: `npm run typecheck`, `npm run web:typecheck`, `npm run lint`, `npm run test:fast`, affected
   suites, `npm run test:protected`, and Docker/Playwright/live-model gates when relevant.
5. Update `CHANGELOG.md` for user-visible changes, move the finished package to `done.md`, and commit the coherent green
   increment. Never weaken a surfaced failure or mark an unverified package done.

Backlog zero means: every package below is moved to `done.md`, deliberately `[-]`, or explicitly `[?]`; the full gate,
feature-completeness challenges, release checks, and required manual checks are green; no known correctness/safety/UX
gap remains.

## 4A. Engineering standards & tribal knowledge (read before coding)

> Integrated from the former `AGENTS.md` (2026-06-28, user). `todo.md` is the **single file** an agent is pointed at —
> `AGENTS.md`/`CLAUDE.md` are now thin pointers here. **When to add tribal knowledge to this section:** the user had to
> intervene/correct/hand-hold · multiple back-and-forths to get something working · something required reading many files
> to understand · a change touched files you wouldn't have guessed · something behaved differently than expected · the
> user asks. Proactively suggest additions when those happen. **What NOT to add:** things you can figure out from reading
> a few files, obvious patterns, standard practices — keep it high-signal, not comprehensive.

### TypeScript principles
- No `any` types unless absolutely necessary.
- Check `node_modules` for external API type definitions instead of guessing.
- Prefer SDK-provided types, schemas, helpers, and model metadata over local redefinitions. For things like NKlein SDK reasoning settings, use the SDK's source of truth instead of recreating unions, support checks, or shapes in !Klein.
- NEVER use inline imports. No `await import("./foo.js")`, no `import("pkg").Type` in type positions, no dynamic imports for types. Always standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies. Upgrade the dependency instead.

### Cline SDK (vendored agent engine — base we build on, not a path we follow)
The agent engine is the **Cline SDK** (`@cline/*`, Apache-2.0), vendored as **source** under `vendor/cline-sdk/`
(pinned upstream commit in its [`NOTICE.md`](vendor/cline-sdk/NOTICE.md)) and built by us
(`npm install --prefix vendor/cline-sdk` once, then `node scripts/build-cline-sdk.mjs` → esbuild self-contained `.js`
+ tsc `.d.ts`; the host resolves `@cline/*` to that built `dist` via tsconfig `paths` + esbuild aliases). We build from
**source, not the prebuilt npm bundles**, for a hard safety net (upstream has reorganized once — `@clinebot`→`@cline`,
source repo went private — so if it vanishes the buildable source still lives here) and for deep control of internals.
- **Pull upstream selectively — only when it benefits us.** Do NOT auto-upgrade or chase parity. Cline's gravity is the
  cloud platform (accounts/hub/remote/subscriptions); ours is offline/local/small-model. Different products, shared engine.
- **Patch our copy deliberately when upstream steers against our target** (e.g. context/compaction tuning for small, slow
  local LLMs). Apache-2.0 permits it. Keep patches MINIMAL and log every one in the patch ledger in
  [`vendor/cline-sdk/NOTICE.md`](vendor/cline-sdk/NOTICE.md); re-apply the ledger on each sync. Be strong about our
  direction, fair to the source (attribution + license intact, upstream fixes contributed back where sensible).
- **Keep cloud code present but disabled** (don't strip it) — out of scope now, in scope later.
- **Host coupling is centralized** in `src/nklein-agent/sdk-*-boundary.ts` (+ a few siblings). On upgrade, API drift
  surfaces there as tsc errors — reconcile at the boundary, not by scattering SDK calls.

### Code quality
- Write production-quality code, not prototypes. Break components into small, single-responsibility files. Extract shared logic into hooks/utilities. Prioritize maintainability + clean architecture over speed. Follow DRY + clear separation of concerns.
- In `web-ui`, prefer `react-use` hooks (via `@/kanban/utils/react-use`) whenever possible.
- **Any spawned `git` (prod OR tests) must scrub inherited hook env via `createGitProcessEnv()`** (`src/core/
  git-process-env.ts`). Git hooks export `GIT_DIR`/`GIT_INDEX_FILE` (with `git commit -a` the index is a TEMP file),
  and a child `git init`+`commit` in a tmpdir silently inherits them and operates on the OUTER repo's index — the
  pre-commit test suite is exactly such a hook context, so raw `{...process.env}` spawns pass standalone but fail
  under `git commit -a` (live 2026-07-03: three decomposition tests). Repro/guard: run the test with
  `GIT_INDEX_FILE=<repo>/.git/index` poisoned.
- **Fresh `.claude/worktrees/*` checkouts have no `node_modules`** (2026-07-13) — Node resolution silently falls back to
  the MAIN checkout's, which lacks web-ui-only + `@clinebot/*` deps, so runs/typechecks half-work confusingly. To work in
  one locally: `npm install` in `web-ui/` + `HUSKY=0 npm install` at the worktree root. The runtime's data dir comes from
  `homedir()`, so an isolated `$HOME` gives a throwaway instance (it auto-registers the cwd repo as a workspace) without
  touching real projects.
- **Prefer existing solutions over custom implementations — a standing directive.** Before hand-crafting any non-trivial
  capability, FIRST do **extensive, current online research** for a valid, well-maintained, *suitable* existing solution
  (library, tool, MCP server, service) — **web-search the ecosystem broadly; do NOT rely on training-cutoff memory (it is
  stale), and verify each candidate is current + actively maintained** (recent releases / last commit / open-issue health).
  Then evaluate fit against our constraints — **license, strict local-only/offline + Docker-sandbox compatibility,
  token/footprint cost for small local LLMs, maintenance health, and overlap with what we already have.** If it fits,
  **integrate it properly** rather than reinventing it; only build custom when nothing suitable exists or the fit is poor.
  **This evaluation must happen BEFORE writing the custom version** (don't build, then discover the off-the-shelf option).
  Precedents: the **Cline SDK** (evaluated → forked the source — special case, it's our engine; see the §4A note above);
  **`codebase-memory-mcp`** (evaluated → integrated behind the sandbox `LocalizationProvider`; extend the native
  fallback only when the graph cannot supply the required behavior).
- **Research is CONTINUOUS, not just a build-vs-buy gate — a standing directive (2026-07-01, user).** The rule above
  fires *before* hand-crafting; this one is broader: do **extensive, current online research for basically EVERY !Klein
  component + concept — BEFORE and AFTER implementing, and whenever we touch a topic directly OR adjacently.** The
  local-LLM / agent / context-engineering landscape moves weekly, so training-cutoff memory is stale by default; treat
  every non-trivial design point (a model's behavior, a budgeting / retry / context / prompting strategy, an API surface,
  a protocol, a security posture, an algorithm) as something to **re-ground in current sources** — SOTA papers, the
  model/tool/framework's OWN docs + release notes, how the ecosystem already solves it — NOT to reason about from memory.
  **"After implementing" matters too:** re-check that what we built still matches current best practice AND the real
  runtime behavior (live-probe the models — §4A MODEL LOADING / §5.Z), then revise. Capture findings durably (§4A / the
  relevant §5 section, `docs/dev/`, the integrations registry) so research COMPOUNDS instead of being re-done. When in
  doubt, RESEARCH — under-researching + reinventing (or coding against a stale mental model of how a model/tool behaves)
  is the failure mode this repo most wants to avoid. This applies to agents + subagents too: a task that "touches a
  topic" should budget for the research, not skip it to save a step.
  **TRACK every integration in [docs/dev/integrations.md](docs/dev/integrations.md)** (the registry — name · what · status ·
  license · #1/egress posture · where wired; user 2026-07-01). Update it whenever we adopt, evaluate, partial-wire, or drop one.

### Architecture opinions
- Avoid thin shell wrappers that only forward props or relocate JSX for a single call site.
- Prefer extracting domain logic (state, effects, async orchestration) over presentation-only pass-through layers.
- Do not optimize for line count alone. Optimize for codebase navigability and clarity.

### Git guardrails
- **Commit cadence is governed by the WORKING MODE callout at the top of this file** (this repo's standing instruction is *commit incrementally without being asked*, each commit green — which overrides the generic "never commit unless the user asks"). Never push / open PRs unless asked.
- `CHANGELOG.md` is **release notes**, not a work log. We branched off `main`, pre-version dev (no released version, no back-compat burden). Only record in `## [Upcoming]`: **features** / user-facing behavior changes since the last version, and **fixes for bugs that already existed on `main`**. Do **NOT** add entries for bugs we introduce *and* fix during this pre-version phase (they never shipped) — just fix them with a test. (After a version releases, resume normal "every fix" discipline.)

### GitHub issues
- When reading an issue, read all comments: `gh issue view <number> --json title,body,comments,labels,state`.
- When closing via commit, include `fixes #<number>` / `closes #<number>`.

### web-ui stack & styling
- Tailwind CSS v4 for styling, Radix UI for accessible headless primitives, Lucide React for icons. Custom UI primitives live in `src/components/ui/` (button, dialog, tooltip, kbd, spinner, cn). Toasts via `sonner` (`{ toast }` or `showAppToast` from `@/components/app-toaster`).
- Tailwind utility classes are the primary system — prefer `className` over inline `style={{}}`. Prefer Tailwind over custom CSS in `globals.css`; conditional Tailwind via `cn()` beats CSS overrides for state-driven styling. Reserve `globals.css` for what Tailwind can't express (complex selectors, app-level layout glue, genuine cascade). Only use inline `style={{}}` for truly dynamic values (prop/variable colors, computed drag positions, runtime dimensions). Design tokens live in `globals.css` `@theme { … }` — use `bg-surface-0`, `text-text-primary`, `border-border`, etc.
- **Design tokens:** surfaces `surface-0` (#1F2428 app bg/columns) · `surface-1` (#24292E navbar/raised) · `surface-2` (#2D3339 cards/inputs) · `surface-3` (#353C43 hover) · `surface-4` (#3E464E pressed/scrollbars). Borders `border` (#30363D) · `border-bright` (#444C56) · `border-focus` (#0084FF). Text `text-primary` (#E6EDF3) · `text-secondary` (#8B949E) · `text-tertiary` (#6E7681). Accent `accent` (#0084FF) · `accent-hover` (#339DFF). Status blue #4C9AFF · green #3FB950 · orange #D29922 · red #F85149 · purple #A371F7 · gold #D4A72C. Radius `sm` 4px · `md` 6px · `lg` 8px · `xl` 12px.
- **UI primitives** (`src/components/ui/`): `Button` (`variant="default|primary|danger|ghost"`, `size="sm|md"`, `icon={<Icon/>}`, `fill`, children); `Dialog`/`DialogHeader`(`title`)/`DialogBody`/`DialogFooter`; `AlertDialog*` for destructive confirms; `Tooltip` (`<Tooltip content="…"><trigger/></Tooltip>`); `Spinner` (`size`, `className`); `Kbd`; `cn`.
- **Icons:** `lucide-react`, individual imports; 14px for small buttons, 16px default; pass as JSX to `icon` prop.
- **Radix** directly for headless behavior (`@radix-ui/react-{popover,dropdown-menu,checkbox,switch,collapsible,select}`), styled with Tailwind + `data-[state=checked]:` etc.
- **Dark theme always.** Surfaces `bg-surface-0` (app) → `-1` (raised) → `-2` (cards/inputs) → `-3` (hover) → `-4` (pressed). Do NOT use Blueprint, Tailwind light-mode defaults, or any `dark:` prefix.
- **Hand-rolled `useSyncExternalStore` stores (`web-ui/src/stores/`) must NOT notify listeners synchronously from their mutators** (2026-07-13, root cause of the mount-time dev-console warning flood). `App` mutates them from effects (e.g. `workspace-metadata-store`'s `replaceWorkspaceMetadata`/`resetWorkspaceMetadataStore`), and during the board-seeding burst React flushes those pending passive effects while mid-render/commit — a synchronous `emit` then schedules an update for a subscribed component (BoardCard/TopBar/App-via-`use-git-actions`) while another is rendering, flooding the console with `Cannot update a component while rendering a different component` + `flushSync … React is already rendering`. Fix: mutate state synchronously (so `getSnapshot` stays correct) but coalesce the listener fan-out onto a `queueMicrotask`; `startTransition` does NOT help (still schedules synchronously). Regression guard: `workspace-metadata-store.test.tsx`.

### The quickest simplest explanation is NOT the truth — search deeply for root cause (non-negotiable, user 2026-07-07)
> **Never accept your first, quickest, most convenient explanation as the answer. A plausible-sounding cause is a
> HYPOTHESIS, not a conclusion — question it, look for disconfirming evidence, and dig for the ACTUAL root cause before
> you record it, act on it, or ship a fix on it.** The failure mode this bans: pattern-matching a symptom to a tidy
> label ("it's a TTL", "it's a 6-min prefill", "it's flaky/environmental/pre-existing") and moving on as if the label
> were verified fact. That is how wrong understanding calcifies into wrong fixes.
> - **Never apply only the smallest possible patch unless the root cause is already known and evidenced.** A tiny local
>   change that makes the current symptom disappear is a dirty quick fix if it does not explain what actually went wrong.
>   Before changing code, identify the failure path; if the evidence is insufficient, collect or generate more evidence
>   first (logs, preserved run artifacts, focused regression tests, live probes, instrumentation). The goal is to improve
>   the whole system's understanding, diagnostics, and behavior, not to hide one observed bug behind an extra fallback.
>   Complexity is only acceptable when it follows from the verified cause and reduces future ambiguity; speculative
>   fallbacks, silent bypasses, and "just make it pass" patches are banned.
> - **Distinguish "verified" from "guessed" in what you WRITE.** If you haven't confirmed it with evidence, say
>   "hypothesis" / "unverified" / "plausible but unconfirmed" — never state a guess in the declarative voice of fact.
>   (Recorded miss 2026-07-07: I wrote a model vanished due to "TTL expiry" — but `lms ps` had shown that model with a
>   BLANK TTL, and its actual settings/logs didn't support the claim. It was a convenient guess dressed as fact.)
> - **Chase the evidence to ground truth**, even across systems: config files, actual logs, OS crash reports, live probes
>   (`lms ps`, `lms log stream`), the source. Follow it until it either CONFIRMS or REFUTES the hypothesis. Multiple
>   competing hypotheses? Enumerate them and find the observation that discriminates.
> - **SCOPE every piece of evidence to its EXACT source, and name the scope out loud.** Evidence gathered from one place
>   does not silently generalize to another. "`m5max`'s settings.json says JIT is on" is NOT "JIT is on for the model on
>   `m4mini`" — per-host / per-node / per-env config differs. State what you actually inspected ("I read X on host A;
>   host B's is unknown to me") and never let a reading from one system stand in for another. (Recorded miss 2026-07-07:
>   I read Local/m5max's LM Studio config and floated its JIT-TTL as a cause for a model that was on m4mini — where JIT
>   was actually OFF, refuting the hypothesis. Convenient nearby data masquerading as the real data, one level below the
>   first TTL miss.)
> - **Catalog model/package aliases by evidenced capability family, not by hope.** If LM Studio or Hugging Face exposes a
>   patched/package-specific id such as `qwen2.5.1-coder-7b-instruct`, classify it from the underlying model family and
>   the observed package behavior, with a specific catalog row when size or behavior differs. Do not unblock a run by
>   suppressing an UNKNOWN warning unless the matcher, sources, and regression tests prove the alias is the intended
>   family.
> - **GATE a hypothesis on CONSISTENCY with ALL the facts you ALREADY hold, BEFORE you entertain / rank / investigate it —
>   check the MECHANISM and the MAGNITUDES, not just surface plausibility.** Ask two questions of every candidate cause:
>   (1) *does the proposed mechanism even apply to the observed conditions?* (2) *do the numbers/timeline fit?* A
>   hypothesis that contradicts a fact in hand is DEAD ON ARRIVAL — killing it needs zero investigation. This is the
>   cheapest, earliest filter and it catches the worst misses (the ones you then spend days half-defending). **Reason
>   about ALL the details of basically everything — the mechanism's actual definition, the quantities, the timeline — not
>   the vibe of a label.** (Recorded miss 2026-07-07, user-caught: I entertained AND RANKED a JIT *idle*-TTL as a cause
>   for a model that vanished during ACTIVE, REPEATED use — but (a) an *idle* timeout by definition never unloads a model
>   that is processing, and (b) that TTL was **1 hour** while the model was being called **every few minutes**, so a
>   continuous 60-min idle window never remotely existed and it COULD NOT have fired. Two independent disqualifiers, both
>   derivable from facts I had on the FIRST tick, needing zero investigation — I carried the dead hypothesis through two
>   more corrections instead of killing it on sight. The upfront wrong-steering came from pattern-matching "model gone →
>   TTL" without checking whether the TTL mechanism could physically produce THIS observation.)
> - **When the true cause is genuinely UNKNOWABLE with current evidence, SAY SO — and add the instrumentation to catch
>   it next time.** "I can't determine this because X (remote node / logging was off / event already passed); here's the
>   monitoring that would answer it" is a correct, honest deliverable. Inventing a clean answer to avoid "I don't know"
>   is the exact sin this rule bans.
> - This is the general principle; its specific instances already in §4A — "READ THE LM STUDIO DEV LOGS FIRST" (don't
>   theorize a model's behavior from harness symptoms) and "A surfaced test failure is NEVER waived" (don't rationalize a
>   red away) — are the same discipline applied to two recurring traps. (Prior instance the user caught 2026-06-30:
>   rationalizing a decompose stall as "a ~6-min/40k-token prefill" and shipping a fix on that guess.)

### A surfaced test failure is NEVER waived (non-negotiable, user 2026-06-29)
> **No test failure that has surfaced may be dismissed, hand-waved, or rationalized as "unrelated / environmental / pre-existing / not my change."** The moment a failure appears — in any suite, fast or integration, on any machine — it is a debt that MUST be discharged:
> - **Fix it right away** if doing so doesn't derail genuinely-relevant ongoing work; **then** continue.
> - If fixing now WOULD interrupt relevant in-flight work, it MUST be written into the **very next todos** (a concrete, top-of-queue backlog item with the failing test name + observed error), and picked up immediately after the current unit of work — not "later", not "someday".
> - "All green" claims only ever refer to a suite where **nothing is failing**. Never report green while quietly excluding a failing suite. If `test:fast` is green but the full `vitest run` (integration) is not, SAY SO and record the integration failures as todos.
> This rule outranks momentum: a passing build is worth more than one more feature increment.

### When debugging an LLM, READ THE LM STUDIO DEV LOGS FIRST (non-negotiable, user 2026-06-30)
> **Any time a model behaves unexpectedly — a stall, timeout, slow/empty response, a tool-call that never lands, a
> mysterious "inactivity" abort — go to the LM Studio dev logs for GROUND TRUTH before theorizing from runtime/harness
> symptoms.** The harness/runtime only tells you *something* is slow or wrong; the model-server logs tell you *what* and
> *how slow*. (Caught 2026-06-30: I rationalized a decompose stall as "a ~6-min/40k-token prefill" and shipped a fix on
> that guess — the user rightly pushed back; `lms ps` showed the real state immediately.)
> - **Never wait on an assumed long generation or assumed model activity without checking the ground truth.** If !Klein is
>   quiet, check `lms ps` (and, when relevant, workspace sessions / task-run state / dev logs) before burning wall-clock.
>   `IDLE` models plus no active task session is a **stall**, not "probably still thinking"; stop the stale wait, preserve
>   the run artifacts, diagnose from evidence, and either recover or file the concrete bug. Verifier harnesses must not treat
>   `state:"running"` as progress by itself: a quiet-running session needs a bounded, model-aware lane that records the
>   `lms ps` state (`IDLE` vs `PROCESSINGPROMPT`/`GENERATING`) in the abort/wait diagnostic.
> - **Be generous with ACTIVE model timeouts, especially on low-spec hardware.** !Klein's vision includes making weaker
>   machines useful, so a checked `PROCESSINGPROMPT`/`GENERATING` model is not a failure just because it is slow. Use
>   generous, hardware-aware active bounds; reserve fast aborts for verified idle/unloaded/stuck states, missing sessions,
>   repeated no-progress loops, or explicit harness limits. When a low-spec model is slow but still active, record latency
>   as capacity/fit evidence rather than prematurely calling the model unsuitable.
> - **Do not confuse model diversity with hardware/model suitability (2026-07-09 live miss).** A second reviewer off the
>   m5max is useful only if that host/model is fit for the lane. Do **not** put a latency-critical reviewer/conductor lane
>   on an oversized dense remote model just to get family/host diversity: the live fleet run pinned `qwen3.6-27b` on the
>   Legion5pro as the single review slot and predictably turned review into the bottleneck. For constrained hosts (for
>   example Legion5pro-class laptop hardware), use small/appropriate models for tiny worker/probe/read-only tasks, ask the
>   user before using a heavy dense model there, or keep heavy review on the m5max. Always gate model assignment on the real
>   hardware envelope + `lms ps` state, not just "different machine/family".
> - **Slow processing should produce OBSERVATION-BASED context advice, not impatience or blanket shrinkage.** If repeated
>   `PROCESSINGPROMPT`/slow-TTFT evidence shows that a model/host/context setting is wasting wall-clock, !Klein should
>   eventually suggest a smaller loaded/request context limit or leaner prompt level for that host/model/task class. But
>   the low-spec-hardware vision stays leading: advice must be based on measured prefill speed, TTFT, prompt tokens,
>   cache-hit/miss, and task outcome; it must never drop below the 32k floor, never silently sacrifice needed project
>   context, and should pair smaller windows with JIT retrieval, compaction, cache reuse, and task splitting so weak
>   machines can still work through large codebases over time.
> - **`lms ps`** — live per-model state: `PROCESSINGPROMPT` (prefilling — emits NO stream tokens, so this is what trips a
>   stream-INACTIVITY timeout) vs `GENERATING` (emitting tokens) vs `IDLE`, plus loaded context window + parallelism. This
>   alone distinguishes "prefilling slowly", "generating a long reasoning block", and "actually hung".
> - **`lms log stream --stats --source model [--filter output|input]`** — per-request prediction stats: prompt tokens,
>   predicted tokens, tok/s, **time-to-first-token** (= the prefill time). Compute prefill speed = promptTokens / TTFT to
>   judge whether a slow turn is a *large context* or *throttled/pathological prefill*. **Caveat:** `--stats` emits on
>   request **completion**, and only for requests that **start after** the stream is attached — so start the stream
>   BEFORE triggering the model call you want to measure.
> - The model server is local LM Studio on `:1234`; `lms` lives at `~/.lmstudio/bin/lms`. Per-request stats are NOT
>   written to `~/.lmstudio/server-logs/` by default (that dir is sparse) — capture them LIVE via `lms log stream`.
> - Note the OS power mode (`pmset -g | grep -i lowpower`): Low Power throttles GPU ~50%, so prefill/gen are ~2× slower —
>   factor it into "is this speed legit?" and remember the runtime's own timeouts must be power-aware (the §5.AF C3 fix).

### Misc. tribal knowledge (engineering invariants & hard-won gotchas)
> (WORKING MODE — autonomous, full capabilities — is the callout at the **top of this file**; don't re-litigate it. `/clear` at clean breakpoints once a milestone is committed and all durable state is in `todo.md`/`git`.)
- **New root CLI launch flags MUST also be added to `shouldAutoOpenBrowserTabForInvocation` (`src/cli-invocation-parsing.ts`).**
  That classifier doubles as "is this a server launch": an argv token it doesn't recognize makes `run()` (cli.ts) treat the
  invocation as a subcommand and `process.exit` right after the command resolves — the server boots, prints "running at …",
  then exits 0 with no error. This bit `--public-host` (2026-07-13: every LAN launch, incl. the desktop child spawn, died
  instantly); unit suites stayed green and only a live boot surfaced it. When adding a flag, extend the classifier + its
  regression test in `test/runtime/cli-invocation-parsing.test.ts` in the same commit.
- **Basic Memory MCP is LOCAL on this host unless explicitly proven otherwise.** Use the local/default project (currently
  `main`) or omit the `project` parameter; do NOT pass `project:"nklein"` unless a local Basic Memory project with that
  exact name has been confirmed. A cloud-credentials error from Basic Memory is a tool-routing mistake, not a reason to
  require Basic Memory Cloud for !Klein work. The same rule applies to any future !Klein Basic Memory integration:
  local-first Markdown store by default; cloud sync/remote memory only by deliberate user opt-in.
- !Klein's native NKlein agent is powered by the installed `@nkleinbot/core` + `@nkleinbot/llms` packages plus the local `src/nklein-agent/` boundary layer — when NKlein behavior is unclear, inspect those packages and `src/nklein-agent/` for the real implementation.
- The NKlein session host does not expose its internal session map. Model changes may use the public `updateSessionModel` API; provider, endpoint, reasoning, mode, context, or timeout changes require restarting from persisted history. Never cast the host to a private `sessions` shape and mutate it.
- Default NKlein/sandbox tasks no longer use host task worktrees: work lives in the Docker sandbox volume (`/workspaces/<taskId>`) and is captured as an `nklein/tasks/<task>` result branch the trusted runtime applies to the user's repo (`src/workspace/task-result-branches.ts`). Verified end-to-end by `scripts/verify-strict-isolation.mts` (isolated `HOME` + live LM Studio): a Docker sandbox container appears, **no** host worktree under `~/.nklein/nklein/worktrees`, containers clean up on dispose. The host-worktree **creation** machinery + the terminal-CLI **agent launcher** are deleted (§5.A C7c/C7d); shell-on-task is decoupled (it `docker exec`s into the sandbox, or opens at the project root). What remains of `src/workspace/task-worktree*.ts` is **legacy cleanup only** (`deleteTaskWorktree`/`removeTaskWorktreeSetupLock`/`deleteTaskPatchFilesForRepo`), invoked on task-trash + shutdown. The single boundary predicate is `usesLegacyHostTaskWorkspace(agentId)` in `src/core/agent-catalog.ts` — true for any non-nklein id, still drives that legacy cleanup for migrated boards, so it is **live, not dead**; never re-derive it. Still deferred (§2.B): shrinking `RUNTIME_AGENT_CATALOG`/`runtimeAgentIdSchema` to nklein-only (web-ui + CLI contract-coupled → needs UI verification) then deleting the worktree modules outright.
- **Sandbox placement is not workspace liveness (2026-07-09).** `AgentSandboxManager.hasWorkspace()` is only an
  in-memory placement hint; a Docker restart/OOM/manual removal can leave that map populated while the real
  `/workspaces/<taskId>` cwd is gone. Before skipping restore/re-drive setup, probe the concrete cwd with
  `isWorkspacePrepared()`. `spawn /bin/bash ENOENT`, `chdir to cwd ... no such file or directory`, or tool `scandir`
  ENOENT can mean the **cwd is missing**, not that `/bin/bash` or the tool binary is absent. Recovery is: release/dispose
  the stale placement, then `prepareWorkspace()` from the result branch/base ref; do not add retries/fallbacks around the
  model or tool call without proving the sandbox cwd exists.
- **Sandbox workspace disposal is also a session-resource boundary (2026-07-09).** Curated sandbox MCP servers run as
  `docker exec -i ... -w /workspaces/<taskId> ...` transports owned by the task session. If review finalization frees a
  parked task's workspace, close the task-scoped MCP bundle before deleting that cwd, and force the next re-drive through
  the service's sandbox rebuild path so fresh `toolExecutors`, `extraTools`, and sandbox MCP transports are wired. Never
  let a restored sandbox turn reuse the generic runtime restart path: the runtime's persisted start request deliberately
  omits closure-backed sandbox tools, so a generic restart can recreate host-backed file tools pointed at `/workspaces`.
- **Narrated tool-call recovery is an offered-tool resolver, not a raw parser passthrough (2026-07-09).** Live fleet proof:
  qwen3 recovered `<function=sequential_thinking_sequentialthinking_1>...` while the actual SDK MCP tool name was
  `sequential-thinking__sequentialthinking`, causing `Unknown tool` retries until the card abandoned. Recovery must first
  constrain to the tools offered on that exact turn, then repair only unambiguous alias pollution (punctuation collapse,
  repeated-call numeric suffix); unoffered narrated names are dropped. This is now shared by swarm `afterModel` and chat.
- **Model-turn admission waits are live activity; unresolved LM Studio hosts are UNKNOWN, not local (2026-07-09).** A
  re-drive/review turn can be `state:"running"` before its SDK model call is admitted through the host/model capacity gate.
  While it waits, the service must emit `latestHookActivity.hookEventName:"model_turn_admission_wait"` on the admission
  warning cadence so verifiers do not mistake a capacity queue for an idle model stall. Conversely, never apply host or
  per-machine caps by falling back an unmapped model alias to `local`; `local` is valid only when `lms ps --json` mapped
  that concrete runtime model id/key to the local host. If the model-to-host map cannot resolve the selected model, skip
  host-specific caps and collect better `lms ps`/alias evidence instead of serializing unrelated machines.
- **Acceptance checks run in fresh synthetic sandboxes (2026-07-09).** A task card may contain an `Acceptance check:` that
  was generated while the worker/reviewer lived under `/workspaces/<old-task>`, but the verifier runs it under
  `<taskId>::acceptance-<n>`. The gate may remap only a leading `cd /workspaces/<old-task> && ...` prefix into the fresh
  sandbox root (preserving any subpath); do not add broad shell-command fallbacks or host execution. If the check still
  cannot enter a `/workspaces/...` cwd, classify it as acceptance setup and hand it to review instead of asking workers to
  repair code blindly. The auto-repair ladder is intentionally bounded: configured repair attempts, then at most one
  reviewer/architect escalation, then human review. More configured roles must not turn a failing acceptance setup into an
  infinite re-drive loop.
- Legacy host task worktrees (when they exist) intentionally preserve agent progress. External project-folder changes are copied only onto paths still owned by the project sync state; overlapping agent edits must remain isolated + produce a warning. Removing an entire project ≠ trashing a task: await all worktree cleanup and delete saved task patches so re-adding the folder can't restore stale content.
- !Klein is launched from the user's shell and inherits its environment. For agent detection + task-agent startup, prefer direct PATH checks and direct process launches over spawning an interactive shell. Avoid `zsh -i`, shell fallback command discovery, or "launch shell then type command into it" on hot paths — heavy shell init (`conda`/`nvm`) per task can freeze the runtime. Interactive shells are fine for explicit shell terminals, not for normal agent session work.
- **Model-role pinning contract (David, 2026-07-09):** automatic skill-set + task-difficulty/complexity based model
  selection is the default and must not create implicit pins. A role/"thing" is hard-pinned only when the user explicitly
  sets `modelSelectionMode:"pinned"` with a concrete primary model id; provider-only role settings and unpinned model
  choices are auto-selection candidates. Enabling/defaulting to Auto means there is no hidden global/default model pin:
  do not translate a selected default/provider model into a pin unless the user explicitly pins that exact role/card.
  Users may pin any subset of roles/things while leaving the rest on auto. If auto ranking thinks a different model is
  better for a pinned thing, surface a recommendation but honor the pin; if the pin is unavailable, unrunnable, or
  class-ineligible, fail closed instead of silently falling through. Do not "fix" pinning by
  adding `/api/v0` descriptor fallbacks — descriptor robustness is separate from the pin contract. The Settings UI must not
  let a provider-only role look pinned: keep assignment on Auto until a concrete primary model exists, and clear the pin
  immediately when that model is removed. A card/task `nkleinSettings.modelId` is the narrower task-level model pin for
  that start (including plan mode): role pins/config apply only when the task has no concrete model override, and routing
  must block rather than auto-replace a task override that fails class/feasibility checks.
- **Never put a RAW control character in source — use the 6-char backslash-u-0000 escape, not a literal NUL byte.** Composite map keys use U+0000 as a collision-proof delimiter (template literal `a` + NUL + `b` — a NUL can't appear in a modelId/role/path). Writing it as a *raw* NUL byte makes the whole file **binary to `grep`/`rg`** (they print "binary file matches" and skip it), so symbol searches in that file silently return nothing — a real correctness hazard for both humans and agents (it broke a `summarizeModelOutcomes` search mid-session). The escape yields the byte-identical runtime string while keeping the file text/greppable. Found + fixed across `agent-attempt-ledger.ts` / `agent-ledger-projections.ts` / `nklein-embedding-idle-unload.ts` / `model-performance-stats-dialog.tsx` (2026-06-30). (Meta-gotcha: typing the literal escape token into a tool input round-trips to a real NUL in this harness, so describe it in words.) Scan: `find src web-ui/src -name '*.ts*' -exec perl -0777 -ne 'print "$ARGV\n" if /\0/' {} \;`.
- **Self-referential `replace_all` when extracting a helper: add the helper body AFTER the sweep, or it rewrites ITSELF into infinite recursion (2026-06-30).** Consolidating an inline pair (`providerId: …, modelId: …`) at N call sites into a `resolveTaskModelIdentity()` helper: I added the helper (whose body IS that exact pair) and THEN `replace_all`'d the pair → `...this.resolveTaskModelIdentity(x)`. The sweep matched the helper's OWN body too, making it `return { ...this.resolveTaskModelIdentity(x) }` — infinite self-recursion. **tsc PASSES it (type-valid); only the runtime suite catches it** (here: `RangeError: Maximum call stack size exceeded` across 57 service tests at once). Mitigations: do the `replace_all` FIRST then add the helper, or give the helper's body a shape the pattern can't match, or just re-read the helper after the sweep. General lesson: a green tsc is necessary-not-sufficient for a mechanical multi-site refactor — the full suite is the real gate (this is why every extraction here is suite-gated, not just tsc-gated).
- **`response_format: json_schema` structured output DEAD-ENDS on qwen3.5 / qwopus3.6 REASONING models → `finish_reason:stop` with EMPTY `content` (2026-07-01, live-probed via 127.0.0.1:1234 on resident qwen3.5-9b AND qwopus3.6-27b).** The grammar constraint conflicts with the reasoning channel: the model emits ~16–20 reasoning tokens (captured in `message.reasoning_content`) then STOPS with no JSON in `content`, at `max_tokens` 200/800/**2000 alike** ⇒ a grammar dead-end, NOT a budget cap. Reproduces on the capable **27B** (so it's the reasoning FAMILY, not size — the "<7B" caveat in the §5.AN structured-output note is wrong), and `/no_think` / a "don't think" nudge does nothing (qwen3.5 ignores it — reasoning even GREW to 845 tok). **⇒ The codebase's "THE forcing lever = constrained decoding" (§5.AN, live-verified 2026-06-29 on qwen2.5-coder-14b + phi-4-mini — both NON-reasoning) is reasoning-model-INCOMPATIBLE: the §5.AA constrained-tool-call rung silently returns EMPTY on the current all-reasoning resident tier.** ROBUST fallback (live-verified same probe): NO grammar + LARGE budget (the model burns 500–850 reasoning tok first) + parse the JSON object from the small post-reasoning `content` (546 reasoning tok → 41-char `content` = valid `{…}`). Structured-output strategy MUST be reasoning-aware: json_schema for non-reasoning, prose-extract for reasoning. `lmstudio-response-format.ts` stays envelope-correct; its applicability is model-gated. (Owed: a positive control on a resident NON-reasoning model to re-confirm json_schema works there — none loaded now; don't disrupt the user's resident set just to get one. Probes: `scratchpad/probe-structured-output*.py`.)
- **FIX for the above: native TOOL-CALLING WORKS on reasoning models where `json_schema` dead-ends (live-probed 2026-07-01, qwen3.5-9b + qwopus3.6-27b).** `tools` + `tool_choice:"required"` returns `finish_reason:tool_calls` with a VALID tool_call after ~55–171 reasoning tokens (fast 4–12s; guaranteed schema-valid `arguments`) — the model reasons freely, then the call lands in the SEPARATE `tool_calls` channel, so there is no grammar-vs-reasoning conflict (`"auto"` and `"required"` both work). **⇒ To FORCE structured output from a reasoning model, wrap the target schema as ONE tool's `parameters` + `tool_choice:"required"`, NOT `response_format:json_schema`.** CONFIRMED IN-CODE: the §5.AA constrained-tool-call FORCING-FALLBACK rung (`chat-local-llm-adapter.ts` ~242/256 → `buildConstrainedToolCallSchema` → `response_format:json_schema`, then `parseConstrainedToolCall(constrained.content)`) reads from `content` — EMPTY on a reasoning model ⇒ null ⇒ forces nothing (a verified no-op on the all-reasoning resident tier). IMPACT IS BOUNDED: the PRIMARY `completeWithTools` path already uses native tools and works on reasoning models, so ONLY the force-a-RELUCTANT-call recovery is dead; fix = force that fallback via native `tool_choice:"required"`. Decision core shipped: `structured-output-strategy.ts::selectStructuredOutputStrategy` (reasoning→`native_tool_call`, confident-non-reasoning→`json_schema_grammar`, unknown→`native_tool_call`) composing `isReasoningModel` in `model-thinking-control.ts`; the `prose_extract` last-resort reuses `repairJsonValue`. Probes: `scratchpad/probe-tool-call.py`.
- **MODEL LOADING — !Klein MANAGES IT, GUARDED (user handover 2026-06-29; supersedes the 2026-06-28 no-load rule).**
  **TEMPORARY / REVOCABLE: the user re-confirmed (2026-06-29) "you can load/unload yourself, as you need — just don't
  overload the system … not a forever rule, until further notice."** So treat load control as ON now, but watch for the
  user revoking it, and always keep the system safe (the headroom guard below is non-negotiable; when in doubt, unload
  rather than pile on).
  The user unloaded everything and handed loading/unloading control to !Klein, under HARD guardrails:
  **(1) one model resident at a time** — UNLOAD before LOADING the next (never pile up; the user's pinned/embedding
  models excepted); **(2) context = 40000** for every load (≥32k floor honored); **(3) size cap ≤14B for now**
  (qwen2.5-coder-14b is the ceiling) — raise only as the tier roadmap advances; **(4) headroom-check every load**
  (keep ~25% RAM free). Tooling: detect resident via `/api/v0/models` `state`
  ([lmstudio-loaded-models.ts](src/core/lmstudio-loaded-models.ts)); sizes via `lms ps`
  (`parseLmsPs` in [lms-model-control.ts](src/core/lms-model-control.ts)); guard via
  [model-load-headroom.ts](src/core/model-load-headroom.ts) `decideModelLoad`; plan+command via `planGuardedModelLoad` /
  `buildLmsLoadArgs`/`buildLmsUnloadArgs`; the effectful `lms` runner is the ONLY place a load happens and MUST consult
  the guard. Reason for the old rule (freeze risk) is now handled by the guard + the 1-at-a-time/size limits. `/v1/models`
  = available (downloaded), `/api/v0/models` = resident.
- **MODEL RESIDENCY IS NOT GUARANTEED STABLE + we are currently BLIND to why a model vanishes (investigation 2026-07-07,
  user flagged; supersedes my earlier casual "auto-unloaded (TTL)" claim, which was an UNVERIFIED guess).** Observed: a
  model resident + serving many requests (`qwen/qwen2.5-coder-14b` on the **m4mini** fleet node) DISAPPEARED between two
  harness runs; a 2nd model (`gemma-4-e4b` on Local) was gone too, leaving only the legion5pro model. Config found in
  `~/.lmstudio/settings.json`: **`justInTimeModelLoading: true` + `jitModelTTL.ttlSeconds: 3600`** — so a JIT-loaded model
  (auto-loaded when a request hits an unloaded model) auto-unloads after **1h idle** (this is the `7m/1h` seen on gemma in
  `lms ps`). BUT an EXPLICITLY `lms load`-ed model (no `--ttl`) gets no TTL (shown BLANK in `lms ps`), and coder-14b showed
  blank — so whether it had the 1h JIT TTL, was explicitly loaded, or was on a remote node whose TTL simply isn't
  displayed to Local's `lms ps`, is **UNVERIFIED**. **Crucially, root cause of a given vanish is currently
  NON-DIAGNOSABLE post-hoc, because:** (1) **`fileLoggingMode: "off"`** in settings.json ⇒ no LM Studio event logs exist to
  read (this DEFEATS the "READ THE LM STUDIO DEV LOGS FIRST" rule — the logs must be turned ON first); (2) the model was
  on a **remote fleet node** (m4mini) whose logs/crash-reports aren't inspectable from Local; (3) the event already passed.
  So the honest status is **UNDETERMINED among ≥3 live hypotheses — JIT 1h-TTL expiry · a model/runtime CRASH (user's
  concern; models are expected to load STABLE) · memory eviction on the remote node** — none confirmable without
  instrumentation. **ACTIONS to make this diagnosable + stable (owed, mostly the user's LM Studio config):** (a) turn
  `fileLoggingMode` ON (succinct) so the NEXT vanish is captured; (b) if stable residency is the goal, raise/disable
  `jitModelTTL` or always `lms load` explicitly (no `--ttl`); (c) a lightweight `lms ps` state-change monitor (poll +
  diff + timestamp) would catch WHEN a model drops and correlate it to load/idle/crash; (d) §5.Z harnesses already
  `assertModelLoaded` (refuse-to-load) so a vanish becomes a hard, visible failure — good, but pre-load explicitly for
  long multi-run experiments. Until (a)-(c) exist, do NOT assert a specific cause for a model vanishing — say "undetermined
  (logging was off / remote node)" per the root-cause rule above.
  **DECISION (David, 2026-07-07 AskUserQuestion): "Stabilize loading" + "I'll handle the config."** ⇒ (i) David owns the
  LM Studio settings (file logging + raising/disabling `jitModelTTL`) — do NOT modify `~/.lmstudio/settings.json`
  autonomously. (ii) !Klein's harness convention: **always EXPLICIT-load** (`lms load <key>`, no `--ttl`) before a
  multi-run experiment so the model can't JIT-TTL out mid-run, and treat any mid-run vanish as a hard failure whose cause
  stays "undetermined" unless David's file-logging is on to prove it. The discipline (don't guess a cause) is the durable
  takeaway.
  **★ CORRECTED 2026-07-07 (David checked the LM Studio config on ALL 3 hosts — a 2ND precision failure on my part, one
  level deeper than the first).** The `settings.json` I read above was **m5max's (Local) ONLY** — I never read m4mini's,
  yet I floated m5max's `justInTimeModelLoading:true` / `jitModelTTL:3600` as a hypothesis for a model that lived on
  **m4mini**. David confirms: **JIT was ON on m5max but OFF on m4mini.** ⇒ the **JIT-1h-TTL hypothesis is REFUTED** for
  coder-14b's disappearance — a host with JIT OFF has no JIT model + no `jitModelTTL` to expire, so a model there is
  expected STABLE and its vanishing is genuinely anomalous. Remaining space narrows to **CRASH or memory-eviction (or an
  external unload)** — David's original CRASH concern is now the leading candidate — still not confirmable without
  m4mini's OWN logs. **David has now DISABLED JIT on all 3 hosts**, so JIT-auto-unload is eliminated fleet-wide; any
  future vanish is attributable to crash/eviction by elimination. **Precision lesson (sharpens the root-cause rule): a
  multi-host fleet has PER-HOST config — reading ONE node's settings and reasoning about ANOTHER node's model is the same
  "convenient data standing in for the real data" error, one level deeper. ALWAYS scope a finding to the exact machine/
  file/source you read it from, and name that scope explicitly ("m5max's settings.json says X; m4mini's is unknown to
  me"). Never let evidence from one host silently generalize to the fleet.**
  **★ DEEPER STILL (2026-07-07, David #3): the JIT-TTL hypothesis was DEAD ON ARRIVAL — refutable on tick 1 with ZERO
  investigation, on MECHANISM + MAGNITUDE alone.** `jitModelTTL` is an *IDLE* timeout of **3600s (1 h)**. coder-14b
  vanished during an ACTIVE decompose experiment — multiple 200-320s runs back-to-back, called every few minutes over
  ~20-30 min. (a) an idle-timeout by definition never unloads a model that is processing; (b) a 1-h idle window never
  came close to existing under that use frequency. So the hypothesis could NOT physically have produced the observation —
  I should have killed it on sight, before the per-host-config detour AND before David's first correction. This is the
  cheapest filter (does the mechanism physically fit? do the numbers fit?) and I skipped it. See the §4A root-cause rule's
  new "GATE a hypothesis on CONSISTENCY … BEFORE you entertain it" bullet — that filter, applied first, kills this on
  tick 1. Cause remains crash / eviction / external-unload, undetermined without m4mini's logs.
  **★ RESOLVED 2026-07-11 (David's live observation + a real-model probe) — the vanish is a MEMORY-PRESSURE CRASH (swap)
  on m4mini, and it RECURS because the runtime's model-load path is NOT headroom-gated.** David, watching a real-model
  run: *"i've seen m4mini swapping during last run."* Corroborated by a `mid_task` probe that forced
  `qwen/qwen2.5-coder-14b`: the runtime routed the worker to the m4mini 14B instance, and its task-runs recorded
  `Agent error: The model has crashed without additional info` (state `awaiting_review`, reason `error`, patch `empty`).
  So among the three surviving hypotheses, **CRASH-via-memory-eviction is CONFIRMED** and TTL / external-unload are ruled
  out (a swap-kill is not a clean unload). **Mechanism:** a 14B (~8.33 GB weights) at the mandated **40000** context — KV
  cache + OS on top — exceeds m4mini's RAM, so it pages to disk (swap) and LM Studio's model process dies. This SHARPENS
  the §5.AB "m4mini ≤14B" routing heuristic (line ~834): a 14B **at full 40k ctx** already swaps m4mini — the real ceiling
  is lower, or needs a reduced context on that node. **WHY IT RECURS (the real gap, confirmed by reading the code
  2026-07-11):** the runtime does NOT headroom-check its loads. `decideModelLoad` ([model-load-headroom.ts](src/core/model-load-headroom.ts))
  is wired ONLY into `loadModelExclusive` → and `loadModelExclusive` has NO callers in `src/` (only `scripts/model-lab.mts`,
  the dev sweep tool). The live runtime relies on **LM Studio LM-Link JIT auto-resolution** to pick the device — the 14B
  is registered on BOTH `Local` (m5max, 128 GB) and `m4mini`, and LM Link resolved it to m4mini — with only the reactive,
  OPT-IN `nklein-model-residency-watcher.ts` (`NKLEIN_RESIDENCY_HEARTBEAT`) noticing AFTER the crash. **Precursor missing:**
  `LmsLinkDevices` ([lms-link-status.ts](src/core/lms-link-status.ts)) exposes device names/ids but NO per-device RAM, so
  even a wired guard can't currently know m4mini can't fit a 14B. **✅ DURABLE FIX SHIPPED — OPT-IN machine-aware routing
  (2026-07-12, David scoped it "test harness + !Klein when the user enables it"; commits `28b43ecd`→`b98f99f3`).**
  ENABLE per-device RAM: `NKLEIN_DEVICE_RAM_GB="Local:128,m4mini:16,legion5pro:24"` (unset ⇒ feature OFF, ZERO fleet I/O,
  byte-identical). When set, `startTaskSession` (the seam BOTH the dev-test harness and live !Klein dispatch through) calls
  the fail-open [ensure-model-loaded.ts](src/core/ensure-model-loaded.ts) adapter before the model request: it
  reads the LM-Link roster + model sizes, estimates the EFFECTIVE footprint (weights + KV-at-context — weights-alone
  under-counts and misses exactly the m4mini case; prefers llmfit's `memoryRequiredGb`), and on a `set_preferred` verdict
  issues `lms link set-preferred-device <fitting-node>` so LM-Link's JIT lands the model on a node that fits instead of
  m4mini. Pure toolkit in [device-load-routing.ts](src/core/device-load-routing.ts) (`selectDeviceForModelLoad` /
  `resolveDeviceRamBytesFromEnv` / `estimateEffectiveModelBytes` / `planPreferredDeviceSteering`, 29 tests) + adapter
  (10 tests), all opt-in with byte-identical defaults. **✅ VALIDATED LIVE against the real fleet (2026-07-12, READ-ONLY
  dry-run — the adapter with real `fetchLmsLinkDevices` + real REST sizes, a no-op `setPreferredDevice`, ZERO fleet
  mutation):** the 14B (real weights 7.75 GiB, ~15 GiB effective @40k) produces `set_preferred → m5max` (112.9 GiB free),
  correctly steering OFF the fleet's CURRENT preferred device (which the dry-run showed IS m4mini — the very cause). The
  read-only harness also surfaced two facts: (a) the real device NAMES are `m5max` (local) · `m4mini` · `legion5pro`
  (ids visible in `lms link status`), and (b) a UX TRAP — `lms ls` labels the local host `"Local"` but its LM-Link routing
  NAME is `m5max`; a `Local:…` map key would leave the 128 GB farm UNMAPPED. FIXED with `applyLocalDeviceAlias` (commit
  `c5e52cc9`) so `Local:128` now resolves to `m5max`. **STILL OWED:** a FULL live dispatch (set the env, run a dev-test,
  confirm via `lms link status` that the preferred device actually flips + the 14B runs on m5max without m4mini swapping)
  — the read-only dry-run proves the DECISION; the effectful `set-preferred-device` write + JIT placement want one live
  end-to-end run. **v1 limits (documented,
  follow-ups):** the global preferred-device could race under highly-concurrent card-starts (bounded by the 1-at-a-time
  guardrail); a link+size fetch per gated dispatch (opt-in overhead); silent at the seam (handlers have no logger + console
  is lint-banned) so observability is owed; and a throughput-farm-aware "smallest-sufficient device" policy (§5.AB L834)
  can layer on the same per-device verdicts later. **IMMEDIATE MITIGATION if the flag is left OFF (David's fleet, no code):**
  unregister/unload the 14B from m4mini's LM Studio so LM Link only resolves it to m5max, or cap m4mini's per-model
  context/size. See [[realmodel-lifecycle-validated]] + [[live-dev-test-single-machine]] for the probe detail.
  **★★ CRITICAL FOLLOW-UP FINDING (2026-07-12, live-fleet behavior tests) — the task-dispatch WIRING POINT is WRONG; the
  set-preferred-device steering is INERT in the current config.** Three empirical truths from probing the real fleet
  (`lms` direct, then restored): (1) **the preferred device controls where a LOAD lands** — `lms load` of the 14B with
  preferred=m5max loaded ON m5max in 2.9 s (validated the mechanism); (2) **JIT is OFF** — a completion request for a
  non-resident model returns "No models loaded", it does NOT auto-load; (3) **LM-Link serves an already-loaded model from
  WHERE IT'S LOADED, ignoring the preferred device** — with the 14B resident on m5max and preferred=m4mini, the request
  still served from m5max (no new instance). Consequently the seam wiring (`b98f99f3`, steer at `startTaskSession`) CANNOT
  help the real crash: the task path only ever runs ALREADY-LOADED models (it BLOCKS non-resident ones at
  start-task-session.ts:335-345, before the steering at ~:1168), and steering can't move a loaded model. The model's
  device is decided at LOAD time, which happens BEFORE any task dispatch. **So the toolkit + decision are correct and
  validated, but the effective hook is the LOAD point, not dispatch.** The real fix, by tier: (a) **test harness** — wire
  `selectDeviceForModelLoad` into `model-lab`'s `loadModelExclusive` device pick (it already carries `targetDeviceIdentifier`),
  so a harness load auto-lands on a fitting node [clean, effective, safe]; (b) **live !Klein** — there is NO runtime load
  path (loadModelExclusive has zero `src/` callers; JIT off), so the live fix needs EITHER a detect-and-BLOCK guard at
  dispatch (refuse a card whose serving device can't fit its model, with "reload on m5max" guidance — prevents the swap
  instead of crashing) OR wiring the built-but-unwired §5.AB autonomous loader (with the device pick) so !Klein loads on
  the right device. The committed seam steering is opt-in + fail-open (harmless when off) but should be REPURPOSED to the
  guard or removed — it does not earn its per-dispatch fetch while inert. DECISION owed from David: guard-and-block vs
  wire-the-autonomous-loader vs harness-only. (Corrects the "VALIDATED LIVE" note above — that validated the DECISION on
  live data, not end-to-end effectiveness, which these behavior tests then disproved for the dispatch hook.)
  **✅✅ RESOLVED — AUTONOMOUS LOADER SHIPPED + VALIDATED END-TO-END (2026-07-12; David chose "wire the autonomous
  loader"; commits `df9eb67c` wire + `42e476ee`/`3bd00687` remove the dead steering).** The EFFECTIVE fix: instead of
  BLOCKING a non-resident model, `start-task-session` now calls `ensureModelLoadedOnFittingDevice`
  ([ensure-model-loaded.ts](src/core/ensure-model-loaded.ts)) → picks the best-fit linked device (validated toolkit) →
  loads there via the guarded `loadModelExclusive` (capability gate + one-at-a-time unload + headroom + preferred
  set→load→restore). This hooks at LOAD time (the correct point). OPT-IN + fail-safe: gated on `NKLEIN_DEVICE_RAM_GB`
  (unset ⇒ the adapter returns immediately with no fleet I/O ⇒ the original block still fires, byte-identical); any
  no-fit / load-error / exception falls through to the block with a clear reason. **LIVE E2E PROOF (real fleet, then
  cleaned up):** with `NKLEIN_DEVICE_RAM_GB="Local:128,m4mini:16,legion5pro:24"` a non-resident `qwen/qwen2.5-coder-14b`
  (effective 15.1 GiB @40k) LOADED ON m5max (the 128 GB farm) — NOT the m4mini it used to crash on — the `Local` alias
  resolved to `m5max`, and the preferred device was correctly RESTORED to m4mini afterward. The inert dispatch-time
  steering is removed. **REMAINING (follow-ups):** (a) the MIS-PLACED case — a model already resident on a can't-fit
  device isn't moved (loadModelExclusive treats resident-anywhere as done); a detect-and-reload guard could handle it;
  (b) David's REAL m4mini/legion RAM for a precise map (the swap observation already justifies a conservative m4mini:16);
  (c) a throughput-farm-aware "smallest-sufficient device" policy can layer on the same per-device verdicts. Immediate
  no-code alternative still valid: `lms link set-preferred-device <m5max>` so manual loads land on the farm.
  **★ REAL-MODEL DEV-TEST (2026-07-12, mid_task ×14B, loader ENABLED via .env) validated the loader end-to-end AND found
  2 more bugs.** (1) **Loader wiring was incomplete — FIXED (`c5ce8dd8`):** a forced non-resident `--model-id` failed at
  the EARLIER `resolveLaunchConfig` residency gate (before the start block where the loader was wired). Now the
  resolveLaunchConfig catch runs the loader → `clearProviderModelDiscoveryCache()` → retries once (shared
  `attemptAutonomousModelLoad` closure reused by both gates). Re-validated LIVE: the 14B loaded on **m5max** + ran the
  full swarm (decompose → 5 workers with REAL patches → 3 delivered), no m4mini crash. (2) **[ ] BUG — dev-test harness
  PREMATURE SETTLE:** `runDevTestProject` settles `blocked_by_review_cards` after `DEFAULT_STABLE_POLLS=6 × 5s = 30s` of
  unchanged board + no active session ([nklein-dev-test-harness.ts](src/nklein-agent/nklein-dev-test-harness.ts) L181 +
  [dev-test-outcome.ts](src/core/dev-test-outcome.ts):101). Real-model between-turn lulls exceed 30s, so it exits while
  the runtime keeps working (observed: harness settled at 3m/completed=1; runtime continued to completed=3 by 18m). Fix:
  a longer stable threshold for the real-model path (30s is tuned for the fast SIM), or gate the "blocked" settle on
  persistence. (3) **[x] NOT A BUG (corrected 2026-07-12 via the runtime log) — review WORKS with the 14B; the "stuck"
  cards were correctly PARKED.** The first read ("0 reviewer sessions → stall") was wrong: `::review` sessions are
  SYNTHETIC/auxiliary so they're absent from the regular task-runs. The runtime log shows review ran fine —
  `reviewer=qwen/qwen2.5-coder-14b (worker_fallback)` (the diverse-reviewer correctly fell back to the loaded worker
  with a diversity waiver, no lineage-different model resident) → multiple rounds → `request_changes` → the 14B re-worked
  with NO changes → the review-loop guard PARKED them ("worker made no changes after the last review. Parking for a
  human."). That's CORRECT (bounce→re-work→no-change→park), same as the 8B — the 14B sometimes can't address feedback
  (empty re-work), a MODEL limitation handled right. So the full flow (decompose → workers w/ real patches → 3 delivered
  → park the 2 unconvergeable) is VALIDATED. No reviewer-path/diverse-reviewer bug; the only real dev-test bug was the
  premature-settle (fixed `c02eeb10`). See [[machine-aware-load-routing]].
  (4) **[ ] TOP LOADER FOLLOW-UP — the loader is INERT for CONFIG-ROLE dispatch (self-review CONFIRMED 2026-07-12).** It
  engages only for the EXPLICIT-model path (dev-test `--model-id` + escalation `action.modelId`). For a normal config-role
  card (David's fleet: worker=reviewer=14b, architect=9b) the runtime SKIPS non-resident role candidates (start-task-session.ts:443-452,
  "!Klein won't load it (directive)") and falls back to an already-loaded model — so it never loads a configured role
  model that isn't resident, and the block-loader runs on the PRIMARY (pre-routing), never the routed winner. Fix (2-part,
  substantial, touches the hot routing path + one-at-a-time swap): (a) when NKLEIN_DEVICE_RAM_GB is set, DON'T skip
  non-resident role candidates (:443-452) so routing can pick the best even if unloaded; (b) add a POST-routing loader
  step (after the winner at ~:1085, before dispatch) that loads the winning model on a fitting device via
  `attemptAutonomousModelLoad`. Needs a live config-role dev-test to validate — do NOT rush (the reviewer "stall" was
  already a misdiagnosis). This is what makes the loader actually help David's real fleet, not just the dev-test path.
  (5) **[x] SETTINGS UI FIELD SHIPPED (David's Q2 decision, 2026-07-12; commit `3d47d4cf`).** The per-device RAM budget is
  now a first-class global config field (`deviceRamGb`, "name:GB" string) surfaced at **Settings → Tasks → "Machine-Aware
  Model Loading → Per-device RAM budget"**, plumbed end-to-end (types → normalizer → merge → state-factory → file payload
  → change-detection → API contract → getConfig mapper → web-ui draft/save/dialog, modeled on `workspaceBaseDir`). The
  loader now resolves the map via `resolveDeviceRamBytes({env, configuredDeviceRamGb})` with **env-wins-over-Settings**
  precedence (`NKLEIN_DEVICE_RAM_GB` still overrides); a blank field disengages the loader (no separate toggle). Follow-up
  (b) — David's REAL fleet RAM — is CAPTURED: `m5max:128,m4mini:24,legion5pro:32` (in the git-ignored `.env` today, and
  now settable from the UI). Tests: parse null/undefined, precedence (3), config-enables + env-wins (2), config round-trip
  case, 4-case end-to-end contract suite (real backend save→disk→read). tsc + biome + 8963 backend + 82 web-ui + browser
  visual all green. Config-role extension (4) stays DEFERRED (David: explicit-only). See [[machine-aware-load-routing]].
  (6) **[x] CONFIG-PATH LIVE-VALIDATED ON THE REAL FLEET (2026-07-12, low-power mode — David: "slower but fully
  functional").** Isolated-HOME rig with `deviceRamGb` written INTO the global config.json and the env var NEUTRALIZED
  (`NKLEIN_DEVICE_RAM_GB=""` blocks the repo `.env` injection; empty parses to `{}` so the resolver falls through to the
  config value): a NON-RESIDENT `qwen/qwen2.5-coder-14b` (`--model-id`, small-model-smoke) **loaded on Local/m5max**
  (8.33 GB, ctx 40000) — NOT the still-preferred m4mini — purely from the Settings-persisted value. Same run also
  live-confirmed: the §5.AF memory-fit gate's NOT-SILENT warning (verbatim in the task-run record: Codebase Memory OFF,
  4096 < 2048+2560, raise Settings → Agents), and the §12 turn-loop guard FIRED ON A REAL MODEL — the 14B re-raised the
  same question 3 turns during the decompose seed and was correctly PARKED for attention with the operator message
  (state `awaiting_review`, reason `attention`); auto-resolve wasn't groundable and no lineage-diverse model was resident,
  so the park layer was the right rung. (Not directly inspected in this pass: the verbatim contested question in the chat
  surface — the sim e2e regression covers it.) Fleet restored exactly as found (model unloaded, rig removed). Two
  follow-ups filed from the run: the dev-test monitor classified a PARKED-for-attention card as generic "stagnant" —
  **✅ FIXED same day (`f8880108`): new `needs_attention` outcome** (pure `countAttentionParkedSessions` over
  awaiting_review+attention sessions → threaded state-reader → harness → dev.ts; "Needs your attention: N card(s)
  parked with a question for the operator"; 8 tests incl. the exact live shape) — and `dev-full`'s stale-process
  sweep killed OTHER dev stacks on boot — **✅ FIXED (2026-07-12, `b0be40fc`): overridden base ports now ALSO mark the
  instance alternate** (isolated-flag OR non-default NKLEIN_DEV_RUNTIME_PORT/WEB_UI_PORT skips the sweep), so a second
  rig never kills the default :3484/:4173 stack; only the true default instance sweeps.
- **Model-size tier roadmap (user 2026-06-29) — robustness-first, smallest-up.** (1) smallest models — harden !Klein
  against them FIRST (current focus); (2) mid **≤40B** — speed + quality/perf; (3) **≤80B**; (4) **≤130B** — fun, only
  while the M5 Max/128 GB runs them without heavy stalling/swapping; **>130B** — out of scope (swapping) unless the user
  greenlights dedicated sessions / new hardware. Hypothesis: ≤40B (occasionally ≤80B) already gets us far.
- **Research model catalogs + recommend downloads (user 2026-06-29).** Research online catalogs (HF / LM Studio
  community) for promising LOCAL agentic models per the active tier (tool-calling + coding + instruction strength);
  produce the user-controlled recommendation from the typed catalog/fitness evidence (H7.16). The user downloads;
  !Klein may load/unload-test only models they made available.
- **Model-lab roadmap → roster keep-list + disk reclaim (user 2026-06-29).** **(a) DOWNLOADS:** `model-lab get
  <name>[@quant]` is built (retries a stall once) but NOT used yet — the user has queued downloads; WAIT for them, and if
  a download stalls, retry it. **(b) Once all variants are resident:** load/unload-test each through (sufficient *varied*
  runs per variant — not one-shot, given the stochasticity), then produce a **keep-list**: a clean roster from the
  least-capable up through the best performer in each size/perf class — and a **drop-list** of redundant/dominated
  variants the user can delete to reclaim disk (the user confirms deletes). **(c) ⇒ REJECTED PERMANENTLY 2026-07-12 (§10c#7: downloads NEVER autonomous; recommendation lists only). Originally: LATER (gated on the user's explicit
  go, when the work has matured):** !Klein does deep online research for the most promising not-yet-available models AND
  self-manages a **~100 GB disk budget** for downloading/evaluating them (download → test → keep-or-drop within budget).
  Patience: (c) depends on progress; keep it on the agenda, don't start it unprompted.
- **Hot-path / agent-loop changes are SELF-verifiable via the live UI (user 2026-06-29) — don't defer for a human to
  watch.** Drive the running app with Playwright (or another browser-control method) + a live model and assert the
  durable side effects. The §5.AA controller loop-wiring is autonomously verifiable this way.
- **`lms load` takes the `lms ls` KEY, not the `/api/v0/models` served id (2026-06-29, caught by the first guarded load).**
  The served id carries a loaded-instance alias suffix the user assigned (e.g. `google/gemma-4-e2b-m5max`, `…-q8`); `lms
  load` rejects those with "Model not found". Load by the **`lms ls` key** (`google/gemma-4-e2b`, `qwen/qwen3-8b`,
  `phi-4-mini-instruct@4bit`, …). A multi-variant key (`google/gemma-4-e2b (2 variants)`) loads the DEFAULT variant
  (gemma → the q4); selecting a specific variant (for a q4-vs-q8 A/B) needs a variant selector — TODO if/when needed.
  `model-lab.mts` (the guarded loader CLI) drives this: `ps` | `load <lms-key> [ctx]` | `unload <id>` | `sweep <harness>
  <keys>`; every load goes through `loadModelExclusive` (one resident at a time, ctx 40000, headroom-checked). Verified
  live 2026-06-29: load qwen/qwen3-8b + gemma-4-e2b (auto-unloads the prior, keeps the embedder).
- **The model-capability catalog ([model-capability-catalog.ts](src/core/model-capability-catalog.ts), §5.AL) is a LIVING
  artifact — extend it with EVERY new capability fact you surface (2026-06-29, user).** It is the curated, shipped-in-code
  knowledge of which models suit our use cases (tool calling / agentic chains); `loadModelExclusive` gates on it (refuses a
  `reject` before any unload/spawn; `warn`/`unknown` proceed with a caveat), default policy **warn-and-reject**, overridable
  per-project. **Rule:** whenever a sweep or live run teaches you something — a model narrates instead of calling tools, a
  quant is confirmed-good or ships FC broken, a reasoning-only variant can't chain, a `verified: false` row is confirmed or
  refuted — fold it into the catalog **in the same change**: flip the verdict, append the note, cite the source, set
  `basis: "empirical"`/`"both"`. Don't let hard-won model knowledge live only in a sweep log or your head. Verdict buckets:
  `TOOL_NATIVE / TOOL_CAPABLE / TOOL_WEAK / TOOL_UNSUITABLE / UNKNOWN`. Quick check: `tsx scripts/model-lab.mts check <id>`.
  Cross-cutting truths already encoded: **reasoning-only variants are the trap** (Phi-4-mini-reasoning, Phi-4-reasoning-plus,
  Magistral, DeepSeek-R1 distill — default to the instruct sibling); **"native" ≠ reliable at small sizes** (Qwen3-8B,
  Nemotron-Nano degrade on multi-step chains); **many "failures" are template/parser mismatches, not the model**.
  **The gate is enforced at ALL model-use paths** (model-lab load, CLI `nklein chat`, runtime task-start, chat send-turn API)
  and reads ONE policy via `resolveActiveModelSuitabilityPolicy()`. **Global-setting env knobs:** `NKLEIN_MODEL_GATE_UNSUITABLE`
  and `NKLEIN_MODEL_GATE_UNKNOWN` each take `allow`|`warn`|`reject` (default reject/warn); plus the blanket per-invocation
  escape `NKLEIN_ALLOW_UNSUITABLE_MODEL=1` on the chat/task paths. The per-PROJECT override + Settings UI (runtime-config)
  is the remaining §5.AL piece; the merge primitive `resolveModelSuitabilityPolicy(global, projectOverride)` already exists.
- **Keep an eye on LM Studio's dev logs during any LLM work (sweeps, scouts, live runs).** They surface things nothing else does: the **catalog endpoint being hammered** (`/api/v0/models` request-rate spikes — the 2026-06-28 incident: a roster-discovery path with no cache; fixed with a 30 s TTL cache in `nklein-provider-service.ts`, so the live `/models` is polled ~once/30 s regardless of caller), request errors, model **load/unload/crash** events (deepseek vanishing mid-run), and slow-prefill warnings. **The verify harness should tail/monitor the LM Studio dev log during runs and flag anomalies** (request-rate, errors, dropped models) — see the §5.Z harness item. Rule of thumb: roster/`/models` discovery should never exceed ~1 call per 30–60 s; if you see faster, find the caller (or add/lower a TTL cache).
- **NEVER assume the machine's power state — and never draw a premature conclusion from a symptom (user 2026-06-29).** The machine is NOT always in Low Power Mode; it is frequently in **HIGH power mode** (the user confirmed high power 2026-06-29). Do not reach for "it's just Low Power / resource contention / a flaky environment" to explain a failure you haven't actually diagnosed — that's the exact premature-conclusion trap. A symptom (a stall, an `exitCode 137`/SIGKILL, a test that passes in isolation but fails under load) is a HYPOTHESIS to verify, not a verdict to assert. Verify before concluding: check the real power state, reproduce, isolate the variable, read the actual error. Pair this with the "a surfaced test failure is NEVER waived" rule above — "environmental" is a claim you must EARN with evidence, not a default escape hatch. When you genuinely can't root-cause now, say so plainly and file it as a todo; don't dress a guess up as a finding.
- **Low Power Mode (~50% throughput) does NOT corrupt sweep/fitness data — the agent/task path auto-adapts; don't misdiagnose a low-power abort as a model ceiling.** The agent path's request/stream/turn timeouts are scaled from the model's **observed** tokens/sec (`applyMcsrAwareLocalTimeoutScaling`, [nklein-timeout-scaling.ts](src/nklein-agent/nklein-timeout-scaling.ts), wired at [start-task-session.ts](src/trpc/runtime-api/start-task-session.ts)) — slower regime → measured-slower → proportionally LONGER timeout (×3 + 60 s buffer); cold-start (no samples) uses deliberately conservative priors (~4 tok/s decode). So a genuine `aborted` on the swarm path is real signal, not a timeout artifact. **Exception:** the interactive CHAT client ([nklein-local-llm-client.ts](src/nklein-agent/nklein-local-llm-client.ts)) is a FIXED fallback (not MCSR-aware) — default 120 s, now overridable via `NKLEIN_CHAT_REQUEST_TIMEOUT_MS` for a slow regime. The runtime also disables undici body/headers timeouts (`installKanbanFetchTimeoutPolicy`, bodyTimeout/headersTimeout 0) so streaming inference never trips a transport timeout; the `HeadersTimeoutError` seen in scouts is the *harness's* own poll fetch, not the runtime. Verify/scout harness timeouts are separately power-scaled (`power-aware-timeout.ts`).
- **Sustained back-to-back LLM runs under Low Power provoke ENDPOINT STALLS, not model failures — pace live sweeps, don't hammer (2026-06-28).** A C0 reliability repeat (qwen3-8b ×3 back-to-back) went ✅✅ then **STALLED** on run 3: the model went silent ~480 s (a hung/unresponsive call), the stall detector aborted at 498 s. This is the local endpoint (serialized inference) buckling under sustained load at ~50% throughput, not a wrong answer or a model ceiling — it's the `aborted`/transient class (re-run mitigates). Practical rule: space repeated live runs (one model at a time, let the prior finish), and read a lone stall in a repeat batch as load/transient, not a capability regression. Loading BIGGER models under this regime makes stalls worse, not better.
- **Reasoning can be DISABLED per-request via a model's soft switch — `/no_think` for Qwen3 (2026-06-29, live-verified); `chat_template_kwargs.enable_thinking` is IGNORED by LM Studio's OpenAI endpoint.** Probed qwen3-8b: appending `/no_think` to the user message dropped `reasoning_content` from 965 → **2 chars** while the reply/tool call STILL emitted correctly (`create_card({"title":"X"})`); passing `chat_template_kwargs:{enable_thinking:false}` did nothing. So thinking control is a **message-appended soft token**, not a request param, and it's **model-family-specific** (Qwen3 `/no_think` ↔ `/think`; qwen2.5-coder is NOT a reasoning model; other families TBD-verify). Captured as the pure [model-thinking-control.ts](src/core/model-thinking-control.ts) (`getThinkingControl` / `applyThinkingDisable`, conservative matcher table — only live-verified families). **Use it (§5.AA):** for a SIMPLE/tool task on a reasoning model, disable thinking to kill the reasoning-token overhead + truncation risk + latency at no correctness cost; and as a **truncation-recovery rung** (a `finish:length` no-call → retry with `/no_think`, the root-cause fix, cheaper than just bumping `maxTokens`). Conversely KEEP thinking for genuinely hard tasks (where it helps). Extend the matcher table as each family's switch is verified live. **Per-family verification so far (2026-06-29, paced load/probe/restore under the §4A load guardrails): Qwen3 = `/no_think` WORKS (965→2). phi-4-mini-reasoning (Phi-3) = `/no_think` does NOT work** (reasoning_content unchanged ~1100–1800 chars with or without it) — it has no soft switch + is a HIGH truncation risk (reasons ~1100+ tokens even for "2+2", truncated at 500 → `finish:length`), so the matcher correctly EXCLUDES it and the truncation rung matters most for it. **deepseek-r1-0528-qwen3-8b = `/no_think` does NOT work** (qwen3-ARCH but an R1 distill trained to always reason — reasoning_content ~1950 chars either way, truncated at 500 even for "2+2"). ⇒ the matcher now EXCLUDES R1 distills (`ALWAYS_REASONING_EXCLUDE = /deepseek|r1/`), since the bare `/qwen-?3/` would otherwise over-match the distill. (qwq is qwen2-arch — verify separately; the ≤14B guardrail blocks qwq-32b for now.) **qwen3.5 (arch `qwen3_5`) = `/no_think` does NOT work** (live-verified 2026-07-01, qwen3.5-9b-mlx: `/no_think` appended to the user message left reasoning IDENTICAL to baseline — 249 reasoning tokens, empty content, `finish:length` at temp 0 either way). So the qwen3 switch is qwen3-ONLY, not qwen3.x — the matcher now EXCLUDES qwen3.5 (`ALWAYS_REASONING_EXCLUDE …|qwen-?3[._]?5`), else the bare `/qwen-?3/` over-matches it and appends a `/no_think` the model ignores. **Confirmed model-family-intrinsic (not quant/runtime-specific): the legion GGUF variant `qwen3.5-9b-mtp-q4-k-xl` behaves IDENTICALLY (249 reasoning tokens either way) — same as the m4 MLX build.** Reinforces the lesson below: verify per model id, and a MINOR version bump can silently drop the switch. **Lesson: a soft switch is chat-TEMPLATE + TRAINING dependent, not arch-dependent — verify per model id, not per arch.**
- **A reasoning model's `no_tool_call` is often `maxTokens` TRUNCATION mid-reasoning, not inability to act (2026-06-29, live-confirmed with qwen3-8b).** Probed the loaded qwen3-8b with a trivial "reply READY": at `max_tokens:200` it emitted ZERO content (`finish:"length"`) — all 200 tokens went to `reasoning_content` (858 chars); only at `max_tokens:1200` did it finish (`finish:"stop"`, "READY" after 965 chars of reasoning, 229 completion tokens). Implication for §5.AA: a reasoning model on a real tool task can exhaust the chat adapter's `DEFAULT_SAMPLING.maxTokens` (1024) on reasoning ALONE → truncated before the tool call → looks like `no_tool_call` but is really budget truncation. So (a) classify a `finish:"length"` turn distinctly from a genuine no-call (it's an `aborted`/retry-with-more-budget case, NOT a capability failure), and (b) a cheap first rung for reasoning models is simply RAISE maxTokens (or stream + stop at the call), before the heavier reduction/constrained/variant rungs. Ties the reason-then-act rung. **The model endpoint + my chat-path changes are live-verifiable now that load control is restored (§4A MODEL LOADING).**
- **The truncation-recovery rung is `/no_think` (thinking-control) — but that's a NO-OP for the `ALWAYS_REASONING_EXCLUDE` models, which therefore need a BUDGET-RAISE rung that doesn't exist yet (2026-07-01, ties the qwen3.5 finding + a code audit).** Precise current state, ground-truthed: (1) the SWARM/task path (`nklein-session-runtime.ts` ~L293) DETECTS truncation by content-shape (the SDK hides the `finish:length` reason) → records a `model_stalled` observation, but the comment says it's **"Observational only"** — recovery is NOT wired there (chat path only, per §5.AA). (2) `retry-policy.ts`'s `aborted` ladder is `[same_model_retry, alternate_endpoint, context_shrink, cross_model_carry]` — **no budget-raise rung**, and at temp 0 `same_model_retry` RE-TRUNCATES a deterministic reasoning stall identically (wasted attempt). (3) **CORRECTION (2026-07-01, ground truth — earlier claim here was WRONG):** the CHAT path DOES recover truncation.
`chat-local-llm-adapter.ts` (~L142) detects a no-call turn that hit `finishReason==="length"` OR whose `reasoningTokens ≥
90%` of budget, then RETRIES with a bumped budget (`max(base×3, 3072)`) AND applies `/no_think` when the model supports it.
So the `ALWAYS_REASONING_EXCLUDE` models (qwen3.5/phi-4/R1) still get the BUDGET-BUMP recovery — `/no_think` is just an
added optimization for the models that honor it, NOT the only rung. The genuine remaining CHAT-path gaps: the bump is a
SINGLE ×3 retry (a big reasoner like the 27B truncated at 1024 and needed 64→4096 across MULTIPLE escalations in the
`dev tool-pick` demo, so one ×3 may be short) and it's UNBOUNDED (no context-window ceiling). **FIXED (2026-07-01):** the chat
adapter now ESCALATES once more when the first ×3 bump STILL truncates — `chat-local-llm-adapter.ts` calls the tested
`raisedTokenBudget({current: bumped, attempt:1, ceiling: 8192})` for a second retry (only fires on CONTINUED truncation ⇒
byte-identical for every case the ×3 already handled; the 19 existing rung tests stay green + a 20th pins the 1024→3072→6144
escalation). This also gives `raisedTokenBudget` a LIVE production consumer (not just `dev tool-pick`). Empirically grounded: qwen3.5-9b truncates at 1024 on a compound task (all 3 machines), the 27B qwopus needs even more. **ESCALATION POLICY SHIPPED + LIVE-DEMONSTRATED (2026-07-01):** the pure part — `raisedTokenBudget({current,attempt,ceiling?})` in [retry-policy.ts](src/core/retry-policy.ts) (doubles per attempt, exponent-capped, clamped to a ceiling, never below current) — is done + tested (4 tests). It now has a real consumer: `nklein dev tool-pick --max-retries N` auto-escalates the budget on a `finish:length` truncation and retries. **Proven end-to-end against the loaded 27B qwopus:** a compound task truncated at budget 64 → escalated 3× (64→128→512→4096) → RECOVERED a clean `list_files` pick. So the budget-raise IS the recovery — the owed runtime rung just needs to do the same at the model-call seam. **STRATEGY + LADDER DONE (2026-07-01):** `raise_token_budget` is now a `RetryStrategy` and the FIRST rung of the `aborted` ladder (a truncation deterministically re-truncates on a plain re-run, so raise the budget first; the plain re-run is the 2nd rung for a transient stall). Byte-identical live — key discovery: `runAdaptiveAttemptLoop` has **NO live callers**, so the ENTIRE §5.AA adaptive-retry ladder is well-tested pure substrate not yet wired into the live model-call path. OWED (the real behavior-change, now with the full substrate ready): (1) wire `runAdaptiveAttemptLoop` into the live chat/swarm model-call seam; (2) the executor applies `raisedTokenBudget` when the rung is `raise_token_budget`; (3) wire the swarm-path truncation detection from a `model_stalled` observation into a `truncated`→`aborted` classification. All measurable on real-swarm evidence — the `dev tool-pick` escalation already proves the mechanism. **SEAM CLARIFIED (2026-07-01, ground truth):** the wire point differs by path. (a) The SDK TASK-path turn loop offers NO turn-retry hook — the vendored `afterModel` only supports `{stop}`/observe (`if(o?.stop)return o`), so a turn-level retry loop can't be a hook there (would need session-level re-send wrapping or an SDK change). (b) The CHAT path IS a `!Klein`-owned seam: `runChatAgentLoop` (`chat-agent-loop.ts`) calls `deps.complete` in its own `for` loop and ALREADY has partial §5.AA inline (the constrained-schema rung + the evidence-gate + repeated-call detection) — so the generic `runAdaptiveAttemptLoop` driver would REPLACE/extend that inline logic there, applying strategies to the `deps.complete` args (which needs `complete` to accept per-attempt overrides — it currently takes only messages/allowTools). So "wire the loop" = a chat-loop restructure (bounded, `!Klein`-owned) + a `complete`-override seam, judged by real-swarm recovery-rate measurement. Contrast §5.O two-phase, which HAD a clean `beforeModel` tools-hook and is now WIRED — the adaptive loop's lack of an equivalent SDK hook is the real structural difference.
>
> **★ FIRST LIVE CHAT INCREMENT SHIPPED (2026-07-04, commit `2ebebcaf`) — the truncation rung's one-shot escalation is now a flag-gated BOUNDED LADDER.** Not yet the full `runAdaptiveAttemptLoop` wiring (that still needs the `complete`-override precursor), but the highest-value rung is now live-tunable: `createChatAgentModel`'s §5.AA truncation escalation (chat-local-llm-adapter.ts) loops the `raisedTokenBudget` raise — default OFF ⇒ exactly one escalation (byte-identical to the prior one-shot), and with `NKLEIN_CHAT_ADAPTIVE_TRUNCATION` set it compounds the budget across up to 3 passes toward the 8192 ceiling, breaking on landed-call / cleared-signal / ceiling-clamp. So a big reasoner that only recovers at the full headroom now gets there (flag OFF capped at 6144); doubly bounded (pass count AND monotonic ceiling clamp) so a turn can't spin. NO API change — the ladder lives inside the adapter closure that already owns `sampling`/`retryWire`/`offered`, so it's a local maxTokens override, not a `deps.complete` signature change. Scouted+designed via a workflow, then adversarially verified via a 3-refuter workflow (byte-identity / termination-&-bound / hot-path-interaction — all refuted=false, high confidence, zero findings, ceiling edges checked exhaustively). +3 tests, test:fast 6866 GREEN. **PLAIN-PATH GAP ALSO CLOSED (2026-07-04, commit `941a3e97`):** the scout flagged that only the TOOL-call path retried truncation — a plain answer or a context summary that hit `finish:"length"` reached the user as a half-sentence with NO retry. `completePlainWithTruncationLadder` now wraps the non-streaming `complete` + `summarize` with the SAME flag-gated bounded ladder (default OFF = one call, byte-identical). NON-STREAMING only by design (a streamed turn already showed live deltas; re-streaming would double the visible output — left to the caller's UX contract). +5 tests, test:fast 6871 GREEN. So `NKLEIN_CHAT_ADAPTIVE_TRUNCATION` now governs adaptive truncation recovery across BOTH chat paths. **STILL OWED:** the `complete(...,sampling?)` override seam that unlocks wiring the FULL `runAdaptiveAttemptLoop` at the loop level (capsule circulation, the other rungs) + the swarm-path `model_stalled`→`truncated`→`aborted` classification + (optional) the streaming-path retry — UX contract DECIDED 2026-07-12 (§10c#12): append-continuation with a subtle marker — ✅ SHIPPED same day (streamWithContinuationLadder: bounded continuations after a "(continued)" marker, same flag/budget rails as the plain ladder).
- **SWARM turn-level recovery is a VENDORED-ENGINE milestone, not a hook wiring — precisely scoped 2026-07-05.** Confirmed against the SDK contract + `ClineCore` types: (a) `afterModel → AgentStopControl` (stop/observe ONLY) and `beforeModel → AgentBeforeModelResult` (can re-frame the NEXT request's messages) — but NEITHER can force a re-invoke on a text-but-no-tool-call turn, which the SDK loop treats as TERMINAL. (b) The SWARM path drives the high-level `ClineCore`, which builds the `AgentModel` INTERNALLY (`ClineCoreStartInput extends Omit<StartSessionInput,"config"|"localRuntime">` — no custom-model field); nklein never touches the low-level `AgentRuntime`. (c) **Session-level re-send is the WRONG granularity** — a card is a long multi-turn session; re-running it would redo completed tool work, not recover the ONE stalled turn. ⇒ The only correct seam for TURN-level recovery is INSIDE the loop, which needs a **vendored change**. The MINIMAL one is elegant: `AgentRuntime` ALREADY accepts a pre-built `model: AgentModel` (its "advanced form", `agent-runtime.d.ts`), so the fork edit is just to PLUMB an optional `model?` from `ClineCoreStartInput` through to that internal `AgentRuntime` construction. Then nklein injects a wrapped `AgentModel` (local-LLM stream + the recovery ladder: on a no-tool-call turn, re-frame/bump-budget + re-stream). **ADDITIVE + default-inert** (no injected model ⇒ ClineCore builds internally as today = byte-identical), flag-gated, live-validatable by inducing truncation on the loaded 27B (brain27 truncates at a low `max_tokens`). Blast radius = the core engine, so do it deliberately with a full §5.Z roster re-verify. **CLASSIFICATION HALF SHIPPED (2026-07-05, `c1aacf9c`):** the swarm afterModel stall detector now classifies the empty turn via `deriveTruncationSignal(context.finishReason)` + records `finishReason`/`outcome`/`truncatedByStopReason` (resolves the old "SDK abstracts finishReason away" uncertainty empirically) — observation-only groundwork; the re-invoke is the remaining vendored step. **★ DE-RISKED 2026-07-05 (the minimal vendored change is even smaller than "plumb model? through ClineCore"):** the vendored `agent-runtime-config-builder` (built FROM SOURCE — `vendor/cline-sdk/packages/core/src/runtime/config/agent-runtime-config-builder.ts`) already BUILDS the `AgentModel` via `apiHandlerToAgentModel` and hands the runtime a pre-built `model: AgentModel` (its output field). So the fork edit is a single **`wrapModel?: (m: AgentModel) => AgentModel` hook** on the config-builder input, applied right after it builds the model (`model = input.wrapModel ? input.wrapModel(built) : built`) + plumbed from `ClineCoreStartInput` → the builder. Then nklein injects a **recovery-ladder wrapper around the ALREADY-BUILT model's `stream`** — NO local-LLM→SDK bridge to reimplement (the provider bridge stays; we only decorate its `stream`): buffer the base stream, detect a no-tool-call turn, re-frame/bump-budget, re-stream (bounded). Additive/default-inert (no `wrapModel` ⇒ byte-identical). Validate with brain27 induced-truncation — NO Docker needed (it's the model-call path, validatable on THIS host, unlike the durable default-on gate which is Docker-VM-blocked at 7.7 GiB). **BUILD ORDER:** (1) the recovery-ladder `AgentModel` wrapper (!Klein-side, unit-testable with a fake base model) → (2) the vendored `wrapModel` hook + rebuild → (3) wire flag-gated + brain27-validate. **★ INCREMENT 1 DONE + VALIDATED (2026-07-05, commit `921278e2`):** `src/nklein-agent/recovery-ladder-model.ts` — `createRecoveryLadderModel({base, maxAttempts, shouldRecover, reframe})` decorates a base `AgentModel`'s stream: buffer the turn → on a stalled no-tool-call turn re-invoke with a reframed request + REPLACE the events (bounded); verbatim replay otherwise. Injected policy ⇒ 6 unit tests, tsc 0. **★ INCREMENT 2 ENV-BLOCKED (2026-07-05):** the vendored `wrapModel` hook needs a rebuild of `vendor/cline-sdk/packages/core`, whose build is `bun run ./bun.mts && bun tsc` — and **`bun` is NOT installed on this host** (a monorepo build with codegen + package references; raw `npx tsc` bypass is fragile on the load-bearing engine, and the `apiHandlerToAgentModel` build-site isn't in the grepped src). ⇒ COLLECTED as an interaction/env blocker: **needs `bun` installed** (or a pre-built vendored dist) to land increment 2 + then increment 3 (wire flag-gated `NKLEIN_SWARM_RECOVERY` + brain27 induced-truncation validation). The wrapper (increment 1) is ready to plug in the moment the hook exists. **★ UNBLOCKED 2026-07-06 (David greenlit "install bun, land increments 2–3"):** `bun 1.3.14` installed via brew; the BASELINE vendored build (`bun run ./bun.mts && bun tsc -p tsconfig.build.json` in `vendor/cline-sdk/packages/core`) verified to succeed exit-0 AND be **byte-reproducible** (zero git changes to the committed dist ⇒ a known-good rollback reference). Build site confirmed at `agent-runtime-config-builder.ts:51` (the pre-built `model` field). NEXT (focused, deliberate — load-bearing engine): increment 2 = add the `wrapModel?` hook to the config-builder input + plumb from `ClineCoreStartInput` + rebuild + diff-verify; increment 3 = wire flag-gated `NKLEIN_SWARM_RECOVERY` in nklein + brain27 induced-truncation validation + §5.Z roster re-verify. **⚠ SCOPE FINDING (2026-07-06, traced the plumbing): DEEPER than the "single hook" scoping.** The config-builder hook itself is trivial+additive (verified: `wrapModel?` on `CreateAgentRuntimeConfigInput`, apply `model: input.wrapModel ? input.wrapModel(input.model) : input.model`). BUT the model is built at `session-runtime-orchestrator.ts:742` via `createAgentModelFromConfig(this.config)` where `this.config: AgentConfig` — and **`AgentConfig` lives in a SEPARATE vendored package (`packages/shared/src/agents/types.ts`, imported as `@cline/shared`).** Threading `wrapModel` from nklein's `ClineCoreStartInput.config` (a `CoreSessionConfig`, core pkg) to the apply-site needs: (1) add `wrapModel?` to `AgentConfig` [shared pkg] + rebuild shared, (2) carry it through the `CoreSessionConfig → AgentConfig` construction [core pkg], (3) apply at orchestrator:742 or the config-builder hook, (4) rebuild core, (5) nklein wiring + brain27. **= a multi-PACKAGE pervasive-core-type change + 2 rebuilds, not one hook.** Exploratory config-builder edit was made then REVERTED to keep the vendored engine byte-clean at the verified baseline. Deprioritized behind the approved review-cluster seam (nklein-side, no engine risk); worth a dedicated deliberate pass. Increment-1 wrapper stays ready.
- **Small-model tool-call NARRATION dialect varies run-to-run — recovery alone is stochastic; the constrained-decoding rung + evidence-gate controller are the durable fix (2026-06-28, §5.AA).** The same model on the same prompt narrates a skipped tool call differently across runs: gemma alternates Python `tool_code = create_card(…)` ↔ markerless `{"tool_name":…}` JSON; qwen/coder use pure prose ("3. Created card X"). `parseNarratedToolCalls` (now incl. the gemma `tool_code` dialect) recovers the *marked* forms, but a markerless/prose form is deliberately NOT recovered (too easily a legit answer). So narrated-recovery is a partial, stochastic lift. The reliable path is the §5.AA **constrained-decoding rung** (force a parseable `{tool,arguments}` via `response_format: json_schema`, steering to the next undone tool) + the **finite-state controller's evidence-gate** (don't accept a model's "done" without acceptance evidence). Live-proven: this took the e2e multi-tool capstone from 0/8 to coder-14b + phi-4-mini driving the full chain + persisting (stochastically). The wall is *chaining* tools across turns, not the individual capabilities (all 8 models pass the single-tool flows).
- **Dev-tooling gotchas (2026-06-28): (1) trust `tsc`/`biome`/tests over IDE diagnostics — the IDE's incremental parser chokes on non-ASCII (`§`, `—`, `⇒`) in comments/strings mid-edit and emits a cascade of phantom "redeclared / unexpected token / unterminated string" errors that `tsc -p tsconfig.json --noEmit` shows are nonexistent. (2) `grep` silently SKIPS some source files it flags as "binary" (a non-ASCII byte makes it treat the whole file as binary, so `grep`/`grep -c` print nothing — not even `0`); `agent-attempt-ledger.ts` + `agent-ledger-projections.ts` hit this. Use `grep -a` (force text) when a grep mysteriously returns nothing on a file you KNOW contains the term.
- **Token counting must stay bounded — it's behind every budget/size check (`get_file_size`, chat context, repo-map, retrieval) so its worst case is a runtime-wide throughput floor.** `countKanbanTextTokens` ([nklein-context-budgets.ts](src/nklein-agent/nklein-context-budgets.ts)) is the single entry point; keep all counting on it. Two non-obvious gotchas, both root-caused 2026-06-28 from a test that "only flaked under load" (it wasn't load — the machine was fine): **(1) BPE is ~O(n²) on a long run of ONE repeated char/token** (whitespace blocks, `====` rules, base64/minified blobs, lockfiles, generated data) — 8 KB ≈ 42 ms, 32 KB ≈ 390 ms, 120 KB ≈ ~6 s, blocking the event loop; mitigated by **chunking into 8 KB windows + a 256 KB sample-and-extrapolate cap** (counts are budget ESTIMATES, so boundary drift is fine). `gpt-tokenizer`'s internal merge cache HIDES this in naive benchmarks — use a FRESH char to reproduce. **(2) Pass `disallowedSpecial: <empty Set>`, never `allowedSpecial: ALL_SPECIAL_TOKENS`** — the latter adds a special-token scan and the default encode THROWS on `<\|endoftext\|>`-style strings in real content; the empty-disallowed set never throws and treats them as ordinary text.
- NKlein agent tool execution is containerized. SDK default tools + sandbox acceptance checks must go through the Docker `AgentSandboxManager`; do not add host fallbacks for agent `bash`, read, search, editor, or patch execution. (The shell-startup guidance above is for CLI detection / legacy terminal/shell sessions / explicit user terminals, not NKlein agent tool side effects.)
- Host-path recovery must cover raw sandbox command strings as well as structured file-tool path fields. Models often run `cd <host temp project> && …` after seeing trusted-runtime paths; inside Docker that must become `cd . && …` or they misdiagnose the sandbox as unavailable and start alternate-access loops.
- **IMPORTANT — agents must never see host details.** A Docker-isolated task agent's *view* is the sandbox: its cwd and every path it sees must be the in-container workspace (`/workspaces/<taskId>`, `AGENT_SANDBOX_WORKSPACES_DIR`), **never** the host mount path (`/private/var/folders/.../T/nklein-…`, `~/.nklein/nklein/…`). Host paths must not leak into the agent's prompt/context, tool-call arguments it's nudged toward, tool results, error messages, or evidence shown back — present the **workspace-relative** path instead. Host paths remain fine host-side (evidence bundles, result branches, trusted-runtime logs). **Dev-test projects are not special** — same Docker isolation as real tasks (host mounts for host-side evidence, but the agent still only sees `/workspaces/<taskId>`); a dev-test run that lets the agent see the host temp path is a bug. Only sanctioned exception: the user intentionally opted out of Docker isolation (strongly discouraged; future full-privileged host-agent mode).
- If CI hangs on Node 22 after tests seem to finish, suspect a live subprocess or SDK-host startup path before a slow test body. `test/runtime/nklein-agent/nklein-task-session-service.test.ts` was the big prior culprit (a unit-style suite still booting the real NKlein SDK host).
- On a headless remote Linux instance (e.g. SSH+tunnel), native folder picker commands may be unavailable (`zenity`/`kdialog`). Treat as a normal remote-runtime limitation; use manual path-entry fallback instead of requiring desktop packages.
- Git repos initialized/cloned by !Klein carry the local Git config marker `kanban.repositoryCreatedByKanban=true`. Keep the workspace-index ownership flag in sync with that marker so ownership survives removing + re-adding a project. Only offer deletion of `.git` for marked repos; remove task worktrees before deleting repo metadata.
- **A workspace !Klein CREATES (dev-test fixtures, scaffolds, clones) must NEVER live at/below !Klein's own parent folder.** It `git init`s + commits into the created workspace; if that path is inside the install subtree, the commits land on the dev repo's own branch. Real incident (2026-06-25): a dev-test scaffold whose `parentDir` resolved inside the repo seeded ~23 "Initial dev test fixture" commits onto the working branch, **replaced the working tree with the fixture, and flipped `core.bare=true`** — every work-tree git op then fails `fatal: this operation must be run in a work tree` while `git tag`/`log`/`rev-parse` still work (tell-tale of a bare-flip; check `git rev-parse --is-bare-repository`). Recovery: `git config core.bare false` → `git reset --hard <last-good-commit>` (confirm `git merge-base --is-ancestor <good> HEAD`) → clear a bogus `kanban.repositoryCreatedByKanban`. **Always route created-workspace paths through `resolveSafeCreatedWorkspaceParentDir` (`src/config/workspace-location.ts`)** — confines them to a configured path (`NKLEIN_DEV_WORKSPACE_DIR` / Settings) or the `~/.nklein/dev-workspaces` home default. **The guard is git-aware (2026-06-25 hardening, after a RECURRENCE):** a candidate is rejected if it is at/below the install's parent **OR inside any git work tree** (`isPathInsideGitWorkTree` walks up for a `.git`). The git-awareness is the robust part — the old `dirname(import.meta.url)` "below the install's parent" check is FRAGILE when run from inside a worktree. `initializeGitRepository` in `nklein-dev-test-project.ts` also has a **hard backstop** — throws rather than `git init` inside an existing work tree. **Salvage:** a fixture-corrupted worktree usually still has the real source as *untracked* files on disk — recover the main repo (`git config core.bare false` + `git config --unset kanban.repositoryCreatedByKanban`), `cp` the agent's clean edits out (`diff -rq`), re-verify + commit on the main tree, then `git worktree remove --force`. Agent worktrees live at `.claude/worktrees/<id>/` (full checkouts); `vitest.config.ts` excludes `.claude/**`. **The pre-commit hook (`.husky/pre-commit`) self-heals:** `cd`s to the git toplevel, **auto-resets `core.bare=false`** if bare, **skips gracefully in a non-!Klein repo** (sentinel on `package.json` name), and **refuses to commit `.claude/worktrees/` gitlinks** — so a flip can't wedge commits; don't reach for `--no-verify`. **Parallel git-worktree subagents are unreliable here** (shared `.git/config` → one's git op flips the shared `core.bare`; working trees cross-contaminate) — prefer solo sequential work. **SIBLING FAILURE (found 2026-07-06): a stale `core.hooksPath` SILENTLY disables the whole pre-commit gate.** husky writes `core.hooksPath` into `.git/config` (local, untracked); after a repo **rename/move** an ABSOLUTE stale value can persist (observed `core.hooksPath=/Users/david/GIT/kanban/.husky/_` after the kanban→nklein rename — that dir is gone, so NO hook fires and commits skip tsc+biome+test:fast **with zero warning** — worse than the `core.bare` flip, which at least errors loudly). The hook's own self-heal can't help (chicken-and-egg: the hook never runs). **Detect:** `git config core.hooksPath` — if it isn't a repo-relative `.husky/_` (or a path under the CURRENT repo), it's stale; a commit with no `Running biome…`/`Pre-commit checks passed` output is the tell. **Fix:** `git config core.hooksPath .husky/_` (repo-relative → survives future renames; husky v9's own convention) or re-run `npm install` (the `prepare: husky` script re-sets it). Because it's untracked local config there is no committable fix — rely on `npm install` after any clone/move, and eyeball for the hook's output on the first commit in a moved checkout.
- Keep ordinary NKlein `read_files` stateless for normal/small/focused reads. Only use `read_large_file` when a file must be read completely and won't fit in context — not just because it's longish. When genuinely needed, use reasonably large primary chunks (fewer chunks/stitches), cover through EOF, return every stitching window, and require final deduplicated synthesis.
- When tightening NKlein read-loop guardrails, cover both per-file content coverage and exact batch request fingerprints. Small models reread the same 2–4 file group in alternating batches, so single-file duplicate checks alone don't stop the loop; still allow narrower focused reads after a batch so agents can recover when compacted context drops verbatim lines.
- The repeated-identical-tool-call guard (`enforceRepeatedToolCallGuard` in `nklein-task-session-service.ts`) keys on a **lossless full-input fingerprint** — `computeNKleinToolInputFingerprint` (`nklein-tool-call-fingerprint.ts`, key-order-independent hash of the *entire* parsed tool input), stamped onto the `tool_call` hook activity (`toolInputFingerprint`) at both adapter sites in `nklein-event-adapter.ts`. It falls back to the lossy display summary (`summarizeParsedToolInput`) only for back-compat. **Because the fingerprint is the full input, every tool — incl. future ones — is immune by construction to the false-pause failure mode**: two calls collide only when inputs are genuinely identical, so a stateful workflow that *advances* (`read_large_file`'s cursor, `decompose_project` resolving open questions one per turn) never collapses to one fingerprint. Empty payloads fingerprint to `null` (so the empty-`decompose_project` diagnostic still fires). Don't "fix" a suspected false-pause by excluding a tool wholesale.
- NKlein diagnostics + generated-card starts are workspace-sensitive. Task ids like `dev-habit-insights-mid` repeat across dev-test projects, so diagnostics must be scoped by workspace identity/path hash, not just task id. Decomposition-generated implementation cards land in `planning` with `startInPlanMode:false`; under §5.B a started work card **stays** in Planning to refine then calls `begin_implementation` to advance to `in_progress` (it is NOT the start path that moves it — see the Planning/Refinement-lane note below).
- LM Studio is a live-only local provider. Do not trust SDK/catalog default model ids for selection (they can point at an unloaded stale model like `openai/gpt-oss-20b`); discover loaded models from the live endpoint, fall back to the catalog localhost base URL when none is saved, and prefer a currently-loaded model.
- **Be robust against small/weak-model output errors rather than trying to teach the model.** When a small/quantized model malforms output, the durable fix is to *parse and recover* in !Klein, not add another re-prompt (models that make the mistake often can't follow the correction either, and it burns turns/budget). Canonical example: models "narrate" tool calls as `<tool_call>{…}</tool_call>` text instead of a structured call — recovered by `recoverNarratedToolCalls` in the `afterModel` hook (`nklein-narrated-tool-call.ts`), which appends a real tool-call part so the loop dispatches it. The single robust seam for "model output text → executed tool call" is the `afterModel` hook mutating `message.content` *before* the vendored `agent-runtime` loop extracts tool-call parts. Apply this parse-and-recover principle to every weak-model failure mode (malformed tool args already go through `repairJsonValue`).
- **The Planning/Refinement lane (§5.B) — every started card refines before it implements.** A started card (work OR decompose) routes to **Planning first**, never straight to In Progress. The entry lane is the single constant `STARTED_CARD_ENTRY_LANE` (= `"planning"`) in `src/core/task-board-mutations.ts`, and **all three start paths must use it**: `reconcileStartedTaskBoardLane` (`src/core/task-board-lane-reconcile.ts`) + the runtime-server **queued-start drain** (`moveStartedQueuedTask`) + the **auto-start-linked drain** (`autoStartTaskIds`). Do **not** reintroduce a per-site `startInPlanMode ? "planning" : "in_progress"` derivation. The reconcile is a **source→target map** (`RUNNING_CARD_ENTRY_LANE_BY_SOURCE`): only `backlog → planning` and `review → in_progress`; every other lane is left untouched (a resumed In-Progress/Review card is never pulled backward; a decompose child already in Planning stays to refine). A **work card** (`isRefinableWorkCard` = not the home agent AND `!startInPlanMode`) gets the refinement preamble (`buildNKleinRefinementSystemPrompt`) + the **`begin_implementation`** tool (`src/nklein-agent/nklein-promotion-tool.ts`): re-validates against current project state, then moves *its own* card Planning→In Progress (via `onCardPromoted`, attached only for non-home work cards). `begin_implementation` **self-gates on the card's own `startInPlanMode`** — refuses a planning/decompose card (→ "use `decompose_project`"). The board-wide "card + its column" lookup is the one exported `findBoardCardWithColumn` (task-board-mutations) — don't re-add a local copy.
- **Naming truth — product is `!Klein`, code identity is `NKlein`/`nklein`, and we forked from Cline (NOT from ourselves).** Agents repeatedly confabulate this: the **user-facing product** is `!Klein`; the **CLI** is `nklein`; the **native agent + its SDK** are deliberately spelled `NKlein`/`nklein` in code (`src/nklein-agent/`, the `@nkleinbot/core` + `@nkleinbot/llms` packages, the `NKlein*` types, the `nklein-*.ts` files, `NKlein` as a runtime-agent id). That code identity is **intentional** — do NOT rename code identifiers to `!Klein`; "NKlein SDK/agent/integration" in architecture docs are correct code-component references. (2026-06-27 rename, do NOT revert: `src/nklein-sdk/` → `src/nklein-agent/` + tests, because !Klein doesn't expose an SDK. The vendored upstream agent SDK keeps its name at `vendor/nklein-sdk/` + the `scripts/nklein-sdk-alias.mjs` alias + `@nklein/*` tsconfig aliases; the `sdk-*-boundary.ts` shims + `nklein-sdk-event-readers.ts` keep their names.) Forked from **Cline Kanban** (Saoud Rizwan — root commit `6954ff79`). No "NKlein Kanban" upstream, no "NKlein Bot Inc."; `LICENSE` is the holder/terms source of truth. Rule: user-facing → `!Klein`; code component → `NKlein`/`nklein`; origin → `Cline Kanban`. The one deliberate "NKlein Kanban" that stays is `LEGACY_KANBAN_INITIAL_COMMIT_MESSAGE` in `src/workspace/initialize-repo.ts` — matched against the **real git history** of repos older versions created, so it's a historical fact, not a label to rename.
- **Biome in-editor noise is tuned on purpose (2026-06-27) — don't "fix" it back.** `noUnusedImports` is deliberately `info` (not error/warn) in `biome.json` so it's a subtle hint, not a yellow squiggle. Gotcha: its fix is **UNSAFE**, so `biome check --write` (= `npm run format`) does NOT remove unused imports — only `biome check --write --unsafe`, the editor's on-save `source.removeUnusedImports`, or manual cleanup do (and tsc doesn't catch them — no `noUnusedLocals`). Keep your imports tidy. `.claude/**` + `.clinerules/**` are excluded from biome traversal (a committed symlink `.claude/commands/release.md` → `.clinerules/workflows/release.md` made biome emit `internalError/fs`). Config uses Biome **2.5 `preset`** syntax (dep floor `^2.5.0`); after a biome bump run `biome migrate --write`.

---

## 5. Ordered backlog

### Phase 0 — stop-the-line correctness and liveness

These are known defects or incomplete migrations. Clear them before widening capability.

- [ ] **P0.9 — Finish legacy host-worktree retirement** *(legacy §5.A/§2.B; split into leaves 2026-07-13).* Re-home
  migrated-board cleanup away from agent-id predicates, delete the remaining cleanup-only worktree modules/schema/catalog
  residue, and verify upgrades, shell-on-task, shutdown, and result-branch delivery.
  - [ ] **P0.9d — Retirement verification lap.** Prove upgrades (fixture with a populated legacy worktrees home +
    legacy agent ids), shell-on-task, shutdown, and result-branch delivery are intact; then retire the §4A
    "legacy cleanup only" tribal-knowledge note.

### Phase 1 — feature completion: planning, execution, and durable control plane

#### 1A. Planning, decomposition, and work-package construction *(legacy §5.B, §5.S, §5.N, §5.AV, §5.AK)*

- [ ] **F1.1 — Turn knowledge-tool use into a decomposition-quality signal.** Correlate retrieval/localization activity,
  knowledge debt, graph revisions, and delivery outcome; feed the signal back into expansion and model fitness.
- [ ] **F1.2 — Add domain-rubric scoring for the DAW challenge preset.** Reuse the shipped Audio/VST scorer pattern;
  produce machine-readable DAW quality scores/evidence rather than reopening the four completed Audio/VST axes.
- [ ] **F1.3 — Complete automatic clarification after decomposition.** Run the question-quality/reviewer pass wherever
  decomposition or execution raises questions, persist answers into plan revisions, and resume the exact blocked card.
- [ ] **F1.4 — Complete the clarification dialog.** Support at least four explained choices plus free text,
  single/multi-select semantics, durable answer review, and keyboard/accessibility coverage.
- [ ] **F1.5 — Make focus chains durable across every agent surface.** Persist ordered steps and state transitions,
  seed/repair them in board and chat sessions, and make reviewer/attempt-ledger events agree on the current step.
- [ ] **F1.6 — Complete focus-chain operator controls.** Allow safe add/reorder/skip/reopen operations in card and chat
  views, with current-step visibility and audit history.
- [ ] **F1.7 — Wire incremental valid-DAG construction into decomposition.** Expose `add_task`/`add_dependency` handlers
  over `applyDagOp`, return precise rejection feedback, and retain one-shot mode behind the evaluator for comparison.
- [ ] **F1.8 — Emit work-package-shaped cards by construction.** Populate intent, bounded write scope, forbidden paths,
  interfaces, acceptance gates, evidence, and hot-file classification in generated cards and refinements.
- [ ] **F1.9 — Enforce work-package boundaries at dispatch and review.** Reject or park unauthorized file overlap and
  prove small workers remain within Green/Yellow/Red ownership on representative DAGs.
- [ ] **F1.10 — Wire first-class stuck/at-risk signals into worker and runtime loops.** Generalize fixture flips,
  read/tool loops, host-path confusion, no-progress, and repeated failures into early escalation rather than grinding.
#### 1B. Ledger, scheduler, replay, manifests, and dispatchability *(legacy §5.AF, §5.AK)*

- [ ] **F1.14 — Finish production writes to the Agent Attempt Ledger.** Record every attempt, rung, endpoint, model,
  prompt/profile, tool result reference, resource observation, outcome, and salvage/delivery decision once.
- [ ] **F1.15 — Make behavior profile, fitness, MCSR, and evaluation views ledger projections.** Remove parallel sources
  of truth, migrate existing records, and lock projection equivalence with fixtures.
- [ ] **F1.16 — Finish per-tool idempotency and durable result hashes/references.** Replayed or resumed work must neither
  repeat side effects nor lose the original evidence.
- [ ] **F1.17 — Implement replay policies end to end.** Support `reuse`, `simulate`, `skip`, and `reconfirm` per tool,
  persist the choice/result, and make simulator fixtures consume the same contract.
- [ ] **F1.27 — Land the workflow-kernel/durable-queue interface.** Isolate workflow state transitions from CLI/tRPC/UI
  adapters so schedulers and agents share one typed command/event seam.
- [ ] **F1.18 — Complete the durable long-run scheduler.** Checkpoint admission, running, review, retry, and delivery
  transitions to the ledger; restart without duplicate work or lost capacity. Do not treat `awaiting_review` as a
  dependency-releasing success: dependents must remain blocked until review, acceptance, and merge/delivery complete,
  with a multi-card bounce regression before the scheduler becomes default-on.
- [ ] **F1.19 — Feed endpoint/pool saturation into durable admission.** Replace retry polling with event-driven wakeups,
  fairness, and starvation bounds.
- [ ] **F1.20 — Complete the tool-capability manifest.** Add run-state, taint source/sink, semantic-error, replay,
  idempotency, cost, and approval metadata for every offered tool.
- [ ] **F1.21 — Make the manifest the single live access gate.** Route chat, NKlein, sandbox MCP, and delivery actions
  through `decideManifestAccess` while preserving delivery-autonomy rules as a separate axis.
- [>] **F1.22 — Prove manifest behavior parity** *(after F1.20–F1.21).* Lock all mode×action cells, current rulesets,
  approval paths, local-only restrictions, and fail-closed unknown-tool behavior.
- [ ] **F1.23 — Wire model load/unload policy into the scheduler.** Apply headroom, resident budget, idle TTL, current
  task need, and safe eviction decisions without autonomous downloads.
- [ ] **F1.24 — Add resource reservations to dispatch.** Reserve fast memory, context KV, endpoint capacity, sandbox
  slots, and disk budget before admission; release them on every terminal/error path.
- [ ] **F1.25 — Finish the quarantined self-improvement delivery pipeline** *(legacy §5.AF/M4).* Require protected/full
  gates, coverage delta, taint/capability review, human approval where specified, and an auditable merge decision.
- [>] **F1.26 — Add deterministic replay evaluation for self-improvement patches** *(after F1.17 and F1.25).* Compare the
  proposal against baseline fixtures before approval and retain the result in the ledger.
- [ ] **F1.28 — Complete the runtime-config facade split.** Move read/write/resolve/change-notify concerns behind stable
  modules without changing config semantics; keep legacy load compatibility tests.
- [ ] **F1.29 — Extract the Settings draft boundary.** Give each section an independent typed draft/dirty/reset/save
  contract so config-heavy work no longer edits the monolithic dialog state.
- [ ] **F1.30 — Finish the provider-service split at its proven seams.** Separate discovery/cache, registry mutation,
  load control, health, and response shaping; retain request throttling and stable behavior tests.
- [ ] **F1.31 — Integrate the continuous evaluation rail as a production background service** *(legacy §5.AI).* Reuse
  the shipped admission/runner/checkpoint cores, recover leases on runtime restart, yield to interactive work, and clean
  throwaway projects on every exit.
- [ ] **F1.32 — Complete evaluation-rail project/model selection.** Support user pin, deterministic rotation/random,
  and evidence-driven agent selection while honoring capability, freshness, resource, and recent-coverage constraints.
- [ ] **F1.33 — Auto-analyse rail evidence into typed findings.** Harvest success and failure, classify regressions,
  flakes, quality gaps, and ideas, write ledger evidence, and propose deduplicated backlog packages for review.
- [ ] **F1.34 — Finish full test-driven delivery mode.** Add the per-project override, make the intended safe default
  explicit, and prove no-test changes bounce while test-backed changes reach review without identical-loop churn.
- [ ] **F1.35 — Add evaluation-rail controls and status.** Expose enable/pause, cadence, background cap, long-timeout
  profile, active leases, latest outcomes, and cleanup errors without a tight poll loop.
- [ ] **F1.36 — Wire opportunistic idle work into durable scheduling** *(legacy §5.AW).* When a suitable model becomes
  idle, choose the highest-value safe work-ahead/review/deliberation/context-prep action, enforce overlap/resource/
  background-budget gates, and record realized value.
- [ ] **F1.37 — Complete orthogonal N-eyes review scheduling** *(legacy §5.AW).* Assign distinct lenses and model
  families, run blind-then-confer, deduplicate/dispute findings, and stop adding eyes when marginal value collapses.
- [ ] **F1.38 — Finish the hermetic Playwright smoke foundation** *(legacy §5.AK).* Add the shared mock helper,
  de-stale existing Settings/Chat specs, and create a strict-port `reuseExistingServer:false` smoke config so UI gates
  never pass against a stale server.

### Phase 2 — feature completion: chat, board, safety, and operator workflow

#### 2A. Chat execution and safety *(legacy §5.L, §5.M, §5.S)*

- [ ] **F2.1 — Thread provenance/taint through live chat and retrieval.** Label untrusted input, derived content,
  secrets, tools, and sinks; preserve labels through summaries/results and fail closed at dangerous combinations.
- [ ] **F2.2 — Wire capability escalation decisions into live execution.** Park and explain denied/escalated actions,
  persist grants with least scope/duration, and never let a retry silently widen capability.
- [ ] **F2.3 — Implement the egress proxy confirm flow (I5).** Queue `confirm` attempts on a loopback-only control
  channel, bind the decision to attempt+target+role, expose approve/deny, and keep denial/default timeouts fail-closed.
- [ ] **F2.4 — Add per-role egress allowlists.** Resolve architect/worker/reviewer policy snapshots into isolated proxy
  listeners and settings, with tightening applied immediately.
- [ ] **F2.5 — Add per-task egress attribution.** Use authenticated proxy identity to associate every DNS/CONNECT verdict
  with task/attempt/ledger records; prevent co-tenant spoofing.
- [ ] **F2.6 — Replace raw host `runCommand`/`openFile` with typed allowlisted intents.** Preserve legitimate local UI
  actions while removing arbitrary local-mode strings and adding server-side target validation.
- [ ] **F2.7 — Complete capability-gated multimodal chat.** Accept images first, then audio/PDF only where a local model
  and parser support them; bound storage/context and render input/output accessibly.
- [ ] **F2.8 — Complete chat execution-access modes.** Make isolated/read-only/confirming/full-risk postures explicit,
  persistent, enforced at every tool/host boundary, and understandable in the composer.
- [ ] **F2.9 — Replace the half-wired chat-memory store with the selected memory projection.** Unify short-term session
  recall, durable project/global Basic Memory, focus chains, and ledger evidence with provenance and delete controls.
- [ ] **F2.10 — Gate broad memory recall on a LongMemEval-style internal test.** Measure relevance, contradiction,
  privacy, and recency; refuse broadening when the model/store pair fails.
- [ ] **F2.11 — Finish the unified chat surface.** Cover session create/select/delete/relabel, streaming, reasoning,
  tools, knowledge, attachments, execution mode, history replay, errors, and reconnection with one shared renderer.
- [ ] **F2.12 — Complete host-action permission and audit UX.** Typed confirmations must name action, target, scope,
  consequence, and duration; history must be filterable and secret-safe.
- [ ] **F2.13 — Finish auto-clarification wiring in chat.** Bind questions and answers to card/plan state, resume the
  correct work, and avoid duplicate prompts after restart.

#### 2B. Board↔chat, streams, and operator surfaces *(legacy §5.AG, §5.AH, §5.AT, §5.AU, §5.BB)*

- [ ] **F2.14 — Finish board-chat verbosity controls.** Persist per-session quiet/normal/detailed levels and apply them
  consistently to deterministic digests, activity ticks, ASK events, and reconnect replay.
- [ ] **F2.15 — Add ASK-tier desktop/browser notifications.** Notify only actionable, deduplicated needs-you events when
  the owning chat is not visible; honor mute, OS permission, and quiet settings.
- [ ] **F2.16 — Complete stream drill-down.** Navigate stream → DAG → card → thread with stable focus/back behavior and
  accessible keyboard controls.
- [ ] **F2.16a — Add residual target disambiguation for card messages** *(legacy §5.AU rung 5).* Keep deterministic
  exact/name/id/stream matching first; only when several candidates remain, ask an isolated LLM picker to choose among
  those candidates or abstain. Never let it invent a route or start a card.
- [ ] **F2.17 — Complete the operator inbox signal sources.** Thread unresolved clarification, host-action ack,
  held-delivery, protected-write, and setup blockers into the existing board/chat inbox without double counting.
- [ ] **F2.18 — Surface hard-stuck recovery suggestions.** Render `buildEscalationSuggestions` beside the attempt chain,
  prioritize evidence-backed actions, and make approved actions re-enter the exact suspended state.
- [ ] **F2.19 — Ground read-only !Klein self-awareness.** Index current source plus `todo.md`/`done.md`/maintained docs,
  expose freshness/provenance, and prevent self-write tools in `klein_self` mode.
- [ ] **F2.20 — Package self-awareness as a skill/retrieval bundle.** Reuse dynamic skills and online/local retrieval so
  “how does !Klein work?” answers cite current code and do not rely on stale prompt prose.
- [ ] **F2.21 — Re-key display/behavior telemetry by stable model identity.** Use provider+canonical endpoint+model for
  non-routing views/stores while retaining runtime aliases only for display and historical migration.
- [ ] **F2.22 — Build the fitness/failing-model browser.** Add a read-only tRPC projection and filterable UI showing
  role verdicts, evidence age, confidence, failure reasons, and last evaluation.
- [ ] **F2.23 — Complete reasoning capture and multi-agent reflection.** Persist reasoning-channel summaries safely,
  show them where useful, and let reviewers compare independent lenses without exposing hidden secrets/raw CoT.

### Phase 3 — feature completion: adaptive local-model execution and routing

#### 3A. Adaptive recovery controller *(legacy §5.O, §5.AA)*

- [ ] **F3.1 — Wire loop detection and salvage/park into every model path.** Use the existing classifier on chat,
  planning, worker, reviewer, and retrieval turns; preserve useful artifacts and a clear reason.
- [ ] **F3.2 — Finish endpoint iteration.** Apply endpoint alternatives in policy order, record the winner, avoid known
  failures, and stop cycling across canonical-equivalent endpoints.
- [ ] **F3.3 — Wire prompt variation into the shared swarm/model seam.** Apply bounded, role-aware variants and record
  effectiveness without contaminating stable cache prefixes.
- [ ] **F3.4 — Replace reasoning-model grammar forcing with native required-tool calls.** Keep json-schema grammar only
  for verified non-reasoners; fall back to prose extraction conservatively.
- [ ] **F3.5 — Wire runaway-generation detection.** Distinguish useful long reasoning from repetition/no-action,
  interrupt safely, and feed classification/recovery metrics.
- [ ] **F3.6 — Complete reason-then-act orchestration.** Run reasoning and constrained action phases with separate
  budgets/tool sets, preserve a compact capsule, and land the tool call or a typed failure.
- [ ] **F3.7 — Use `ModelBehaviorProfile` at attempt start.** Prefer learned winners, skip proven failures, decay stale
  facts, and expose the chosen rationale.
- [ ] **F3.8 — Adopt the retry-policy engine on chat.** Replace inline ladders with the shared bounded controller while
  preserving streaming UX and simulator determinism.
- [ ] **F3.9 — Add the vendored model-wrapper seam for swarm turn retries.** Keep the default inert, rebuild the SDK
  reproducibly, and wrap a single stalled turn rather than rerunning a whole session.
- [>] **F3.10 — Adopt the retry-policy engine on swarm paths** *(after F3.9).* Map finish/truncation/stall signals,
  apply budget/context/endpoint/prompt/cross-model rungs, and preserve completed tool work.
- [ ] **F3.11 — Finish adaptive strategy-effectiveness learning.** Update per-model/task/rung success and cost from the
  ledger, explore safely, and converge without locking onto a one-off win.
- [ ] **F3.12 — Complete the finite-state outer controller.** Drive orient→plan→act→verify→repair→finish with phase
  context, tool subset, budget, evidence gates, and bounded transitions.
- [ ] **F3.13 — Complete cross-model bounce.** Select a stronger/different loaded reviewer, pass a minimal evidence
  capsule, repair the draft, and avoid recursive review loops.
- [ ] **F3.14 — Complete persona-varied self-bounce.** Use distinct system lenses only when no suitable second model is
  available; measure whether it improves the result.
- [ ] **F3.15 — Complete self-consistency execution.** Sample N bounded paths for hard tasks, majority/score them, and
  feed agreement/cost into reliability and routing.
- [ ] **F3.16 — Learn whether a model needs enforced reasoning.** Persist kind/benefit by role+difficulty and apply loops
  only when evidence says they help.
- [ ] **F3.T1 — Finish tool-card and two-phase tool selection.** Present a lean per-tool card set, choose none/one/
  plan-needed before exposing full schemas, and prove the smaller surface improves weak-model chaining without hiding a
  required tool.
- [ ] **F3.T2 — Standardize typed semantic tool errors.** Return code/field/expected/received/retryability/minimal
  example/result handle across tool boundaries so the controller can repair one failure without dumping bulk context.
- [ ] **F3.T3 — Execute the ActionPlan IR end to end.** Validate bounded multi-step tool plans, dispatch each step through
  the manifest, checkpoint evidence/results, and recover/replan one failed step without replaying completed side effects.
- [ ] **F3.T4 — Consume per-provider schema profiles.** Offer the smallest safe tool/schema dialect per provider/model,
  route near-valid payloads through tolerant repair, and fall back without weakening semantic validation.

#### 3B. Evaluation, routing, and machine pools *(legacy §5.AB, §5.AL)*

- [ ] **F3.18 — Finish per-task model selection.** Score card difficulty/skills/constraints against loaded-model fitness,
  cost, context, and availability at dispatch and retry.
- [ ] **F3.19 — Make autonomous guardrails power/model aware.** Derive wall-time/turn budgets from measured speed and
  task shape so slow capable local models are not falsely killed.
- [ ] **F3.20 — Discover/configure linked-machine pools.** Canonicalize endpoints, machine identity, roster, memory,
  power mode, and safe concurrency without hammering discovery APIs.
- [ ] **F3.21 — Enforce per-pool capacity.** Account for models and shared resources per machine, serialize where needed,
  and release capacity reliably on crashes/unloads.
- [ ] **F3.22 — Make routing pool-aware.** Prefer a free smallest-sufficient machine/model, preserve warm rails when
  beneficial, and avoid spill/thrash.
- [ ] **F3.23 — Add machine-pool settings.** Show endpoint, models, power/resource state, caps, override provenance, and
  a safe editable roster/preset.
- [ ] **F3.24 — Prove multi-machine fan-out.** A wide DAG must use at least two pools, keep hard work on capable models,
  survive one endpoint loss, and merge all results.
- [ ] **F3.25 — Complete the model-evaluation runtime.** Run the role×difficulty matrix repeatedly, capture quality,
  TTFT/tok-s/retries/cost, and persist a versioned fitness observation per cell.
- [ ] **F3.26 — Add freshness/decay and re-evaluation priority.** Re-run stale/uncertain/high-impact cells first and
  distinguish model, quant, engine, prompt, and runtime versions.
- [ ] **F3.27 — Finish task-difficulty estimation.** Use objective scope, expected files/dependencies, domain novelty,
  constraints, and observed trouble; calibrate against delivered results.
- [ ] **F3.28 — Complete automatic role assignment and balancing.** Choose defaults from fitness, permit explicit pins,
  explain every selection, and balance parallel work without downgrading critical roles.
- [ ] **F3.29 — Complete automatic stubborn-failure escalation.** Exhaust bounded approach/model alternatives, preserve
  the best partial artifact, then park with a complete evidence report.
- [ ] **F3.30 — Finish learned retry budgets.** Estimate useful stochastic retry count per model/role/failure and cap it
  by cost, deadline, and diminishing returns.
- [ ] **F3.31 — Complete model-routing Settings.** Expose fitness, role policy, pins, confidence/age, resource preference,
  and a working “Re-evaluate connected models” action.
- [ ] **F3.32 — Integrate llmfit into live load/routing decisions.** Consume fit/speed priors, reconcile IDs with the
  catalog, expose an egress-gated update check/action, and never autonomously download a model.
- [ ] **F3.33 — Make routing confidence- and resource-aware.** Combine quality confidence, queue time, RAM/VRAM, load
  time, endpoint occupancy, and warm-cache value; record predicted versus realized outcomes.
- [ ] **F3.34 — Add an egress-gated “research this model” flow.** For unknown/failing local models, search current
  primary documentation for API switches, tool dialect, reasoning controls, context/quant quirks, and fit; present a
  provisional catalog update for review and never auto-apply model downloads or unsafe settings.
- [ ] **F3.35 — Surface capability-ceiling model recommendations.** When the loaded fleet cannot clear a role/challenge,
  show the evidence, exact promising local model/quant, target machine, expected fit, and uncertainty; recommendations
  never download/delete/load without the user-controlled policy.

### Phase 4 — feature completion: retrieval, context, skills, MCP, and inference efficiency

#### 4A. Temporal retrieval and evidence *(legacy §5.AC)*

- [ ] **F4.1 — Record retrieval attempts/results/citations in the ledger.** Include query plan, source trust/freshness,
  fetch errors, selected spans, synthesis model, unsupported claims, and final use.
- [ ] **F4.2 — Put the freshness gate into decomposition/research.** Trigger online retrieval only when local knowledge is
  stale/insufficient and egress is explicitly enabled; otherwise explain the skip.
- [ ] **F4.3 — Surface “is this current?” reasoning.** Show evidence date/conflict/support status in agent output without
  leaking raw untrusted instructions.
- [ ] **F4.4 — Prove stale-vs-fresh behavior on decomposition.** Simulator fixtures and one live local retrieval run must
  show stale knowledge searches, fresh knowledge skips, and both cite their decision.
- [ ] **F4.5 — Finish citation conflict resolution.** Prefer newer authoritative release notes when sources conflict,
  retain minority evidence, and mark unresolved material claims.
- [ ] **F4.6 — Trim synthesis evidence to relevant spans.** Apply extraction before the model call, preserve citation
  addressability, and measure context saving/answer quality.
- [ ] **F4.R1 — Complete retrieval-provider modes.** Support `none`, user-supplied SearXNG-compatible URL, and an
  explicitly managed local backend with start/stop/idle-TTL; keep it absent at rest and add direct providers only behind
  the same egress/SSRF/taint contract.

#### 4B. Context arrangement and enforced reasoning *(legacy §5.AD)*

- [ ] **F4.7 — Wire smart-zone context arrangement into every prompt path.** Keep stable system/skill prefixes,
  task/evidence recency, result handles, and model-specific sensitivity while enforcing the 32k floor.
- [ ] **F4.8 — Verify end-of-context re-anchors.** Long simulator/live tasks must retain objective, current focus,
  constraints, and acceptance criteria without duplicating large context.
- [ ] **F4.9 — Produce observation-driven context recommendations.** Detect slow prefill/quality decline and suggest a
  smaller effective context/model setting with evidence.
- [ ] **F4.10 — Consume learned quality-effective budgets in prompt assembly.** Compact to the learned knee rather than
  blindly filling the advertised window; retain safety margins.
- [ ] **F4.11 — Prove learned-budget quality.** Compare compacted versus overflow-threshold prompts on small models and
  require no regression on capable models.
- [ ] **F4.12 — Wire reasoning-aware answer budgets across chat/swarm/review.** Separate reasoning and answer headroom,
  classify truncation accurately, and expose budget decisions in diagnostics.
- [ ] **F4.13 — Make retrieval pruning model-sensitive.** Learn distractor sensitivity and prune repo-map/index/web
  evidence while preserving required facts and citations.
- [ ] **F4.14 — Wire context-pressure triage.** At runtime choose continue/compact/stop from occupancy, quality budget,
  pending work, and model behavior; prove bounded behavior.

#### 4C. Dynamic prompt skills *(legacy §5.AE)*

- [ ] **F4.15 — Finish per-skill/API feature-profile wiring.** Apply thinking directive, structured-output strategy,
  proactive force-call, sampler, and budget preferences at chat and swarm call seams.
- [ ] **F4.16 — Finish dynamics-level configuration.** Resolve global/project/role/task levels, expose effective state,
  and make the default fully dynamic without hidden env-only behavior.
- [ ] **F4.17 — Replace hard-coded prompt blocks with composed skill fragments.** Wire board and chat through one
  resolver, smart-zone ordering, and overflow capping; keep cache-stable order.
- [ ] **F4.18 — Add skill variation as a stuck-task rung.** Select a materially different validated procedure, track
  provenance/effect, and avoid retrying equivalent fragments.
- [ ] **F4.19 — Complete the `ProceduralSkillBank`.** Store validated procedures, applicability, version/hash,
  outcomes, supersession, and provenance as durable procedural memory.

#### 4D. Safe community Agent Skills ingestion *(legacy §5.AP)*

- [ ] **F4.20 — Complete effectful SKILL.md loading.** Read a real skill plus bundle inside containment, feed the existing
  parser/manifest cores, and map it into the dynamic-skill shape without executing files.
- [ ] **F4.21 — Implement gated discovery.** Search trusted origins by default; require an explicit untrusted-discovery
  opt-in for community indexes, use the egress broker, and never inject result text into an execution prompt.
- [ ] **F4.22 — Build the user-controlled import flow.** Browse/select, show full source/bundle/findings/trust/provenance,
  compute SHA-256 over the canonical preimage, persist TOFU pins, and force re-review on change.
- [ ] **F4.23 — Wire skill execution containment.** Enforce effective tool grants, per-file no-auto-execute approvals,
  Docker/egress policy, credential/identity constraints, and the session-level Rule of Two.
- [ ] **F4.24 — Finish deterministic bundle screening.** Inspect magic/content for executables/obfuscation, optionally
  collect advisory scanner signals, and persist quarantine flags at the containment boundary.
- [>] **F4.26 — Implement suggest-only auto skill mode** *(after F4.20–F4.24).* The planner may suggest pinned,
  pre-screened skills as quarantined data; human approval is required before execution context use.
- [ ] **F4.27 — Record skill provenance and effectiveness in the ledger.** Content hash, source, scan/import/execution
  verdicts, grants, approvals, and helped/hurt signals must be queryable.

#### 4E. Curated sandbox MCP and authored memory *(legacy §5.AR)*

- [ ] **F4.28 — Add per-project curated-MCP overrides.** Resolve project→global for enablement and optional per-server
  controls; apply the effective value at sandbox/tool-bundle creation.
- [ ] **F4.29 — Complete curated-MCP Settings.** Show global/project switches, active servers, availability, and the
  per-model fit reason; changes affect new sessions predictably.
- [ ] **F4.30 — Prove curated MCP live.** A fitting model must use codebase-memory/sequential-thinking in the sandbox;
  a reasoner, opted-out project, unavailable binary, and failed server must be withheld/fail soft as designed.
- [ ] **F4.31 — Finish Basic Memory container integration.** Inject per-project/global RW mounts, seed hardened offline
  config, isolate permissions, and preserve user-owned Markdown across container/session restarts.
- [ ] **F4.32 — Finish Basic Memory audit and production proof.** Dispatch strongest-non-author idle audits, reconcile
  contradictions against code graph/ledger, test write→restart→recall, and optionally preseed offline semantic search.

#### 4F. Native LM Studio API leverage *(legacy §5.AN)*

- [ ] **F4.33 — Rewrite native `/api/v1/chat` for the probed contract.** Implement request
  `{model,input:[{type,content}]}` and response `{model_instance_id,output,response_id,stats}` parsing with tolerant,
  typed fallbacks; the prior pure shape is known stale (`26cd46ce`).
- [ ] **F4.34 — Probe and implement native tools/reasoning/SSE events.** Capture real tool call/result, reasoning text,
  message, usage, error, and stream termination shapes; add fixtures and state-machine parsing.
- [>] **F4.35 — Add stateful native sessions and MCP composition** *(after F4.33–F4.34).* Use response/session IDs to
  avoid resending history, preserve replay/ledger ownership, and fall back to OpenAI-compatible stateless calls.
- [ ] **F4.36 — Finish native model-management and thinking controls.** Complete safe list/load/unload/status use,
  verify family-specific switches (never infer from architecture alone), and feed facts into load/routing policies.

#### 4G. Context economy, cache health, and resource frugality *(legacy §5.AQ)*

- [ ] **F4.37 — Complete tiered system-prompt content and wiring.** Define the five additive levels, assemble them in
  chat/swarm/review, and expose global/project controls.
- [ ] **F4.38 — Feed real budget and task complexity into AUTO prompt depth.** Use quality-effective context and
  difficulty, with a visible reason and deterministic fallback.
- [ ] **F4.39 — Complete prompt intent modes.** Apply minimize/balance/max-task-info consistently and prove they affect
  component selection without bypassing invariants.
- [ ] **F4.40 — Finish byte-stable cache-aware layout.** Stabilize ordering/serialization across all prompt builders,
  isolate volatile suffixes, and regression-test prefix identity.
- [ ] **F4.45 — Use stateful LM Studio responses where verified.** Adopt `previous_response_id`/native sessions behind a
  capability gate, with stateless fallback and replay-safe transcript ownership.
- [ ] **F4.46 — Wire effectful context compaction.** Summarize old dialogue, drop/raw-handle tool output, retain pinned
  facts/evidence, and verify provenance/citation continuity.
- [ ] **F4.47 — Pass task-needed/max context into model loading.** Make the existing load-context planner a production
  consumer and prove the loaded context matches the computed safe value.
- [ ] **F4.48 — Wire fast-memory-fit checks.** Combine weights, KV geometry, host fast memory, and reserve policy to cap
  context/refuse loads before spillover.
- [ ] **F4.49 — Add Apple unified-memory safety.** Keep peak below the configured safe fraction, cap MLX KV growth, and
  surface a clear refusal/recommendation rather than risking a system freeze.
- [ ] **F4.50 — Integrate idle TTL, auto-evict, and JIT load.** Reclaim whole-model memory when idle while respecting
  warm-value and queued-work reservations.
- [ ] **F4.53 — Add a resource panel.** Show process/system RAM, CPU, fast memory/VRAM, disk, model residency, cache hit,
  and reservations with low idle overhead.

### Phase 5 — feature completion: product surfaces and desktop distribution

#### 5A. Remaining functional UI *(legacy §5.W, §5.BB, §5.BC)*

- [ ] **F5.1 — Expose every remaining non-experimental runtime setting.** Audit config→API→UI after phases 1–4; each
  user-relevant control needs effective global/project provenance, validation, reset, and tests.
- [ ] **F5.2 — Add Basic Memory audit-cadence controls.** Expose safe defaults, project override, last/next audit, and
  pause behavior without turning idle evaluation into polling churn.
- [ ] **F5.3 — Complete guided setup for newly added capability groups.** First-run/project setup must cover isolation,
  models, memory/MCP, egress/retrieval, resource policy, and desktop access with safe defaults; add CLI rendering parity
  over the same setup-plan model.
- [ ] **F5.4 — Add first-party self-hosted onboarding media.** Keep CSP `self`-only, make media optional/lightweight, and
  provide accessible text fallback.

#### 5B. Desktop updates, migrations, and packaged behavior *(legacy §10 desktop)*

- [ ] **F5.5 — Complete the packaged desktop updater.** Fetch the selected channel manifest, download+verify asset,
  hand off to the platform installer, expose tray/UI progress/errors/retry, and never install an untrusted asset.
- [ ] **F5.6 — Build runtime/project migrations with backup and rollback.** Version every migration, create verifiable
  backups, record results, resume/rollback safely after interruption, and make update acceptance depend on it.
- [ ] **F5.7 — Integrate signed release assets and update policy.** macOS signing/notarization, Windows signing, Linux
  checksum/signing decision, channel manifests, integrity tests, and reproducible electron-builder configuration.

### Phase 6 — prove feature completeness before broad hardening

Run these after phases 0–5. Fix findings by inserting concrete packages above the gate that exposed them.

- [>] **G6.1 — Complete the pure-core regression sweep** *(after phases 0–5).* Add focused tests for exported decision
  cores still lacking behavior coverage; avoid implementation-trivia and duplicate schemas.
- [>] **G6.2 — Complete the simulator-driven full pipeline e2e** *(after phases 0–5; legacy §5.V/C3).* Decompose →
  planning/refinement → parallel execution → review/bounce → acceptance → merge/delivery across representative success,
  failure, restart, and recovery fixtures.
- [>] **G6.3 — Complete chat e2e coverage** *(after phases 0–5).* Exercise sessions, reconnect, streaming, tools,
  reasoning, retrieval, memory, permissions, board feedback, attachments, and errors against deterministic fixtures.
- [>] **G6.4 — Complete board/card lifecycle browser coverage** *(after phases 0–5).* Start/pause/resume/move,
  dependencies, planning promotion, review, conflict, recovery, trash/replay, cockpit, and no-console-error assertions.
- [>] **G6.5 — Complete Settings/isolation browser coverage** *(after phases 0–5).* Prove every persisted setting and
  override, reset/inheritance, fail-closed Docker states, pool/resource state, and desktop-only visibility.
- [>] **G6.5a — Prove portable-state compatibility** *(after phases 0–5; legacy §5.F).* Exercise old mirror/CRDT fixtures
  through `migratePortableBoardCrdt`, add only genuinely missing schema migrations, then browser-drive export→fresh-
  machine import→continue-work with machine-local settings stripped.
- [>] **G6.6 — Upgrade pass/fail gates into diagnostic oracles** *(after G6.1–G6.5a).* Record exact failed phase,
  invariant, model/tool/attempt, artifacts, liveness, resource state, and reproducible fixture; track reliability over N.
- [>] **G6.7 — C3 durable multi-card challenge** *(after G6.2).* Survive restart and resume a multi-card pipeline with
  exactly-once side effects and correct delivery.
- [>] **G6.8 — C4 routing/recovery challenge** *(after F3.* and G6.2).* Route mixed difficulty by role/model and recover
  induced truncation, no-call, endpoint loss, and loop without user help.
- [>] **G6.8a — Prove a suitable-model three-role swarm** *(after F3.18–F3.35).* Assign distinct loaded architect/
  worker/reviewer models when beneficial, honor role fit and endpoint/pool caps, and complete a multi-card challenge.
- [>] **G6.9 — C5 concurrency challenge** *(after F3.20–F3.24).* Saturate a wide DAG across pools without unsafe overlap,
  cache/resource collapse, starvation, or lost merges.
- [>] **G6.10 — C6 context/deep-chain challenge** *(after F4.*).* Complete a long dependency chain under constrained
  context with re-anchors, compaction, memory, citations, and no objective drift.
- [>] **G6.11 — C7 clarification/retrieval challenge** *(after F1.3–F1.4 and F4.1–F4.6).* Ask only material questions,
  incorporate answers, retrieve current evidence when needed, and deliver a cited result.
- [>] **G6.12 — C8 quarantined self-improvement challenge** *(after F1.25–F1.26).* Propose, test, review, approve, and
  deliver a safe patch to !Klein with protected paths and replay evidence intact.
- [>] **G6.13 — Prove the continuous evaluation rail unattended** *(after F1.31–F1.35).* Run a sustained window that
  yields to targeted work, survives restart, rotates scenarios, cleans every project/lease, and produces useful typed
  findings without operator babysitting.

### Phase 7 — deep hardening, campaigns, and performance sweeps

These are valuable after the product paths exist. They are not allowed to block implementation-first progress above.

- [>] **H7.1 — Add a real mid-stream SSE-stall simulator behavior** *(after G6.2).* Emit partial deltas then stall,
  distinct from TTFT/dead-stream stall; cover continuation, timeout, cancel, and replay.
- [>] **H7.2 — Prove simulator failure-catalog coverage** *(after G6.2).* Generate a machine-readable mapping from every
  transport/content/agent-loop failure id to at least one scenario/assertion; fail CI on uncovered required entries.
- [>] **H7.3 — Drive web UI flows directly from simulator sets** *(after G6.3–G6.5).* Run prepared success/flaky sets
  through browser board/chat/review activity with deterministic timing and screenshots/traces on failure.
- [>] **H7.4 — Record→distill real telemetry into sets 01–20** *(after H7.1–H7.3).* Capture representative local-model
  sessions, redact, distill, validate specificity/coverage, and keep fixtures deterministic.
- [>] **H7.5 — Finish transient-abort/user-cancel roster validation** *(after P0.4).* Run representative families and
  verify no accidental retry of explicit cancellation.
- [>] **H7.6 — Finish role-specific model classification.** Populate the fitness-backed failing-model projection and
  settle uncertain role verdicts with repeated evaluator evidence.
- [>] **H7.7 — Settle phi-4-mini recovery classification.** Run reason-then-act, native constrained call, endpoint, and
  budget rungs before recording a capability floor.
- [>] **H7.8 — Finish unloaded-model isolation/restart cells.** Cover the three remaining roster models without changing
  the user’s resident set unexpectedly; record drop/reload/resume behavior.
- [>] **H7.9 — Sweep `browse_url` across the remaining representative roster.** Verify tool offer/call, SSRF/egress
  refusal, fetched-content taint, and cited synthesis.
- [>] **H7.10 — Sweep autonomous chat across the representative roster.** Cover tool chaining, persistence, streaming,
  recovery, and final synthesis; classify evidence rather than merely pass/fail.
- [>] **H7.11 — Finish output-robustness presets/models.** Complete the remaining small-model presets and reconcile
  model-family dialect/control facts into the typed catalog.
- [>] **H7.12 — Sweep embedding/code-intelligence flows.** Test current embedder plus new candidates for indexing,
  retrieval quality, cache identity, failure fallback, and resource cost.
- [>] **H7.13 — Run the deferred model-attribute A/B matrix.** Measure format, quant, reasoning, context, sampling,
  engine/API profile, cache, and concurrency with controlled repeated cells.
- [>] **H7.14 — Measure local cache/concurrency behavior.** Run MLX concurrency, cold-parallel vs warm-serial break-even,
  LM Studio slot affinity, and per-model cache-hit probes; feed results into F4 policies.
- [>] **H7.15 — Evaluate Legion5pro MoE candidates.** Survey fitting local models, benchmark only plausible candidates,
  and record whether expert offload beats smaller fully resident models on quality×latency×stability.
- [>] **H7.16 — Run model/quant recommendation follow-ups.** Settle qwen3.6-35B q8 availability, key GGUF-vs-MLX pairs,
  Devstral/Magistral repeatability, and context/quant tradeoffs; emit user-controlled download/cleanup recommendations.
- [>] **H7.17 — Run the full-catalog final campaign.** On explicitly available models, execute the cumulative challenge
  suite with power-aware pacing; update catalog/fitness evidence and turn every product defect into an earlier package.
- [>] **H7.18 — Run the dschinn capstone.** Only after C0–C8 are green: execute the real-project master challenge,
  structure the next chapter for any failure, and rerun cumulatively until the product—not a one-off patch—passes.
- [>] **H7.19 — Build the live cache-health probe.** Measure repeated-prefix TTFT per engine/model/format/quant/context,
  persist the verdict, and bound probing.
- [>] **H7.20 — Add runtime-specific cache evidence adapters.** Consume llama.cpp/LM Studio/MLX signals where present,
  cross-check timing, and never claim a hit from one unreliable field.
- [>] **H7.21 — Apply the cache adaptation playbook.** Route cache-broken models to one-shot work or a better engine/
  variant, warn the operator, and keep correctness above cache speed.
- [>] **H7.22 — Make swarm scheduling cache-aware.** Protect valuable warm prefixes from parallel-slot eviction when
  that improves total completion time, without starving independent work.
- [>] **H7.23 — Bound Node/process memory.** Audit heap, caches, listeners/timers, stream buffering, and worker pools;
  add LRU/TTL/limits and leak regressions where measurements show a risk.
- [>] **H7.24 — Cap disk growth.** Rotate logs, snapshot/compact ledger JSONL, expire discovery caches, preserve audit
  requirements, and expose retained-size accounting.
- [>] **H7.25 — Wire cache warmup amortization.** Use measured cold/warm costs plus expected reuse to decide/rank warm
  prefixes and record realized savings.
- [>] **H7.26 — Enable Flash Attention where supported.** Gate by engine/model, default on only after verification, and
  expose effective state/fallback.
- [>] **H7.27 — Enable Q8 KV cache with safe prerequisites.** Require verified Flash Attention, preserve quality limits,
  and expose memory saved/context gained.
- [>] **H7.28 — Add measured speculative decoding.** Opt in per compatible target/draft pair, track acceptance/net speed,
  and auto-disable when slower or resource-harmful.
- [>] **H7.29 — Apply agent/task sampler policy.** Use reproducible low-temperature/tight-top-p defaults where measured,
  preserve free-form reasoning quality, and record overrides.
- [>] **H7.30 — Apply structured output surgically.** Use native tools/grammar only for machine-consumed outputs and
  verified families; retain reasoning-aware fallback and quality tests.
- [>] **H7.31 — Add continuous batching only for proven concurrent wins.** Gate on workload/engine, monitor cache
  eviction/latency, and leave interactive single sessions unbatched.
- [>] **H7.32 — Make per-request inference-lever selection live.** Choose engine/flags/context/sampler by task budget and
  model evidence, then write predicted/realized speed, quality, TTFT, and cache results to the ledger.
- [>] **H7.33 — Integrate the TypeScript native agent core with task execution** *(after G6.1–G6.6; legacy §5.H;
  all-TS decision).* Once the SDK-backed product paths have coverage and diagnostic oracles, give the native core sandbox
  tools, session lifecycle, checkpoints, capture, review, and typed failure semantics without a host fallback.
- [>] **H7.34 — Make the native core a selectable/default runtime with safe SDK fallback** *(after H7.33).* Persist the
  choice, expose it in settings/diagnostics, and fall back only on a classified initialization failure.
- [>] **H7.35 — Prove native-core strict isolation and compatibility** *(after H7.33–H7.34).* Re-run the protected,
  Docker, simulator, result-branch, review, recovery, and diagnostic-oracle gates used by the vendored path.

### Phase 8 — visual polish and UX refinement

- [>] **P8.1 — Finish the token-based visual system across Board/Chat/Settings** *(legacy §5.AX).* Apply approved color,
  typography, spacing, elevation, motion, and state tokens component-by-component; retain information density and a11y.
- [>] **P8.2 — Polish egress, MCP, capability, memory, and resource controls.** Make safety posture/effective scope clear
  without overwhelming beginners; test all zoom levels and narrow layouts.
- [>] **P8.3 — Polish dense DAG/stream/activity surfaces.** Verify 20+ cards, long names, cycles, filtered streams,
  pan/zoom, hover/focus, reduced motion, and no disturbing rest-state clutter.
- [>] **P8.4 — Profile and remove UI render churn.** Measure real board/chat/settings updates, fix expensive selectors/
  subscriptions, and prove idle UI and machine remain responsive during LLM work.
- [>] **P8.5 — Run the final Fable/visual review.** Review every view/state/detail with real simulated workflows, fix
  concrete findings, and capture an accessibility/responsive/no-console-error acceptance pass.

### Phase 9 — release hardening and public preparation

- [>] **R9.1 — Curate public repository content.** Remove stale/private/handoff artifacts, secrets/placeholders, dead
  links, obsolete architecture claims, and generated clutter while preserving licenses/provenance.
- [>] **R9.2 — Prepare public branch/history.** Decide and execute a clean-root/squash strategy, preserve required
  attribution, verify tags/remotes, and document the chosen provenance.
- [>] **R9.3 — Add hosted CI.** Run supported-platform build/type/lint/tests/security/package checks with caches and
  artifact retention; keep protected-test policy intact.
- [>] **R9.4 — Add manual-dispatch publishing.** Validate version/tag/changelog, build signed assets, publish with
  provenance, create release notes/assets/manifests, and require approval.
- [>] **R9.5 — Prove clean-profile reproducibility.** From a fresh user/home/project, install, configure local models,
  run C0–C3, restart/update/migrate, and verify no untracked prerequisite.
- [>] **R9.6 — Complete release security/legal review.** Dependency/license/SBOM/secrets/CSP/egress/remote-access/update
  threat review, plus third-party notice accuracy for the final all-TypeScript architecture.
- [>] **R9.7 — Run the full release gate.** Build packaged apps, start the built server and curl critical routes, run
  fast/protected/integration/web/simulator/challenge gates, and retain machine-readable evidence.

### Phase 10 — research, decisions, optional ideas, and external/manual tail

These are intentionally last because they are not clear implementation work, are optional, or depend on external
hardware/user action. Promote a research item into an earlier concrete package only after its verdict produces one.

- [ ] **D10.1 — Research the orchestrator role** *(legacy §5.AS).* Compare it with current planner/scheduler/reviewer
  ownership; adopt with a bounded build plan only if it adds a non-duplicative control-plane capability, otherwise
  record the rejection in `done.md`.
- [ ] **D10.2 — Decide whether sacrificial skill classification is worth its cost/risk.** Evaluate the threat model,
  likely negative-detection lift, false-trust risk, and zero-privilege operating cost; add a concrete package only if it
  improves safety over deterministic screening and containment.
- [ ] **D10.3 — Decide whether auto skill mode may advance beyond suggest-only.** Require containment, rug-pull,
  provenance, and adversarial evidence; default is to keep human approval.
- [ ] **D10.4 — Decide optional per-session remote `browse_url` overrides.** Preserve server/project egress policy as the
  ceiling and define an understandable, non-sticky scope before implementation.
- [ ] **D10.5 — Define measurable criteria for hand-polishing simulator sets 02–20.** If no objective domain-realism or
  coverage gain can be measured, drop the subjective task.
- [ ] **D10.6 — Decide whether a local digest summarizer adds value.** Compare deterministic board/chat digests with a
  fail-soft local-model rewrite for clarity, latency, token use, and distortion; add an implementation package only if
  it measurably improves the operator surface.
- [ ] **D10.7 — Decide whether a first-class Mission layer adds non-duplicative value** *(legacy §5.AJ).* Compare it
  with chat-owned workspace goals, streams, DAGs, delivery reports, and the zoom ladder; adopt only a concrete operator
  workflow, not another planning abstraction.
- [-] **D10.8 — Multi-workspace portfolio/meta-chat.** Valuable future altitude after single-workspace ownership is
  solid; do not build until cross-workspace authority, addressing, resource, and privacy semantics are specified.
- [-] **D10.9 — Cloud escalation.** Greenlit only as a future explicitly enabled phase after local capability is maxed;
  it remains outside the active local-only backlog.
- [-] **D10.10 — Private messenger bridge.** Dropped from the current product backlog; reconsider only with a fresh user
  request and a concrete authentication/privacy posture.
- [-] **D10.11 — Wholesale Python backend port / standalone file-size campaign.** Permanently rejected; refactor only for
  a concrete cohesion, correctness, or feature-enabling reason.
- [?] **D10.12 — macOS packaged interaction smoke.** Launch the packaged app, exercise tray/open/pause/resume/autostart/
  auto-resume/LAN toggle+restart, connect from a second device with the displayed passcode, and verify clean shutdown.
- [?] **D10.13 — Windows and Linux packaged smoke/signing validation.** Hardware/CI-gated; run the equivalent desktop,
  tray, autostart, updater, migration, LAN, and uninstall checks on native systems when available.
- [?] **D10.14 — Docker Desktop memory-cap validation.** If the local VM remains below the required workload headroom,
  raise it under user control and rerun the affected multi-model/sandbox challenge; code must still fail clearly when low.

## 6. Legacy section alias map

This map preserves the old enumeration as a lookup aid; it is not a second queue.

| Legacy | Current home |
| --- | --- |
| §5.A, §12 | Phase 0 correctness, liveness, and worktree retirement |
| §5.F | Phase 6 portable-state compatibility proof |
| §5.B, §5.S, §5.N, §5.AV | Phase 1A planning/decomposition/clarification/focus chains |
| §5.AF, §5.AK | Phase 1B ledger/scheduler/manifests/dispatchability |
| §5.L, §5.M, §5.AG, §5.AH, §5.AT, §5.AU, §5.BB, §5.BC | Phase 2 chat/board/operator |
| §5.O, §5.AA | Phase 3A adaptive recovery |
| §5.AB, §5.AL, §5.AN | Phase 3B routing/evaluation and Phase 4F native API leverage |
| §5.AC, §5.AD, §5.AE, §5.AP, §5.AQ, §5.AR | Phase 4 retrieval/context/skills/MCP/resources |
| §5.V, §5.Z, §5.AI, MCF C3–C8/CAP | Phases 6–7 gates and campaigns |
| §11 | H7.17 full-catalog final campaign |
| §13 | Phases 6–7 simulator/e2e proof and hardening |
| §5.W, §5.AX, §10 desktop | Phases 5 and 8 product surfaces |
| §5.AZ, §5.J | Phase 9 release work |
| §5.AS, §5.AY and former LATER/manual queues | Phase 10 decisions/optional/external tail |

## 7. Backlog accounting and forecast

The checkbox count is an implementation-package count, not a raw Markdown-marker count. Recalculate with:

```sh
rg -c '^\s*- \[( |>|\?|-)\]' todo.md
```

The 2026-07-13 reconciliation replaces 310 unresolved-looking legacy markers with **229 remaining packages**:

- **153** implementation-first packages in phases 0–5 (the path to feature-complete);
- **15** feature-completeness proof gates in phase 6;
- **47** deep-hardening, visual-polish, and release packages in phases 7–9;
- **14** research/decision/manual/deferred-tail packages in phase 10.

Status totals are **155 ready**, **67 dependency-blocked**, **3 user/hardware-blocked**, and **4 deliberately deferred**.
The larger package count than the prior ~154 estimate reflects finer, top-down-executable slicing plus tasks recovered
from secondary Markdown files; it does not represent a proportional scope increase.

Bottom-up uncertainty is still dominated by scheduler/recovery wiring, routing/resource policy, safe skills/memory,
desktop updates/migrations, and defects found by C3–C8. A defensible forecast for the repository's continuous autonomous
workflow is **11–18 weeks probable**, **7–10 weeks optimistic**, and **5–9 months conservative**, plus roughly **5–14
low-power machine-days** for the final model campaign. A conventional single full-time engineer is more like **10–20
months**. Re-estimate after every phase; these are planning ranges, not promises.
