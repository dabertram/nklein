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
	});
});
