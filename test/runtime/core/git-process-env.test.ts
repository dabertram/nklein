import { afterEach, describe, expect, it } from "vitest";
import { createGitProcessEnv } from "../../../src/core/git-process-env";

const TOUCHED = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "NKLEIN_TEST_PASSTHROUGH"] as const;
const saved = new Map<string, string | undefined>();

afterEach(() => {
	for (const key of TOUCHED) {
		const prev = saved.get(key);
		if (prev === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = prev;
		}
	}
	saved.clear();
});

function setEnv(key: (typeof TOUCHED)[number], value: string): void {
	saved.set(key, process.env[key]);
	process.env[key] = value;
}

describe("createGitProcessEnv", () => {
	it("strips repository-scoped git vars that would hijack a repo-scoped git command", () => {
		setEnv("GIT_DIR", "/somewhere/.git");
		setEnv("GIT_WORK_TREE", "/somewhere");
		setEnv("GIT_INDEX_FILE", "/somewhere/.git/index");
		const env = createGitProcessEnv();
		expect(env.GIT_DIR).toBeUndefined();
		expect(env.GIT_WORK_TREE).toBeUndefined();
		expect(env.GIT_INDEX_FILE).toBeUndefined();
	});

	it("passes through unrelated env vars", () => {
		setEnv("NKLEIN_TEST_PASSTHROUGH", "keepme");
		expect(createGitProcessEnv().NKLEIN_TEST_PASSTHROUGH).toBe("keepme");
	});

	it("applies overrides on top, even re-supplying a stripped key intentionally", () => {
		setEnv("GIT_DIR", "/inherited/.git");
		const env = createGitProcessEnv({ GIT_DIR: "/explicit/.git", FOO: "bar" });
		expect(env.GIT_DIR).toBe("/explicit/.git"); // override wins over the strip
		expect(env.FOO).toBe("bar");
	});
});
