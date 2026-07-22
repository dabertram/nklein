import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SCRIPT = "scripts/real-model-run.sh";

describe("real-model run controller safety", () => {
	it("remains valid shell and handles help before any run-directory mutation", () => {
		execFileSync("bash", ["-n", SCRIPT]);
		const source = readFileSync(SCRIPT, "utf8");
		expect(source.indexOf("-h|--help)")).toBeGreaterThan(-1);
		expect(source.indexOf("-h|--help)")).toBeLessThan(source.indexOf('mkdir -p "$RUN_DIR"'));
		expect(source.indexOf('if [ "$CHECK_ONLY" = 1 ]')).toBeLessThan(source.indexOf('mkdir -p "$RUN_DIR"'));
		const checked = execFileSync(
			"bash",
			[SCRIPT, "--eval-harness", "--worker", "ternary-bonsai-27b-mlx", "--check-config"],
			{ encoding: "utf8" },
		);
		expect(checked).toContain("kind=eval");
		expect(checked).toContain("fleet=[ternary-bonsai-27b-mlx]");
		const cacheChecked = execFileSync(
			"bash",
			[SCRIPT, "--cache-probe", "--worker", "qwen/qwen2.5-coder-14b", "--check-config"],
			{ encoding: "utf8" },
		);
		expect(cacheChecked).toContain("kind=cache");
		expect(cacheChecked).toContain("fleet=[qwen/qwen2.5-coder-14b]");
		const nullChecked = execFileSync("bash", [SCRIPT, "mid_task", "--null-agent", "--check-config"], {
			encoding: "utf8",
		});
		expect(nullChecked).toContain("kind=dev-test");
		expect(nullChecked).toContain("nullAgent=1");
		const fleetChecked = execFileSync(
			"bash",
			[SCRIPT, "wide_fanout", "--fleet-swarm", "--worker", "qwen/qwen2.5-coder-14b", "--check-config"],
			{ encoding: "utf8" },
		);
		expect(fleetChecked).toContain("kind=fleet");
		expect(fleetChecked).toContain("preset=wide_fanout");
	});

	it("routes every fleet admission through the guarded retained-set command", () => {
		const source = readFileSync(SCRIPT, "utf8");
		expect(source).toContain('npx tsx scripts/model-lab.mts admit "$m" "$CTX"');
		expect(source).not.toMatch(/\blms load\b/u);
		expect(source).toMatch(/MAX_RESIDENTS="\$\{NKLEIN_LOAD_MAX_RESIDENTS:-3\}"/u);
		expect(source).not.toContain("google/gemma-4-31b-qat");
	});

	it("keeps teardown warm by default and exposes monitored eval and cache paths", () => {
		const source = readFileSync(SCRIPT, "utf8");
		expect(source).toContain('if [ "$UNLOAD" = 1 ]');
		expect(source).toContain("--eval-harness");
		expect(source).toContain("npx tsx scripts/eval-harness.mts");
		expect(source).toContain("--cache-probe");
		expect(source).toContain("npx tsx scripts/verify-cache-health-live.mts");
		expect(source).toContain("--fleet-swarm");
		expect(source).toContain("npx tsx scripts/verify-fleet-swarm.mts");
		expect(source).toContain("--null-agent");
		expect(source).toContain('DRAIN_OUTCOME="null_agent_rejected"');
		expect(source).toContain('DRAIN_OUTCOME="null_agent_forged"');
		expect(source).toContain('if [ "$RUN_KIND" = eval ]; then');
		expect(source).toContain('elif [ "$RUN_KIND" = cache ]; then');
	});

	it("debounces transient cross-host resident snapshot omissions", () => {
		const source = readFileSync(SCRIPT, "utf8");
		expect(source).toContain('WORKER_MISSING_POLLS="${NKLEIN_WORKER_MISSING_POLLS:-2}"');
		expect(source).toContain("WORKER_MISS_COUNT=$((WORKER_MISS_COUNT + 1))");
		expect(source).toContain('if [ "$WORKER_MISS_COUNT" -ge "$WORKER_MISSING_POLLS" ]');
		expect(source.indexOf("WORKER_MISS_COUNT=$((WORKER_MISS_COUNT + 1))")).toBeLessThan(
			source.indexOf('ABORT_REASON="worker_unloaded"'),
		);
	});

	it("does not treat repetitive scheduler bookkeeping as semantic run progress", () => {
		const source = readFileSync(SCRIPT, "utf8");
		expect(source).toContain("drain_semantic_signature()");
		expect(source).toContain("Board-liveness watchdog:");
		expect(source).toContain("Auto-start of .* (");
		expect(source).toContain("queued behind a busy endpoint");
		expect(source).toContain("hit the concurrency limit; deferred for retry on the next completion");
		expect(source).toContain("Model turn for .* is waiting for capacity");
		expect(source).toContain("drain-semantic=${DRAIN_SEMANTIC_SIG:-0 0}");
		expect(source).not.toContain('CURSIG="$SIG|$TOOLS|devlog=${DEVLOG_BYTES:-0}|drain=${DRAIN_BYTES:-0}"');
	});
});
