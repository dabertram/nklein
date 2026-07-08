import { describe, expect, it } from "vitest";
import { decideCatalogUpdate } from "../../../src/core/catalog-update-decision";

describe("decideCatalogUpdate (§5.AB llmfit catalog-update decider — opt-in, never silent)", () => {
	it("mode off ⇒ noop regardless of a newer remote", () => {
		expect(decideCatalogUpdate({ mode: "off", localRevision: "a", remoteRevision: "b" }).action).toBe("noop");
	});

	it("no remote revision (fetch failed/skipped) ⇒ noop", () => {
		expect(decideCatalogUpdate({ mode: "notify", localRevision: "a", remoteRevision: null }).action).toBe("noop");
	});

	it("matching revisions ⇒ up_to_date", () => {
		expect(decideCatalogUpdate({ mode: "auto", localRevision: "sha1", remoteRevision: "sha1" }).action).toBe(
			"up_to_date",
		);
	});

	it("notify + newer remote ⇒ suggest_update (never pulls); no local copy also suggests", () => {
		const newer = decideCatalogUpdate({ mode: "notify", localRevision: "sha1", remoteRevision: "sha2" });
		expect(newer).toMatchObject({ action: "suggest_update", remoteRevision: "sha2" });
		const fresh = decideCatalogUpdate({ mode: "notify", localRevision: null, remoteRevision: "sha2" });
		expect(fresh.action).toBe("suggest_update");
	});

	it("auto + newer remote ⇒ pull_update (the caller performs the pull)", () => {
		expect(decideCatalogUpdate({ mode: "auto", localRevision: "sha1", remoteRevision: "sha2" })).toMatchObject({
			action: "pull_update",
			remoteRevision: "sha2",
		});
	});
});
