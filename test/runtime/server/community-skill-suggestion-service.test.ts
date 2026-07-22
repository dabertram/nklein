import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCommunitySkillImportService } from "../../../src/server/community-skill-import-service";
import { createCommunitySkillSuggestionService } from "../../../src/server/community-skill-suggestion-service";

describe("createCommunitySkillSuggestionService", () => {
	const roots: string[] = [];
	afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

	it("returns only current pinned snapshots as quarantined, non-prompt-eligible suggestions", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-skill-suggest-"));
		roots.push(root);
		const communityRoot = join(root, "community");
		const pinRoot = join(root, "pins");
		const skillDir = join(communityRoot, "inbox", "reviewer");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			"---\nname: security-review\ndescription: Review repository security boundaries\n---\nReview carefully.\n",
			"utf8",
		);
		await chmod(join(skillDir, "SKILL.md"), 0o644);
		const imports = createCommunitySkillImportService({ rootDir: communityRoot, pinRootDir: pinRoot });
		const request = { directory: "reviewer", sourceUrl: "https://example.test/security-review" };
		const review = await imports.review(request);
		const imported = await imports.approve({
			...request,
			expectedContentHash: review.contentHash,
			confirmation: true,
		});
		const result = await createCommunitySkillSuggestionService({
			rootDir: communityRoot,
			pinRootDir: pinRoot,
		}).suggest({
			sessionId: "task-1",
			role: "reviewer",
			taskText: "Review repository security",
		});
		expect(result).toMatchObject({
			channel: "suggest-only",
			suggestions: [
				{
					snapshotId: imported.snapshotId,
					quarantinedData: true,
					humanApprovalRequired: true,
					promptEligible: false,
					active: false,
				},
			],
		});
	});
});
