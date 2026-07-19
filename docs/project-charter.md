# !Klein — Project Charter

> **Read this before judging the roadmap.** !Klein's shape only makes sense once you know what it is *for*.
> Analyses that assume "unreleased developer tool racing competitors to market" reach confident conclusions from
> a false premise. This document states the actual premise, including where outside criticism lands correctly.

## 1. What this project is

**!Klein is a research vehicle for understanding agentic coding from the inside, which may become a product.**
That ordering is deliberate and is not a hedge.

The maintainer's primary goal is direct, hands-on knowledge: how agent harnesses actually behave, where they
break, what the real limits are today, and — critically — *which of today's limits dissolve over time and which
are structural*. That understanding is only obtainable by building a harness complete enough to hit the hard
parts, then running it against real work. A toy cannot teach it. Reading other people's harnesses cannot teach
it either: the interesting failures live in the interactions between decomposition, routing, context budgets,
verification and recovery, and those interactions only appear in a system that has all five.

A second, entangled goal: **use frontier cloud agents to push on what frontier cloud agents can build.** !Klein
is largely built *by* the class of system it studies. That makes the project a live experiment in autonomous
agentic construction, and it is why the engineering standards (§4A of `todo.md`) are stricter than an
early-stage product would normally justify. The strictness is not gold-plating; it is the instrumentation.

Product release is a **possible outcome conditional on the research going well**, not the organizing objective.
There is no launch date to slip, no market window to miss, and no user base whose absence constitutes failure.

## 2. Why local-first, and why now

Three independent arguments converge, and they hold even if !Klein never ships:

**(a) There is a real, underserved demand.** A substantial part of the developer community wants to keep
dependency on cloud frontier models and agents as low as possible — for cost, privacy, autonomy, air-gapped
environments, or simple unwillingness to make their daily work a metered API call. The tools serving that wish
well are scarce. Most "local support" in agent products is a compatibility checkbox layered on assumptions
tuned for a 200B-parameter cloud model, which is why it disappoints in practice.

**(b) Local models are nowhere near their ceiling.** Betting that open-weight models stay where they are is a
bad bet, and it has been a bad bet every year so far. The work that makes a 4B–32B model productive today —
smaller tasks, tighter context, empirical routing, deterministic verification, real recovery — is precisely the
work that compounds as those models improve. The harness is the durable asset; the model is the replaceable
part.

**(c) The hardware economics point this way.** RAM shortage and pricing pressure show no sign of relaxing.
The constraint that shapes local agentic coding — *how much capable model can you actually keep resident,
and how do you spend a context budget you cannot afford to waste* — is getting tighter, not looser. Problems
that only surface hard on the consumer hardware developers already own are therefore worth drilling into
now, and they are exactly the problems a cloud-first harness never has to solve.

The corollary is stated plainly: **!Klein optimizes for a machine that is too small, not for a model that is
too good.** When a design choice trades frontier-model elegance for small-model reliability, it takes the
small-model side. That is the whole thesis.

## 3. Why there is no rush to ship

Shipping an early, limited version would trade the project's actual purpose for a weaker version of someone
else's. A narrow v0.1 optimizes for external validation — adoption, comparison, positioning. Those are the
right goals for a product company and the wrong goals for a learning vehicle whose value is the depth of
understanding it produces. The maintainer is explicitly willing to spend more effort per unit of external
progress in exchange for knowing *why* each mechanism does or does not work.

This is not an argument against evaluation. It is an argument against letting a release schedule decide which
questions get asked.

## 4. Where outside criticism is correct

A charter that only defends itself is not worth reading. These points, raised in external review (GPT-5.6 Sol,
2026-07-19), are accepted:

- **Mechanisms have outrun proof.** A large number of features are shipped "core + record-only wire, default
  OFF, awaiting live validation". Each was individually the right call — observe before enforce — but the
  aggregate is a library of unproven mechanisms rather than a tuned system. *Response: this is now a tracked
  work item with its own phase, not a vague intention. See §5 and Phase 15 in `todo.md`.* The backlog still
  gets driven to zero; what changes is that "prove it or default it" becomes a first-class deliverable rather
  than a comment at the end of each item.
- **Public docs have drifted from the code.** `README.md` and `docs/architecture.md` describe retired
  PTY/worktree architecture. Documentation that lies is worse than documentation that is missing.
- **`todo.md` has become an intake as well as a queue.** Completed items belong in `done.md`; the `[~]` marker
  was undocumented.
- **Over-fitting to LM Studio internals is a real risk.** LM Studio should be one adapter behind a runtime
  boundary, not an assumption threaded through the system.
- **32k as an allocation floor is the wrong reading of a capability requirement.** A model should be *capable*
  of 32k; every request and concurrent slot should not therefore *allocate* 32k. KV memory is the scarcest
  resource on the hardware this project targets, and effective context degrades well before the advertised
  maximum.
- **Building another native agent core (H7.33–H7.35) is likely wasted effort** while the vendored SDK evolves
  underneath it.
- **Interoperability (ACP/A2A) is the largest future-openness gap.**

**Where the criticism is rejected: the recommended feature freeze.** It follows correctly from a product
premise this project does not hold. Freezing feature work to run a comparative bake-off would optimize for a
go/no-go decision nobody is waiting on, and would forgo the exploration that is the point. The backlog gets
driven to zero; hardening and comparative evaluation follow it rather than replacing it.

## 5. The verification gap — a first-class design concern

The deepest issue this project has surfaced is not about models. It is this:

> Frontier agents can now implement very complex systems from limited specification. **Ensuring that the right
> thing was built is a vastly different and much harder problem than getting something built.**

Tests pass. Types check. Review approves. And the artifact can still be subtly not what was wanted — because
the specification was underdetermined, because the agent resolved an ambiguity plausibly but wrongly, or
because the verification only ever checked the properties someone thought to name. Effort scales with the
building; assurance does not scale with it automatically.

This matters twice over for !Klein:

1. **As a builder of itself** — !Klein is largely agent-built, so this gap is a live risk in its own codebase.
2. **As a tool** — !Klein will let users build such systems. A harness that hides this gap is selling a
   dangerous illusion.

The project does not claim to solve this. It commits to three things instead:

- **Be honest about it in the product surface.** Where !Klein cannot verify intent, it says so, names what it
  did and did not check, and never presents "the checks I ran passed" as "this is what you asked for". This is
  the same honesty stance already applied throughout the core (unknown ≠ safe; absence of evidence is never
  approval) raised to the product level.
- **Invest in intent-side verification, not just artifact-side.** Acceptance criteria in testable form,
  spec-derived invariants, requirements traceability, and detection of the "passes the test, misses the point"
  failure mode.
- **Close the loop with real usage.** One maintainer cannot personally encounter every situation a harness
  must handle. That structural limit — not laziness — is why automated, user-controlled feedback generation
  (§6) is a core feature rather than a nice-to-have.

## 6. User-generated feedback, on the user's terms

A single maintainer cannot experience enough situations to tune a system this large. The honest fix is to let
the system report on itself — using the LLMs the user has already connected — and to make that reporting
something the user *commands*, not something that happens to them.

Non-negotiable constraints, in priority order:

1. **Never automatic, never hidden.** Feedback is generated only on explicit user action. There is no
   background collection, no "anonymous telemetry" default, no opt-out buried in settings. If the user does
   nothing, nothing leaves the machine, ever.
2. **Fully reviewable before it exists as an artifact, and fully editable after.** The user sees every
   section, every included fact, and every redaction — at the granularity of individual findings — and can
   drop any part.
3. **Local generation.** The report is written by the user's own connected models. Generating feedback must
   not itself create the cloud dependency the project exists to reduce.
4. **Privacy by construction, not by promise.** Source code, file contents, paths, prompts and project
   identifiers are excluded by default; what ships is behavioural and structural (what the harness did, where
   it stalled, which mechanism fired, what the model class was). Anything richer is opt-in per item, shown
   verbatim first.
5. **Transport is the user's choice and is decided last.** A GitHub issue draft the user submits themselves is
   the first target precisely because it is transparent and requires no infrastructure. Anything beyond that
   is a later question that scale may or may not raise.

The purpose is not analytics. It is to convert one maintainer's blind spots into evidence — the same
"observe before enforce" discipline the codebase already applies internally, extended to the one signal that
cannot be synthesized: what actually happened on somebody else's machine, on somebody else's project, with
somebody else's models.

## 7. How to read the backlog in light of this

- `todo.md` remains the single source of truth, and the backlog still gets driven to zero.
- "Ship the mechanism, then prove it" is the accepted working order — but **proving is scheduled work**, not
  an aspiration. Phase 15 exists for exactly that.
- Items justified only by "a competitor has it" are weak by this charter's standards. Items justified by
  "this makes a small model on constrained hardware measurably more reliable" are strong.
- Effort disproportionate to near-term product value is expected and is not, by itself, evidence of a problem.
  Effort disproportionate to *learning* value is.
