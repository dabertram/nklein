import { describe, expect, it } from "vitest";
import {
	filterChatMemoriesForRecall,
	inferSupersededMemoryIds,
	type NamespaceTaggedMemory,
	resolveMemoryNamespaceDecision,
} from "../../../src/chat/chat-memory-retrieval-policy";

function memory(input: Partial<NamespaceTaggedMemory> & Pick<NamespaceTaggedMemory, "id" | "text">) {
	return {
		sessionId: "source",
		shared: false,
		createdAt: 1,
		...input,
	};
}

describe("chat-memory retrieval policy", () => {
	it("resolves an explicitly named namespace and removes its label from the similarity query", () => {
		expect(
			resolveMemoryNamespaceDecision({
				query: "Which payment provider did Project Alpha choose?",
				namespaces: [
					{ id: "ws-alpha", label: "Alpha" },
					{ id: "ws-beta", label: "Beta" },
				],
				defaultNamespaceId: "ws-beta",
			}),
		).toEqual({
			retrievalQuery: "which payment provider did choose",
			allowedNamespaceIds: ["ws-alpha"],
			explicitMatch: true,
		});
	});

	it("falls back to the active namespace and fails closed without either signal", () => {
		const namespaces = [{ id: "ws-alpha", label: "Alpha" }];
		expect(
			resolveMemoryNamespaceDecision({
				query: "What was the deploy target?",
				namespaces,
				defaultNamespaceId: "ws-alpha",
			}).allowedNamespaceIds,
		).toEqual(["ws-alpha"]);
		expect(
			resolveMemoryNamespaceDecision({ query: "What was the deploy target?", namespaces }).allowedNamespaceIds,
		).toEqual([]);
	});

	it("infers a high-signal knowledge update but does not collapse unrelated same-project facts", () => {
		const memories = [
			memory({
				id: "old-db",
				text: "Project Gamma uses SQLite for persistence.",
				namespaceId: "ws-gamma",
				namespaceLabel: "Gamma",
				createdAt: 1,
			}),
			memory({
				id: "retry",
				text: "Project Gamma retries failed jobs three times.",
				namespaceId: "ws-gamma",
				namespaceLabel: "Gamma",
				createdAt: 2,
			}),
			memory({
				id: "new-db",
				text: "Decision update: Project Gamma migrated persistence from SQLite to Postgres.",
				namespaceId: "ws-gamma",
				namespaceLabel: "Gamma",
				createdAt: 3,
			}),
		];
		expect([...inferSupersededMemoryIds(memories)]).toEqual(["old-db"]);
	});

	it("filters private foreign namespaces and inferred stale facts before ranking", () => {
		const memories = [
			memory({ id: "old", text: "Gamma uses SQLite persistence", namespaceId: "gamma", createdAt: 1 }),
			memory({
				id: "new",
				text: "Gamma migrated persistence from SQLite to Postgres",
				namespaceId: "gamma",
				createdAt: 2,
			}),
			memory({ id: "foreign", text: "Delta secret endpoint", namespaceId: "delta", createdAt: 3 }),
		];
		const filtered = filterChatMemoriesForRecall({
			memories,
			sessionId: "driver",
			allProjects: true,
			decision: { retrievalQuery: "database", allowedNamespaceIds: ["gamma"], explicitMatch: true },
		});
		expect(filtered.map((entry) => entry.id)).toEqual(["new"]);
	});

	it("does not let an explicit supersession link cross a namespace boundary", () => {
		const memories = [
			memory({ id: "global", text: "shared safety rule", namespaceId: "global", shared: true, createdAt: 1 }),
			memory({
				id: "project-update",
				text: "updated project rule",
				namespaceId: "alpha",
				createdAt: 2,
				supersedesMemoryIds: ["global"],
			}),
		];
		expect([...inferSupersededMemoryIds(memories)]).toEqual([]);
	});
});
