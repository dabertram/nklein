# Receipt Ingest CLI — product specification

A single-binary command-line tool that reads expense receipts out of a watched folder, normalises them, and writes
one canonical ledger file. It runs on a laptop, offline, with no service dependencies.

This document is the source of truth for the work. Every numbered obligation below is a thing the finished tool must
do; nothing outside these obligations is in scope.

## Obligations

- **OBL-01** — The CLI MUST accept `--input <dir>` and exit with code 2, printing the offending path, when the
  directory does not exist.
- **OBL-02** — The CLI MUST accept `--out <file>` and refuse to overwrite an existing file unless `--force` is
  given.
- **OBL-03** — The reader MUST discover receipt files by extension (`.json`, `.csv`) and ignore everything else in
  the watched folder, including dotfiles.
- **OBL-04** — The JSON receipt parser MUST reject a receipt with no `total` field and report the file name and the
  missing field.
- **OBL-05** — The CSV receipt parser MUST treat the first row as a header, and MUST fail on a row whose column
  count differs from the header's.
- **OBL-06** — Amounts MUST be parsed into integer minor units; a value with more than two decimal places is an
  error, not a rounding opportunity.
- **OBL-07** — Currency codes MUST be validated against ISO 4217 alphabetic codes, and a receipt in an unknown
  currency MUST be rejected by name.
- **OBL-08** — Dates MUST be normalised to `YYYY-MM-DD` in UTC; an ambiguous two-digit year MUST be rejected rather
  than guessed.
- **OBL-09** — Two receipts with the same merchant, date and amount MUST be flagged as a suspected duplicate and
  emitted once, with the duplicate count recorded.
- **OBL-10** — The ledger writer MUST emit receipts sorted by date, then merchant, then amount, so that the output
  is byte-stable across runs.
- **OBL-11** — The ledger writer MUST write atomically: a crash mid-write MUST leave either the previous file or the
  complete new one, never a truncated file.
- **OBL-12** — On exit the CLI MUST print a one-line summary — files read, receipts accepted, receipts rejected,
  duplicates collapsed — and exit non-zero if any receipt was rejected.

## Non-goals

Networked sync, OCR of scanned paper, multi-user access control, and a GUI are all out of scope.
