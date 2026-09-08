# Analysis fixture — incident log forensics

`input/incident.jsonl` is the evidence. It is READ-ONLY: never edit it.

Your deliverable is `analysis/timeline.json`. It already exists in a valid, empty form, so `npm test` is green
before you start. The verifier in `test/` re-reads the log on every run:

- **Every event you record is checked strictly, immediately.** A line that plays none of the three roles, a line
  recorded under the wrong role, a duplicate, an out-of-order entry, or a root cause the rubric does not select
  fails the suite. There is no credit for guessing.
- **Coverage is only required once you set `"complete": true`.** At that point the whole chain must be present and
  the root cause named, and the failure message says what is missing.
