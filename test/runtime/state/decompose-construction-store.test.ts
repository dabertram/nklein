import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearDecomposeConstruction,
	loadDecomposeConstruction,
	saveDecomposeConstruction,
} from "../../../src/state/decompose-construction-store";

describe("decompose construction store (P0.DSTALL layer 3a)", () => {
	let rootDir: string;
	beforeEach(() => {
		rootDir = mkdtempSync(join(tmpdir(), "dag-store-"));
	});
	afterEach(() => {
		rmSync(rootDir, { recursive: true, force: true });
	});

	const snapshot = {
		construction: {
			nodes: [{ id: "core-types", label: "Core types" }, { id: "clock" }],
			edges: [{ from: "core-types", to: "clock" }],
		},
		tasks: [["core-types", { id: "core-types", title: "Core types", prompt: "p", dependsOn: [] }]] as [
			string,
			unknown,
		][],
		rejectedOpCount: 2,
	};

	it("round-trips a checkpoint and clears on consume", () => {
		expect(saveDecomposeConstruction("/ws/a", "card-1", snapshot, rootDir)).toBe(true);
		const loaded = loadDecomposeConstruction("/ws/a", "card-1", rootDir);
		expect(loaded?.construction.nodes.map((node) => node.id)).toEqual(["core-types", "clock"]);
		expect(loaded?.construction.edges).toEqual([{ from: "core-types", to: "clock" }]);
		expect(loaded?.rejectedOpCount).toBe(2);
		clearDecomposeConstruction("/ws/a", "card-1", rootDir);
		expect(loadDecomposeConstruction("/ws/a", "card-1", rootDir)).toBeNull();
	});

	it("keys are isolated per (workspace, card) and the workspace path never lands on disk", () => {
		saveDecomposeConstruction("/ws/a", "card-1", snapshot, rootDir);
		expect(loadDecomposeConstruction("/ws/b", "card-1", rootDir)).toBeNull();
		expect(loadDecomposeConstruction("/ws/a", "card-2", rootDir)).toBeNull();
	});

	it("a corrupt or missing file loads as null, never throws", () => {
		expect(loadDecomposeConstruction("/ws/none", "card-x", rootDir)).toBeNull();
	});
});
