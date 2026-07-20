/**
 * `nklein dev spec-review` — run the spec-first pipeline (F12.8 + F12.9) on a real spec, deterministically.
 *
 * The EARS renderer and the clarification sequencer shipped as pure cores with NO consumer, waiting on the F11.1
 * guided initializer, which is unbuilt and plan-coupled. That waiting made them orphans — the exact
 * built-but-unwired shape this session opened by auditing. This command is a real consumer that needs no model
 * and no initializer: it lints a spec, sequences the next clarifying question, and renders acceptance criteria in
 * EARS. When F11.1 lands it runs the same cores; until then this is where they earn their place and stay tested
 * against real input.
 */

import { readFile } from "node:fs/promises";
import type { ClarificationTopic, EarsCriterionInput } from "../core/ears-acceptance-criteria";
import { renderEarsCriterion } from "../core/ears-acceptance-criteria";
import { reviewSpec } from "../core/spec-review-pipeline";

const TOPICS: readonly ClarificationTopic[] = ["problem", "core_actions", "out_of_scope", "success_criteria"];

function parseAnswered(value: string | undefined): ClarificationTopic[] {
	if (!value) {
		return [];
	}
	return value
		.split(",")
		.map((token) => token.trim())
		.filter((token): token is ClarificationTopic => (TOPICS as readonly string[]).includes(token));
}

export async function runDevSpecReviewCommand(options: {
	spec?: string;
	answered?: string;
	criteria?: string;
	json?: boolean;
}): Promise<void> {
	// EARS rendering: one JSON `EarsCriterionInput` per line. JSON, not a prose micro-syntax, because the pattern
	// is DERIVED from which fields are present — a fuzzy parser would mislabel the very thing the core exists to
	// get right.
	if (options.criteria) {
		const text = await readFile(options.criteria, "utf8").catch(() => null);
		if (text === null) {
			process.stdout.write(`Could not read ${options.criteria}.\n`);
			process.exitCode = 1;
			return;
		}
		const rendered = text
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.map((line, index) => {
				try {
					return renderEarsCriterion(JSON.parse(line) as EarsCriterionInput);
				} catch {
					return {
						pattern: "ubiquitous" as const,
						text: `⚠️ line ${index + 1}: not valid criterion JSON — skipped`,
					};
				}
			});
		if (options.json) {
			process.stdout.write(`${JSON.stringify(rendered, null, 2)}\n`);
			return;
		}
		process.stdout.write("EARS ACCEPTANCE CRITERIA\n\n");
		for (const criterion of rendered) {
			process.stdout.write(`[${criterion.pattern}] ${criterion.text}\n`);
		}
		return;
	}

	if (!options.spec) {
		process.stdout.write(
			"usage: dev spec-review --spec <file> [--answered problem,core_actions,...]\n" +
				"       dev spec-review --criteria <file>   (one EarsCriterionInput JSON per line)\n",
		);
		process.exitCode = 2;
		return;
	}

	const spec = await readFile(options.spec, "utf8").catch(() => null);
	if (spec === null) {
		process.stdout.write(`Could not read ${options.spec}.\n`);
		process.exitCode = 1;
		return;
	}

	const review = reviewSpec({ spec, callerAnswered: parseAnswered(options.answered) });

	if (options.json) {
		process.stdout.write(`${JSON.stringify(review, null, 2)}\n`);
		return;
	}

	process.stdout.write("SPEC REVIEW (F12.8 + F12.9)\n\n");
	if (review.lintFindings.length > 0) {
		process.stdout.write("Lint gaps:\n");
		for (const finding of review.lintFindings) {
			process.stdout.write(`  [${finding.kind}] ${finding.question}\n`);
		}
		process.stdout.write("\n");
	}
	process.stdout.write(`${review.summary}\n\n`);
	if (review.next) {
		process.stdout.write(`NEXT QUESTION (ask this one, alone): ${review.next.question}\n`);
	} else {
		process.stdout.write("No clarifying questions open — the spec is ready to decompose.\n");
	}
}
