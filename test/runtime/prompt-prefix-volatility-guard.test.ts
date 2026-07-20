import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * P19.1 guard: no prompt-building module may put a volatile value into prompt BYTES.
 *
 * llama.cpp reuse "stops at the first unmatched token", so a single varying byte near position 0 forfeits the
 * entire downstream context. Measured cost: prefill runs 24–36× slower per token than generation on Apple
 * Silicon, so a 32k full-miss is ~35 s on an M4 Max — roughly the wall-clock of generating 1,100 tokens, for a
 * turn that may only emit a few hundred.
 *
 * F4.40 swept the builders once and regression-locked prefix identity for the builders that existed THEN. This
 * guard covers the ones that come later: a new prompt module embedding `Date.now()` would pass every existing
 * test and quietly halve throughput. The documented real-world case is a Claude Code attribution header that
 * varied per request and sat at the prompt head, producing repeated "forcing full prompt re-processing".
 *
 * Comments are excluded — a docblock may legitimately DISCUSS the hazard (and one does).
 */

const VOLATILE = [/\bDate\.now\s*\(/, /\bnew Date\s*\(\s*\)/, /\btoISOString\s*\(/, /\bMath\.random\s*\(/];

/** Modules whose job is to BUILD prompt bytes. Timestamps here land in the model's context. */
const PROMPT_BUILDER_GLOB = "src/core/*prompt*.ts";

function codeLines(source: string): string[] {
	return source.split("\n").filter((line) => {
		const trimmed = line.trim();
		return !(trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*"));
	});
}

describe("prompt-prefix volatility guard", () => {
	it("no prompt-building module embeds a volatile value in prompt bytes", () => {
		const offenders: string[] = [];
		for (const file of globSync(PROMPT_BUILDER_GLOB)) {
			if (file.includes(".test.")) {
				continue;
			}
			const lines = codeLines(readFileSync(file, "utf8"));
			for (const [index, line] of lines.entries()) {
				for (const pattern of VOLATILE) {
					if (pattern.test(line)) {
						offenders.push(`${file}:${index + 1}: ${line.trim()}`);
					}
				}
			}
		}
		expect(
			offenders,
			`A prompt builder embedded a volatile value. A single varying byte near the prompt head forfeits the ENTIRE downstream KV cache (llama.cpp reuse stops at the first unmatched token), and prefill is 24-36x slower per token than generation — so this shows up only as unexplained slow turns. Put volatile content in the LAST user message, never the head.\n${offenders.join("\n")}`,
		).toEqual([]);
	});

	it("actually scans something (a guard that matches no files is not a guard)", () => {
		const files = globSync(PROMPT_BUILDER_GLOB).filter((file) => !file.includes(".test."));
		expect(files.length).toBeGreaterThan(3);
	});
});
