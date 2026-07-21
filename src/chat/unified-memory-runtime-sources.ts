import { basename, join } from "node:path";
import {
	type BasicMemoryRecallSource,
	nodeBasicMemoryFsDeps,
	readBasicMemoryRecallSources,
} from "../core/basic-memory-note-reader.js";
import { hashWorkspacePathForLedger } from "../nklein-agent/nklein-ledger-attempt.js";
import { listWorkspaceIndexEntries, type RuntimeWorkspaceIndexEntry } from "../state/workspace-state.js";
import { type ChatMemory, enrichChatMemoryNamespaces, readChatMemories } from "./chat-memory-store.js";
import { listChatSessions } from "./chat-session-store.js";

export interface UnifiedMemoryRuntimeSources {
	chatMemories: ChatMemory[];
	basicMemorySources: BasicMemoryRecallSource[];
	namespaceHints: Array<{ id: string; label: string; aliases: string[] }>;
	workspaceIdByLedgerHash: ReadonlyMap<string, string>;
}

export interface UnifiedMemoryRuntimeSourceDeps {
	readChatMemories(): Promise<ChatMemory[]>;
	listChatSessions(): ReturnType<typeof listChatSessions>;
	listWorkspaceEntries(): Promise<RuntimeWorkspaceIndexEntry[]>;
	readBasicMemorySources(root: string): Promise<BasicMemoryRecallSource[]>;
}

const defaultDeps: UnifiedMemoryRuntimeSourceDeps = {
	readChatMemories,
	listChatSessions,
	listWorkspaceEntries: listWorkspaceIndexEntries,
	readBasicMemorySources: (root) => readBasicMemoryRecallSources(root, nodeBasicMemoryFsDeps()),
};

/**
 * Gather and namespace every effectful source consumed by the unified composer. Keeping this out of runtime-api makes
 * the ownership boundary explicit and independently testable: product runtime roots only, registered workspace labels,
 * global Basic Memory deliberately shared, and legacy chat rows enriched from their authoring sessions.
 */
export async function loadUnifiedMemoryRuntimeSources(
	input: {
		runtimeHome: string;
		activeWorkspaceId: string | null;
		activeWorkspacePath: string | null;
		accessAllProjects: boolean;
	},
	deps: UnifiedMemoryRuntimeSourceDeps = defaultDeps,
): Promise<UnifiedMemoryRuntimeSources> {
	const [rawMemories, chatSessions, workspaceEntries] = await Promise.all([
		deps.readChatMemories(),
		deps.listChatSessions(),
		deps.listWorkspaceEntries().catch(() => []),
	]);
	const chatMemories = enrichChatMemoryNamespaces(rawMemories, chatSessions);
	const namespaceHints = workspaceEntries.map((entry) => ({
		id: entry.workspaceId,
		label: entry.displayName ?? basename(entry.repoPath),
		aliases: [...new Set([basename(entry.repoPath), entry.workspaceId])],
	}));
	const selectedWorkspaceEntries = input.accessAllProjects
		? workspaceEntries
		: workspaceEntries.filter(
				(entry) => entry.workspaceId === input.activeWorkspaceId || entry.repoPath === input.activeWorkspacePath,
			);
	const activeWorkspaceHash = input.activeWorkspacePath ? hashWorkspacePathForLedger(input.activeWorkspacePath) : null;
	const scopes = [
		...selectedWorkspaceEntries.map((entry) => ({
			root: join(input.runtimeHome, "basic-memory", hashWorkspacePathForLedger(entry.repoPath), "notes"),
			namespaceId: entry.workspaceId,
			namespaceLabel: entry.displayName ?? basename(entry.repoPath),
			shared: false,
		})),
		...(selectedWorkspaceEntries.length === 0 && activeWorkspaceHash && input.activeWorkspaceId
			? [
					{
						root: join(input.runtimeHome, "basic-memory", activeWorkspaceHash, "notes"),
						namespaceId: input.activeWorkspaceId,
						namespaceLabel: input.activeWorkspacePath
							? basename(input.activeWorkspacePath)
							: input.activeWorkspaceId,
						shared: false,
					},
				]
			: []),
		{
			root: join(input.runtimeHome, "basic-memory", "global", "notes"),
			namespaceId: "global",
			namespaceLabel: "Global",
			shared: true,
		},
	];
	const basicMemorySources = (
		await Promise.all(
			scopes.map(async (scope) =>
				(
					await deps.readBasicMemorySources(scope.root).catch(() => [])
				).map((source) => ({
					...source,
					namespaceId: scope.namespaceId,
					namespaceLabel: scope.namespaceLabel,
					shared: scope.shared,
				})),
			),
		)
	).flat();
	return {
		chatMemories,
		basicMemorySources,
		namespaceHints,
		workspaceIdByLedgerHash: new Map(
			workspaceEntries.map((entry) => [hashWorkspacePathForLedger(entry.repoPath), entry.workspaceId]),
		),
	};
}
