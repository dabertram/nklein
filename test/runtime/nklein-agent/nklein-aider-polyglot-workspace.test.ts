import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAiderPolyglotTask, PINNED_AIDER_POLYGLOT_COMMIT } from "../../../src/core/aider-polyglot-benchmark";
import { materializeAiderPolyglotWorkspace } from "../../../src/nklein-agent/nklein-aider-polyglot-workspace";

const task = buildAiderPolyglotTask({
	language: "python",
	exercise: "pov",
	corpusCommit: PINNED_AIDER_POLYGLOT_COMMIT,
	configText: JSON.stringify({ files: { solution: ["pov.py"], test: ["pov_test.py"] } }),
	instructionParts: ["Implement it."],
});

describe("materializeAiderPolyglotWorkspace", () => {
	it("refuses a missing local corpus and preserves an occupied workspace", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-aider-workspace-"));
		await expect(
			materializeAiderPolyglotWorkspace({
				task,
				corpusDir: join(root, "missing"),
				workspaceParentDir: join(root, "work"),
				image: "nklein/agent-sandbox:0.0.1",
				runDocker: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
			}),
		).rejects.toThrow(/missing from the local corpus/);
		const corpus = join(root, "corpus", "python", "exercises", "practice", "pov");
		const workspaceParent = join(root, "occupied");
		await mkdir(corpus, { recursive: true });
		await writeFile(join(corpus, "pov.py"), "pass\n");
		await mkdir(workspaceParent);
		await writeFile(join(workspaceParent, task.instanceId), "user-owned");
		await expect(
			materializeAiderPolyglotWorkspace({
				task,
				corpusDir: join(root, "corpus"),
				workspaceParentDir: workspaceParent,
				image: "nklein/agent-sandbox:0.0.1",
				runDocker: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
			}),
		).rejects.toThrow(/already exists/);
		expect(await readFile(join(workspaceParent, task.instanceId), "utf8")).toBe("user-owned");
	});

	it("cleans an owned half-workspace after a Docker failure", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-aider-failed-"));
		const corpus = join(root, "corpus", "python", "exercises", "practice", "pov");
		const workspaceParent = join(root, "work");
		await mkdir(corpus, { recursive: true });
		await writeFile(join(corpus, "pov.py"), "pass\n");
		await expect(
			materializeAiderPolyglotWorkspace({
				task,
				corpusDir: join(root, "corpus"),
				workspaceParentDir: workspaceParent,
				image: "nklein/agent-sandbox:0.0.1",
				runDocker: async () => ({ exitCode: 1, stdout: "", stderr: "copy failed" }),
			}),
		).rejects.toThrow(/copy failed/);
		await expect(readFile(join(workspaceParent, task.instanceId, "pov.py"), "utf8")).rejects.toThrow();
	});
});
