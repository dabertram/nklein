import { describe, expect, it } from "vitest";
import {
	DEFAULT_AGENT_ID,
	DEFAULT_DEVELOPER_MODE_ENABLED,
	DEFAULT_MAX_CONCURRENT_TASKS,
	DEFAULT_REPLAY_CARDS_ENABLED,
} from "../../../src/config/runtime-config-defaults";
import type { RuntimeGlobalConfigFileShape } from "../../../src/config/runtime-config-types";
import { buildRuntimeGlobalConfigFilePayload } from "../../../src/config/runtime-global-config-file-payload";

describe("buildRuntimeGlobalConfigFilePayload", () => {
	it("keeps a freshly-defaulted config sparse (no existing file)", () => {
		// Every field defaults, nothing was on disk -> the persisted shape is empty.
		expect(buildRuntimeGlobalConfigFilePayload({}, null)).toEqual({});
	});

	it("writes a scalar field only when it differs from its default", () => {
		const changed = buildRuntimeGlobalConfigFilePayload(
			{ developerModeEnabled: !DEFAULT_DEVELOPER_MODE_ENABLED },
			null,
		);
		expect(changed.developerModeEnabled).toBe(!DEFAULT_DEVELOPER_MODE_ENABLED);

		const unchanged = buildRuntimeGlobalConfigFilePayload(
			{ developerModeEnabled: DEFAULT_DEVELOPER_MODE_ENABLED },
			null,
		);
		expect(unchanged).not.toHaveProperty("developerModeEnabled");
	});

	it("preserves an existing key even when its value equals the default (round-trips on resave)", () => {
		const existing: RuntimeGlobalConfigFileShape = { replayCardsEnabled: DEFAULT_REPLAY_CARDS_ENABLED };
		const payload = buildRuntimeGlobalConfigFilePayload({}, existing);
		expect(payload.replayCardsEnabled).toBe(DEFAULT_REPLAY_CARDS_ENABLED);
	});

	it("does not persist the default agent id unless it was already present on disk", () => {
		const fresh = buildRuntimeGlobalConfigFilePayload({ selectedAgentId: DEFAULT_AGENT_ID }, null);
		expect(fresh).not.toHaveProperty("selectedAgentId");

		const existing: RuntimeGlobalConfigFileShape = { selectedAgentId: DEFAULT_AGENT_ID };
		const preserved = buildRuntimeGlobalConfigFilePayload({}, existing);
		expect(preserved.selectedAgentId).toBe(DEFAULT_AGENT_ID);
	});

	it("normalizes a provided value (clamps/sanitizes) rather than writing it verbatim", () => {
		// A non-positive maxConcurrentTasks is invalid; normalization falls back to the default,
		// which then is not persisted (equals default, no pre-existing key).
		const payload = buildRuntimeGlobalConfigFilePayload({ maxConcurrentTasks: -5 }, null);
		expect(payload.maxConcurrentTasks ?? DEFAULT_MAX_CONCURRENT_TASKS).toBe(DEFAULT_MAX_CONCURRENT_TASKS);
	});
});
