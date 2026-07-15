import { describe, expect, it } from "vitest";
import {
	readKanbanLaunchConfigFromSessionRecord,
	toPersistedLaunchConfig,
} from "../../../src/nklein-agent/nklein-session-launch-config";
import type { StartNKleinSessionRuntimeRequest } from "../../../src/nklein-agent/nklein-session-runtime";
import type { NKleinSdkSessionRecord } from "../../../src/nklein-agent/sdk-runtime-boundary";

function record(launchConfig: unknown): NKleinSdkSessionRecord {
	return { metadata: { kanban: { launchConfig } } } as unknown as NKleinSdkSessionRecord;
}

describe("readKanbanLaunchConfigFromSessionRecord (§5.U)", () => {
	it("reads a launch config, lowercasing the provider and trimming the model", () => {
		const config = readKanbanLaunchConfigFromSessionRecord(
			record({ providerId: "LMStudio", modelId: "  qwen-coder  ", contextWindow: 32768 }),
		);
		expect(config).toMatchObject({ providerId: "lmstudio", modelId: "qwen-coder", contextWindow: 32768 });
	});

	it("returns null when the launch config is missing or lacks provider/model", () => {
		expect(readKanbanLaunchConfigFromSessionRecord(record(undefined))).toBeNull();
		expect(readKanbanLaunchConfigFromSessionRecord(record({ modelId: "qwen" }))).toBeNull(); // no providerId
		expect(readKanbanLaunchConfigFromSessionRecord(record({ providerId: "lmstudio" }))).toBeNull(); // no modelId
	});
});

describe("toPersistedLaunchConfig (§5.U)", () => {
	it("normalizes provider/model and omits undefined optionals", () => {
		const persisted = toPersistedLaunchConfig({
			providerId: "LMStudio",
			modelId: "  qwen  ",
			workspaceRoot: "  /w  ",
		} as StartNKleinSessionRuntimeRequest);
		expect(persisted).toEqual({ providerId: "lmstudio", modelId: "qwen", workspaceRoot: "/w" });
		expect(persisted).not.toHaveProperty("baseUrl"); // undefined optionals are dropped
	});

	it("coalesces an empty workspaceRoot/baseUrl to null when the field is present", () => {
		const persisted = toPersistedLaunchConfig({
			providerId: "lmstudio",
			modelId: "qwen",
			workspaceRoot: "   ",
			baseUrl: "",
		} as StartNKleinSessionRuntimeRequest);
		expect(persisted.workspaceRoot).toBeNull();
		expect(persisted.baseUrl).toBeNull();
	});
});
