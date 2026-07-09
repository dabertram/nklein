import { describe, expect, it } from "vitest";
import type { RuntimeModelRoles } from "@/runtime/types";
import {
	MODEL_ROLE_IDS,
	MODEL_ROLE_LABELS,
	normalizeModelRolesForSettings,
	serializeModelRoles,
} from "./runtime-settings-model-roles";

describe("model role constants", () => {
	it("exposes the three roles with labels", () => {
		expect(MODEL_ROLE_IDS).toEqual(["architect", "worker", "reviewer"]);
		expect(MODEL_ROLE_IDS.every((id) => typeof MODEL_ROLE_LABELS[id] === "string")).toBe(true);
	});
});

describe("normalizeModelRolesForSettings", () => {
	it("returns {} for undefined", () => {
		expect(normalizeModelRolesForSettings(undefined)).toEqual({});
	});

	it("trims provider/model, drops empty roles, and keeps only roles with content", () => {
		const input = {
			architect: { providerId: "  lmstudio  ", modelId: "m" },
			worker: { providerId: "   " }, // whitespace-only ⇒ dropped
		} as unknown as RuntimeModelRoles;
		const out = normalizeModelRolesForSettings(input);
		expect(out.architect).toEqual({ providerId: "lmstudio", modelId: "m" });
		expect(out.worker).toBeUndefined();
	});

	it("filters additionalModels without a provider or model", () => {
		const input = {
			reviewer: {
				modelId: "r",
				additionalModels: [{ providerId: "p" }, { providerId: "   ", modelId: "  " }],
			},
		} as unknown as RuntimeModelRoles;
		const out = normalizeModelRolesForSettings(input);
		expect(out.reviewer?.additionalModels).toEqual([{ providerId: "p" }]);
	});

	it("keeps pinned assignment only when the role names a primary model", () => {
		const input = {
			architect: { providerId: "lmstudio", modelId: "m", modelSelectionMode: "pinned" },
			worker: { modelSelectionMode: "pinned" },
			reviewer: { providerId: "lmstudio", modelId: "r", modelSelectionMode: "auto" },
		} as unknown as RuntimeModelRoles;
		const out = normalizeModelRolesForSettings(input);
		expect(out.architect).toEqual({ providerId: "lmstudio", modelId: "m", modelSelectionMode: "pinned" });
		expect(out.worker).toBeUndefined();
		expect(out.reviewer).toEqual({ providerId: "lmstudio", modelId: "r" });
	});
});

describe("serializeModelRoles", () => {
	it("produces a stable serialization equal to the normalized JSON (whitespace-insensitive)", () => {
		const a = { worker: { modelId: "m" } } as unknown as RuntimeModelRoles;
		const b = { worker: { modelId: "  m  " } } as unknown as RuntimeModelRoles;
		expect(serializeModelRoles(a)).toBe(JSON.stringify(normalizeModelRolesForSettings(a)));
		expect(serializeModelRoles(a)).toBe(serializeModelRoles(b)); // dirty-tracking stability
	});
});
