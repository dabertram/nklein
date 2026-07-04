# Autonomous run — started 2026-07-04

Standing goal (David): work the whole backlog autonomously for 2+ days; decide anything that
won't cause major reworks later; don't wait for greenlighting; don't stop; load/unload LLMs as
needed without overloading the 3 fleet machines; collect anything that genuinely needs David's
guidance here for a clarify-when-back session.

**Operating rules I'm holding myself to**
- Every commit GREEN (tsc + biome + `npm run test:fast`).
- Behavior-changing work is **flag-gated / additive with a byte-identical default** → zero rework risk.
- Hot paths (security / scheduler / model-call) get an adversarial-verify workflow before commit.
- Prefer wiring built-but-dark cores; verify ripeness (data exists at the seam) before building.
- Fleet: check `lms ps` before loading; unload before loading to stay within RAM; restore baseline.

---

## NEEDS-GUIDANCE queue (clarify when back)

These are genuine forks / product decisions where guessing risks rework — I did NOT build these,
to avoid locking in a direction you'd want to choose:

1. **§5.L swarm-path capability broker** — the CHAT-path broker is live (opt-in). The SWARM (agent
   task) tool seam is different: it has a *real* requested manifest + egress requests, so the
   broker's escalation + egress gates become live (not no-ops). Wiring it well needs a decision on
   *what a tool call's requested manifest is* on the SDK tool path (per-tool declared vs. derived) —
   a modeling choice that, if guessed wrong, would rework the broker inputs. **Q: is per-tool static
   manifest acceptable for v1, or do you want per-call requested caps?**
2. **§5.L egress-read manifest** — today `browse_url` is `host_command`, so after one browse the
   turn is tainted and further host actions (incl. another browse) are refused. A distinct
   "egress-read" action kind would let benign multi-page browsing through without laundering the
   write/exec sinks — but that's a change to the capability *model* (a new ChatActionKind + manifest
   mapping). **Q: add an egress-read action kind, or keep the strict single-browse-per-turn v1?**
3. **Default-on flips** — several opt-in flags are proven + could default ON (e.g.
   `NKLEIN_CHAT_ADAPTIVE_TRUNCATION`, `DURABLE_DEPTH_PRIORITY`, retrieval synthesis). I'm leaving
   them opt-in (no rework risk). **Q: which, if any, should ship default-on?**
4. **Capability-broker default** — `capabilityBrokerEnabled` is off by default (opt-in). It's a real
   prompt-injection defense; should it default ON once the swarm seam is also covered? (Strictness:
   the single-browse-per-turn behavior above.)

(Appended as I hit more forks.)

---

## Work log (newest first)

- **§5.AC extract-into-synthesis** — `buildSynthesisPrompt` now narrows LONG evidence to
  query-relevant spans via the tested-but-dark `extractRelevantSpans` (lights it up) instead of an
  arbitrary head slice; short evidence + no-match fall back unchanged. +1 test. GREEN.
- _(run start)_ — §5.L capability broker (chat path) + §5.AC synthesis shipped + validated in the
  prior session (23 commits). Starting the autonomous backlog grind from here.
