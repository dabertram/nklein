import { describe, expect, it } from "vitest";
import { renderToolCard, renderToolCardList, type ToolCard } from "../../../src/core/tool-card";

describe("renderToolCard", () => {
	it("renders all fields in order when all are present", () => {
		const card: ToolCard = {
			name: "read_file",
			purpose: "Read file contents",
			useWhen: "When you need to examine code before editing",
			args: "path: string",
			avoidWhen: "Avoid reading files > 100KB without pagination",
		};

		const result = renderToolCard(card);
		const lines = result.split("\n");

		expect(lines[0]).toBe("read_file");
		expect(lines[1]).toContain("Read file contents");
		expect(lines[2]).toContain("Use when: When you need to examine code before editing");
		expect(lines[3]).toContain("Args: path: string");
		expect(lines[4]).toContain("Avoid: Avoid reading files > 100KB without pagination");
		expect(lines.length).toBe(5);
	});

	it("omits args when absent", () => {
		const card: ToolCard = {
			name: "list_models",
			purpose: "List available models",
			useWhen: "When you need to check available models",
			avoidWhen: "Avoid calling repeatedly in a loop",
		};

		const result = renderToolCard(card);
		const lines = result.split("\n");

		expect(lines[0]).toBe("list_models");
		expect(lines[1]).toContain("List available models");
		expect(lines[2]).toContain("Use when");
		expect(lines[3]).toContain("Avoid");
		expect(result).not.toContain("Args:");
		expect(lines.length).toBe(4);
	});

	it("omits avoidWhen when absent", () => {
		const card: ToolCard = {
			name: "write_file",
			purpose: "Write content to a file",
			useWhen: "When you need to create or modify a file",
			args: "path: string, content: string",
		};

		const result = renderToolCard(card);
		const lines = result.split("\n");

		expect(lines[0]).toBe("write_file");
		expect(lines[1]).toContain("Write content to a file");
		expect(lines[2]).toContain("Use when");
		expect(lines[3]).toContain("Args");
		expect(result).not.toContain("Avoid:");
		expect(lines.length).toBe(4);
	});

	it("omits both optional fields when absent", () => {
		const card: ToolCard = {
			name: "status",
			purpose: "Show current status",
			useWhen: "At the start of a task",
		};

		const result = renderToolCard(card);
		const lines = result.split("\n");

		expect(lines[0]).toBe("status");
		expect(lines[1]).toContain("Show current status");
		expect(lines[2]).toContain("Use when");
		expect(result).not.toContain("Args:");
		expect(result).not.toContain("Avoid:");
		expect(lines.length).toBe(3);
	});
});

describe("renderToolCardList", () => {
	it("joins multiple cards with a blank line", () => {
		const cards: ToolCard[] = [
			{
				name: "read_file",
				purpose: "Read file contents",
				useWhen: "When you need to examine code",
			},
			{
				name: "write_file",
				purpose: "Write to a file",
				useWhen: "When you need to create files",
			},
		];

		const result = renderToolCardList(cards);
		const cardBlocks = result.split("\n\n");

		expect(cardBlocks.length).toBe(2);
		expect(cardBlocks[0]).toContain("read_file");
		expect(cardBlocks[0]).toContain("Read file contents");
		expect(cardBlocks[1]).toContain("write_file");
		expect(cardBlocks[1]).toContain("Write to a file");
	});

	it("returns empty string for empty list", () => {
		const result = renderToolCardList([]);
		expect(result).toBe("");
	});
});
