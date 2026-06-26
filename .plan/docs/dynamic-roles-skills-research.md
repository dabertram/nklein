# Dynamic roles, composable skill sets & just-in-time prompt composition — research notes

> **Why this doc exists.** The user (2026-06-26), reacting to !Klein injecting the "today" date into *every* prompt
> (token waste where it doesn't help), set a broader direction: **!Klein's prompts should be highly DYNAMIC** — adapted
> to the task, the context, the **agent role**, and the **history**. The date is irrelevant to a coding task but crucial
> to a *retriever* role (which we don't have yet → extend the role catalog). Go further: **decompose roles into SKILL
> SETS**, and let an agent be **dynamically assigned the skills + information it needs to excel**, varying by many
> factors — even **message-to-message** for the same agent. Varying the skill set is also a lever to push through
> **stubbornly failing tasks** (ties §5.AA/§5.AB). Expose **role-mode "dynamics levels"** so a user can choose how
> dynamic vs. strict the assignment is (fully-dynamic default → static skills + auto model → assigned skills → fully
> static skills+model), with use-cases like "only the planner/architect may use the bigger/cloud models" (compute
> control). Keep the control surface **basic for now**, grow later. *"research as much as you can about this."*
>
> This is the grounded research base for **todo.md §5.AE**. Citations are dated; re-judge freshness against "now" (the
> §5.AC temporal lighthouse) — this is a fast-moving area (2025–2026 papers).

## 1. The user's instinct matches where the field is going: **skills as a first-class, composable abstraction**

- **Agent "Skills" are an emerging standard unit.** Survey: *"Agent Skills for Large Language Models: Architecture,
  Acquisition, Security"* (arXiv:2602.12430). A **skill** is a **modular, reusable knowledge unit** that typically
  bundles: a **behavioral specification**, **applicable scenarios** (when it's relevant), **guiding principles**, and
  an **output template**. Claude Code and other coding agents now expose **reusable skills as a first-class capability**.
  *Caveat to keep us pragmatic:* *"Agent Skills Are Not the Endgame — They're a Transitional Layer"* (ossinsight, 2026)
  — treat skills as a useful organizing layer, **don't over-architect** a grand ontology.
- **Capability decomposition from a role.** A role description is decomposed into **discrete atomic capabilities** —
  each a functional unit (e.g. "perform code review", "fetch fresh docs") **independent of implementation**. Roles like
  reasoner / executor / summarizer / retriever fall out of this. This is exactly the user's "decompose roles into skill
  sets."
- **Skills compose dynamically during problem-solving** — specialized agents **select and compose modular skills from a
  library** as a goal-driven process (not a fixed per-role bundle).

## 2. Dynamic skill **selection/routing** + **per-skill context construction** (the core mechanism)

- **Skill routing**: *SkillRouter* (arXiv:2603.22455) retrieves the **right skill(s) from a large pool** given the task
  (embedding models fine-tuned on (query, skill) pairs). *Optimal-Agent-Selection* (arXiv:2511.02200) does **state-aware
  routing**; *AgentRouter* (arXiv:2510.05445) is knowledge-graph-guided. Routing happens **at runtime**, per task.
- **Dynamic skill CONTEXT construction** — the key one for the date critique: *SkillsInjector* (arXiv:2605.29794)
  **adapts each skill's description at injection time, conditioned on the set of co-injected skills** — a shift from
  static descriptions to **context-aware, just-in-time prompt assembly**. Generalized: **only assemble the context
  fragments the currently-active skills need.** The "today" date is a fragment a *temporal/retriever* skill needs and a
  *plain-coding* skill does not → it shouldn't be in every prompt.
- **Capability/model routing co-travels with skill routing.** *Capability Instruction Tuning* uses **model capability
  vectors**; learned routers predict the **best model per query** (directly our §5.AB). So "which skills" and "which
  model" are two coupled routing decisions — the dynamics-level setting governs both.
- **Adaptive reasoning effort.** *Ares* (arXiv:2603.07915) **selects reasoning effort dynamically** per task — the same
  spirit as §5.AD enforced-reasoning + the dynamics levels (a "reasoning" skill toggled by difficulty).
- **Measured payoff.** Adaptive routing + evaluator-driven competition reported **+29% factual coverage / −74% revision
  rate vs. static pipelines** in document workflows — dynamic > static is not just elegant, it measurably wins.

## 3. **Dynamics levels** = the autonomy/control spectrum (the user's role-mode settings)

- **Autonomy is a spectrum, not a flag** ("Autonomy Is a Spectrum", Medium/Agentic AI; *Levels of Autonomy in AI
  Agents*, emergentmind; taxonomy arXiv:2310.03659): rules → LLM call → predefined chain → **router (LLM influences
  control flow)** → state machine → full agency (LLM decides output, next step, **and which tools/skills it has**).
- **Tiered control patterns**: read-only → reversible writes → irreversible actions gated by policy/approval. Map this
  to **how much freedom the skill/model assignment has**:
  | Dynamics level (user's words) | Skills | Model | !Klein mapping |
  |---|---|---|---|
  | "fully automatic … highly dynamic … vary message-to-message" (**DEFAULT**) | auto, per-turn dynamic | auto (§5.AB) | `fully_dynamic` |
  | "more static role skill sets but still automatically selecting the best model fit" | fixed per role | auto (§5.AB) | `static_skills_auto_model` |
  | "strictly assigned role-skill sets" | user-assigned per role | auto or pinned | `assigned_skills` |
  | "fully strict … statically assigned models" | user-assigned | pinned per role | `fully_static` |
- **Per-role model-class constraint** (the user's example: "only planner/architect may use the bigger/cloud models" —
  compute control): an **orthogonal policy** layered on any dynamics level — a role may cap/floor the model class it's
  allowed (small-only / any-local / + cloud-when-revisited). Cloud stays invariant-#1-locked (idea-only until revisited).
- **Design guidance from the autonomy research:** keep the **default maximally dynamic** (highest economic value; human
  oversight *reduces* value as capability rises) but make **stricter modes cheap to opt into**. Don't over-build the
  control surface now — a **basic** level enum + a per-role model-class cap is enough; grow as needed.

## 4. Synthesis → the !Klein design (feeds §5.AE)

- **`Skill` = the composable unit.** Fields: `id`, `description` (for routing), `relevance` (when it applies — task
  shape / role / context / history signals), **`contextFragments`** (which prompt blocks it needs — e.g. `temporal`,
  `repo_map`, `focus_chain`, `freshness_rail`, `refinement_preamble`, `online_retrieval`), **`tools`** (which tools it
  needs), `preamble` (behavioral guidance), optional `outputTemplate`.
- **Context fragments are assembled JUST-IN-TIME from the active skills** → minimal, relevant prompts (fixes the date
  waste). This is the producer of the parts that **§5.AD's smart-zone arrangement then orders** — clean synergy: §5.AE
  decides *what's in* the prompt, §5.AD decides *where it goes*, §6.2 guarantees it never overflows.
- **Roles are default skill bundles**, but a **dynamic skill resolver** picks the active set per task/message from:
  task text/shape, role, history, the §5.AA `ModelBehaviorProfile` + prior failures (→ **vary skills to break a stuck
  task**), and the dynamics level. Extend the catalog with **`retriever`/`researcher`** (the §5.AC online-knowledge
  role the user noted is missing).
- **Coupled with model selection (§5.AB).** The dynamics level governs **both** skill dynamism and model dynamism; the
  per-role model-class cap is an extra policy. Reuse the §5.AA profile as the shared learning substrate.
- **Pragmatism (the "transitional layer" caveat):** start with a **small, hand-authored skill set + a simple relevance
  resolver**, not a learned router or a huge skill ontology. The first concrete step is the **smallest dynamic fragment**:
  make the **temporal/date block relevance-gated** (a coding task with no temporal signal doesn't get it) — the seed of
  the fragment-composition system, and it directly answers the user's token-waste critique.

## Sources
- **Agent Skills for LLMs: Architecture, Acquisition, Security** — https://arxiv.org/html/2602.12430v3
- **SkillsInjector: Dynamic Skill Context Construction for LLM Agents** — https://arxiv.org/html/2605.29794
- **SkillRouter: Skill Routing for LLM Agents at Scale** — https://arxiv.org/html/2603.22455v4
- **Optimal-Agent-Selection: State-Aware Routing** — https://arxiv.org/pdf/2511.02200 · **AgentRouter** — https://arxiv.org/pdf/2510.05445 · **EvolveRouter** — https://arxiv.org/pdf/2604.05149
- **Ares: Adaptive Reasoning Effort Selection** — https://arxiv.org/pdf/2603.07915
- **MoRAgent: Mixture-of-Roles** — https://arxiv.org/pdf/2512.21708
- **When Single-Agent with Skills Replaces Multi-Agent Systems** — https://arxiv.org/pdf/2601.04748
- **Agent Skills Are Not the Endgame — a Transitional Layer** — https://ossinsight.io/blog/agent-skills-explosion-2026
- **Autonomy spectrum / control:** taxonomy https://arxiv.org/pdf/2310.03659 · Levels of Autonomy https://www.emergentmind.com/topics/levels-of-autonomy-in-ai-agents · "Autonomy Is a Spectrum" https://medium.com/agenticais/autonomy-is-a-spectrum-88cd7f338237 · roles archetypes https://arxiv.org/pdf/2602.11924
