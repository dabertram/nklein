import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

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

/**
 * P0.10 — spawn-heavy suite headroom (2026-07-13). Contract/integration files spawn real tsx backends and CLI
 * invocations (seconds of CPU-bound compile EACH); under a saturated full-suite run (`npm run test`, all files in
 * parallel forks) the global 15s per-test timeout starves and healthy tests flake ("task done" CLI spawns,
 * zero-token-self-heal, task-command-exit — every one green in isolation). Give exactly those directories a
 * proportionate default; unit suites keep the tight 15s so genuine hangs still fail fast.
 */
const currentTestFilepath =
	((globalThis as Record<string, unknown>).__vitest_worker__ as { filepath?: string } | undefined)?.filepath ?? "";
if (/[/\\]test[/\\](contract|integration)[/\\]/.test(currentTestFilepath)) {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
}
