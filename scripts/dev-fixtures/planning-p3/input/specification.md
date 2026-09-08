# Encrypted Backup and Restore — tool specification

A laptop backup tool: chunk a directory tree, encrypt the chunks, write them to a local or removable store, and
restore them provably. It ships with the operational paperwork an auditor asks for.

Every obligation below names the module or document its implementation belongs in, written `[module: <path>]`.
Some obligations are discharged by writing prose rather than code; those are marked `(documentation-only)`. The
distinction is load-bearing: a documentation obligation has nothing a test runner can assert about it.

## Obligations

- **OBL-01** — A snapshot MUST record every regular file's path, size, mode and modification time, and MUST skip
  sockets, fifos and device nodes without failing the run. [module: src/backup/snapshot.js]
- **OBL-02** — A snapshot MUST detect a file that changed while it was being read and re-read it, up to a bounded
  number of attempts, before failing that path. [module: src/backup/snapshot.js]
- **OBL-03** — Chunking MUST be content-defined so that inserting a byte near the start of a large file re-uploads
  only the chunks around the insertion. [module: src/backup/chunker.js]
- **OBL-04** — Chunk boundaries MUST be reproducible: the same bytes MUST chunk identically on every machine and
  every run. [module: src/backup/chunker.js]
- **OBL-05** — Each chunk MUST be encrypted with a key derived from the passphrase and a per-repository salt, never
  from the passphrase alone. [module: src/backup/encrypt.js]
- **OBL-06** — Encryption MUST be authenticated: a chunk whose ciphertext or header was altered MUST fail to
  decrypt rather than yield wrong plaintext. [module: src/backup/encrypt.js]
- **OBL-07** — The chunk store MUST be content-addressed, and writing a chunk that already exists MUST be a no-op
  rather than a rewrite. [module: src/backup/store.js]
- **OBL-08** — The store MUST survive an interrupted write: a partially written chunk MUST be invisible to readers
  and reclaimable on the next run. [module: src/backup/store.js]
- **OBL-09** — Restore MUST verify every chunk against its content address before use, and MUST name the first
  chunk that fails. [module: src/restore/verify.js]
- **OBL-10** — A dry-run restore MUST report exactly which files it would write, which it would skip, and why,
  without touching the filesystem. [module: src/restore/verify.js]
- **OBL-11** — Restore MUST refuse to overwrite an existing file unless told to, and MUST restore modes and
  modification times it recorded. [module: src/restore/apply.js]
- **OBL-12** — An interrupted restore MUST be resumable: rerunning it MUST complete the remaining files without
  redoing the finished ones. [module: src/restore/apply.js]
- **OBL-13** — The scheduler MUST support an hourly, daily and weekly cadence, and MUST skip a run rather than
  stack two overlapping backups. [module: src/cli/schedule.js]
- **OBL-14** — The restore drill MUST be documented as a numbered procedure an operator can follow under pressure,
  including how to verify the result. (documentation-only) [module: docs/runbook-restore.md]
- **OBL-15** — The retention policy MUST be written down: how long each cadence is kept, what prunes it, and who
  approves an exception. (documentation-only) [module: docs/retention-policy.md]
- **OBL-16** — The threat model MUST state what the tool protects against, what it explicitly does not, and where
  the passphrase is trusted. (documentation-only) [module: docs/threat-model.md]
- **OBL-17** — The status report MUST show last successful backup, store size, chunk count and the age of the
  oldest unverified chunk. [module: src/report/status.js]
- **OBL-18** — The operator guide MUST document every exit code the tool can return and the action each one calls
  for. (documentation-only) [module: docs/operator-guide.md]

## Non-goals

Cloud storage backends, multi-machine deduplication, a GUI and continuous replication are all out of scope.
