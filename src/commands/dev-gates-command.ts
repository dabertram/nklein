/**
 * `nklein dev gates` — which planned changes are SAFE to make yet?
 *
 * Some backlog items carry an executable precondition: a check that says "doing this today would break
 * something". Those checks are worth more before the work than after it, and they are worthless if nobody can
 * run them — which is what they were, sitting in cores with no consumer.
 *
 *  - **F3.8** (adopt the retry engine on chat): `auditChatLadderAdoption` reports whether the engine's ladders
 *    cover what chat's live-tuned inline ladder already does. Today they do not, so adopting would REGRESS.
 *  - **F4.8** (end-of-context re-anchors): `auditReanchorPaths` reports which of the four required elements
 *    actually reach a live prompt. Today two do.
 *
 * ── WHY THESE TWO BELONG TOGETHER ──
 * Both answer the same question at the same moment: *an item says "wire X" — is that actually a wire yet, or is
 * it still a rewrite that would lose something?* Both are the kind of check that gets skipped precisely because
 * running it requires knowing it exists. A named command is the difference.
 *
 * Both are expected to FAIL today, and the command exits non-zero when they do. That is the honest state, not a
 * defect: each gate is pinned by a test asserting it currently blocks, and the day a gate passes is the signal
 * that its item became a wire.
 */

import { auditReanchorPaths, OBSERVED_REANCHOR_PATHS } from "../core/reanchor-coverage";
import { auditChatLadderAdoption } from "../core/retry-ladder-divergence";

export async function runDevGatesCommand(options: { json?: boolean }): Promise<void> {
	const retryLadder = auditChatLadderAdoption();
	const reanchor = auditReanchorPaths(OBSERVED_REANCHOR_PATHS);

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ retryLadder, reanchor }, null, 2)}\n`);
		if (!retryLadder.safeToAdopt || !reanchor.passed) {
			process.exitCode = 1;
		}
		return;
	}

	process.stdout.write(`F3.8 — adopt the retry engine on chat: ${retryLadder.safeToAdopt ? "SAFE" : "BLOCKED"}\n`);
	process.stdout.write(`  ${retryLadder.summary}\n\n`);

	process.stdout.write(`F4.8 — end-of-context re-anchors: ${reanchor.passed ? "COMPLETE" : "INCOMPLETE"}\n`);
	process.stdout.write(`  ${reanchor.summary}\n`);
	process.stdout.write(`  reaching a live prompt: ${reanchor.liveElements.join(", ") || "(none)"}\n\n`);

	if (!retryLadder.safeToAdopt || !reanchor.passed) {
		process.stdout.write(
			"A BLOCKED gate is not a defect — it is the precondition doing its job. Each is pinned by a test that\n" +
				"asserts it currently blocks, so the day a gate passes is the signal its item became a wire rather than\n" +
				"a rewrite that would lose something.\n",
		);
		process.exitCode = 1;
	}
}
