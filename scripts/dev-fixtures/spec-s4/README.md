# Specification fixture — specification plus conformance suite

`input/brief.md` and `candidates/` are READ-ONLY evidence: never edit them. `candidates/conforming/` is the
oracle; `candidates/nonconforming/` breaks exactly one rule.

You have two deliverables, both of which already exist in a valid, empty form so `npm test` is green before you
start: `spec/spec.json` (the rules, pinned down) and `conformance/suite.mjs` (the suite that checks them).

- **Everything you write is checked strictly, immediately.** A rule the brief does not name, a statement that just
  copies the brief, a suite that declares a rule it never checks, a suite that imports from `candidates/`, and
  above all **a check that fails the oracle** all fail the suite.
- **Discrimination is only required once you set `"complete": true`.** At that point the suite must state every
  rule, check every rule it states, REJECT the non-conforming candidate, and reject a do-nothing implementation
  the verifier builds from the oracle's exports.
