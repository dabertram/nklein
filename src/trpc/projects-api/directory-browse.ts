import { readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type {
	RuntimeDirectoryListRequest,
	RuntimeDirectoryListResponse,
	RuntimeProjectDirectoryPickerResponse,
} from "../../core/api-contract";
import { parseDirectoryListRequest } from "../../core/api-validation";
import { isPathWithinRoot } from "../../workspace/path-sandbox";
import { confineToAllowedRoots } from "../../workspace/remote-path-confinement";

interface DirectoryBrowseDeps {
	/** The sandbox root all browsing is confined to (computed in the factory from remote/local mode). */
	filesystemRoot: string;
	isRemoteMode: boolean;
	allowedBrowseRoots: readonly string[];
	pickDirectoryPathFromSystemDialog: () => string | null;
}

/**
 * Pick a project directory via the host's native system dialog (the projects-api `pickProjectDirectory`
 * procedure handler, extracted from the factory). Returns ok:false when the dialog is dismissed.
 */
export async function handlePickProjectDirectory(
	deps: DirectoryBrowseDeps,
): Promise<RuntimeProjectDirectoryPickerResponse> {
	try {
		const selectedPath = deps.pickDirectoryPathFromSystemDialog();
		if (!selectedPath) {
			return { ok: false, path: null, error: "No directory was selected." };
		}
		return { ok: true, path: selectedPath };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, path: null, error: message };
	}
}

/**
 * List the sub-directories of a path for the project picker (the projects-api `listDirectoryContents`
 * procedure handler). Confines every resolved path to the sandbox root (and, in remote mode, the allowed
 * browse roots), hides dotfiles, flags git repositories, and surfaces a within-root parent for navigation.
 */
export async function handleListDirectoryContents(
	input: RuntimeDirectoryListRequest,
	deps: DirectoryBrowseDeps,
): Promise<RuntimeDirectoryListResponse> {
	const body = parseDirectoryListRequest(input);
	const rootPath = deps.filesystemRoot;
	const requestedPath = body.path?.trim() || "";

	// Remote mode: every resolved path must be within an allowed root. We check before the local
	// rootPath sandbox so the error message is consistent regardless of absolute/relative input.
	if (deps.isRemoteMode && requestedPath) {
		const candidate = isAbsolute(requestedPath) ? requestedPath : resolve(rootPath, requestedPath);
		const confinement = confineToAllowedRoots(candidate, deps.allowedBrowseRoots);
		if (!confinement.allowed) {
			return {
				ok: false,
				currentPath: rootPath,
				parentPath: null,
				rootPath,
				entries: [],
				error: "Access denied: path is outside the allowed directories for remote mode.",
			} satisfies RuntimeDirectoryListResponse;
		}
	}

	// Reject absolute paths that fall outside the sandbox.
	if (requestedPath && isAbsolute(requestedPath)) {
		if (!isPathWithinRoot(rootPath, requestedPath)) {
			return {
				ok: false,
				currentPath: rootPath,
				parentPath: null,
				rootPath,
				entries: [],
				error: "Access denied: absolute path is outside the server root directory.",
			} satisfies RuntimeDirectoryListResponse;
		}
		// Absolute path is within sandbox — fall through to existing stat/readdir logic.
	}
	const resolvedPath = resolve(rootPath, requestedPath) || rootPath;

	if (!isPathWithinRoot(rootPath, resolvedPath)) {
		return {
			ok: false,
			currentPath: rootPath,
			parentPath: null,
			rootPath,
			entries: [],
			error: "Access denied: path is outside the server root directory.",
		} satisfies RuntimeDirectoryListResponse;
	}

	try {
		const dirStat = await stat(resolvedPath);
		if (!dirStat.isDirectory()) {
			return {
				ok: false,
				currentPath: resolvedPath,
				parentPath: null,
				rootPath,
				entries: [],
				error: "The specified path is not a directory.",
			} satisfies RuntimeDirectoryListResponse;
		}

		const dirEntries = await readdir(resolvedPath, { withFileTypes: true });
		const directoryEntries = dirEntries.filter((entry) => {
			if (!entry.isDirectory()) {
				return false;
			}
			if (entry.name.startsWith(".")) {
				return false;
			}
			return true;
		});

		directoryEntries.sort((a, b) => a.name.localeCompare(b.name));

		const entries = await Promise.all(
			directoryEntries.map(async (entry) => {
				const entryPath = resolve(resolvedPath, entry.name);
				let isGitRepository = false;
				try {
					const gitDirStat = await stat(resolve(entryPath, ".git"));
					isGitRepository = gitDirStat.isDirectory() || gitDirStat.isFile();
				} catch {
					// .git does not exist or is not accessible
				}
				return {
					name: entry.name,
					path: entryPath,
					isGitRepository,
				};
			}),
		);

		const isAtRoot = resolvedPath === rootPath;
		const rawParent = dirname(resolvedPath);
		const parentIsWithinRoot = isPathWithinRoot(rootPath, rawParent);
		const parentPath = isAtRoot ? null : parentIsWithinRoot ? rawParent : null;

		return {
			ok: true,
			currentPath: resolvedPath,
			parentPath,
			rootPath,
			entries,
		} satisfies RuntimeDirectoryListResponse;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const isPermissionError =
			error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EACCES";
		const isNotFoundError =
			error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
		return {
			ok: false,
			currentPath: resolvedPath,
			parentPath: null,
			rootPath,
			entries: [],
			error: isPermissionError
				? "Permission denied: cannot read this directory."
				: isNotFoundError
					? "Directory not found."
					: message,
		} satisfies RuntimeDirectoryListResponse;
	}
}
