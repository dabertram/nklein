# Dev-test project specification — deep enhancement guidelines (for the research agents)

You are an **Opus max-reasoning research agent**. Your job: take a small batch of these dev-test-project specs and **deeply extend each one** so that it becomes a rich, authentic, ambitious-yet-buildable, *deterministically testable* master-grade specification — one that it is **a genuine pleasure to watch a swarm of small-local-LLM !Klein agents decompose and build**, and where good spec + good instructions let them **deliver great output**.

This is not a copy-edit. Use **rich, repeated online research** and **long, careful reasoning**. Spend the budget. The reference quality bar is the **`36_dark_factory_dschinn_universal_agent/specification.md` → "Extended scope & deep-reasoning extensions (v2)"** section — read it first; match or exceed that depth and rigor for your domains.

## Process for EACH project in your batch

1. **Read carefully:** the project's `specification.md` and `user-prompt.txt`, end to end.
2. **Research deeply online (multiple passes — this is the point):** use web search + page fetches repeatedly to ground the spec in reality. Research, as relevant to the domain:
   - The **real standards, regulations, and protocols** the domain actually uses (e.g. HL7/FHIR, DICOM, HIPAA; ISA-95/MES, SEMI; double-entry accounting + banking regs; HACCP/FSMA; NIMS/ICS; IMO/COLREGS; A-CDM; GHG Protocol; lockstep/rollback netcode; Raft/Paxos + stream processing; capability-based microkernels; etc.).
   - The **canonical data models, domain entities, state machines, and invariants** practitioners expect.
   - **Real-world failure modes, edge cases, and adversarial situations** in that domain.
   - **State-of-the-art tools, architectures, and (where it exists) credible benchmarks** — and where public benchmarks do or don't predict the real workload.
   - Do **2–4+ research passes per project**, refining queries as you learn. Capture **source URLs** to cite.
3. **Reason long and hard** about the *hardest architecture seams* — the parts that make this genuinely difficult and interesting, not the CRUD.
4. **Append** a new section to that project's `specification.md` (append only — preserve everything already there):

```
---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. <one-sentence thesis: the single hardest, most-defining property of THIS project>.
```

Then write the extension. It MUST include, **tailored to the specific domain** (no generic filler):

- **Research-grounded domain authenticity.** Fold in the real standards/protocols/data-models/regulations you researched, with **cited source URLs** (match how `36`'s base spec cites). Make a domain expert nod.
- **The hardest technical seams**, named and explained — the load-bearing architecture decisions, the tricky state machines, the concurrency/consistency/determinism problems, the things that will make or break the build.
- **A determinism & testability strategy.** The acceptance command must stay green **without** live external dependencies. Specify **deterministic fixture adapters** for every external system, a virtual clock / seeded entropy where time or randomness matters, and event-sourced or snapshot-able state where long-running or stateful. Acceptance must be reproducible.
- **Adversarial, failure, and edge-case scenarios** as concrete, testable situations (like `36`'s "Required challenge scenarios" + adversarial fixture pack) — the things that separate a real system from a demo.
- **Rigorous acceptance criteria, including property-based / invariant tests** (conservation laws, monotonicity, idempotency, totality of audit, safety ratchets — whatever the domain's true invariants are), not just example-based tests.
- **A concrete first vertical slice (the on-ramp):** the ~30–60 cards that prove the hardest seams end-to-end before breadth. Be specific about which seams and why.
- **Domain knowledge-debt to track:** the genuine unknowns / expert-review-needed items (licensing, legal, safety, regulatory, ethical, economic) the building agents should surface rather than bluff past.
- **Why this is a great !Klein challenge:** a short note on what capability it stresses (decomposition, determinism under weak models, long-running state, multi-agent coordination, governance, etc.).

## Quality bar & constraints

- **Match or exceed `36`'s v2 depth.** High signal, authentic, specific. Ambitious but **buildable as release-quality vertical slices**, not broad placeholder.
- **Deterministically testable is non-negotiable.** No spec may require live LLM calls, live network, real payments, wall-clock randomness, or real external services for its acceptance command. Live integrations are production adapters behind deterministic fixtures.
- **Append only** to your assigned projects' `specification.md`. Do **NOT** edit `user-prompt.txt`, other projects, this guidelines file, or anything in the !Klein git repo. Your batch's folders are disjoint from every other agent's — there is no merge collision.
- **Cite your research** (URLs inline where a requirement is grounded in a source).
- **Keep the existing acceptance command** (usually `npm test`) and match the existing spec's tone/structure.
- Write so an **agent swarm can decompose it cleanly**: clear dependency-ordered build guidance, explicit entities + invariants + acceptance, so the work is legible and the output is great.

When done with your batch, report: for each project — the key research sources you used, the 3–5 most important extensions you added, and confirm the append-only constraint was honored.
