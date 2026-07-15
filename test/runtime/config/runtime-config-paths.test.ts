import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import {
	getRuntimeConfigLockRequests,
	getRuntimeGlobalConfigPath,
	getRuntimeProjectConfigPath,
	normalizePathForComparison,
	resolveRuntimeConfigPaths,
} from "../../../src/config/runtime-config-paths";

describe("runtime-config-paths (§5.U)", () => {
	it("resolves the global + project config.json paths", () => {
		expect(getRuntimeGlobalConfigPath().endsWith("config.json")).toBe(true);
		const projectPath = getRuntimeProjectConfigPath("/some/project");
		expect(projectPath.endsWith("config.json")).toBe(true);
		expect(projectPath.startsWith("/some/project")).toBe(true);
	});

	it("normalizePathForComparison resolves relative paths and uses forward slashes", () => {
		const normalized = normalizePathForComparison(".");
		expect(normalized).toContain("/");
		expect(normalized).not.toContain("\\");
		// A relative path resolves to an absolute one.
		expect(normalized.length).toBeGreaterThan(1);
	});

	it("returns NO project config path when cwd is null or the home dir (never a project config in $HOME)", () => {
		expect(resolveRuntimeConfigPaths(null).projectConfigPath).toBeNull();
		expect(resolveRuntimeConfigPaths(homedir()).projectConfigPath).toBeNull();
	});

	it("returns a project config path for a non-home cwd", () => {
		const paths = resolveRuntimeConfigPaths("/some/other/project");
		expect(paths.projectConfigPath).not.toBeNull();
		expect(paths.globalConfigPath.endsWith("config.json")).toBe(true);
	});

	it("locks only the global config for home/null, both for a project cwd", () => {
		expect(getRuntimeConfigLockRequests(null)).toHaveLength(1);
		expect(getRuntimeConfigLockRequests(homedir())).toHaveLength(1);
		const projectLocks = getRuntimeConfigLockRequests("/some/other/project");
		expect(projectLocks).toHaveLength(2);
		expect(projectLocks.every((lock) => lock.type === "file")).toBe(true);
	});
});
