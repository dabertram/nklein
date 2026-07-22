import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RuntimeProjectInitializerBrief } from "../../../src/core/projects-api-contract";
import {
	resolveProjectInitializerBrief,
	writeCanonicalProjectBrief,
} from "../../../src/trpc/projects-api/project-initializer-files";

const cleanup: string[] = [];

function tempDir(): string {
	const path = join(tmpdir(), `nklein-initializer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(path, { recursive: true });
	cleanup.push(path);
	return path;
}

function completeBrief(references: RuntimeProjectInitializerBrief["references"] = []): RuntimeProjectInitializerBrief {
	return {
		mode: "beginner",
		projectKind: "greenfield",
		outcome: "Ship the planner.",
		audience: "Households.",
		stackRuntime: "Node.js 22 and TypeScript.",
		acceptanceCommands: "npm test",
		successCriteria: "A seven-day plan is exported.",
		inScope: "Planning and export.",
		outOfScope: "Cloud sync.",
		domainConcepts: "Plans contain days and meals.",
		constraints: "Local only.",
		uncertainties: "none known",
		effort: "small",
		autonomy: "checkpoints",
		references,
	};
}

afterEach(() => {
	for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("project initializer files", () => {
	it("resolves a regular text reference and writes the canonical brief once", async () => {
		const base = tempDir();
		const project = join(base, "project");
		mkdirSync(project);
		writeFileSync(join(base, "prd.md"), "The planner has seven days.\n", "utf8");

		const brief = await resolveProjectInitializerBrief({
			brief: completeBrief([{ kind: "file", value: "prd.md" }]),
			referenceBasePath: base,
			isRemoteMode: false,
			allowedBrowseRoots: [],
		});
		expect(brief.references[0]).toMatchObject({ kind: "file", content: "The planner has seven days.\n" });

		const briefPath = await writeCanonicalProjectBrief({ projectPath: project, projectName: "Planner", brief });
		expect(await readFile(briefPath, "utf8")).toContain("The planner has seven days.");
		await expect(
			writeCanonicalProjectBrief({ projectPath: project, projectName: "Planner", brief }),
		).rejects.toThrow();
	});

	it("confines remote file references to the configured roots", async () => {
		const base = tempDir();
		const allowed = join(base, "allowed");
		mkdirSync(allowed);
		const outside = join(base, "outside.md");
		writeFileSync(outside, "outside", "utf8");

		await expect(
			resolveProjectInitializerBrief({
				brief: completeBrief([{ kind: "file", value: outside }]),
				referenceBasePath: allowed,
				isRemoteMode: true,
				allowedBrowseRoots: [allowed],
			}),
		).rejects.toThrow("outside the allowed remote directories");
	});

	it("rejects symlink references instead of following them across the remote boundary", async () => {
		if (process.platform === "win32") return;
		const base = tempDir();
		const allowed = join(base, "allowed");
		mkdirSync(allowed);
		const outside = join(base, "outside.md");
		writeFileSync(outside, "outside", "utf8");
		symlinkSync(outside, join(allowed, "linked.md"));

		await expect(
			resolveProjectInitializerBrief({
				brief: completeBrief([{ kind: "file", value: join(allowed, "linked.md") }]),
				referenceBasePath: allowed,
				isRemoteMode: true,
				allowedBrowseRoots: [allowed],
			}),
		).rejects.toThrow("not a regular non-symlink file");
	});

	it("rejects oversized and binary-looking reference files", async () => {
		const base = tempDir();
		writeFileSync(join(base, "large.txt"), "x".repeat(200_001), "utf8");
		writeFileSync(join(base, "binary.txt"), "safe\0unsafe", "utf8");

		for (const [file, message] of [
			["large.txt", "exceeds the 200000 byte intake limit"],
			["binary.txt", "is not plain text"],
		] as const) {
			await expect(
				resolveProjectInitializerBrief({
					brief: completeBrief([{ kind: "file", value: file }]),
					referenceBasePath: base,
					isRemoteMode: false,
					allowedBrowseRoots: [],
				}),
			).rejects.toThrow(message);
		}
	});
});
