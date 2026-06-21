import { join } from "node:path";

export {
	LEGACY_KANBAN_RUNTIME_DIR_NAME,
	LEGACY_KANBAN_RUNTIME_HOME_DIR_NAME,
	NKLEIN_HOME_DIR_NAME,
	NKLEIN_PROJECT_CONFIG_DIR_NAME,
	NKLEIN_RUNTIME_DIR_NAME,
	NKLEIN_RUNTIME_HOME_DIR_NAME,
	TASK_WORKTREES_DIR_NAME,
	TASK_WORKTREES_HOME_DIR_NAME,
} from "./runtime-path-constants";

import {
	LEGACY_KANBAN_RUNTIME_DIR_NAME,
	NKLEIN_HOME_DIR_NAME,
	NKLEIN_RUNTIME_DIR_NAME,
} from "./runtime-path-constants";

export function resolveNkleinRuntimeHomePath(homePath: string): string {
	return join(homePath, NKLEIN_HOME_DIR_NAME, NKLEIN_RUNTIME_DIR_NAME);
}

export function resolveLegacyKanbanRuntimeHomePath(homePath: string): string {
	return join(homePath, NKLEIN_HOME_DIR_NAME, LEGACY_KANBAN_RUNTIME_DIR_NAME);
}
