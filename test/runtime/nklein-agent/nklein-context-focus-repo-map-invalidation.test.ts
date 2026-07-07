import { describe, expect, it } from "vitest";

import {
	doesNKleinToolInvalidateRepoMap,
	REPO_MAP_INVALIDATING_TOOL_NAMES,
} from "../../../src/nklein-agent/nklein-context-focus-extension";
import type { AgentAfterToolContext } from "../../../src/nklein-agent/sdk-agent-types";

// §5.V coverage for the repo-map cache-invalidation predicate (§5.N context focus): a repo-mutating tool call must
// invalidate the cached repo map so the next beforeModel re-renders it, while reads/discovery and FAILED mutations must
// not. This predicate was previously only exercised transitively — these tests pin its exact contract.

// The predicate reads only `toolCall.toolName` and `result.isError`; the rest of AgentAfterToolContext is irrelevant.
function afterToolContext(toolName: string, isError = false): AgentAfterToolContext {
	return {
		toolCall: { toolName },
		result: { isError },
	} as unknown as AgentAfterToolContext;
}

describe("doesNKleinToolInvalidateRepoMap", () => {
	it("invalidates for every repo-mutating tool in the canonical set", () => {
		for (const toolName of REPO_MAP_INVALIDATING_TOOL_NAMES) {
			expect(doesNKleinToolInvalidateRepoMap(afterToolContext(toolName))).toBe(true);
		}
	});

	it("does not invalidate for reads, discovery, or other non-mutating tools", () => {
		for (const toolName of ["read_files", "read_large_file", "list_files", "find_files", "search", "get_file_size"]) {
			expect(doesNKleinToolInvalidateRepoMap(afterToolContext(toolName))).toBe(false);
		}
	});

	it("normalizes tool names by trimming and lower-casing before matching", () => {
		expect(doesNKleinToolInvalidateRepoMap(afterToolContext("  WRITE_FILE  "))).toBe(true);
		expect(doesNKleinToolInvalidateRepoMap(afterToolContext("Edit_File"))).toBe(true);
		expect(doesNKleinToolInvalidateRepoMap(afterToolContext("BASH"))).toBe(true);
	});

	it("does not invalidate when the mutating tool call failed (errored result)", () => {
		// A write that errored changed nothing on disk, so the cached repo map is still valid.
		expect(doesNKleinToolInvalidateRepoMap(afterToolContext("write_file", true))).toBe(false);
		expect(doesNKleinToolInvalidateRepoMap(afterToolContext("edit_file", true))).toBe(false);
	});

	it("keeps the canonical set aligned with the mutating tools it must cover", () => {
		// Guard against an accidental drift of the set: the core write/exec tools must stay in, reads must stay out.
		for (const mutating of ["write_file", "write_files", "edit_file", "apply_patch", "bash", "execute_command"]) {
			expect(REPO_MAP_INVALIDATING_TOOL_NAMES.has(mutating)).toBe(true);
		}
		for (const nonMutating of ["read_files", "read_large_file", "list_files"]) {
			expect(REPO_MAP_INVALIDATING_TOOL_NAMES.has(nonMutating)).toBe(false);
		}
	});
});
