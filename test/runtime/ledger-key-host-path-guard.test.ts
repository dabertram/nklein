import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: a ledger KEY must hash the HOST workspace path, never the agent-perceived (sandbox) cwd.
 *
 * Live-found 2026-07-20: `nklein-session-runtime.ts` hashed `agentPerceivedCwd` for a retrieval ledger event,
 * writing it under `/workspaces/<taskId>` — a key no reader ever computes, since every `readAgentLedger` caller
 * derives its hash from a host path. Result: ZERO retrieval events across all 76 workspace hashes in the live
 * ledger, with no error anywhere.
 *
 * This is the second time the sandbox-vs-host distinction has bitten this codebase (the first left the repo map
 * silently empty under isolation, per the context-focus extension's docblock), which is why it gets a guard
 * rather than a comment. Written in the same style as the existing no-wallclock guard.
 */

const SANDBOX_PATH_IDENTIFIERS = ["agentPerceivedCwd", "sandboxCwd", "agentCwd"];

function collectSources(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules" || entry.startsWith(".")) {
			continue;
		}
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			collectSources(path, out);
		} else if (path.endsWith(".ts") && !path.includes(".test.")) {
			out.push(path);
		}
	}
	return out;
}

describe("ledger key must be host-scoped", () => {
	it("never hashes an agent-perceived (sandbox) path into a ledger key", () => {
		const offenders: string[] = [];
		for (const file of collectSources("src")) {
			const source = readFileSync(file, "utf8");
			for (const identifier of SANDBOX_PATH_IDENTIFIERS) {
				// Match `hashWorkspacePathForLedger(<sandbox identifier>)` allowing whitespace.
				const pattern = new RegExp(`hashWorkspacePathForLedger\\s*\\(\\s*${identifier}\\b`);
				if (pattern.test(source)) {
					offenders.push(`${file}: hashWorkspacePathForLedger(${identifier})`);
				}
			}
		}
		expect(
			offenders,
			`A ledger key hashed a SANDBOX path. Every readAgentLedger caller derives its hash from a HOST path, so these events are written under a key nothing reads — silently, with no error. Use the host workspace root instead.\n${offenders.join("\n")}`,
		).toEqual([]);
	});
});
