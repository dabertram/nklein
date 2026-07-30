import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createSimulatorServer, type ScenarioScript } from "../../packages/llm-simulator/src/index";
import { buildContextIntegrityCases } from "../../src/core/context-integrity-experiment";

const execFileAsync = promisify(execFile);

describe("context-integrity eval harness", () => {
	it("runs all paired arms through the real CLI and preserves unresolved results", async () => {
		const script: ScenarioScript = {
			name: "context-integrity",
			seed: 19,
			tracks: buildContextIntegrityCases().map((case_) => ({
				id: case_.id,
				requestClass: "any",
				userMessageIncludes: case_.question.slice(0, 60),
				turns: [{ behavior: { kind: "text", content: case_.expectedFragments.join(" | ") } }],
				repeatLastTurn: true,
			})),
		};
		const simulator = createSimulatorServer(script, {
			models: [{ id: "sim/context-integrity", state: "loaded", family: "qwen", maxContextLength: 65_536 }],
		});
		await simulator.start();
		try {
			const first = await execFileAsync("npx", ["tsx", "scripts/eval-harness.mts"], {
				cwd: process.cwd(),
				timeout: 30_000,
				env: {
					...process.env,
					NKLEIN_VERIFY_MODEL: "sim/context-integrity",
					NKLEIN_VERIFY_BASE_URL: simulator.url(),
					NKLEIN_EVAL_EXPERIMENT: "context-integrity",
				},
			});
			expect(first.stdout).toContain("result: context-integrity tasks=20 observations=120 infra=0.000");
			expect(first.stdout).toContain("format=unresolved");
			const second = await execFileAsync("npx", ["tsx", "scripts/eval-harness.mts"], {
				cwd: process.cwd(),
				timeout: 30_000,
				env: {
					...process.env,
					NKLEIN_VERIFY_MODEL: "sim/context-integrity",
					NKLEIN_VERIFY_BASE_URL: simulator.url(),
					NKLEIN_EVAL_EXPERIMENT: "context-integrity",
					NKLEIN_EVAL_RESUME_PATH: "/dev/null",
				},
			});
			expect(second.stdout).toContain("resumed 0 context-integrity observation(s)");
			const formats = await execFileAsync("npx", ["tsx", "scripts/eval-harness.mts"], {
				cwd: process.cwd(),
				timeout: 30_000,
				env: {
					...process.env,
					NKLEIN_VERIFY_MODEL: "sim/context-integrity",
					NKLEIN_VERIFY_BASE_URL: simulator.url(),
					NKLEIN_EVAL_EXPERIMENT: "context-integrity",
					NKLEIN_CONTEXT_INTEGRITY_ARMS: "narrative,fact_list,shuffled_facts",
				},
			});
			expect(formats.stdout).toContain("observations=60");
		} finally {
			await simulator.stop();
		}
		// Generous on purpose. This test SPAWNS THE REAL CLI, so its wall time tracks machine load, not the
		// behaviour under test — and it timed out twice on 2026-07-30 at the 15s default purely because a
		// real-model campaign was saturating the box (it passed in isolation both times). A timing gate that
		// false-trips under load trains people to ignore the suite, and the standing project rule for exactly
		// this shape is a MORE generous timeout rather than a faster test. The assertions below are about
		// content, not speed; nothing here regresses if it takes longer.
	}, 120_000);
});
