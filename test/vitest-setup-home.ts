import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Global test HOME isolation (2026-06-27). Every test file runs in its own forked process (vitest default pool), so a
 * per-file temp HOME guarantees all home-based runtime state — `~/.nklein` config, the model registry, the durable
 * queued-start store, and their `proper-lockfile` locks — lands in a throwaway directory, never the user's real home.
 *
 * Two benefits: (1) tests can't read/clobber real `~/.nklein` state, and (2) the suite no longer contends on the real
 * home's locks with a running `dev:full` instance — so commits work (the pre-commit suite passes) WHILE the app is up
 * for live testing. Tests that set their own temp `process.env.HOME` still override this; their `originalHome` restore
 * just returns to this isolated base instead of the real home.
 */
const isolatedHome = mkdtempSync(join(tmpdir(), "nklein-test-home-"));
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;
