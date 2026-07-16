import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSkillPin, readSkillPins, type StoredPin, upsertSkillPin } from "../../../src/state/skill-pin-store";

const pin = (over: Partial<StoredPin>): StoredPin => ({
	id: "skill-a",
	contentHash: "hash-v1",
	version: "1.2.3",
	trust: "community",
	pinnedAt: 1,
	...over,
});

describe("skill-pin-store", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "nklein-pins-"));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("reads empty when unset; upserts and gets a pin by id", async () => {
		expect(await readSkillPins({ rootDir: root })).toEqual([]);
		expect(await getSkillPin("skill-a", { rootDir: root })).toBeNull();
		await upsertSkillPin(pin({}), { rootDir: root });
		expect(await getSkillPin("skill-a", { rootDir: root })).toMatchObject({ contentHash: "hash-v1" });
	});

	it("re-pinning an id REPLACES its record (TOFU re-review updates the pin)", async () => {
		await upsertSkillPin(pin({}), { rootDir: root });
		await upsertSkillPin(pin({ contentHash: "hash-v2", version: "2.0.0", pinnedAt: 2 }), { rootDir: root });
		const pins = await readSkillPins({ rootDir: root });
		expect(pins).toHaveLength(1);
		expect(pins[0]).toMatchObject({ contentHash: "hash-v2", version: "2.0.0" });
	});

	it("keeps distinct artifact ids as separate pins", async () => {
		await upsertSkillPin(pin({ id: "skill-a" }), { rootDir: root });
		await upsertSkillPin(pin({ id: "mcp-b" }), { rootDir: root });
		expect((await readSkillPins({ rootDir: root })).map((p) => p.id).sort()).toEqual(["mcp-b", "skill-a"]);
	});
});
