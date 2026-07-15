import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	LEGACY_KANBAN_RUNTIME_DIR_NAME,
	NKLEIN_HOME_DIR_NAME,
	NKLEIN_RUNTIME_DIR_NAME,
	resolveLegacyKanbanRuntimeHomePath,
	resolveNkleinRuntimeHomePath,
} from "../../../src/config/runtime-paths";

describe("runtime-paths", () => {
	it("resolves the nklein runtime home under <home>/<nklein-dir>/<runtime-dir>", () => {
		expect(resolveNkleinRuntimeHomePath("/home/x")).toBe(
			join("/home/x", NKLEIN_HOME_DIR_NAME, NKLEIN_RUNTIME_DIR_NAME),
		);
	});

	it("resolves the legacy kanban runtime home under the legacy runtime dir", () => {
		expect(resolveLegacyKanbanRuntimeHomePath("/home/x")).toBe(
			join("/home/x", NKLEIN_HOME_DIR_NAME, LEGACY_KANBAN_RUNTIME_DIR_NAME),
		);
	});

	it("keeps the nklein and legacy homes distinct (a migration reads one, writes the other)", () => {
		expect(resolveNkleinRuntimeHomePath("/home/x")).not.toBe(resolveLegacyKanbanRuntimeHomePath("/home/x"));
	});
});
