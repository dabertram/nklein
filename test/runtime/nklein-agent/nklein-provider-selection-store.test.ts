import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getKanbanProviderSelectionPath,
	readKanbanSelectedProviderId,
	writeKanbanSelectedProviderId,
} from "../../../src/nklein-agent/nklein-provider-selection-store";

const ENV_KEY = "KANBAN_NKLEIN_PROVIDER_SELECTION_PATH";
let tempDir: string;
let selectionPath: string;
const savedEnv = process.env[ENV_KEY];

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "nklein-selection-"));
	selectionPath = join(tempDir, "nested", "selection.json");
	process.env[ENV_KEY] = selectionPath;
});

afterEach(() => {
	if (savedEnv === undefined) {
		delete process.env[ENV_KEY];
	} else {
		process.env[ENV_KEY] = savedEnv;
	}
	rmSync(tempDir, { recursive: true, force: true });
});

describe("getKanbanProviderSelectionPath (§5.U extraction)", () => {
	it("honors the env override verbatim (trimmed)", () => {
		process.env[ENV_KEY] = `  ${selectionPath}  `;
		expect(getKanbanProviderSelectionPath()).toBe(selectionPath);
	});
});

describe("write/readKanbanSelectedProviderId (§5.U extraction)", () => {
	it("round-trips a written provider id, creating parent dirs", () => {
		writeKanbanSelectedProviderId("lmstudio");
		expect(readKanbanSelectedProviderId()).toBe("lmstudio");
	});

	it("normalizes the read id to trimmed lowercase", () => {
		writeKanbanSelectedProviderId("seed");
		writeFileSync(selectionPath, JSON.stringify({ providerId: "  LMStudio  " }), "utf8");
		expect(readKanbanSelectedProviderId()).toBe("lmstudio");
	});

	it("returns null when the file is missing", () => {
		expect(readKanbanSelectedProviderId()).toBeNull();
	});

	it("returns null on malformed JSON", () => {
		writeKanbanSelectedProviderId("seed"); // creates the dir + file
		writeFileSync(selectionPath, "{ not json", "utf8");
		expect(readKanbanSelectedProviderId()).toBeNull();
	});

	it("returns null when the providerId field is missing or blank", () => {
		writeKanbanSelectedProviderId("seed");
		writeFileSync(selectionPath, JSON.stringify({ providerId: "   " }), "utf8");
		expect(readKanbanSelectedProviderId()).toBeNull();
		writeFileSync(selectionPath, JSON.stringify({ other: "x" }), "utf8");
		expect(readKanbanSelectedProviderId()).toBeNull();
	});
});
