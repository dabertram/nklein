// §5.U cohesive extraction (2026-07-07): config-file PATH RESOLUTION + lock-request derivation, lifted out of the
// large runtime-config.ts. Pure path math over the home/project dir constants (no config state, no I/O) — resolves the
// global + per-project config.json paths, normalizes them for cross-platform comparison, and derives the file locks a
// load/save must hold. runtime-config.ts imports these back; the two public getters are also re-exported there.
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { LockRequest } from "../fs/locked-file-system";
import {
	NKLEIN_HOME_DIR_NAME,
	NKLEIN_PROJECT_CONFIG_DIR_NAME,
	NKLEIN_RUNTIME_DIR_NAME,
} from "./runtime-path-constants";

const RUNTIME_HOME_PARENT_DIR = NKLEIN_HOME_DIR_NAME;
const RUNTIME_HOME_DIR = NKLEIN_RUNTIME_DIR_NAME;
const CONFIG_FILENAME = "config.json";
const PROJECT_CONFIG_PARENT_DIR = NKLEIN_HOME_DIR_NAME;
const PROJECT_CONFIG_DIR = NKLEIN_PROJECT_CONFIG_DIR_NAME;
const PROJECT_CONFIG_FILENAME = "config.json";

function getRuntimeHomePath(): string {
	return join(homedir(), RUNTIME_HOME_PARENT_DIR, RUNTIME_HOME_DIR);
}

export function getRuntimeGlobalConfigPath(): string {
	return join(getRuntimeHomePath(), CONFIG_FILENAME);
}

export function getRuntimeProjectConfigPath(cwd: string): string {
	return join(resolve(cwd), PROJECT_CONFIG_PARENT_DIR, PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILENAME);
}

interface RuntimeConfigPaths {
	globalConfigPath: string;
	projectConfigPath: string | null;
}

export function normalizePathForComparison(path: string): string {
	const normalized = resolve(path).replaceAll("\\", "/");
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function resolveRuntimeConfigPaths(cwd: string | null): RuntimeConfigPaths {
	const globalConfigPath = getRuntimeGlobalConfigPath();
	if (cwd === null) {
		return {
			globalConfigPath,
			projectConfigPath: null,
		};
	}

	const normalizedCwd = normalizePathForComparison(cwd);
	const normalizedHome = normalizePathForComparison(homedir());
	if (normalizedCwd === normalizedHome) {
		return {
			globalConfigPath,
			projectConfigPath: null,
		};
	}

	return {
		globalConfigPath,
		projectConfigPath: getRuntimeProjectConfigPath(cwd),
	};
}

export function getRuntimeConfigLockRequests(cwd: string | null): LockRequest[] {
	const paths = resolveRuntimeConfigPaths(cwd);
	const requests: LockRequest[] = [
		{
			path: paths.globalConfigPath,
			type: "file",
		},
	];
	if (paths.projectConfigPath) {
		requests.push({
			path: paths.projectConfigPath,
			type: "file",
		});
	}
	return requests;
}
